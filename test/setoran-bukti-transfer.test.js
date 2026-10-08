import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import {
  bacaBuktiTransfer,
  bacaFotoBukti,
  cocokkanMutasi,
  normalisasiJam,
  normalisasiTanggal,
  rapikanBacaan,
  simpanFotoBukti,
  tetapkanWaktuTransfer,
  waktuTransferIso
} from '../src/setoran-bukti.js';

// Bos Cyo, 2026-10-08: storage foto bukti setoran, baca otomatis hari/jam:menit transfer (boleh
// diisi manual, laporan menandai), dan pondasi cek otomatis ke mutasi bank.

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-08T05:00:00.000Z'); // 12.00 WIB

test('tanggal & jam dari bukti dinormalkan, waktu WIB jadi ISO UTC, dan waktu janggal ditolak', () => {
  assert.equal(normalisasiTanggal('08 Okt 2026'), '2026-10-08');
  assert.equal(normalisasiTanggal('8/10/2026'), '2026-10-08');
  assert.equal(normalisasiTanggal('2026-10-08'), '2026-10-08');
  assert.equal(normalisasiTanggal('31 Feb 2026'), null);
  assert.equal(normalisasiJam('9.05'), '09:05');
  assert.equal(normalisasiJam('21:40:12'), '21:40');
  assert.equal(normalisasiJam('25:00'), null);
  assert.equal(waktuTransferIso('2026-10-08', '10:40', NOW), '2026-10-08T03:40:00.000Z');
  assert.equal(waktuTransferIso('2026-10-08', '12:30', NOW), null, 'masa depan > 10 menit ditolak');
  assert.equal(waktuTransferIso('2026-06-01', '10:00', NOW), null, 'lebih tua dari 60 hari ditolak');
});

test('hasil baca mesin dirapikan; bidang yang tak terbaca kosong, bukan ditebak', () => {
  const bacaan = rapikanBacaan({ adalahBuktiTransfer: true, tanggal: '08 Okt 2026', jam: '10.40', nominal: 150000, bank: 'BCA', referensi: 'ABC123', penerima: 'Rekening Bersama' }, NOW);
  assert.deepEqual(bacaan, {
    adalahBuktiTransfer: true, tanggal: '2026-10-08', jam: '10:40', transferAt: '2026-10-08T03:40:00.000Z',
    nominalRupiah: 150000, bank: 'BCA', referensi: 'ABC123', penerima: 'Rekening Bersama'
  });
  const kosong = rapikanBacaan({ adalahBuktiTransfer: false, tanggal: '', jam: '', nominal: 0, bank: '', referensi: '', penerima: '' }, NOW);
  assert.equal(kosong.transferAt, null);
  assert.equal(kosong.nominalRupiah, null);
  assert.equal(kosong.adalahBuktiTransfer, false);
});

test('pembaca memakai lapisan AI dengan gambar + skema, dan kegagalannya tidak dilempar', async () => {
  let permintaan;
  const ok = await bacaBuktiTransfer({}, { bytes: new Uint8Array([1, 2, 3]).buffer, type: 'image/jpeg' }, {
    now: NOW,
    call: async (_env, req) => { permintaan = req; return { ok: true, value: { adalahBuktiTransfer: true, tanggal: '2026-10-08', jam: '10:40', nominal: 50000, bank: 'DANA', referensi: '', penerima: '' } }; }
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.bacaan.transferAt, '2026-10-08T03:40:00.000Z');
  assert.equal(permintaan.content[0].type, 'image');
  assert.equal(permintaan.content[0].data, Buffer.from([1, 2, 3]).toString('base64'));
  assert.ok(permintaan.schema.required.includes('jam'));
  const gagal = await bacaBuktiTransfer({}, { bytes: new ArrayBuffer(1), type: 'image/jpeg' }, { call: async () => ({ ok: false, status: 503, error: 'Kunci belum dipasang' }) });
  assert.deepEqual(gagal, { ok: false, status: 503, error: 'Kunci belum dipasang' });
});

test('asal waktu transfer: OTOMATIS hanya bila sama persis dengan bacaan server; selain itu MANUAL', () => {
  const bacaan = { transferAt: '2026-10-08T03:40:00.000Z' };
  assert.deepEqual(tetapkanWaktuTransfer({ tanggal: '2026-10-08', jam: '10:40' }, bacaan, NOW), { transferAt: '2026-10-08T03:40:00.000Z', source: 'OTOMATIS' });
  assert.deepEqual(tetapkanWaktuTransfer({ tanggal: '2026-10-08', jam: '10:45' }, bacaan, NOW), { transferAt: '2026-10-08T03:45:00.000Z', source: 'MANUAL' });
  assert.deepEqual(tetapkanWaktuTransfer({ tanggal: '2026-10-08', jam: '10:40' }, null, NOW), { transferAt: '2026-10-08T03:40:00.000Z', source: 'MANUAL' });
  assert.deepEqual(tetapkanWaktuTransfer({ tanggal: '', jam: '' }, bacaan, NOW), { transferAt: null, source: '' });
});

test('pondasi cek mutasi: cocok bila nominal persis & waktu dekat; ganda/sudah terpakai tidak dipaksakan', () => {
  const setoran = { amountScaled: 150_000_000_000, transferAt: '2026-10-08T03:40:00.000Z' };
  const m = (id, menit, rupiah = 150000, extra = {}) => ({ id, direction: 'IN', amount_scaled: rupiah * 1_000_000, occurred_at: new Date(Date.parse(setoran.transferAt) + menit * 60000).toISOString(), matched_payment_id: null, ...extra });
  assert.equal(cocokkanMutasi(setoran, [m('a', 12)]).mutation.id, 'a');
  assert.equal(cocokkanMutasi(setoran, [m('a', 12, 150001)]).status, 'TIDAK_ADA', 'nominal beda 1 rupiah tidak cocok');
  assert.equal(cocokkanMutasi(setoran, [m('a', 90)]).status, 'TIDAK_ADA', 'di luar jendela 60 menit');
  assert.equal(cocokkanMutasi(setoran, [m('a', 5), m('b', 20)]).status, 'GANDA');
  assert.equal(cocokkanMutasi(setoran, [m('a', 5, 150000, { matched_payment_id: 'lain' })]).status, 'TIDAK_ADA');
  assert.equal(cocokkanMutasi(setoran, [m('a', 5, 150000, { direction: 'OUT' })]).status, 'TIDAK_ADA');
});

function fakeR2() {
  const store = new Map();
  return {
    store,
    async put(key, bytes, opts) { store.set(key, { bytes: new Uint8Array(bytes), type: opts?.httpMetadata?.contentType }); },
    async get(key) { const v = store.get(key); return v ? { body: v.bytes, httpMetadata: { contentType: v.type } } : null; }
  };
}

test('storage foto: R2 bila terpasang, D1 bila belum / R2 gagal; foto lama di D1 tetap terbaca', async () => {
  const bytes = new Uint8Array([9, 8, 7]).buffer;
  const r2 = fakeR2();
  const keR2 = await simpanFotoBukti({ R2_BUCKET: r2 }, { storeId: 'store_pendem', bytes, type: 'image/jpeg' });
  assert.match(keR2.key, /^setoran\/store_pendem\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.jpg$/);
  assert.equal(keR2.bytes, null);
  const dibaca = await bacaFotoBukti({ R2_BUCKET: r2 }, { proof_photo_key: keR2.key });
  assert.deepEqual([...dibaca.body], [9, 8, 7]);

  const keD1 = await simpanFotoBukti({}, { storeId: 'store_pendem', bytes, type: 'image/jpeg' });
  assert.equal(keD1.key, null);
  assert.equal(keD1.bytes, bytes);
  const rusak = { put: async () => { throw new Error('R2 down'); }, get: async () => null };
  assert.equal((await simpanFotoBukti({ R2_BUCKET: rusak }, { storeId: 'x', bytes, type: 'image/jpeg' })).bytes, bytes, 'R2 gagal jatuh ke D1');
  const lama = await bacaFotoBukti({ R2_BUCKET: r2 }, { proof_photo: new Uint8Array([1]), proof_photo_type: 'image/jpeg' });
  assert.deepEqual([...lama.body], [1]);
  assert.equal(await bacaFotoBukti({}, { proof_photo: null }), null);
});

// --- Alur penuh lewat Worker ----------------------------------------------------

const migrationDir = new URL('../migrations/', import.meta.url);
class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params.map(p => (p instanceof ArrayBuffer ? new Uint8Array(p) : p))); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() { const r = this.db.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: Number(r.changes || 0) } }; }
}
class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) {
    this.db.exec('BEGIN');
    try { const out = statements.map(s => s.run()); this.db.exec('COMMIT'); return out; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  db.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, 'cashier_pendem_pilot', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('kasir-token'));
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_b', 'owner_b', 'x', 'Bos')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_b', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-token'));
  db.prepare(`
    INSERT INTO operational_receivables_payables (id, store_id, entity_id, source_type, balance_type, source_id, counterparty_id, counterparty_name_snapshot, counterparty_type, description, original_amount, transaction_date)
    VALUES ('orp_bukti', 'store_pendem', 'ENT-KPM', 'EMPLOYEE_DEPOSIT', 'RECEIVABLE', 'drawer_bukti', 'cashier:cashier_pendem_pilot', 'Kasir Pendem', 'EMPLOYEE', 'Setoran laci', 400000000000, '2026-10-07')
  `).run();
  return db;
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const formWith = fields => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
const kasir = (env, path, body) => worker.fetch(new Request(`https://example.test${path}`, { method: 'POST', headers: { Authorization: 'Bearer kasir-token' }, body }), env);

function mockGemini(jawaban) {
  const asli = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(jawaban) }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return asli(url, init);
  };
  return () => { globalThis.fetch = asli; };
}

test('alur penuh: baca foto -> kirim setoran -> asal OTOMATIS/MANUAL tersimpan -> foto di R2 -> ACC menandai dicek Admin', async () => {
  const db = await setup();
  const r2 = fakeR2();
  const env = { DB: new D1Database(db), GEMINI_API_KEY: 'uji', R2_BUCKET: r2 };
  // Waktu transfer harus "masa lalu dekat" relatif jam sekarang (validasi 60 hari).
  const sekarang = new Date(Date.now() - 30 * 60 * 1000);
  const wib = new Date(sekarang.getTime() + 7 * 3600 * 1000).toISOString();
  const tanggal = wib.slice(0, 10);
  const jam = wib.slice(11, 16);
  const pulihkan = mockGemini({ adalahBuktiTransfer: true, tanggal, jam, nominal: 150000, bank: 'BCA', referensi: 'REF1', penerima: '' });
  try {
    const baca = await kasir(env, '/api/cashier/employee-deposits/read-proof', formWith({ photo: new File([JPEG], 'b.jpg', { type: 'image/jpeg' }) }));
    assert.equal(baca.status, 200, await baca.clone().text());
    const { bacaan } = await baca.json();
    assert.equal(bacaan.jam, jam);
    assert.equal(bacaan.nominalRupiah, 150000);

    // Kirim dengan waktu persis bacaan -> OTOMATIS, foto masuk R2.
    const kirim = await kasir(env, '/api/cashier/employee-deposits/orp_bukti/payments', formWith({
      amountRupiah: '150000', photo: new File([JPEG], 'b.jpg', { type: 'image/jpeg' }), transferDate: tanggal, transferTime: jam
    }));
    assert.equal(kirim.status, 201, await kirim.clone().text());
    const hasil = await kirim.json();
    assert.equal(hasil.transferAtSource, 'OTOMATIS');
    const row = db.prepare(`SELECT proof_photo, proof_photo_key, transfer_at, transfer_at_source, proof_read_json, verification_status FROM operational_receivable_payable_payments WHERE id = ?`).get(hasil.payment.id);
    assert.equal(row.proof_photo, null, 'foto tidak di D1 bila R2 terpasang');
    assert.ok(r2.store.has(row.proof_photo_key));
    assert.equal(row.transfer_at_source, 'OTOMATIS');
    assert.equal(JSON.parse(row.proof_read_json).bank, 'BCA');
    assert.equal(row.verification_status, 'BELUM_DICEK');

    // Jam diubah CS -> MANUAL.
    const jamLain = `${jam.slice(0, 3)}${String((Number(jam.slice(3)) + 1) % 60).padStart(2, '0')}`;
    const manual = await kasir(env, '/api/cashier/employee-deposits/orp_bukti/payments', formWith({
      amountRupiah: '50000', photo: new File([JPEG], 'b.jpg', { type: 'image/jpeg' }), transferDate: tanggal, transferTime: jamLain
    }));
    assert.equal(manual.status, 201, await manual.clone().text());
    assert.equal((await manual.json()).transferAtSource, 'MANUAL');

    // Admin melihat waktu + asal + bacaan, foto terbaca dari R2, ACC menandai DICEK_ADMIN.
    const owner = (path, init = {}) => worker.fetch(new Request(`https://example.test${path}${path.includes('?') ? '&' : '?'}store=PENDEM`, { ...init, headers: { Authorization: 'Bearer owner-token', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } }), env);
    const overview = await (await owner('/api/admin/employee-deposits/overview')).json();
    const p = overview.pending.find(item => item.id === hasil.payment.id);
    assert.equal(p.transferAtSource, 'OTOMATIS');
    assert.equal(p.proofRead.nominalRupiah, 150000);
    assert.equal(p.hasPhoto, true);
    const foto = await owner(`/api/admin/employee-deposits/payments/${hasil.payment.id}/photo`);
    assert.equal(foto.status, 200);
    assert.deepEqual([...new Uint8Array(await foto.arrayBuffer())], [...JPEG]);
    const acc = await owner(`/api/admin/employee-deposits/payments/${hasil.payment.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'APPROVE' }) });
    assert.equal(acc.status, 200, await acc.clone().text());
    const sesudah = db.prepare(`SELECT verification_status, verification_provider, verified_at FROM operational_receivable_payable_payments WHERE id = ?`).get(hasil.payment.id);
    assert.equal(sesudah.verification_status, 'DICEK_ADMIN');
    assert.equal(sesudah.verification_provider, 'ADMIN');
    assert.ok(sesudah.verified_at);
  } finally { pulihkan(); db.close(); }
});

test('tanpa R2 foto tetap di D1, dan baca otomatis gagal tidak menghalangi setoran (asal MANUAL)', async () => {
  const db = await setup();
  const env = { DB: new D1Database(db) }; // tanpa kunci AI, tanpa R2
  try {
    const baca = await kasir(env, '/api/cashier/employee-deposits/read-proof', formWith({ photo: new File([JPEG], 'b.jpg', { type: 'image/jpeg' }) }));
    assert.equal(baca.status, 503);
    const wib = new Date(Date.now() - 20 * 60 * 1000 + 7 * 3600 * 1000).toISOString();
    const kirim = await kasir(env, '/api/cashier/employee-deposits/orp_bukti/payments', formWith({
      amountRupiah: '100000', photo: new File([JPEG], 'b.jpg', { type: 'image/jpeg' }), transferDate: wib.slice(0, 10), transferTime: wib.slice(11, 16)
    }));
    assert.equal(kirim.status, 201, await kirim.clone().text());
    const hasil = await kirim.json();
    assert.equal(hasil.transferAtSource, 'MANUAL');
    const row = db.prepare(`SELECT length(proof_photo) AS n, proof_photo_key FROM operational_receivable_payable_payments WHERE id = ?`).get(hasil.payment.id);
    assert.equal(row.n, JPEG.length);
    assert.equal(row.proof_photo_key, null);
  } finally { db.close(); }
});

test('foto dibuka di halaman yang sama (bukan tab baru), Portal Staf mengisi waktu transfer dan memperkecil foto', () => {
  const lihat = read('public/foto-lihat.js');
  assert.match(lihat, /window\.MAXIFotoLihat = \{ buka, tutup \}/);
  for (const file of ['public/staff.js', 'public/admin-employee-deposits.js', 'public/entity-setoran-cs.js']) {
    assert.match(read(file), /window\.MAXIFotoLihat\.buka\(url, 'Foto bukti transfer'\)/, file);
  }
  for (const [page, script] of [['staff', 'staff.js'], ['branch-admin', 'admin-employee-deposits.js'], ['entity-admin', 'entity-setoran-cs.js']]) {
    const html = read(`public/${page}.html`);
    assert.ok(html.indexOf('/foto-lihat.js') !== -1 && html.indexOf('/foto-lihat.js') < html.indexOf(`/${script}?v=20261008-bukti-transfer-v1`), page);
  }
  const staff = read('public/staff.js');
  assert.match(staff, /const SISI_FOTO_SETORAN = 1920;/);
  assert.match(staff, /\/api\/cashier\/employee-deposits\/read-proof/);
  assert.match(staff, /form\.set\('transferDate', tanggalInput\.value\)/);
  assert.match(staff, /form\.set\('photo', fotoSiap \|\| await kecilkanFotoSetoran\(file\)\)/, 'foto yang dikirim = foto yang dibaca');
  assert.match(read('public/admin-employee-deposits.js'), /terbaca otomatis' : 'diisi manual'/);
  assert.match(read('public/entity-setoran-cs.js'), /Nominal di foto/);
});

test('binding R2 foto bukti dideklarasikan di wrangler.jsonc (bukan hanya dashboard) dan dipakai kodenya', () => {
  const config = read('wrangler.jsonc');
  assert.match(config, /"r2_buckets":\s*\[\s*\{\s*"binding":\s*"R2_BUCKET",\s*"bucket_name":\s*"bukti-setoran"\s*\}\s*\]/);
  assert.match(read('src/setoran-bukti.js'), /env\?\.R2_BUCKET/);
  assert.doesNotMatch(read('src/setoran-bukti.js'), /BUKTI_FOTO/);
});
