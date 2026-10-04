import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { scaledToDecimal, annotateHpp } from '../src/entity-stock.js';

// Bos Cyo, 2026-10-02: "tambahkan di entity untuk bisa langsung cek stok semua
// gerai, khususnya bahan. setiap stok bahan 1 baris, setiap gerai 1 kolom."
// KANTOR / PENDEM / MANDALA berbagi entity ENT-KPM; IKAN01 entity lain.

const migrationDir = new URL('../migrations/', import.meta.url);

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

const STORE = { KANTOR: 'store_kantor', PENDEM: 'store_pendem', MANDALA: 'store_mandala' };
const OWNER_TOKEN = 'owner-stock-token';
const ADMIN_TOKEN = 'admin-stock-token';

async function setup() {
  const db = migratedDatabase();
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_stk', 'owner_stk', 'x', 'Owner')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_stk', '2026-09-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential(OWNER_TOKEN));
  db.prepare(`INSERT INTO store_admins (id, store_id, username, password_hash, display_name) VALUES ('adm_stk', 'store_pendem', 'adm_stk', 'x', 'Admin Pendem')`).run();
  db.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, 'adm_stk', '2026-09-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential(ADMIN_TOKEN));
  db.prepare(`INSERT INTO product_masters (id, entity_id, code, name) VALUES ('pm_stk_tepung', 'ENT-KPM', 'STK-TEPUNG', 'Tepung')`).run();
  return { db, d1: new D1Database(db) };
}

const typeId = (db, storeId, code) => db.prepare('SELECT id FROM item_types WHERE store_id = ? AND code = ?').get(storeId, code).id;
const unitId = (db, storeId, code) => db.prepare('SELECT id FROM units WHERE store_id = ? AND code = ?').get(storeId, code).id;

function addProduct(db, storeCode, { name, type = 'RAW_MATERIAL', unit = 'KG', master = null, tracked = 1, active = 1, quantity = null }) {
  const storeId = STORE[storeCode];
  const id = Number(db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM products').get().n);
  db.prepare(`INSERT INTO products (id, store_id, name, price, category, base_unit_id, item_type_id, product_master_id, stock_tracking_enabled, is_active)
    VALUES (?, ?, ?, 0, 'Uji', ?, ?, ?, ?, ?)`).run(id, storeId, name, unitId(db, storeId, unit), typeId(db, storeId, type), master, tracked, active);
  if (quantity != null) db.prepare(`INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, ?, '2026-10-01T00:00:00.000Z')`).run(storeId, id, quantity);
  return id;
}

function call(ctx, { token = OWNER_TOKEN, store = 'KANTOR', search = {} } = {}) {
  const url = new URL('https://example.test/api/admin/entity-stock');
  // Gerai hasil migration sudah punya bahan bawaan; tes hanya menilai barang berawalan "Uji".
  if (!('q' in search)) search = { ...search, q: 'uji' };
  if (store) url.searchParams.set('store', store);
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);
  return worker.fetch(new Request(url, { method: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {} }), { DB: ctx.d1 });
}

test('matriks: satu baris per bahan, satu kolom per gerai; barang jadi dan barang nonaktif tidak ikut', async () => {
  const ctx = await setup();
  try {
    const { db } = ctx;
    addProduct(db, 'KANTOR', { name: 'Uji Gula Pasir', quantity: 12 });
    addProduct(db, 'PENDEM', { name: 'UJI GULA  PASIR', quantity: 5 });
    addProduct(db, 'KANTOR', { name: 'Uji Leker Keju', type: 'FINISHED_GOOD', unit: 'PCS', quantity: 40 });
    addProduct(db, 'KANTOR', { name: 'Uji Bahan Lama', quantity: 9, active: 0 });

    const res = await call(ctx, { search: { stores: 'KANTOR,PENDEM,MANDALA' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.scope, 'ENTITY');
    assert.equal(body.kind, 'BAHAN');
    assert.deepEqual(body.stores.map(store => store.code), ['KANTOR', 'PENDEM', 'MANDALA']);
    assert.deepEqual(body.rows.map(row => row.name.toLowerCase().replace(/\s+/g, ' ')), ['uji gula pasir'], 'hanya bahan aktif; nama beda huruf/spasi disatukan');
    const gula = body.rows[0];
    assert.equal(gula.byStore.KANTOR.quantity, 12);
    assert.equal(gula.byStore.PENDEM.quantity, 5);
    assert.equal(gula.byStore.MANDALA, undefined, 'gerai yang tidak punya barang itu -> sel kosong');
    assert.equal(gula.total, 17);
    assert.equal(gula.storesHolding, 2);
  } finally { ctx.db.close(); }
});

test('kind=SEMUA menyertakan barang jadi; barang yang sama disatukan lewat Kode Barang walau nama beda', async () => {
  const ctx = await setup();
  try {
    const { db } = ctx;
    addProduct(db, 'KANTOR', { name: 'Uji Tepung Terigu', master: 'pm_stk_tepung', quantity: 3 });
    addProduct(db, 'MANDALA', { name: 'Uji Terigu Segitiga', master: 'pm_stk_tepung', quantity: 4 });
    addProduct(db, 'KANTOR', { name: 'Uji Leker Keju', type: 'FINISHED_GOOD', unit: 'PCS', quantity: 40 });

    const bahan = await (await call(ctx, { search: { stores: 'KANTOR,MANDALA' } })).json();
    assert.equal(bahan.rows.length, 1);
    assert.equal(bahan.rows[0].masterCode, 'STK-TEPUNG');
    assert.equal(bahan.rows[0].total, 7);

    const semua = await (await call(ctx, { search: { stores: 'KANTOR,MANDALA', kind: 'SEMUA' } })).json();
    assert.deepEqual(semua.rows.map(row => row.name).sort(), ['Uji Leker Keju', 'Uji Tepung Terigu']);
  } finally { ctx.db.close(); }
});

test('sel: tanpa catatan stok = 0, tidak dilacak = null (bukan 0), dan total diam kalau satuan antar gerai berbeda', async () => {
  const ctx = await setup();
  try {
    const { db } = ctx;
    addProduct(db, 'KANTOR', { name: 'Uji Telur', unit: 'PCS' });                           // dilacak, belum ada saldo
    addProduct(db, 'PENDEM', { name: 'Uji Telur', unit: 'PCS', tracked: 0 });               // tidak dilacak
    addProduct(db, 'KANTOR', { name: 'Uji Minyak', unit: 'LITER', quantity: 2 });
    addProduct(db, 'PENDEM', { name: 'Uji Minyak', unit: 'ML', quantity: 500 });

    const body = await (await call(ctx, { search: { stores: 'KANTOR,PENDEM' } })).json();
    const telur = body.rows.find(row => row.name === 'Uji Telur');
    assert.equal(telur.byStore.KANTOR.tracked, true);
    assert.equal(telur.byStore.KANTOR.quantity, 0);
    assert.equal(telur.byStore.PENDEM.tracked, false);
    assert.equal(telur.byStore.PENDEM.quantity, null);
    assert.equal(telur.total, 0);

    const minyak = body.rows.find(row => row.name === 'Uji Minyak');
    assert.equal(minyak.uniformUnit, false);
    assert.equal(minyak.total, null, 'liter + ml tidak dijumlahkan');
    assert.equal(minyak.byStore.KANTOR.unit, 'L');
    assert.equal(minyak.byStore.PENDEM.unit, 'ml');
  } finally { ctx.db.close(); }
});

test('pencarian q menyaring nama atau Kode Barang', async () => {
  const ctx = await setup();
  try {
    const { db } = ctx;
    addProduct(db, 'KANTOR', { name: 'Uji Gula Pasir', quantity: 1 });
    addProduct(db, 'KANTOR', { name: 'Uji Tepung Terigu', master: 'pm_stk_tepung', quantity: 1 });
    const byName = await (await call(ctx, { search: { stores: 'KANTOR', q: 'uji gula' } })).json();
    assert.deepEqual(byName.rows.map(row => row.name), ['Uji Gula Pasir']);
    const byCode = await (await call(ctx, { search: { stores: 'KANTOR', q: 'stk-tepung' } })).json();
    assert.deepEqual(byCode.rows.map(row => row.name), ['Uji Tepung Terigu']);
  } finally { ctx.db.close(); }
});

test('pagar akses: tanpa login 401; gerai lain entity 403; Admin Gerai hanya gerainya sendiri', async () => {
  const ctx = await setup();
  try {
    const { db } = ctx;
    addProduct(db, 'KANTOR', { name: 'Uji Gula Pasir', quantity: 12 });
    addProduct(db, 'PENDEM', { name: 'Uji Gula Pasir', quantity: 5 });

    assert.equal((await call(ctx, { token: null, search: { stores: 'KANTOR' } })).status, 401);

    const crossEntity = await call(ctx, { search: { stores: 'IKAN01' } });
    assert.equal(crossEntity.status, 403);
    assert.equal((await crossEntity.json()).code, 'STORE_OUT_OF_ENTITY_SCOPE');

    const adminOther = await call(ctx, { token: ADMIN_TOKEN, store: 'PENDEM', search: { stores: 'KANTOR' } });
    assert.equal(adminOther.status, 403);
    assert.equal((await adminOther.json()).code, 'STORE_OUT_OF_CALLER_SCOPE');

    const adminOwn = await call(ctx, { token: ADMIN_TOKEN, store: 'PENDEM' });
    assert.equal(adminOwn.status, 200);
    const body = await adminOwn.json();
    assert.equal(body.scope, 'STORE');
    assert.deepEqual(body.stores.map(store => store.code), ['PENDEM']);
    assert.equal(body.rows[0].byStore.PENDEM.quantity, 5);
    assert.equal(body.rows[0].byStore.KANTOR, undefined);
  } finally { ctx.db.close(); }
});

test('tanpa parameter stores, semua gerai entity ikut (Owner)', async () => {
  const ctx = await setup();
  try {
    addProduct(ctx.db, 'MANDALA', { name: 'Uji Gula Pasir', quantity: 8 });
    const body = await (await call(ctx)).json();
    const codes = body.stores.map(store => store.code);
    for (const code of ['KANTOR', 'PENDEM', 'MANDALA']) assert.ok(codes.includes(code));
    assert.ok(!codes.includes('IKAN01'));
  } finally { ctx.db.close(); }
});

test('UI: tab Stok Gerai terpasang di Admin Entity dengan versi script/css yang dibump', () => {
  const html = readFileSync(new URL('../public/entity-admin.html', import.meta.url), 'utf8');
  assert.match(html, /data-entity-tab="entitystock"/);
  assert.match(html, /id="entityTab-entitystock"/);
  assert.match(html, /id="entityStockTable"/);
  assert.match(html, /id="entityStockStoreBtn"/);
  assert.match(html, /id="entityStockXlsx"/);
  assert.match(html, /id="entityStockPdf"/);
  assert.match(html, /entity-stock-matrix\.js\?v=20261003-lihat-hpp-v1/);
  assert.match(html, /entity-stock-matrix\.css\?v=20261003-lihat-hpp-v1/);
  assert.match(html, /entity-admin\.js\?v=20261002-kartu-ringkas-v2/);
  const js = readFileSync(new URL('../public/entity-admin.js', import.meta.url), 'utf8');
  assert.match(js, /loadEntityStockMatrix/);
  const matrix = readFileSync(new URL('../public/entity-stock-matrix.js', import.meta.url), 'utf8');
  assert.doesNotMatch(matrix, /setInterval/, 'tanpa polling periodik (invariant #6)');
});

// ---- Lihat HPP (Bos Cyo, 2026-10-03) ----------------------------------------

function setCost(db, productId, scaled) {
  db.prepare('UPDATE products SET average_cost = ? WHERE id = ?').run(scaled, productId);
}

test('HPP: tiap sel membawa HPP sebagai teks desimal dari integer skala, tanpa pembulatan float', async () => {
  const ctx = await setup();
  try {
    const { db } = ctx;
    setCost(db, addProduct(db, 'KANTOR', { name: 'Uji Air', unit: 'ML', quantity: 1 }), 437500);
    setCost(db, addProduct(db, 'PENDEM', { name: 'Uji Air', unit: 'ML', quantity: 1 }), 18966667);
    setCost(db, addProduct(db, 'MANDALA', { name: 'Uji Air', unit: 'ML', quantity: 1 }), 1500000000);
    const body = await (await call(ctx, { search: { stores: 'KANTOR,PENDEM,MANDALA' } })).json();
    const air = body.rows[0];
    assert.equal(air.byStore.KANTOR.averageCost, '0.4375');
    assert.equal(air.byStore.PENDEM.averageCost, '18.966667');
    assert.equal(air.byStore.MANDALA.averageCost, '1500');
    assert.equal(air.hppReference, '18.966667', 'median dari tiga gerai');
    assert.equal(air.byStore.MANDALA.anomaly, 'TINGGI');
    assert.equal(air.byStore.KANTOR.anomaly, 'RENDAH');
    assert.equal(air.byStore.PENDEM.anomaly, null);
  } finally { ctx.db.close(); }
});

test('HPP: nol padahal gerai lain punya = NOL; acuan baru ada kalau minimal 3 gerai berharga', async () => {
  const ctx = await setup();
  try {
    const { db } = ctx;
    setCost(db, addProduct(db, 'KANTOR', { name: 'Uji Teh', unit: 'PCS', quantity: 1 }), 1500000000);
    setCost(db, addProduct(db, 'PENDEM', { name: 'Uji Teh', unit: 'PCS', quantity: 1 }), 1550000000);
    addProduct(db, 'MANDALA', { name: 'Uji Teh', unit: 'PCS', quantity: 1 });
    const body = await (await call(ctx, { search: { stores: 'KANTOR,PENDEM,MANDALA' } })).json();
    const teh = body.rows[0];
    assert.equal(teh.byStore.MANDALA.averageCost, '0');
    assert.equal(teh.byStore.MANDALA.anomaly, 'NOL');
    assert.equal(teh.hppReference, null, 'dua gerai berharga belum cukup untuk acuan');
    assert.equal(teh.byStore.KANTOR.anomaly, null);
  } finally { ctx.db.close(); }
});

test('HPP: tidak ada penanda kalau semua gerai nol, atau satuan antar gerai berbeda', async () => {
  const ctx = await setup();
  try {
    const { db } = ctx;
    addProduct(db, 'KANTOR', { name: 'Uji Semua Nol', unit: 'PCS', quantity: 1 });
    addProduct(db, 'PENDEM', { name: 'Uji Semua Nol', unit: 'PCS', quantity: 1 });
    setCost(db, addProduct(db, 'KANTOR', { name: 'Uji Beda Satuan', unit: 'KG', quantity: 1 }), 18000000000);
    setCost(db, addProduct(db, 'PENDEM', { name: 'Uji Beda Satuan', unit: 'PCS', quantity: 1 }), 18000000);
    addProduct(db, 'MANDALA', { name: 'Uji Beda Satuan', unit: 'PCS', quantity: 1 });
    const body = await (await call(ctx, { search: { stores: 'KANTOR,PENDEM,MANDALA' } })).json();
    const byName = Object.fromEntries(body.rows.map(row => [row.name, row]));
    assert.ok(Object.values(byName['Uji Semua Nol'].byStore).every(cell => cell.anomaly === null));
    assert.equal(byName['Uji Beda Satuan'].uniformUnit, false);
    assert.ok(Object.values(byName['Uji Beda Satuan'].byStore).every(cell => cell.anomaly === null && cell.averageCost !== undefined));
    assert.equal(byName['Uji Beda Satuan'].hppReference, null);
  } finally { ctx.db.close(); }
});

test('HPP: scaledToDecimal dan annotateHpp (median genap dibulatkan ke atas, tidak memakai float)', () => {
  assert.equal(scaledToDecimal(0n), '0');
  assert.equal(scaledToDecimal(1n), '0.000001');
  assert.equal(scaledToDecimal(17500000n), '17.5');
  assert.equal(scaledToDecimal(11315104n), '11.315104');
  const cells = [{ scaled: 100n }, { scaled: 101n }, { scaled: 103n }, { scaled: 104n }];
  assert.equal(annotateHpp(cells, true), 102n);
  assert.ok(cells.every(cell => cell.anomaly === null));
  const tigaKali = [{ scaled: 100n }, { scaled: 100n }, { scaled: 100n }, { scaled: 301n }];
  annotateHpp(tigaKali, true);
  assert.equal(tigaKali[3].anomaly, 'TINGGI');
  const tepatTiga = [{ scaled: 100n }, { scaled: 100n }, { scaled: 100n }, { scaled: 300n }];
  annotateHpp(tepatTiga, true);
  assert.equal(tepatTiga[3].anomaly, null, 'persis 3x belum janggal (sama dengan audit HPP)');
});

test('UI: pilihan Lihat HPP terpasang, memakai data yang sama, tanpa polling', () => {
  const html = readFileSync(new URL('../public/entity-admin.html', import.meta.url), 'utf8');
  assert.match(html, /data-stock-view="STOK"/);
  assert.match(html, /data-stock-view="HPP"[^>]*>Lihat HPP</);
  const js = readFileSync(new URL('../public/entity-stock-matrix.js', import.meta.url), 'utf8');
  assert.match(js, /renderHpp/);
  assert.match(js, /hppReference/);
  assert.doesNotMatch(js, /setInterval|setTimeout\([^)]*load/, 'tanpa polling periodik (invariant #6)');
});
