import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-10-02: setiap barang baru langsung masuk Jenis Barang yang
// tertaut ke akun Persediaan dan HPP, HPP sementara = Harga Beli yang diisi
// (0 bila kosong). Default ini dikunci di awal; mengubahnya lewat Setting
// Akuntansi. Transaksi lama yang snapshot Jenis Barang-nya kosong dipulihkan
// saat sinkron.

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
  // Real D1 batch() returns query results for SELECT statements too (used by
  // validateBaseUnitChange in src/product-master.js to check recipe/movement/
  // balance in one round trip) -- .run() alone (node:sqlite) never returns
  // rows, so SELECTs inside a batch need routing through .all() here.
  batch(statements) {
    return statements.map(statement => /^\s*select/i.test(statement.sql) ? statement.all() : statement.run());
  }
}

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

async function seedOwnerToken(db) {
  const ownerId = 'owner_bu_test';
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES (?, 'owner_bu_test', 'x', 'Test Owner')`).run(ownerId);
  const token = 'owner-bu-token';
  const tokenHash = await hashCredential(token);
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, '2026-09-28T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(tokenHash, ownerId);
  return token;
}

function request(pathname, { token, store = 'KANTOR', method = 'GET', body } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  url.searchParams.set('store', store);
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

const SCALE = 1_000_000;
const accountCode = (db, id) => db.prepare('SELECT code FROM chart_of_accounts WHERE id = ?').get(id).code;

test('Jenis Barang baru di gerai Akuntansi langsung punya Item Category dengan akun Persediaan/HPP/Penjualan bawaan', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const storeId = db.prepare('SELECT id FROM stores WHERE code = ?').get('KANTOR').id;
    assert.equal(db.prepare('SELECT edition FROM stores WHERE id = ?').get(storeId).edition, 'ACCOUNTING');

    const res = await worker.fetch(request('/api/admin/master/product-kinds', { token, store: 'KANTOR', method: 'POST', body: { code: 'SNACK_UJI', name: 'Snack Uji' } }), env);
    assert.equal(res.status, 201);
    const { id } = await res.json();
    const category = db.prepare('SELECT * FROM item_categories WHERE store_id = ? AND product_kind_id = ?').get(storeId, id);
    assert.ok(category, 'Item Category dibuat otomatis');
    assert.deepEqual([accountCode(db, category.inventory_account_id), accountCode(db, category.cogs_account_id), accountCode(db, category.revenue_account_id)], ['1301', '5101', '4101']);
  } finally { db.close(); }
});

test('barang baru tanpa pilihan Jenis Barang otomatis dapat Jenis Barang bawaan yang sudah tertaut akun; HPP sementara = Harga Beli (0 bila kosong)', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const storeId = db.prepare('SELECT id FROM stores WHERE code = ?').get('KANTOR').id;

    const withPrice = await (await worker.fetch(request('/api/admin/master/products/editor', { token, method: 'POST', body: { name: 'Gula Uji', purchasePrice: 15000, price: 0, category: 'Bahan' } }), env)).json();
    const noPrice = await (await worker.fetch(request('/api/admin/master/products/editor', { token, method: 'POST', body: { name: 'Garam Uji', purchasePrice: 0, price: 0, category: 'Bahan' } }), env)).json();
    for (const created of [withPrice, noPrice]) {
      const row = db.prepare('SELECT product_kind_id, average_cost FROM products WHERE id = ?').get(created.id);
      assert.ok(row.product_kind_id, 'Jenis Barang terisi default');
      assert.ok(db.prepare('SELECT 1 FROM item_categories WHERE store_id = ? AND product_kind_id = ? AND is_active = 1').get(storeId, row.product_kind_id), 'dan tertaut ke akun');
    }
    assert.equal(db.prepare('SELECT average_cost FROM products WHERE id = ?').get(withPrice.id).average_cost, 15000 * SCALE);
    assert.equal(db.prepare('SELECT average_cost FROM products WHERE id = ?').get(noPrice.id).average_cost, 0);
  } finally { db.close(); }
});

test('jenis barang yang dibuat sebelum aturan ini (tanpa Item Category) dilengkapi saat barang disimpan', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const storeId = db.prepare('SELECT id FROM stores WHERE code = ?').get('KANTOR').id;
    db.prepare(`INSERT INTO product_kinds (id, store_id, code, name) VALUES ('kind_lama', ?, 'LAMA', 'Jenis Lama')`).run(storeId);
    // Trigger migration sudah membuatkan Item Category untuk jenis baru; jenis yang
    // dibuat sebelum trigger itu ada / sebelum gerai pindah ke Akuntansi tidak punya.
    db.prepare("DELETE FROM item_categories WHERE product_kind_id = 'kind_lama'").run();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM item_categories WHERE product_kind_id = ?').get('kind_lama').n, 0);

    const res = await worker.fetch(request('/api/admin/master/products/editor', { token, method: 'POST', body: { name: 'Barang Lama Uji', purchasePrice: 0, price: 0, category: 'Bahan', productKindId: 'kind_lama' } }), env);
    assert.equal(res.status, 201);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM item_categories WHERE product_kind_id = ? AND is_active = 1').get('kind_lama').n, 1);
  } finally { db.close(); }
});

test('gerai non-Akuntansi tidak dibuatkan Item Category (Akuntansi opsional)', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const storeId = db.prepare('SELECT id FROM stores WHERE code = ?').get('KANTOR').id;
    db.prepare("UPDATE stores SET edition = 'FLEXIBLE' WHERE id = ?").run(storeId);
    const before = db.prepare('SELECT COUNT(*) AS n FROM item_categories WHERE store_id = ?').get(storeId).n;
    const res = await worker.fetch(request('/api/admin/master/product-kinds', { token, store: 'KANTOR', method: 'POST', body: { code: 'SNACK2', name: 'Snack Dua' } }), env);
    assert.equal(res.status, 201);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM item_categories WHERE store_id = ?').get(storeId).n, before);
  } finally { db.close(); }
});

test('sinkron memulihkan snapshot Jenis Barang yang kosong di transaksi lama dari Jenis Barang barang itu sekarang', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const storeId = db.prepare('SELECT id FROM stores WHERE code = ?').get('KANTOR').id;
    const created = await (await worker.fetch(request('/api/admin/master/products/editor', { token, method: 'POST', body: { name: 'Teh Uji', purchasePrice: 1000, price: 3000, category: 'Minuman', itemTypeId: `item_type_${storeId}_finished` } }), env)).json();
    const kindId = db.prepare('SELECT product_kind_id FROM products WHERE id = ?').get(created.id).product_kind_id;

    db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES ('kasir_heal', 'kasir_heal', 'x', 'Kasir', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(storeId);
    db.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES ('laci_heal', ?, 'kasir_heal', 0, 'OPEN', CURRENT_TIMESTAMP)`).run(storeId);
    db.prepare(`INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, total_amount, created_at) VALUES ('sale_heal', ?, 'laci_heal', 'kasir_heal', 3000, '2026-09-20T05:00:00.000Z')`).run(storeId);
    db.prepare(`INSERT INTO sale_items (id, sale_id, store_id, product_id, product_name, unit_price, quantity, line_total, unit_cost_snapshot, line_cogs)
      VALUES ('item_heal', 'sale_heal', ?, ?, 'Teh Uji', 3000, 1, 3000, 0, 0)`).run(storeId, created.id);
    db.prepare("UPDATE sale_items SET product_kind_id = NULL, product_kind_code = '', product_kind_name = '' WHERE id = 'item_heal'").run();

    const res = await worker.fetch(request('/api/admin/accounting/bridge/sync', { token, method: 'POST', body: {} }), env);
    assert.equal(res.status, 200);
    const item = db.prepare('SELECT product_kind_id, product_kind_code FROM sale_items WHERE id = ?').get('item_heal');
    assert.equal(item.product_kind_id, kindId, 'snapshot kosong terisi dari Jenis Barang barang');
    assert.ok(item.product_kind_code);
    const delivery = db.prepare("SELECT failure_code FROM accounting_bridge_deliveries WHERE fact_type = 'SALE' AND fact_id = 'sale_heal'").get();
    assert.notEqual(delivery?.failure_code, 'NEEDS_PRODUCT_KIND', 'tidak lagi nyangkut NEEDS_PRODUCT_KIND');
  } finally { db.close(); }
});
