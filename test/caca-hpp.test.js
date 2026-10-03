import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { bangunJalurAksi } from '../src/caca-chat.js';
import { cariAksi, periksaUlangDraft } from '../src/caca-aksi.js';
import { hargaPerSatuan } from '../src/caca-aksi-hpp.js';
import { jawabPertanyaan, tanyaHalus } from '../src/caca-agen.js';
import { hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const SCALE = 1_000_000;
const WRONG_COST = 1092 * SCALE;
const MILD_COST = 1_100_000; // Rp1,1 per satuan: melenceng 10%, di bawah ambang 20% // harga adonan per satuan yang salah tercatat
const KIND = 'product_kind_store_kantor_raw_material';

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}
class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) {
    this.db.exec('BEGIN');
    try { const out = statements.map(statement => statement.run()); this.db.exec('COMMIT'); return out; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  return db;
}

let seq = 0;
const nextId = prefix => `${prefix}_${++seq}`;

function addProduct(db, name, unitId, averageCost = 0) {
  const id = Number(db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM products').get().n);
  db.prepare(`INSERT INTO products (id, store_id, name, price, category, base_unit_id, product_kind_id, average_cost, stock_tracking_enabled)
    VALUES (?, 'store_kantor', ?, 0, 'Uji', ?, ?, ?, 0)`).run(id, name, unitId, KIND, averageCost);
  return id;
}

async function setup() {
  const db = migratedDatabase();
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_hpp', 'owner_hpp', 'x', 'Owner')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_hpp', '2026-09-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-hpp'));
  db.prepare(`INSERT INTO units (id, store_id, code, name, symbol, decimal_scale) VALUES ('unit_kantor_rp', 'store_kantor', 'RUPIAH', 'Rupiah', 'Rp', 0)`).run();
  db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES ('kasir_hpp', 'kasir_hpp', 'x', 'Kasir', 'store_kantor', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();
  db.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES ('laci_hpp', 'store_kantor', 'kasir_hpp', 0, 'OPEN', CURRENT_TIMESTAMP)`).run();
  const adonan = addProduct(db, 'Adonan Leker', 'unit_kantor_rp', WRONG_COST);
  const leker = addProduct(db, 'Leker Keju', 'unit_store_kantor_pcs');
  db.prepare(`INSERT INTO manufacturing_recipes (id, store_id, output_product_id, output_unit_id, output_quantity, revision, status, created_at)
    VALUES ('resep_leker', 'store_kantor', ?, 'unit_store_kantor_pcs', 1, 1, 'ACTIVE', '2026-09-01T00:00:00.000Z')`).run(leker);
  return { db, d1: new D1Database(db), adonan, leker, token: 'owner-hpp' };
}

// Satu penjualan Leker dadakan: harga = jumlah adonan (1 adonan = Rp1), tapi
// HPP tercatat memakai harga adonan yang salah.
function seedDadakanSale(ctx, { price, createdAt, voided = false, journalPosted = false, componentKind = KIND, unitCost = WRONG_COST }) {
  const { db, adonan, leker } = ctx;
  const saleId = nextId('sale');
  const runId = nextId('run');
  const wrongCost = price * unitCost;
  db.prepare(`INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, total_amount, created_at, voided_at) VALUES (?, 'store_kantor', 'laci_hpp', 'kasir_hpp', ?, ?, ?)`)
    .run(saleId, price, createdAt, voided ? createdAt : null);
  db.prepare(`INSERT INTO production_runs (id, store_id, drawer_session_id, sale_id, mode, output_product_id, output_product_name, output_unit_id, output_unit_symbol,
      recipe_id, recipe_revision, batches, output_quantity_per_batch, total_output_quantity, hpp_total_scaled, status, created_by_role, created_by_id, created_at)
    VALUES (?, 'store_kantor', 'laci_hpp', ?, 'AUTO_DADAKAN', ?, 'Leker Keju', 'unit_store_kantor_pcs', 'pcs', 'resep_leker', 1, 1, 1, 1, ?, 'POSTED', 'CASHIER', 'kasir_hpp', ?)`)
    .run(runId, saleId, leker, wrongCost, createdAt);
  db.prepare(`INSERT INTO production_run_components (id, production_run_id, store_id, component_product_id, component_product_name, component_unit_id, component_unit_symbol,
      quantity_per_batch, total_quantity, unit_cost_snapshot_scaled, total_cost_snapshot_scaled, component_product_kind_id)
    VALUES (?, ?, 'store_kantor', ?, 'Adonan Leker', 'unit_kantor_rp', 'Rp', ?, ?, ?, ?, ?)`)
    .run(nextId('comp'), runId, adonan, price, price, unitCost, wrongCost, componentKind);
  db.prepare(`INSERT INTO sale_items (id, sale_id, store_id, product_id, product_name, unit_price, quantity, line_total, unit_cost_snapshot, line_cogs, production_run_id, product_kind_id)
    VALUES (?, ?, 'store_kantor', ?, 'Leker Keju', ?, 1, ?, ?, ?, ?, ?)`)
    .run(nextId('item'), saleId, leker, price, price, wrongCost, wrongCost, runId, KIND);
  if (journalPosted) {
    db.prepare(`INSERT INTO accounting_bridge_deliveries (id, store_id, producer_module, fact_type, fact_id, transaction_category_code, status)
      VALUES (?, 'store_kantor', 'POS', 'SALE', ?, 'sale', 'POSTED')`).run(nextId('delivery'), saleId);
  }
  return saleId;
}

function call(ctx, method, path, body) {
  const url = new URL(`https://example.test${path}`);
  url.searchParams.set('store', 'KANTOR');
  return worker.fetch(new Request(url, {
    method, headers: { authorization: `Bearer ${ctx.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  }), { DB: ctx.d1 });
}

const HARI_INI = '2026-10-02';

// Una dipanggil seperti di produksi: lewat pintu utama (worker.fetch) dengan
// kredensial penyuruh dan gerai dari sesi.
function unaJalur(ctx) {
  const request = new Request('https://example.test/api/caca/tanya?store=KANTOR', { headers: { authorization: `Bearer ${ctx.token}` } });
  const jalur = bangunJalurAksi(request, { DB: ctx.d1 }, { storeCode: 'KANTOR', jalurUtama: (permintaan) => worker.fetch(permintaan, { DB: ctx.d1 }) });
  return { ...jalur, hariIni: HARI_INI, namaLingkup: 'Kantor', lingkup: 'gerai', storeCode: 'KANTOR' };
}

async function seedAnomali(ctx) {
  ctx.db.prepare("UPDATE stores SET edition = 'FLEXIBLE' WHERE id = 'store_kantor'").run();
  seedDadakanSale(ctx, { price: 1000, createdAt: '2026-09-10T05:00:00.000Z', unitCost: SCALE });      // benar
  seedDadakanSale(ctx, { price: 2000, createdAt: '2026-09-12T05:00:00.000Z', unitCost: MILD_COST }); // melenceng ringan
  seedDadakanSale(ctx, { price: 2000, createdAt: '2026-09-15T05:00:00.000Z' });                      // salah
  seedDadakanSale(ctx, { price: 5000, createdAt: '2026-09-16T05:00:00.000Z' });                      // salah
}

const ambilAksi = () => cariAksi('hitung_ulang_hpp');

test('harga per satuan: ribuan, pecahan koma/titik, singkatan; nol dan sampah ditolak', () => {
  assert.equal(hargaPerSatuan('1.200').teks, '1200');
  assert.equal(hargaPerSatuan('1200').teks, '1200');
  assert.equal(hargaPerSatuan('Rp 1,5rb').teks, '1500');
  assert.equal(hargaPerSatuan('0,5').teks, '0.5');
  assert.equal(hargaPerSatuan('12.75').teks, '12.75');
  assert.equal(hargaPerSatuan('0,000001').skala, 1n);
  assert.equal(hargaPerSatuan('0').ok, false);
  assert.equal(hargaPerSatuan('banyak').ok, false);
  assert.equal(hargaPerSatuan('').ok, false);
});

test('tanpa harga benar: Una menyebut HPP tercatat sekarang dan bertanya, tidak menebak', async () => {
  const ctx = await setup();
  try {
    await seedAnomali(ctx);
    const hasil = await ambilAksi().siapkan({ hpp_bahan: 'adonan' }, unaJalur(ctx));
    assert.equal(hasil.ok, false);
    assert.match(hasil.tanya, /Adonan Leker sekarang tercatat Rp1\.092 per Rp/);
    assert.match(hasil.tanya, /\?$/);
    assert.equal(tanyaHalus('hitung_ulang_hpp', hasil.tanya).startsWith('Dikit lagi ya Bos'), true, 'soal uang: ajakan halus');
  } finally { ctx.db.close(); }
});

test('bahan belum ketemu: disebut bahan yang bisa dikoreksi', async () => {
  const ctx = await setup();
  try {
    await seedAnomali(ctx);
    const hasil = await ambilAksi().siapkan({ hpp_bahan: 'matcha', hpp_harga: '1' }, unaJalur(ctx));
    assert.equal(hasil.ok, false);
    assert.match(hasil.tanya, /belum (ketemu|nemu) nih\. Yang bisa dikoreksi HPP-nya: Adonan Leker/);
    assert.equal(tanyaHalus('hitung_ulang_hpp', hasil.tanya), hasil.tanya, 'pernyataan tidak diberi ajakan');
  } finally { ctx.db.close(); }
});

test('rekap ulang: tanggal salah dicari kode (yang melenceng ringan dilewati), draft apa adanya, posting mengoreksi HPP', async () => {
  const ctx = await setup();
  try {
    await seedAnomali(ctx);
    const tangkapan = { hpp_bahan: 'adonan leker', hpp_harga: '1', hpp_dari: null, hpp_hanya_harga: null };
    const hasil = await ambilAksi().siapkan(tangkapan, unaJalur(ctx));
    assert.equal(hasil.ok, true, hasil.tanya);

    const { draft } = hasil;
    assert.equal(draft.muatan.from, '2026-09-15', 'tanggal pertama yang melenceng > 20%, bukan 09-12 (10%)');
    assert.equal(draft.muatan.otomatis, true);
    assert.equal(draft.muatan.mode, 'ulang');
    assert.deepEqual(draft.tabel.isi.map((baris) => baris[0]), ['2026-09-15', '2026-09-16']);
    assert.deepEqual(draft.baris.find(([label]) => label.startsWith('Mulai tanggal')), ['Mulai tanggal', '2026-09-15 (dicari Una)']);
    assert.ok(draft.dampak.some((d) => /dicari Una/.test(d)));
    assert.ok(draft.dampak.some((d) => /Hanya HPP yang berubah/.test(d)));

    // Konfirmasi: disusun ulang dari tangkapan dan harus sama persis.
    const diperiksa = await periksaUlangDraft({ ...draft, tangkapan }, unaJalur(ctx));
    assert.equal(diperiksa.ok, true, diperiksa.error);

    const sebelum = ctx.db.prepare('SELECT SUM(line_cogs) AS cogs FROM sale_items').get().cogs;
    const jalur = unaJalur(ctx);
    const posting = await diperiksa.aksi.posting(diperiksa.draft, jalur);
    assert.equal(posting.ok, true, posting.error);
    assert.match(posting.jawaban, /Sudah Una hitung ulang HPP Adonan Leker: HPP dikoreksi −[\d.]+ pada 2 penjualan/);

    assert.equal(ctx.db.prepare('SELECT SUM(line_cogs) AS cogs FROM sale_items').get().cogs, sebelum, 'snapshot lama tidak ditulis ulang');
    assert.equal(ctx.db.prepare('SELECT average_cost FROM products WHERE id = ?').get(ctx.adonan).average_cost, SCALE);
    const catatan = ctx.db.prepare('SELECT effective_from, reason, line_count, created_by_role FROM hpp_recalculations').all();
    assert.equal(catatan.length, 1);
    assert.equal(catatan[0].effective_from, '2026-09-15');
    assert.match(catatan[0].reason, /Koreksi HPP Adonan Leker lewat Una/);
    assert.equal(catatan[0].line_count, 2);

    // Sekali lagi: tidak ada yang perlu dikoreksi, tidak ada koreksi ganda.
    const ulang = await ambilAksi().siapkan(tangkapan, unaJalur(ctx));
    assert.equal(ulang.ok, false);
    assert.match(ulang.tanya, /tidak ada yang perlu dikoreksi/i);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM hpp_recalculations').get().n, 1);
  } finally { ctx.db.close(); }
});

test('tanggal disebut: dipakai apa adanya, tidak dicari; tanggal di masa depan ditanyakan', async () => {
  const ctx = await setup();
  try {
    await seedAnomali(ctx);
    const hasil = await ambilAksi().siapkan({ hpp_bahan: 'adonan', hpp_harga: '1', hpp_dari: '2026-09-16' }, unaJalur(ctx));
    assert.equal(hasil.ok, true, hasil.tanya);
    assert.equal(hasil.draft.muatan.from, '2026-09-16');
    assert.equal(hasil.draft.muatan.otomatis, false);
    assert.deepEqual(hasil.draft.tabel.isi.map((baris) => baris[0]), ['2026-09-16']);
    assert.ok(!hasil.draft.dampak.some((d) => /dicari Una/.test(d)));

    const depan = await ambilAksi().siapkan({ hpp_bahan: 'adonan', hpp_harga: '1', hpp_dari: '2026-12-01' }, unaJalur(ctx));
    assert.equal(depan.ok, false);
    assert.match(depan.tanya, /masa depan/);
  } finally { ctx.db.close(); }
});

test('urgent, hanya harga ke depan: harga rata-rata diganti, penjualan lama tidak disentuh', async () => {
  const ctx = await setup();
  try {
    await seedAnomali(ctx);
    const tangkapan = { hpp_bahan: 'adonan', hpp_harga: '1', hpp_hanya_harga: true };
    const hasil = await ambilAksi().siapkan(tangkapan, unaJalur(ctx));
    assert.equal(hasil.ok, true, hasil.tanya);
    assert.equal(hasil.draft.muatan.mode, 'ke_depan');
    assert.equal(hasil.draft.muatan.from, '2026-10-03', 'besok: tidak ada penjualan yang ikut');
    assert.equal(hasil.draft.tabel, undefined);
    assert.match(hasil.draft.judul, /membetulkan harga rata-rata/);

    const diperiksa = await periksaUlangDraft({ ...hasil.draft, tangkapan }, unaJalur(ctx));
    assert.equal(diperiksa.ok, true, diperiksa.error);
    const posting = await diperiksa.aksi.posting(diperiksa.draft, unaJalur(ctx));
    assert.match(posting.jawaban, /Sudah Una betulkan harga rata-rata Adonan Leker/);
    assert.equal(ctx.db.prepare('SELECT average_cost FROM products WHERE id = ?').get(ctx.adonan).average_cost, SCALE);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM hpp_recalculation_lines').get().n, 0);
  } finally { ctx.db.close(); }
});

test('draft HPP yang diutak-atik di browser (harga diganti) ditolak', async () => {
  const ctx = await setup();
  try {
    await seedAnomali(ctx);
    const tangkapan = { hpp_bahan: 'adonan', hpp_harga: '1', hpp_hanya_harga: true };
    const hasil = await ambilAksi().siapkan(tangkapan, unaJalur(ctx));
    const diubah = structuredClone({ ...hasil.draft, tangkapan });
    diubah.baris[2][1] = 'Rp9 per Rp';
    const diperiksa = await periksaUlangDraft(diubah, unaJalur(ctx));
    assert.equal(diperiksa.ok, false);
    assert.equal(diperiksa.status, 409);
  } finally { ctx.db.close(); }
});

test('agen: pesan "ubah hpp"-nya tersambung ke alat, bukan ke kamus; di entity diarahkan ke gerai', async () => {
  const ctx = await setup();
  try {
    await seedAnomali(ctx);
    const konteks = { nama: 'Bos', peran: 'Entity Admin', lingkup: 'gerai', namaLingkup: 'Kantor', storeCode: 'KANTOR', storeName: 'Kantor', hariIni: HARI_INI };
    const panggilan = [];
    const hasil = await jawabPertanyaan('maksudnya HPP adonan yang ga normal tadi? ubah hppnya jadi 1', {
      ...konteks,
      riwayat: [{ dari: 'saya', teks: 'coba cek barang dengan hpp ga normal' }, { dari: 'una', teks: 'Adonan Leker HPP 1.092 per Rp, tidak wajar.' }]
    }, {
      jalurAksi: bangunJalurAksi(new Request('https://example.test/x', { headers: { authorization: `Bearer ${ctx.token}` } }), { DB: ctx.d1 }, { storeCode: 'KANTOR', jalurUtama: (p) => worker.fetch(p, { DB: ctx.d1 }) }),
      panggilModel: async (_env, permintaan) => {
        panggilan.push(permintaan);
        return { ok: true, value: { alat: 'hitung_ulang_hpp', hpp_bahan: 'adonan', hpp_harga: '1' } };
      }
    });
    assert.equal(hasil.perluKonfirmasi, true);
    assert.equal(hasil.draft.aksi, 'hitung_ulang_hpp');
    assert.equal(panggilan.length, 1, 'satu panggilan model, sisanya kode');
    assert.match(panggilan[0].system, /hitung_ulang_hpp/);
    assert.match(panggilan[0].system, /jelaskan HANYA untuk pertanyaan arti istilah/);
    assert.match(panggilan[0].content[0].text, /Adonan Leker HPP 1\.092/, 'riwayat ikut dibawa');

    const diEntity = await jawabPertanyaan('hitung ulang hpp adonan jadi 1', { ...konteks, lingkup: 'entity', namaLingkup: 'Usaha' }, {
      jalurAksi: {}, panggilModel: async () => ({ ok: true, value: { alat: 'hitung_ulang_hpp', hpp_bahan: 'adonan', hpp_harga: '1' } })
    });
    assert.match(diEntity.jawaban, /dikerjakan per gerai/);
  } finally { ctx.db.close(); }
});

test('HPP: pintu Una hanya membuka jalur hitung ulang yang sudah ada, bukan jalur tulis lain', async () => {
  const ctx = await setup();
  try {
    const jalur = unaJalur(ctx);
    assert.equal((await jalur.baca('/api/admin/hpp-recalculation/components')).ok, true);
    const lain = await jalur.kirim('POST', '/api/admin/hpp-recalculationx', {});
    assert.equal(lain.ok, false);
    assert.match(lain.error, /tidak terdaftar/);
  } finally { ctx.db.close(); }
});
