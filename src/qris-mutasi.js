import { json } from './http.js';
import { getJakartaBusinessDate, jakartaWallClockToUtc } from './time.js';
import { tautkanOtomatis } from './qris-otomatis.js';

// Validasi QRIS dengan mutasi bank (Bos Cyo, 2026-10-18; migration 0168). Mutasi Merchant BCA baru bisa
// diekspor H+1. Admin Entity mengunggahnya (file dibuka di browser, public/bca-mutasi-baca.js), lalu tiap
// baris mutasi dipasangkan dengan satu uang masuk (qris_masuk) dan outlet aslinya dibandingkan dengan gerai
// yang mengklaim:
//   COCOK            uang diklaim gerai yang benar dan sudah tertaut ke penjualan
//   BELUM_DITAUTKAN  diklaim gerai yang benar, belum ada penjualannya
//   BELUM_DIKLAIM    masih di kolam (tak ada CS yang mengklaim)
//   SALAH_GERAI      diklaim gerai lain -> kemungkinan salah klaim / curang (nama CS terlihat)
//   TANPA_NOTIF      ada di mutasi tapi notifikasinya tidak pernah sampai (HP penerima mati/logout)
//   BELUM_DIPETAKAN  outlet (MID) belum dipasangkan ke gerai Leker
// Uang masuk tanpa baris mutasi (NOTIF_TANPA_MUTASI) juga ditampilkan: notifikasi palsu / dobel / beda hari.

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const rows = async stmt => (await stmt.all()).results ?? [];
const MAKS_BARIS = 3000;
// Mutasi presisi menit (jam transaksi), notifikasi datang sesudah bayar: jendela -1 s.d. +3 menit.
const JENDELA_SEBELUM_MS = 60_000;
const JENDELA_SESUDAH_MS = 180_000;

const dompet = value => text(value, 60).toUpperCase().replace(/^BANK\s+/, '').replace(/[^A-Z0-9]/g, '');
function dompetCocok(a, b) {
  const x = dompet(a);
  const y = dompet(b);
  return !x || !y || x.includes(y) || y.includes(x);
}

function hariIni() { return getJakartaBusinessDate(); }

async function petaMid(db, entityId) {
  const list = await rows(db.prepare(`
    SELECT m.mid, m.store_id, m.merchant_name, s.code AS store_code FROM qris_merchant_gerai m JOIN stores s ON s.id = m.store_id WHERE m.entity_id = ?
  `).bind(entityId));
  return new Map(list.map(row => [row.mid, row]));
}

// Pasangkan ulang semua mutasi satu tanggal dengan uang masuk. Deterministik dan bisa diulang kapan saja
// (sesudah klaim baru, pemetaan MID, atau unggah ulang).
export async function cocokkanMutasi(db, entityId, tanggal) {
  const mutasi = await rows(db.prepare(`SELECT id, mid, amount, trx_at, payment_type FROM qris_mutasi WHERE entity_id = ? AND business_date = ? ORDER BY trx_at, id`).bind(entityId, tanggal));
  await db.prepare(`UPDATE qris_mutasi SET masuk_id = NULL WHERE entity_id = ? AND business_date = ?`).bind(entityId, tanggal).run();
  if (!mutasi.length) return 0;
  const awal = jakartaWallClockToUtc(tanggal, '00:00');
  const dari = new Date(awal.getTime() - 30 * 60_000).toISOString();
  const sampai = new Date(awal.getTime() + 24 * 3600_000 + 30 * 60_000).toISOString();
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
      if (selisih < -JENDELA_SEBELUM_MS || selisih > JENDELA_SESUDAH_MS) continue;
      if (!dompetCocok(m.payment_type, q.sumber_bayar)) continue;
      const geraiBenar = Boolean(q.store_id) && peta.get(m.mid)?.store_id === q.store_id;
      calon.push({ m: m.id, q: q.id, geraiBenar, jarak: Math.abs(selisih - 30_000) });
    }
  }
  // Utamakan pasangan yang gerainya sudah benar: dua pembeli Rp6.000 dari DANA di menit yang sama di dua
  // outlet berbeda tidak boleh "tertukar" dan menuduh CS yang benar.
  calon.sort((a, b) => (b.geraiBenar - a.geraiBenar) || (a.jarak - b.jarak));
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

function statusBaris(row, peta) {
  const gerai = peta.get(row.mid);
  if (!gerai) return 'BELUM_DIPETAKAN';
  if (!row.masuk_id) return 'TANPA_NOTIF';
  if (!row.q_store_id) return 'BELUM_DIKLAIM';
  if (row.q_store_id !== gerai.store_id) return 'SALAH_GERAI';
  return row.q_status === 'TERTAUT' ? 'COCOK' : 'BELUM_DITAUTKAN';
}

async function lihat(db, actor, tanggalDiminta) {
  const entityId = actor.store.entityId;
  const tersedia = (await rows(db.prepare(`SELECT business_date, COUNT(*) AS n FROM qris_mutasi WHERE entity_id = ? GROUP BY business_date ORDER BY business_date DESC LIMIT 31`).bind(entityId)))
    .map(row => ({ tanggal: row.business_date, jumlah: Number(row.n) }));
  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(tanggalDiminta || '') ? tanggalDiminta : (tersedia[0]?.tanggal || hariIni());
  if (tersedia.some(item => item.tanggal === tanggal)) await cocokkanMutasi(db, entityId, tanggal);
  const peta = await petaMid(db, entityId);
  const baris = await rows(db.prepare(`
    SELECT mt.*, q.store_id AS q_store_id, q.status AS q_status, q.received_at AS q_received_at, q.sumber_bayar AS q_sumber,
           q.claimed_by_name AS q_claimed_by, q.sale_id AS q_sale_id, qs.code AS q_store_code
    FROM qris_mutasi mt LEFT JOIN qris_masuk q ON q.id = mt.masuk_id LEFT JOIN stores qs ON qs.id = q.store_id
    WHERE mt.entity_id = ? AND mt.business_date = ? ORDER BY mt.trx_at, mt.id
  `).bind(entityId, tanggal));
  const hasil = baris.map(row => ({
    id: row.id, mid: row.mid, merchantName: row.merchant_name, amount: Number(row.amount), trxAt: row.trx_at, rrn: row.rrn,
    paymentType: row.payment_type, payer: row.payer, reversal: row.reversal,
    geraiSeharusnya: peta.get(row.mid)?.store_code || null,
    status: statusBaris(row, peta),
    masuk: row.masuk_id ? { id: row.masuk_id, receivedAt: row.q_received_at, storeCode: row.q_store_code || null, status: row.q_status, claimedByName: row.q_claimed_by || '', saleId: row.q_sale_id || null } : null
  }));
  const awal = jakartaWallClockToUtc(tanggal, '00:00');
  const tanpaMutasi = tersedia.some(item => item.tanggal === tanggal) ? (await rows(db.prepare(`
    SELECT q.id, q.amount, q.received_at, q.sumber_bayar, q.status, q.claimed_by_name, s.code AS store_code FROM qris_masuk q LEFT JOIN stores s ON s.id = q.store_id
    WHERE q.entity_id = ? AND q.status != 'DIABAIKAN' AND q.received_at >= ? AND q.received_at < ?
      AND q.id NOT IN (SELECT masuk_id FROM qris_mutasi WHERE entity_id = ? AND masuk_id IS NOT NULL)
    ORDER BY q.received_at
  `).bind(entityId, awal.toISOString(), new Date(awal.getTime() + 24 * 3600_000).toISOString(), entityId))).map(row => ({
    id: row.id, amount: Number(row.amount), receivedAt: row.received_at, sumberBayar: row.sumber_bayar, status: row.status,
    storeCode: row.store_code || null, claimedByName: row.claimed_by_name || ''
  })) : [];
  const hitung = status => hasil.filter(row => row.status === status).length;
  const mids = [...new Map(baris.map(row => [row.mid, row.merchant_name])).entries()];
  const semuaMid = await rows(db.prepare(`SELECT DISTINCT mid, merchant_name FROM qris_mutasi WHERE entity_id = ? ORDER BY merchant_name`).bind(entityId));
  return json({
    tanggal,
    tersedia,
    ringkas: {
      total: hasil.length,
      totalRupiah: hasil.reduce((sum, row) => sum + row.amount, 0),
      cocok: hitung('COCOK'), belumDitautkan: hitung('BELUM_DITAUTKAN'), belumDiklaim: hitung('BELUM_DIKLAIM'),
      salahGerai: hitung('SALAH_GERAI'), tanpaNotif: hitung('TANPA_NOTIF'), belumDipetakan: hitung('BELUM_DIPETAKAN'),
      notifTanpaMutasi: tanpaMutasi.length
    },
    peta: semuaMid.map(row => ({ mid: row.mid, merchantName: row.merchant_name, storeCode: peta.get(row.mid)?.store_code || null, adaDiTanggalIni: mids.some(([mid]) => mid === row.mid) })),
    gerai: (await rows(db.prepare(`SELECT code, store_name FROM stores WHERE entity_id = ? AND is_active = 1 ORDER BY code`).bind(entityId))).map(row => ({ code: row.code, name: row.store_name })),
    baris: hasil,
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
  for (const tanggal of tanggalList) await cocokkanMutasi(db, entityId, tanggal);
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
    await cocokkanMutasi(db, entityId, row.business_date);
  }
  return json({ ok: true });
}

async function barisMutasi(db, actor, id) {
  const row = await db.prepare(`
    SELECT mt.*, m.store_id AS seharusnya_store_id FROM qris_mutasi mt LEFT JOIN qris_merchant_gerai m ON m.entity_id = mt.entity_id AND m.mid = mt.mid
    WHERE mt.id = ? AND mt.entity_id = ?
  `).bind(text(id, 80), actor.store.entityId).first();
  return row;
}

// TANPA_NOTIF: notifikasi tidak pernah sampai -> admin membuat uang masuknya dari mutasi, langsung di gerai
// yang benar (outlet aslinya), lalu Leker mencoba menautkan ke penjualan QRIS gerai itu.
async function buatMasuk(db, actor, value) {
  const row = await barisMutasi(db, actor, value?.mutasiId);
  if (!row) return json({ error: 'Baris mutasi tidak ditemukan.' }, 404);
  if (row.masuk_id) return json({ error: 'Baris ini sudah punya uang masuk.' }, 409);
  if (!row.seharusnya_store_id) return json({ error: 'Pasangkan dulu outlet (MID) ini ke gerai.' }, 409);
  const now = new Date().toISOString();
  const id = `qrism_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO qris_masuk (id, entity_id, store_id, amount, source, raw_text, ref, received_at, business_date, sumber_bayar, note, created_by_role, created_by_name, created_at)
    VALUES (?, ?, ?, ?, 'MANUAL', '', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, actor.store.entityId, row.seharusnya_store_id, row.amount, `mutasi:${row.mid}:${row.rrn}`, row.trx_at, row.business_date, row.payment_type,
    `Dibuat dari mutasi BCA ${row.merchant_name} RRN ${row.rrn} (notifikasi tidak sampai)`, actor.role, actor.name, now).run();
  await db.prepare(`UPDATE qris_mutasi SET masuk_id = ? WHERE id = ?`).bind(id, row.id).run();
  await tautkanOtomatis(db, row.seharusnya_store_id, { around: row.trx_at });
  return json({ ok: true, id }, 201);
}

// SALAH_GERAI: uang diklaim gerai lain. Admin memindahkannya ke gerai sesuai outlet di mutasi; tautan &
// klaim lama dilepas (jejaknya ditulis di catatan), lalu Leker mencoba menautkan ke penjualan gerai yang benar.
async function pindah(db, actor, value) {
  const row = await barisMutasi(db, actor, value?.mutasiId);
  if (!row?.masuk_id) return json({ error: 'Baris mutasi belum punya uang masuk.' }, 404);
  if (!row.seharusnya_store_id) return json({ error: 'Pasangkan dulu outlet (MID) ini ke gerai.' }, 409);
  const masuk = await db.prepare(`SELECT q.*, s.code AS store_code FROM qris_masuk q LEFT JOIN stores s ON s.id = q.store_id WHERE q.id = ?`).bind(row.masuk_id).first();
  if (masuk.store_id === row.seharusnya_store_id) return json({ error: 'Uang ini sudah di gerai yang benar.' }, 409);
  const jejak = `Dipindah ${actor.name} sesuai mutasi BCA (${row.merchant_name}, RRN ${row.rrn}). Sebelumnya: ${masuk.store_code || 'kolam'}`
    + `${masuk.claimed_by_name ? `, diklaim ${masuk.claimed_by_name}` : ''}${masuk.sale_id ? `, tertaut penjualan ${masuk.sale_id}` : ''}. ${text(value?.catatan, 200)}`.trim();
  await db.prepare(`
    UPDATE qris_masuk SET store_id = ?, status = 'BELUM', sale_id = NULL, link_mode = NULL, linked_at = NULL, linked_by_role = '', linked_by_name = '',
      claimed_at = ?, claimed_by_role = ?, claimed_by_id = '', claimed_by_name = ?, note = ?
    WHERE id = ?
  `).bind(row.seharusnya_store_id, new Date().toISOString(), actor.role, `${actor.name} (mutasi)`, jejak, masuk.id).run();
  await tautkanOtomatis(db, row.seharusnya_store_id, { around: row.trx_at });
  return json({ ok: true });
}

export async function handleQrisMutasiApi(request, db, actor, pathname, value) {
  if (!actor.entityWide) return json({ error: 'Validasi mutasi hanya untuk Entity Admin / Owner.', code: 'QRIS_FORBIDDEN' }, 403);
  if (request.method === 'GET' && pathname === '/api/qris/mutasi') return lihat(db, actor, new URL(request.url).searchParams.get('tanggal'));
  if (request.method !== 'POST') return json({ error: 'Metode tidak didukung.' }, 405);
  switch (pathname) {
    case '/api/qris/mutasi': return unggah(db, actor, value);
    case '/api/qris/mutasi/peta': return simpanPeta(db, actor, value);
    case '/api/qris/mutasi/buat-masuk': return buatMasuk(db, actor, value);
    case '/api/qris/mutasi/pindah': return pindah(db, actor, value);
    default: return json({ error: 'Rute mutasi tidak dikenal.' }, 404);
  }
}
