import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { pendingAdminFacts } from './accounting-admin-bridge.js';

// Bos Cyo, 2026-10-03: laporan Untung Rugi gerai Akuntansi dibaca dari jurnal,
// jadi setiap transaksi uang HARUS berjurnal. Kalau belum bisa karena setelan
// belum lengkap, Una yang membereskan. Endpoint ini mata Una (dan akuntan
// manusia): satu daftar transaksi yang masih berutang jurnal, kenapa mandek,
// dan alat/langkah mana yang membereskannya. Hanya baca -- tidak memposting
// apa pun. Penjualan/pembelian/pengeluaran yang dibatalkan tidak berutang
// jurnal (jurnal pembaliknya netral), jadi hanya dihitung, tidak ditampilkan.

export const ACCOUNTING_BRIDGE_ISSUES_CONTRACT = 'MAXI_ACCOUNTING_BRIDGE_ISSUES_V1';
const MAX_ROWS = 300;
const MAX_PENDING_ADMIN = 100;

const SYNC = 'sinkron_akuntansi';

// Kode penyebab (src/accounting-pos-bridge.js dst.) -> arti dan cara membereskan.
// `alat` = nama alat tulis Una; null = belum ada alat, perlu orang di layar yang disebut.
const PENYEBAB = Object.freeze({
  NEEDS_PAYMENT_MAPPING: {
    arti: 'Cara bayar transaksi ini belum dihubungkan ke akun pembukuan.',
    alat: 'atur_cara_bayar',
    langkah: 'Hubungkan cara bayar itu ke akun Kas/Bank/Piutang yang benar, lalu sinkron_akuntansi.'
  },
  NEEDS_PAYMENT_METHOD: {
    arti: 'Transaksi tidak membawa cara bayar yang dikenali.',
    alat: null,
    langkah: 'Buka transaksinya di Data Transaksi dan periksa cara bayarnya.'
  },
  NEEDS_MAPPING: {
    arti: 'Aturan jurnal untuk jenis transaksi ini kosong atau belum punya satu Debit dan satu Kredit aktif.',
    alat: 'samakan_aturan_jurnal',
    langkah: 'Salin aturan jurnal kategori ini dari gerai yang sudah beres, lalu sinkron_akuntansi.'
  },
  NEEDS_TRANSACTION_MAPPING: {
    arti: 'Jenis transaksi ini belum punya kategori transaksi akuntansi.',
    alat: 'samakan_aturan_jurnal',
    langkah: 'Salin kategori dan aturan jurnalnya dari gerai yang sudah beres, lalu sinkron_akuntansi.'
  },
  NEEDS_FIXED_ACCOUNT: {
    arti: 'Salah satu baris aturan jurnal belum menunjuk akun tetap.',
    alat: 'samakan_aturan_jurnal',
    langkah: 'Salin aturan jurnal kategori ini dari gerai yang sudah beres, lalu sinkron_akuntansi.'
  },
  NEEDS_COMPONENT_ALLOCATION: {
    arti: 'Aturan jurnal punya beberapa akun tetap tetapi nominal tiap akun tidak dibagi.',
    alat: 'samakan_aturan_jurnal',
    langkah: 'Samakan aturan kategori ini dengan gerai yang sudah beres, lalu sinkron_akuntansi (coba sinkron dulu: setelan standar baru mungkin sudah memperbaikinya).'
  },
  NEEDS_PRODUCT_KIND: {
    arti: 'Barang di transaksi belum punya Jenis Barang.',
    alat: SYNC,
    langkah: 'Coba sinkron_akuntansi dulu: Jenis Barang yang kosong di transaksi lama diisi otomatis dari barangnya sekarang. Kalau sinkron tetap menolak, barangnya sendiri belum punya Jenis Barang: pasang lewat betulkan_klasifikasi_barang (jenis), lalu sinkron lagi.'
  },
  NEEDS_ITEM_CATEGORY_MAPPING: {
    arti: 'Jenis Barang belum dihubungkan ke akun Persediaan/HPP.',
    alat: null,
    langkah: 'Biasanya terisi otomatis (akun bawaan 1301/5101/4101). Kalau muncul, ada Jenis Barang yang kategori akunnya kosong: Setting Akuntansi > Kategori Barang. Belum ada alat Una untuk ini: laporkan ke Bos Cyo.'
  },
  NEEDS_COST_SNAPSHOT: {
    arti: 'HPP transaksi belum tercatat.',
    alat: 'hitung_ulang_hpp',
    langkah: 'Periksa HPP bahannya (audit_hpp), betulkan, lalu sinkron_akuntansi.'
  }
});

const KODE_PRODUK_KIND = /^NEEDS_(OUTPUT_|COMPONENT_)?PRODUCT_KIND$/;
const KODE_INVENTORY = /^NEEDS_(OUTPUT_|COMPONENT_)INVENTORY_MAPPING$/;
const KODE_PILIHAN = /^NEEDS_CHOICE_/;

function penyebabUntuk(code, detail, kategori) {
  if (!code) {
    return { arti: 'Belum pernah dicoba dikirim ke Akuntansi.', alat: SYNC, langkah: 'Jalankan sinkron_akuntansi.' };
  }
  let entry = PENYEBAB[code];
  if (!entry && KODE_PRODUK_KIND.test(code)) entry = PENYEBAB.NEEDS_PRODUCT_KIND;
  if (!entry && KODE_INVENTORY.test(code)) entry = PENYEBAB.NEEDS_ITEM_CATEGORY_MAPPING;
  if (!entry && KODE_PILIHAN.test(code)) entry = PENYEBAB.NEEDS_MAPPING;
  if (!entry && code === 'ACCOUNTING_POST_FAILED') {
    return { arti: detail || 'Posting jurnal gagal.', alat: SYNC, langkah: 'Coba sinkron_akuntansi sekali lagi; kalau gagal lagi dengan alasan yang sama, laporkan alasannya ke Bos Cyo.' };
  }
  if (!entry) {
    return { arti: detail || `Penyebab ${code}.`, alat: null, langkah: 'Belum ada alat untuk penyebab ini; laporkan kodenya dan rinciannya ke Bos Cyo.' };
  }
  const parameter = entry.alat === 'samakan_aturan_jurnal' && kategori ? { kategori } : undefined;
  return { ...entry, ...(parameter ? { parameter } : {}) };
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

const jakartaDate = iso => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso || '').slice(0, 10);
  return new Date(t + 7 * 3600 * 1000).toISOString().slice(0, 10);
};

// Transaksi yang sudah punya baris pengiriman tetapi belum POSTED.
const STUCK_SQL = `
  SELECT d.producer_module, d.fact_type, d.fact_id, d.transaction_category_code, d.status,
         d.failure_code, d.failure_detail, d.attempts, d.last_attempt_at, d.created_at,
         CASE d.fact_type WHEN 'SALE' THEN s.voided_at WHEN 'PURCHASE' THEN p.voided_at WHEN 'EXPENSE' THEN e.voided_at END AS voided_at,
         CASE d.fact_type WHEN 'SALE' THEN s.total_amount WHEN 'PURCHASE' THEN p.total_amount WHEN 'EXPENSE' THEN e.amount END AS amount
  FROM accounting_bridge_deliveries d
  LEFT JOIN sales s ON d.fact_type = 'SALE' AND s.id = d.fact_id AND s.store_id = d.store_id
  LEFT JOIN purchases p ON d.fact_type = 'PURCHASE' AND p.id = d.fact_id AND p.store_id = d.store_id
  LEFT JOIN expenses e ON d.fact_type = 'EXPENSE' AND e.id = d.fact_id AND e.store_id = d.store_id
  WHERE d.store_id = ? AND d.status <> 'POSTED'
  ORDER BY d.created_at, d.fact_id
  LIMIT ${MAX_ROWS + 1}
`;

// Transaksi kasir aktif yang belum punya baris pengiriman SAMA SEKALI
// (mis. dibuat sebelum jalur jurnal ada): sunyi di setiap hitungan lain.
const NEVER_TRIED_SQL = `
  SELECT fact_type, fact_id, amount, created_at FROM (
    SELECT 'SALE' AS fact_type, s.id AS fact_id, s.total_amount AS amount, s.created_at
    FROM sales s
    WHERE s.store_id = ? AND s.voided_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM accounting_bridge_deliveries d WHERE d.store_id = s.store_id AND d.producer_module = 'POS' AND d.fact_type = 'SALE' AND d.fact_id = s.id)
    UNION ALL
    SELECT 'PURCHASE', p.id, p.total_amount, p.created_at
    FROM purchases p
    WHERE p.store_id = ? AND p.voided_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM accounting_bridge_deliveries d WHERE d.store_id = p.store_id AND d.producer_module = 'POS' AND d.fact_type = 'PURCHASE' AND d.fact_id = p.id)
    UNION ALL
    SELECT 'EXPENSE', e.id, e.amount, e.created_at
    FROM expenses e
    WHERE e.store_id = ? AND e.voided_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM accounting_bridge_deliveries d WHERE d.store_id = e.store_id AND d.producer_module = 'POS' AND d.fact_type = 'EXPENSE' AND d.fact_id = e.id)
  )
  ORDER BY created_at, fact_id
  LIMIT ${MAX_ROWS + 1}
`;

const HPP_KOREKSI_TERTUNDA_SQL = `
  SELECT COUNT(*) AS n FROM (
    SELECT DISTINCT l.recalculation_id, l.sale_id
    FROM hpp_recalculation_lines l
    WHERE l.store_id = ?
      AND EXISTS (SELECT 1 FROM accounting_bridge_deliveries d WHERE d.store_id = l.store_id AND d.producer_module = 'POS' AND d.fact_type = 'SALE' AND d.fact_id = l.sale_id AND d.status = 'POSTED')
      AND NOT EXISTS (SELECT 1 FROM accounting_bridge_deliveries d WHERE d.store_id = l.store_id AND d.producer_module = 'ADMIN' AND d.fact_type = 'HPP_KOREKSI' AND d.fact_id = l.recalculation_id || ':' || l.sale_id AND d.status = 'POSTED')
  )
`;

export async function buildBridgeIssues(db, store) {
  const editionRow = await db.prepare('SELECT edition FROM stores WHERE id = ? LIMIT 1').bind(store.id).first();
  const base = {
    contract: ACCOUNTING_BRIDGE_ISSUES_CONTRACT,
    store: { code: store.code, name: store.storeName ?? store.name ?? store.code },
    edition: editionRow?.edition ?? null
  };
  if (editionRow?.edition !== 'ACCOUNTING') {
    return { ...base, accounting: false, summary: { owing: 0, byCause: [] }, facts: [], ignored: { voided: 0 }, truncated: false, hppCorrectionsWaiting: 0, order: [] };
  }

  const stuck = (await db.prepare(STUCK_SQL).bind(store.id).all()).results ?? [];
  const never = (await db.prepare(NEVER_TRIED_SQL).bind(store.id, store.id, store.id).all()).results ?? [];
  const adminNever = await pendingAdminFacts(db, store.id, MAX_PENDING_ADMIN);
  const hppWaiting = Number((await db.prepare(HPP_KOREKSI_TERTUNDA_SQL).bind(store.id).first())?.n || 0);

  let voided = 0;
  const facts = [];
  for (const row of stuck.slice(0, MAX_ROWS)) {
    if (row.voided_at) { voided += 1; continue; }
    const cause = penyebabUntuk(row.failure_code, row.failure_detail, row.transaction_category_code);
    facts.push({
      producer: row.producer_module,
      factType: row.fact_type,
      factId: row.fact_id,
      businessDate: jakartaDate(row.created_at),
      amountRupiah: row.amount === null || row.amount === undefined ? null : Number(row.amount),
      status: row.status,
      failureCode: row.failure_code || '',
      failureDetail: row.failure_detail || '',
      category: row.transaction_category_code || '',
      attempts: Number(row.attempts || 0),
      lastAttemptAt: row.last_attempt_at || null,
      neverTried: false,
      cause
    });
  }
  for (const row of never.slice(0, MAX_ROWS)) {
    facts.push({
      producer: 'POS',
      factType: row.fact_type,
      factId: row.fact_id,
      businessDate: jakartaDate(row.created_at),
      amountRupiah: row.amount === null || row.amount === undefined ? null : Number(row.amount),
      status: 'NEVER_TRIED',
      failureCode: '',
      failureDetail: '',
      category: '',
      attempts: 0,
      lastAttemptAt: null,
      neverTried: true,
      cause: penyebabUntuk('', '', '')
    });
  }
  for (const row of adminNever) {
    facts.push({
      producer: 'ADMIN',
      factType: row.fact_type,
      factId: row.fact_id,
      businessDate: jakartaDate(row.created_at),
      amountRupiah: null,
      status: 'NEVER_TRIED',
      failureCode: '',
      failureDetail: '',
      category: '',
      attempts: 0,
      lastAttemptAt: null,
      neverTried: true,
      cause: penyebabUntuk('', '', '')
    });
  }
  facts.sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.factId.localeCompare(b.factId));

  const grouped = new Map();
  for (const fact of facts) {
    const key = fact.failureCode || 'BELUM_DICOBA';
    const group = grouped.get(key) || { code: key, count: 0, cause: fact.cause, stores: store.code, firstDate: fact.businessDate, lastDate: fact.businessDate, amountRupiah: 0 };
    group.count += 1;
    group.firstDate = group.firstDate < fact.businessDate ? group.firstDate : fact.businessDate;
    group.lastDate = group.lastDate > fact.businessDate ? group.lastDate : fact.businessDate;
    group.amountRupiah += fact.amountRupiah || 0;
    grouped.set(key, group);
  }
  const byCause = [...grouped.values()].sort((a, b) => b.count - a.count);

  const hasOwing = facts.length > 0 || hppWaiting > 0;
  return {
    ...base,
    accounting: true,
    summary: { owing: facts.length, byCause },
    facts,
    ignored: { voided },
    hppCorrectionsWaiting: hppWaiting,
    truncated: stuck.length > MAX_ROWS || never.length > MAX_ROWS,
    order: hasOwing
      ? ['Betulkan setelan penyebabnya (lihat cause.alat per kelompok).', `Jalankan ${SYNC}.`, 'Baca jembatan_masalah lagi sampai summary.owing = 0.']
      : []
  };
}

export async function handleAccountingBridgeIssuesApi(request, env, pathname) {
  if (request.method !== 'GET' || pathname !== '/api/admin/accounting/bridge/issues') return null;
  const auth = await requireManagement(request, env.DB, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  return json(await buildBridgeIssues(env.DB, store));
}
