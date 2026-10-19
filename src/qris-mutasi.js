import { json } from './http.js';
import { getJakartaBusinessDate, jakartaWallClockToUtc } from './time.js';
import { qrisMethodFor, QRIS_SALE_JOIN, QRIS_SALE_WHERE, QRIS_SALE_AMOUNT } from './qris-otomatis.js';

// Mutasi QRIS sebagai hakim (Bos Cyo, 2026-10-18/19; migration 0168, 0171). Mutasi Merchant BCA baru bisa
// diekspor H+1. Admin Entity mengunggahnya (file dibuka di browser, public/bca-mutasi-baca.js), lalu sistem
// memproses tanggal itu (prosesMutasi):
//   1. tiap baris mutasi dipasangkan dengan satu uang masuk (qris_masuk) -- notifikasi yang telat sampai
//      berjam-jam tetap terpasang;
//   2. notifikasi yang tidak pernah sampai -> sistem membuat uang masuknya; uang yang diklaim gerai lain /
//      tidak diklaim -> dipindah ke gerai asli outlet (MID) di mutasi;
//   3. sistem menautkan uang ke penjualan QRIS gerai itu (nominal sama, waktu terdekat). CS cukup mengklaim;
//   4. kesalahan tiap CS dicatat untuk Raport (qris_catatan_cs): SALAH_KLAIM, TIDAK_KLAIM,
//      PENJUALAN_TANPA_UANG dan UANG_TANPA_PENJUALAN (dua-duanya "nominal QRIS tidak sesuai").
// Bisa diulang kapan saja (unggah ulang, pemetaan MID, tombol Proses ulang) dengan hasil yang sama.

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const rows = async stmt => (await stmt.all()).results ?? [];
const rupiah = value => `Rp${Number(value || 0).toLocaleString('id-ID')}`;
const jamWib = iso => new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(iso));
const MAKS_BARIS = 3000;
// Mutasi presisi menit (jam transaksi), notifikasi datang sesudah bayar: -1 s.d. +3 menit = pasangan pasti.
// Notifikasi Merchant BCA bisa tertahan di HP berjam-jam (17-18 Okt: 10 menit s.d. 1 jam) -> dicari
// sampai 8 jam sesudahnya, tapi pasangan pasti selalu didahulukan.
const JENDELA_SEBELUM_MS = 60_000;
const JENDELA_SESUDAH_MS = 180_000;
const JENDELA_TELAT_MS = 8 * 3600_000;
// Penjualan dicatat sekitar saat bayar; kadang dicatat ulang belakangan (mis. salah cara bayar lalu dihapus).
const PENJUALAN_SEBELUM_MS = 3600_000;
const PENJUALAN_SESUDAH_MS = 6 * 3600_000;
// Penjualan dari laci (shift CS) lain hanya boleh dipasangkan bila jaraknya dekat: uang jam 17.42 milik shift
// pagi tidak boleh "menutupi" penjualan QRIS jam 19.28 shift sore yang uangnya memang tidak ada.
const BEDA_LACI_MAKS_MS = 30 * 60_000;
export const JENIS_CATATAN_CS = Object.freeze({
  SALAH_KLAIM: 'Salah klaim',
  TIDAK_KLAIM: 'Tidak klaim',
  KLAIM_LAMBAT: 'Klaim lambat',
  SELISIH_KLAIM: 'Total klaim ≠ penjualan QRIS',
  PENJUALAN_TANPA_UANG: 'Penjualan QRIS tanpa uang',
  UANG_TANPA_PENJUALAN: 'Uang QRIS tanpa penjualan QRIS'
});
const JUMLAH_KOSONG = () => Object.fromEntries(Object.keys(JENIS_CATATAN_CS).map(jenis => [jenis, 0]));
// Bos Cyo, 2026-10-19: klaim lebih dari 10 menit sesudah notifikasinya muncul di MAXI = klaim lambat.
export const KLAIM_LAMBAT_MENIT = 10;

const dompet = value => text(value, 60).toUpperCase().replace(/^BANK\s+/, '').replace(/[^A-Z0-9]/g, '');
function dompetCocok(a, b) {
  const x = dompet(a);
  const y = dompet(b);
  return !x || !y || x.includes(y) || y.includes(x);
}

function hariIni() { return getJakartaBusinessDate(); }

function rentang(tanggal) {
  const awal = jakartaWallClockToUtc(tanggal, '00:00');
  return { awal, from: awal.toISOString(), to: new Date(awal.getTime() + 24 * 3600_000).toISOString() };
}

async function petaMid(db, entityId) {
  const list = await rows(db.prepare(`
    SELECT m.mid, m.store_id, m.merchant_name, s.code AS store_code FROM qris_merchant_gerai m JOIN stores s ON s.id = m.store_id WHERE m.entity_id = ?
  `).bind(entityId));
  return new Map(list.map(row => [row.mid, row]));
}

// Pasangkan ulang semua mutasi satu tanggal dengan uang masuk. Deterministik dan bisa diulang kapan saja.
export async function cocokkanMutasi(db, entityId, tanggal) {
  const mutasi = await rows(db.prepare(`SELECT id, mid, amount, trx_at, payment_type FROM qris_mutasi WHERE entity_id = ? AND business_date = ? ORDER BY trx_at, id`).bind(entityId, tanggal));
  await db.prepare(`UPDATE qris_mutasi SET masuk_id = NULL WHERE entity_id = ? AND business_date = ?`).bind(entityId, tanggal).run();
  if (!mutasi.length) return 0;
  const { awal } = rentang(tanggal);
  const dari = new Date(awal.getTime() - 30 * 60_000).toISOString();
  const sampai = new Date(awal.getTime() + 24 * 3600_000 + JENDELA_TELAT_MS).toISOString();
  const masuk = await rows(db.prepare(`
    SELECT id, amount, received_at, store_id, sumber_bayar FROM qris_masuk
    WHERE entity_id = ? AND status != 'DIABAIKAN' AND received_at >= ? AND received_at < ?
      AND id NOT IN (SELECT masuk_id FROM qris_mutasi WHERE entity_id = ? AND business_date != ? AND masuk_id IS NOT NULL)
  `).bind(entityId, dari, sampai, entityId, tanggal));
  const peta = await petaMid(db, entityId);
  const calon = [];
  for (const m of mutasi) {
    const t = new Date(m.trx_at).getTime();
    for (const q of masuk) {
      if (Number(q.amount) !== Number(m.amount)) continue;
      const selisih = new Date(q.received_at).getTime() - t;
      if (selisih < -JENDELA_SEBELUM_MS || selisih > JENDELA_TELAT_MS) continue;
      if (!dompetCocok(m.payment_type, q.sumber_bayar)) continue;
      const pasti = selisih <= JENDELA_SESUDAH_MS;
      const geraiBenar = Boolean(q.store_id) && peta.get(m.mid)?.store_id === q.store_id;
      calon.push({ m: m.id, q: q.id, pasti, geraiBenar, jarak: Math.abs(selisih - 30_000) });
    }
  }
  // Pasangan pasti (±menit) dulu, lalu yang gerainya sudah benar: dua pembeli Rp6.000 dari DANA di menit
  // yang sama di dua outlet berbeda tidak boleh "tertukar" dan menuduh CS yang benar.
  calon.sort((a, b) => (b.pasti - a.pasti) || (b.geraiBenar - a.geraiBenar) || (a.jarak - b.jarak));
  const pakaiM = new Set();
  const pakaiQ = new Set();
  let n = 0;
  for (const c of calon) {
    if (pakaiM.has(c.m) || pakaiQ.has(c.q)) continue;
    pakaiM.add(c.m); pakaiQ.add(c.q);
    await db.prepare(`UPDATE qris_mutasi SET masuk_id = ? WHERE id = ?`).bind(c.q, c.m).run();
    n += 1;
  }
  return n;
}

// CS yang lacinya terbuka di gerai itu saat uangnya masuk = yang seharusnya mengklaim & mencatat.
async function csBertugas(db, storeId, at) {
  return db.prepare(`
    SELECT d.id, d.cashier_id, c.employee_name FROM cash_drawer_sessions d LEFT JOIN cashiers c ON c.id = d.cashier_id
    WHERE d.store_id = ? AND d.opened_at <= ? AND (d.closed_at IS NULL OR d.closed_at >= ?) ORDER BY d.opened_at DESC LIMIT 1
  `).bind(storeId, at, at).first();
}

async function namaKasir(db, cashierId) {
  if (!cashierId) return '';
  return (await db.prepare(`SELECT employee_name FROM cashiers WHERE id = ?`).bind(cashierId).first())?.employee_name || '';
}

// Total uang yang diklaim tiap CS sehari vs total penjualan QRIS yang ia catat (bagian QRIS saja), hanya
// gerai yang outletnya sudah dipasangkan. Klaim dihitung dari klaim asli CS (klaim_cashier_id).
async function rekapKlaimCs(db, entityId, tanggal, peta) {
  const { from, to } = rentang(tanggal);
  const hasil = new Map();
  const ambil = (cashierId, storeId) => {
    if (!hasil.has(cashierId)) hasil.set(cashierId, { cashierId, storeId, klaimRp: 0, klaimN: 0, penjualanRp: 0, penjualanN: 0 });
    return hasil.get(cashierId);
  };
  const storeIds = new Set([...peta.values()].map(g => g.store_id));
  for (const row of await rows(db.prepare(`
    SELECT klaim_cashier_id, klaim_store_id, SUM(amount) AS rp, COUNT(*) AS n FROM qris_masuk
    WHERE entity_id = ? AND business_date = ? AND klaim_cashier_id IS NOT NULL AND status != 'DIABAIKAN' GROUP BY klaim_cashier_id, klaim_store_id
  `).bind(entityId, tanggal))) {
    if (!storeIds.has(row.klaim_store_id)) continue;
    const r = ambil(row.klaim_cashier_id, row.klaim_store_id);
    r.klaimRp += Number(row.rp); r.klaimN += Number(row.n);
  }
  for (const storeId of storeIds) {
    const method = await qrisMethodFor(db, storeId);
    if (!method.code) continue;
    for (const row of await rows(db.prepare(`
      SELECT s.cashier_id, SUM(${QRIS_SALE_AMOUNT}) AS rp, COUNT(*) AS n FROM sales s ${QRIS_SALE_JOIN}
      WHERE s.store_id = ? AND ${QRIS_SALE_WHERE} AND s.voided_at IS NULL AND s.created_at >= ? AND s.created_at < ? GROUP BY s.cashier_id
    `).bind(method.code, storeId, method.code, from, to))) {
      if (!row.cashier_id) continue;
      const r = ambil(row.cashier_id, storeId);
      r.penjualanRp += Number(row.rp); r.penjualanN += Number(row.n);
    }
  }
  const kode = new Map([...peta.values()].map(g => [g.store_id, g.store_code]));
  const list = [];
  for (const r of hasil.values()) list.push({ ...r, storeCode: kode.get(r.storeId) || null, cashierName: await namaKasir(db, r.cashierId), cocok: r.klaimRp === r.penjualanRp });
  return list.sort((a, b) => (a.storeCode || '').localeCompare(b.storeCode || '') || a.cashierName.localeCompare(b.cashierName));
}

export async function prosesMutasi(db, entityId, tanggal) {
  await cocokkanMutasi(db, entityId, tanggal);
  const peta = await petaMid(db, entityId);
  const kodeGerai = new Map([...peta.values()].map(g => [g.store_id, g.store_code]));
  const now = new Date().toISOString();
  const mutasi = await rows(db.prepare(`
    SELECT mt.*, q.store_id AS q_store_id, st.code AS q_store_code FROM qris_mutasi mt
    LEFT JOIN qris_masuk q ON q.id = mt.masuk_id LEFT JOIN stores st ON st.id = q.store_id
    WHERE mt.entity_id = ? AND mt.business_date = ? ORDER BY mt.trx_at, mt.id
  `).bind(entityId, tanggal));

  // 1-2. Uang masuk tiap baris mutasi harus ada dan berada di gerai asli outletnya.
  for (const m of mutasi) {
    const gerai = peta.get(m.mid);
    if (!gerai) continue;
    if (!m.masuk_id) {
      const ref = `mutasi:${m.mid}:${m.rrn}`;
      const ada = await db.prepare(`SELECT id, status FROM qris_masuk WHERE entity_id = ? AND ref = ?`).bind(entityId, ref).first();
      if (ada?.status === 'DIABAIKAN') continue;
      const id = ada?.id || `qrism_${crypto.randomUUID()}`;
      if (!ada) {
        await db.prepare(`
          INSERT INTO qris_masuk (id, entity_id, store_id, amount, source, raw_text, ref, received_at, business_date, sumber_bayar, note, created_by_role, created_by_name, created_at)
          VALUES (?, ?, ?, ?, 'MANUAL', '', ?, ?, ?, ?, ?, 'SYSTEM', 'Sistem (mutasi)', ?)
        `).bind(id, entityId, gerai.store_id, m.amount, ref, m.trx_at, m.business_date, m.payment_type,
          `Dibuat sistem dari mutasi BCA ${m.merchant_name} RRN ${m.rrn} (notifikasi tidak sampai)`, now).run();
      }
      await db.prepare(`UPDATE qris_mutasi SET masuk_id = ? WHERE id = ?`).bind(id, m.id).run();
      m.masuk_id = id;
    } else if (m.q_store_id !== gerai.store_id) {
      await db.prepare(`
        UPDATE qris_masuk SET store_id = ?, status = 'BELUM', sale_id = NULL, link_mode = NULL, linked_at = NULL, linked_by_role = '', linked_by_name = '', note = ?
        WHERE id = ?
      `).bind(gerai.store_id, `Dipindah sistem ke ${gerai.store_code} sesuai mutasi BCA (${m.merchant_name}, RRN ${m.rrn}). Sebelumnya: ${m.q_store_code || 'kolam'}.`, m.masuk_id).run();
    }
  }

  // 3. Tautkan ulang per gerai: uang (menurut mutasi) <-> penjualan QRIS bernominal sama, urut waktu.
  const perGerai = new Map();
  for (const m of mutasi) {
    const gerai = peta.get(m.mid);
    if (!gerai || !m.masuk_id) continue;
    if (!perGerai.has(gerai.store_id)) perGerai.set(gerai.store_id, []);
    perGerai.get(gerai.store_id).push(m);
  }
  const { awal, from, to } = rentang(tanggal);
  const tertaut = new Set();
  for (const [storeId, list] of perGerai) {
    const method = await qrisMethodFor(db, storeId);
    if (!method.code) continue;
    const ids = list.map(m => m.masuk_id);
    await db.prepare(`
      UPDATE qris_masuk SET status = 'BELUM', sale_id = NULL, link_mode = NULL, linked_at = NULL, linked_by_role = '', linked_by_name = ''
      WHERE status = 'TERTAUT' AND id IN (${ids.map(() => '?').join(', ')})
    `).bind(...ids).run();
    const sales = await rows(db.prepare(`
      SELECT s.id, ${QRIS_SALE_AMOUNT} AS amount, s.created_at, s.drawer_session_id FROM sales s ${QRIS_SALE_JOIN}
      WHERE s.store_id = ? AND ${QRIS_SALE_WHERE} AND s.voided_at IS NULL AND s.created_at >= ? AND s.created_at < ?
        AND NOT EXISTS (SELECT 1 FROM qris_masuk q WHERE q.sale_id = s.id)
      ORDER BY s.created_at, s.id
    `).bind(method.code, storeId, method.code, new Date(awal.getTime() - PENJUALAN_SEBELUM_MS).toISOString(), new Date(awal.getTime() + 24 * 3600_000 + PENJUALAN_SESUDAH_MS).toISOString()));
    // Semua pasangan yang mungkin, lalu yang paling dekat waktunya dipasangkan duluan (bukan uang paling pagi
    // dulu: uang 13.53 tanpa penjualan tidak boleh merebut penjualan 18.16 milik uang 18.15).
    const calon = [];
    for (const m of list) {
      const t = new Date(m.trx_at).getTime();
      const laci = (await csBertugas(db, storeId, m.trx_at))?.id || null;
      for (const s of sales) {
        if (Number(s.amount) !== Number(m.amount)) continue;
        const selisih = new Date(s.created_at).getTime() - t;
        if (selisih < -PENJUALAN_SEBELUM_MS || selisih > PENJUALAN_SESUDAH_MS) continue;
        const bedaLaci = Boolean(laci && s.drawer_session_id && laci !== s.drawer_session_id);
        if (bedaLaci && Math.abs(selisih) > BEDA_LACI_MAKS_MS) continue;
        calon.push({ m, s, jarak: Math.abs(selisih) });
      }
    }
    calon.sort((a, b) => a.jarak - b.jarak || a.s.created_at.localeCompare(b.s.created_at));
    const dipakai = new Set();
    for (const { m, s: sale } of calon) {
      if (dipakai.has(sale.id) || tertaut.has(m.masuk_id)) continue;
      let result;
      try {
        result = await db.prepare(`
          UPDATE qris_masuk SET status = 'TERTAUT', sale_id = ?, link_mode = 'OTOMATIS', linked_at = ?, linked_by_role = 'SYSTEM', linked_by_name = 'Sistem (mutasi)'
          WHERE id = ? AND status = 'BELUM'
        `).bind(sale.id, now, m.masuk_id).run();
      } catch { result = { meta: { changes: 0 } }; }
      if (result.meta?.changes) { dipakai.add(sale.id); tertaut.add(m.masuk_id); }
    }
  }

  // 4. Catatan CS untuk Raport -- dihitung ulang utuh untuk tanggal ini.
  await db.prepare(`DELETE FROM qris_catatan_cs WHERE entity_id = ? AND business_date = ?`).bind(entityId, tanggal).run();
  const catat = async (jenis, { storeId, cashierId, cashierName, amount, waktu, mutasiId = null, masukId = null, saleId = null, keterangan }) => {
    await db.prepare(`
      INSERT INTO qris_catatan_cs (id, entity_id, business_date, jenis, store_id, cashier_id, cashier_name, amount, waktu, mutasi_id, masuk_id, sale_id, keterangan, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(`qriscs_${crypto.randomUUID()}`, entityId, tanggal, jenis, storeId, cashierId || null, cashierName || '', amount, waktu, mutasiId, masukId, saleId, keterangan, now).run();
  };
  for (const m of mutasi) {
    const gerai = peta.get(m.mid);
    if (!gerai || !m.masuk_id) continue;
    const q = await db.prepare(`SELECT source, klaim_store_id, klaim_cashier_id, claimed_by_name FROM qris_masuk WHERE id = ?`).bind(m.masuk_id).first();
    const dipertahankan = await db.prepare(`
      SELECT ds.code FROM qris_klaim_permintaan p LEFT JOIN stores ds ON ds.id = p.dari_store_id WHERE p.masuk_id = ? AND p.status = 'DIPERTAHANKAN' AND p.dari_store_id = ? LIMIT 1
    `).bind(m.masuk_id, gerai.store_id).first();
    const uang = `${rupiah(m.amount)} jam ${jamWib(m.trx_at)}${m.payment_type ? ` dari ${m.payment_type}` : ''}`;
    const bertugas = await csBertugas(db, gerai.store_id, m.trx_at);
    const dasar = { storeId: gerai.store_id, amount: Number(m.amount), waktu: m.trx_at, mutasiId: m.id, masukId: m.masuk_id };
    if (q.klaim_store_id && q.klaim_store_id !== gerai.store_id) {
      const klaimKode = kodeGerai.get(q.klaim_store_id) || (await db.prepare(`SELECT code FROM stores WHERE id = ?`).bind(q.klaim_store_id).first())?.code || 'gerai lain';
      await catat('SALAH_KLAIM', { ...dasar, storeId: q.klaim_store_id, cashierId: q.klaim_cashier_id, cashierName: await namaKasir(db, q.klaim_cashier_id) || q.claimed_by_name,
        keterangan: `Mengklaim uang ${uang} untuk ${klaimKode}, padahal uangnya masuk ke outlet ${m.merchant_name} (${gerai.store_code}).${dipertahankan ? ` Klaim tetap dipertahankan walau sudah diminta ${dipertahankan.code}.` : ''}` });
    } else if (!q.klaim_store_id && q.source === 'NOTIF_HP') {
      await catat('TIDAK_KLAIM', { ...dasar, cashierId: bertugas?.cashier_id, cashierName: bertugas?.employee_name,
        keterangan: `Uang ${uang} masuk ke ${gerai.store_code} tapi tidak diklaim${bertugas ? '' : ' (tidak ada laci terbuka saat itu)'}.` });
    }
    if (!tertaut.has(m.masuk_id)) {
      await catat('UANG_TANPA_PENJUALAN', { ...dasar, cashierId: bertugas?.cashier_id, cashierName: bertugas?.employee_name,
        keterangan: `Uang QRIS ${uang} masuk ke ${gerai.store_code} tapi tidak ada penjualan QRIS ${rupiah(m.amount)} -- tercatat dengan cara bayar lain, digabung, atau tidak dicatat.` });
    }
  }
  // Penjualan QRIS yang uangnya tidak ada di mutasi (hanya gerai yang outletnya sudah dipasangkan).
  for (const storeId of new Set([...peta.values()].map(g => g.store_id))) {
    const method = await qrisMethodFor(db, storeId);
    if (!method.code) continue;
    const yatim = await rows(db.prepare(`
      SELECT s.id, ${QRIS_SALE_AMOUNT} AS amount, s.created_at, s.cashier_id, c.employee_name, q.id AS masuk_id
      FROM sales s ${QRIS_SALE_JOIN} LEFT JOIN cashiers c ON c.id = s.cashier_id LEFT JOIN qris_masuk q ON q.sale_id = s.id
      WHERE s.store_id = ? AND ${QRIS_SALE_WHERE} AND s.voided_at IS NULL AND s.created_at >= ? AND s.created_at < ?
        AND (q.id IS NULL OR q.id NOT IN (SELECT masuk_id FROM qris_mutasi WHERE entity_id = ? AND masuk_id IS NOT NULL))
      ORDER BY s.created_at
    `).bind(method.code, storeId, method.code, from, to, entityId));
    for (const s of yatim) {
      await catat('PENJUALAN_TANPA_UANG', { storeId, cashierId: s.cashier_id, cashierName: s.employee_name, amount: Number(s.amount), waktu: s.created_at, saleId: s.id, masukId: s.masuk_id || null,
        keterangan: `Penjualan QRIS ${rupiah(s.amount)} jam ${jamWib(s.created_at)} tidak ada uangnya di mutasi BCA${s.masuk_id ? ' (tertaut ke notifikasi yang tidak ada di mutasi)' : ''}.` });
    }
  }
  // Klaim lambat: diklaim lebih dari 10 menit sesudah notifikasinya muncul di MAXI (created_at).
  for (const q of await rows(db.prepare(`
    SELECT id, amount, created_at, klaim_at, klaim_store_id, klaim_cashier_id, claimed_by_name FROM qris_masuk
    WHERE entity_id = ? AND business_date = ? AND klaim_cashier_id IS NOT NULL AND klaim_at IS NOT NULL AND status != 'DIABAIKAN' AND source = 'NOTIF_HP'
  `).bind(entityId, tanggal))) {
    const menit = (new Date(q.klaim_at).getTime() - new Date(q.created_at).getTime()) / 60000;
    if (menit <= KLAIM_LAMBAT_MENIT) continue;
    await catat('KLAIM_LAMBAT', { storeId: q.klaim_store_id, cashierId: q.klaim_cashier_id, cashierName: await namaKasir(db, q.klaim_cashier_id) || q.claimed_by_name,
      amount: Number(q.amount), waktu: q.klaim_at, masukId: q.id,
      keterangan: `Uang ${rupiah(q.amount)} (notifikasi muncul jam ${jamWib(q.created_at)}) baru diklaim jam ${jamWib(q.klaim_at)} — ${Math.round(menit)} menit kemudian (batas ${KLAIM_LAMBAT_MENIT} menit).` });
  }
  // Total klaim CS sehari harus sama dengan total penjualan QRIS yang ia catat.
  for (const r of await rekapKlaimCs(db, entityId, tanggal, peta)) {
    if (r.cocok) continue;
    await catat('SELISIH_KLAIM', { storeId: r.storeId, cashierId: r.cashierId, cashierName: r.cashierName, amount: Math.abs(r.klaimRp - r.penjualanRp), waktu: from,
      keterangan: `Total klaim ${rupiah(r.klaimRp)} (${r.klaimN}x) tidak sama dengan total penjualan QRIS ${rupiah(r.penjualanRp)} (${r.penjualanN}x) — selisih ${rupiah(Math.abs(r.klaimRp - r.penjualanRp))}.` });
  }
  return { tertaut: tertaut.size };
}

// Rekap uang (Bos Cyo, 2026-10-20): "biarpun CS tidak klaim, mutasi sudah masuk -> langsung ada report
// pasti uangnya sesuai atau tidak". Tidak bergantung pada klaim/notifikasi sama sekali:
//   per gerai  : total QRIS di mutasi tanggal itu vs total penjualan QRIS (bagian QRIS) tanggal itu;
//   per laci   : uang mutasi dari jam buka s.d. jam tutup laci vs penjualan QRIS yang dicatat di laci itu.
// Laci sesuai tapi CS tetap punya catatan = uangnya benar, CS-nya kurang benar mengoperasikan.
async function rekapUang(db, entityId, tanggal, peta) {
  const { from, to } = rentang(tanggal);
  const perGerai = new Map();
  for (const g of peta.values()) {
    if (!perGerai.has(g.store_id)) perGerai.set(g.store_id, { storeId: g.store_id, storeCode: g.store_code, mids: [] });
    perGerai.get(g.store_id).mids.push(g.mid);
  }
  const hasil = [];
  for (const g of perGerai.values()) {
    const mutasi = await rows(db.prepare(`
      SELECT amount, trx_at FROM qris_mutasi WHERE entity_id = ? AND business_date = ? AND mid IN (${g.mids.map(() => '?').join(', ')}) ORDER BY trx_at
    `).bind(entityId, tanggal, ...g.mids));
    const method = await qrisMethodFor(db, g.storeId);
    const sales = method.code ? await rows(db.prepare(`
      SELECT s.id, ${QRIS_SALE_AMOUNT} AS amount, s.created_at, s.drawer_session_id FROM sales s ${QRIS_SALE_JOIN}
      WHERE s.store_id = ? AND ${QRIS_SALE_WHERE} AND s.voided_at IS NULL AND s.created_at >= ? AND s.created_at < ?
    `).bind(method.code, g.storeId, method.code, from, to)) : [];
    const laciList = await rows(db.prepare(`
      SELECT d.id, d.cashier_id, d.opened_at, d.closed_at, c.employee_name FROM cash_drawer_sessions d LEFT JOIN cashiers c ON c.id = d.cashier_id
      WHERE d.store_id = ? AND d.opened_at < ? AND (d.closed_at IS NULL OR d.closed_at >= ?) ORDER BY d.opened_at
    `).bind(g.storeId, to, from));
    const jumlah = list => list.reduce((sum, row) => sum + Number(row.amount), 0);
    const dipakai = new Set();
    const laci = laciList.map(d => {
      const tutup = d.closed_at || '9999';
      const uang = mutasi.filter(m => m.trx_at >= d.opened_at && m.trx_at <= tutup);
      uang.forEach(m => dipakai.add(m));
      const jual = sales.filter(s => s.drawer_session_id === d.id);
      const uangRp = jumlah(uang);
      const penjualanRp = jumlah(jual);
      return { drawerId: d.id, cashierId: d.cashier_id, cashierName: d.employee_name || '', openedAt: d.opened_at, closedAt: d.closed_at || null,
        uangRp, uangN: uang.length, penjualanRp, penjualanN: jual.length, selisih: uangRp - penjualanRp };
    });
    const luar = mutasi.filter(m => !dipakai.has(m));
    const jualTanpaLaci = sales.filter(s => !laciList.some(d => d.id === s.drawer_session_id));
    const uangRp = jumlah(mutasi);
    const penjualanRp = jumlah(sales);
    hasil.push({ storeCode: g.storeCode, metodeQris: Boolean(method.code), uangRp, uangN: mutasi.length, penjualanRp, penjualanN: sales.length, selisih: uangRp - penjualanRp, laci,
      luarLaci: { uangRp: jumlah(luar), uangN: luar.length, penjualanRp: jumlah(jualTanpaLaci), penjualanN: jualTanpaLaci.length } });
  }
  return hasil.sort((a, b) => (b.selisih !== 0) - (a.selisih !== 0) || a.storeCode.localeCompare(b.storeCode));
}

async function lihat(db, actor, tanggalDiminta) {
  const entityId = actor.store.entityId;
  const tersedia = (await rows(db.prepare(`SELECT business_date, COUNT(*) AS n FROM qris_mutasi WHERE entity_id = ? GROUP BY business_date ORDER BY business_date DESC LIMIT 31`).bind(entityId)))
    .map(row => ({ tanggal: row.business_date, jumlah: Number(row.n) }));
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(tanggalDiminta || '') ? tanggalDiminta : (tersedia[0]?.tanggal || hariIni());
  const peta = await petaMid(db, entityId);
  const baris = await rows(db.prepare(`
    SELECT mt.*, q.status AS q_status, q.received_at AS q_received_at, q.source AS q_source, q.created_by_role AS q_created_by_role,
           q.sale_id AS q_sale_id, s.created_at AS sale_at, c.employee_name AS sale_cashier
    FROM qris_mutasi mt LEFT JOIN qris_masuk q ON q.id = mt.masuk_id
    LEFT JOIN sales s ON s.id = q.sale_id LEFT JOIN cashiers c ON c.id = s.cashier_id
    WHERE mt.entity_id = ? AND mt.business_date = ? ORDER BY mt.trx_at, mt.id
  `).bind(entityId, tanggal));
  const catatan = await rows(db.prepare(`
    SELECT k.*, st.code AS store_code FROM qris_catatan_cs k LEFT JOIN stores st ON st.id = k.store_id
    WHERE k.entity_id = ? AND k.business_date = ? ORDER BY k.waktu
  `).bind(entityId, tanggal));
  const mapCatatan = row => ({ jenis: row.jenis, label: JENIS_CATATAN_CS[row.jenis], storeCode: row.store_code || null, cashierId: row.cashier_id || null,
    cashierName: row.cashier_name || '', amount: Number(row.amount), waktu: row.waktu, keterangan: row.keterangan });
  const hasil = baris.map(row => {
    const gerai = peta.get(row.mid);
    const telat = row.q_source === 'NOTIF_HP' ? Math.round((new Date(row.q_received_at).getTime() - new Date(row.trx_at).getTime()) / 60000) : null;
    return {
      id: row.id, mid: row.mid, merchantName: row.merchant_name, amount: Number(row.amount), trxAt: row.trx_at, rrn: row.rrn,
      paymentType: row.payment_type, geraiSeharusnya: gerai?.store_code || null,
      status: !gerai ? 'BELUM_DIPETAKAN' : row.q_status === 'TERTAUT' ? 'COCOK' : 'TANPA_PENJUALAN',
      notifTidakSampai: Boolean(row.masuk_id) && row.q_source === 'MANUAL' && row.q_created_by_role === 'SYSTEM',
      notifTelatMenit: telat !== null && telat >= 5 ? telat : null,
      sale: row.q_sale_id ? { id: row.q_sale_id, createdAt: row.sale_at, cashierName: row.sale_cashier || '' } : null,
      catatan: catatan.filter(k => k.mutasi_id === row.id).map(mapCatatan)
    };
  });
  const tanpaMutasi = tersedia.some(item => item.tanggal === tanggal) ? (await rows(db.prepare(`
    SELECT q.id, q.amount, q.received_at, q.sumber_bayar, q.status, q.claimed_by_name, s.code AS store_code FROM qris_masuk q LEFT JOIN stores s ON s.id = q.store_id
    WHERE q.entity_id = ? AND q.status != 'DIABAIKAN' AND q.business_date = ?
      AND q.id NOT IN (SELECT masuk_id FROM qris_mutasi WHERE entity_id = ? AND masuk_id IS NOT NULL)
    ORDER BY q.received_at
  `).bind(entityId, tanggal, entityId))).map(row => ({
    id: row.id, amount: Number(row.amount), receivedAt: row.received_at, sumberBayar: row.sumber_bayar, status: row.status,
    storeCode: row.store_code || null, claimedByName: row.claimed_by_name || ''
  })) : [];
  // Ringkasan per CS: berapa kali tiap jenis kesalahan, dengan rinciannya.
  const perCs = new Map();
  for (const row of catatan) {
    const key = row.cashier_id || `tanpa:${row.store_id}`;
    if (!perCs.has(key)) perCs.set(key, { cashierId: row.cashier_id || null, cashierName: row.cashier_name || '(tidak ada laci terbuka)', storeCode: row.store_code || null, jumlah: JUMLAH_KOSONG(), rincian: [] });
    const cs = perCs.get(key);
    cs.jumlah[row.jenis] += 1;
    cs.rincian.push(mapCatatan(row));
  }
  const hitung = jenis => catatan.filter(row => row.jenis === jenis).length;
  const semuaMid = await rows(db.prepare(`SELECT DISTINCT mid, merchant_name FROM qris_mutasi WHERE entity_id = ? ORDER BY merchant_name`).bind(entityId));
  return json({
    tanggal,
    tersedia,
    ringkas: {
      total: hasil.length,
      totalRupiah: hasil.reduce((sum, row) => sum + row.amount, 0),
      cocok: hasil.filter(row => row.status === 'COCOK').length,
      tanpaPenjualan: hasil.filter(row => row.status === 'TANPA_PENJUALAN').length,
      belumDipetakan: hasil.filter(row => row.status === 'BELUM_DIPETAKAN').length,
      notifTidakSampai: hasil.filter(row => row.notifTidakSampai).length,
      salahKlaim: hitung('SALAH_KLAIM'),
      tidakKlaim: hitung('TIDAK_KLAIM'),
      klaimLambat: hitung('KLAIM_LAMBAT'),
      selisihKlaim: hitung('SELISIH_KLAIM'),
      penjualanTanpaUang: hitung('PENJUALAN_TANPA_UANG'),
      notifTanpaMutasi: tanpaMutasi.length
    },
    peta: semuaMid.map(row => ({ mid: row.mid, merchantName: row.merchant_name, storeCode: peta.get(row.mid)?.store_code || null, adaDiTanggalIni: baris.some(b => b.mid === row.mid) })),
    gerai: (await rows(db.prepare(`SELECT code, store_name FROM stores WHERE entity_id = ? AND is_active = 1 ORDER BY code`).bind(entityId))).map(row => ({ code: row.code, name: row.store_name })),
    baris: hasil,
    rekapCs: await rekapKlaimCs(db, entityId, tanggal, peta),
    rekapUang: await rekapUang(db, entityId, tanggal, peta),
    perCs: [...perCs.values()].sort((a, b) => (a.storeCode || '').localeCompare(b.storeCode || '') || a.cashierName.localeCompare(b.cashierName)),
    penjualanTanpaUang: catatan.filter(row => row.jenis === 'PENJUALAN_TANPA_UANG').map(mapCatatan),
    notifTanpaMutasi: tanpaMutasi
  });
}

function trxAt(tanggal, jam) {
  const t = jakartaWallClockToUtc(tanggal, jam);
  return t && !Number.isNaN(t.getTime()) ? t.toISOString() : null;
}

async function unggah(db, actor, value) {
  const entityId = actor.store.entityId;
  const masukan = Array.isArray(value?.rows) ? value.rows : [];
  if (!masukan.length) return json({ error: 'Tidak ada baris mutasi.' }, 400);
  if (masukan.length > MAKS_BARIS) return json({ error: `Maksimal ${MAKS_BARIS} baris sekali unggah.` }, 400);
  const bersih = [];
  for (const row of masukan) {
    const mid = text(row?.mid, 20);
    const rrn = text(row?.rrn, 40);
    const amount = Number(row?.amount);
    const tanggal = text(row?.tanggal, 10);
    const jam = text(row?.jam, 5);
    const at = /^\d{4}-\d{2}-\d{2}$/.test(tanggal) && /^\d{2}:\d{2}$/.test(jam) ? trxAt(tanggal, jam) : null;
    if (!/^\d{6,20}$/.test(mid) || !rrn || !Number.isSafeInteger(amount) || amount <= 0 || !at) {
      return json({ error: `Baris mutasi tidak valid (MID ${mid || '-'}, RRN ${rrn || '-'}).` }, 400);
    }
    bersih.push({ mid, rrn, amount, tanggal, at, merchantName: text(row?.merchantName, 80), nmid: text(row?.nmid, 40), approvalCode: text(row?.approvalCode, 20), paymentType: text(row?.paymentType, 40), payer: text(row?.payer, 60), reversal: text(row?.reversal, 20) });
  }
  const tanggalList = [...new Set(bersih.map(row => row.tanggal))].sort();
  if (tanggalList.at(-1) >= hariIni()) return json({ error: 'Mutasi hari ini belum lengkap -- unggah mutasi H+1 (paling akhir kemarin).', code: 'MUTASI_HARI_INI' }, 400);
  const now = new Date().toISOString();
  const uploadId = `qrisup_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO qris_mutasi_upload (id, entity_id, file_name, tanggal_dari, tanggal_sampai, jumlah_baris, created_by_role, created_by_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(uploadId, entityId, text(value?.fileName, 120), tanggalList[0], tanggalList.at(-1), bersih.length, actor.role, actor.name, now).run();
  let baru = 0;
  for (const row of bersih) {
    const res = await db.prepare(`
      INSERT OR IGNORE INTO qris_mutasi (id, entity_id, upload_id, mid, merchant_name, nmid, amount, trx_at, business_date, rrn, approval_code, payment_type, payer, reversal, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(`qrismt_${crypto.randomUUID()}`, entityId, uploadId, row.mid, row.merchantName, row.nmid, row.amount, row.at, row.tanggal, row.rrn, row.approvalCode, row.paymentType, row.payer, row.reversal, now).run();
    baru += Number(res.meta?.changes || 0);
  }
  await db.prepare(`UPDATE qris_mutasi_upload SET baris_baru = ? WHERE id = ?`).bind(baru, uploadId).run();
  for (const tanggal of tanggalList) await prosesMutasi(db, entityId, tanggal);
  return json({ ok: true, uploadId, jumlah: bersih.length, baru, dobel: bersih.length - baru, tanggal: tanggalList }, 201);
}

async function simpanPeta(db, actor, value) {
  const entityId = actor.store.entityId;
  const mid = text(value?.mid, 20);
  const kode = text(value?.storeCode, 40).toUpperCase();
  const contoh = await db.prepare(`SELECT merchant_name FROM qris_mutasi WHERE entity_id = ? AND mid = ? LIMIT 1`).bind(entityId, mid).first();
  if (!contoh) return json({ error: 'MID ini belum pernah muncul di mutasi.' }, 404);
  if (!kode) {
    await db.prepare(`DELETE FROM qris_merchant_gerai WHERE entity_id = ? AND mid = ?`).bind(entityId, mid).run();
  } else {
    const store = await db.prepare(`SELECT id FROM stores WHERE entity_id = ? AND code = ?`).bind(entityId, kode).first();
    if (!store) return json({ error: 'Gerai tidak ditemukan di entity ini.' }, 404);
    await db.prepare(`
      INSERT INTO qris_merchant_gerai (entity_id, mid, store_id, merchant_name, updated_by_name, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_id, mid) DO UPDATE SET store_id = excluded.store_id, merchant_name = excluded.merchant_name, updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at
    `).bind(entityId, mid, store.id, contoh.merchant_name, actor.name, new Date().toISOString()).run();
  }
  for (const row of await rows(db.prepare(`SELECT DISTINCT business_date FROM qris_mutasi WHERE entity_id = ? AND mid = ?`).bind(entityId, mid))) {
    await prosesMutasi(db, entityId, row.business_date);
  }
  return json({ ok: true });
}

async function prosesUlang(db, actor, value) {
  const tanggal = text(value?.tanggal, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return json({ error: 'Tanggal tidak valid.' }, 400);
  if (!await db.prepare(`SELECT 1 FROM qris_mutasi WHERE entity_id = ? AND business_date = ? LIMIT 1`).bind(actor.store.entityId, tanggal).first()) {
    return json({ error: 'Belum ada mutasi di tanggal ini.' }, 404);
  }
  return json({ ok: true, ...await prosesMutasi(db, actor.store.entityId, tanggal) });
}

export async function handleQrisMutasiApi(request, db, actor, pathname, value) {
  if (!actor.entityWide) return json({ error: 'Validasi mutasi hanya untuk Entity Admin / Owner.', code: 'QRIS_FORBIDDEN' }, 403);
  if (request.method === 'GET' && pathname === '/api/qris/mutasi') return lihat(db, actor, new URL(request.url).searchParams.get('tanggal'));
  if (request.method !== 'POST') return json({ error: 'Metode tidak didukung.' }, 405);
  switch (pathname) {
    case '/api/qris/mutasi': return unggah(db, actor, value);
    case '/api/qris/mutasi/peta': return simpanPeta(db, actor, value);
    case '/api/qris/mutasi/proses': return prosesUlang(db, actor, value);
    default: return json({ error: 'Rute mutasi tidak dikenal.' }, 404);
  }
}
