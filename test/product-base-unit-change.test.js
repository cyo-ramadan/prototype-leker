import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-28: "Larutan Teh Poci Vanilla" di Mandala kepasang pcs
// padahal maksudnya ml, barangnya sudah punya stok -- validateBaseUnitChange
// (src/product-master.js) dulu menolak mentah dan menunjuk ke "proses
// konversi/migrasi terpisah" yang tidak pernah dibangun. Keputusan Bos Cyo:
// kasus salah-pasang-satuan itu murni salah label (angka yang sudah kepencet
// memang dimaksudkan dalam satuan yang benar), jadi tidak ada rasio yang
// perlu dihitung -- Admin cukup di-warning sekali (409 + kode
// BASE_UNIT_HISTORY_CONFIRM_REQUIRED), lalu submit ulang dengan
// confirmUnitChange:true (lihat apiWithUnitChangeConfirm di
// public/admin-product-policy.js) untuk benar-benar ganti label satuannya.
// Migration 0126 menyimpan jejak audit-nya (product_base_unit_change_log).

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

function request(pathname, { token, store, method = 'GET', body } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store) url.searchParams.set('store', store);
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

const newProductBody = (overrides = {}) => ({
  name: 'Larutan Teh Poci Vanilla', purchasePrice: 2000, price: 2000, category: 'Bahan', ...overrides
});

test('ganti satuan barang TANPA histori tetap bebas seperti sebelumnya -- tidak perlu confirm, tidak ada jejak audit', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const storeId = db.prepare('SELECT id FROM stores WHERE code = ?').get('KANTOR').id;
    const mlUnitId = `unit_${storeId}_ml`;

    const createRes = await worker.fetch(request('/api/admin/master/products/editor', {
      token, store: 'KANTOR', method: 'POST', body: newProductBody()
    }), env);
    const created = await createRes.json();

    const patchRes = await worker.fetch(request(`/api/admin/master/products/editor/${created.id}`, {
      token, store: 'KANTOR', method: 'PATCH', body: newProductBody({ baseUnitId: mlUnitId })
    }), env);
    assert.equal(patchRes.status, 200, 'barang baru tanpa stok/resep boleh ganti satuan langsung');

    const product = db.prepare('SELECT base_unit_id FROM products WHERE id = ?').get(created.id);
    assert.equal(product.base_unit_id, mlUnitId);

    const logCount = db.prepare('SELECT COUNT(*) AS n FROM product_base_unit_change_log WHERE product_id = ?').get(created.id);
    assert.equal(logCount.n, 0, 'ganti satuan tanpa histori bukan kasus koreksi -- tidak perlu jejak audit');
  } finally {
    db.close();
  }
});

test('ganti satuan barang yang SUDAH punya stok ditahan sekali dengan kode BASE_UNIT_HISTORY_CONFIRM_REQUIRED, satuan belum berubah', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const storeId = db.prepare('SELECT id FROM stores WHERE code = ?').get('KANTOR').id;
    const mlUnitId = `unit_${storeId}_ml`;

    const createRes = await worker.fetch(request('/api/admin/master/products/editor', {
      token, store: 'KANTOR', method: 'POST', body: newProductBody()
    }), env);
    const created = await createRes.json();
    const pcsUnitId = db.prepare('SELECT base_unit_id FROM products WHERE id = ?').get(created.id).base_unit_id;

    // Simulasikan barang ini sudah punya stok sungguhan (mis. dari opname/pembelian
    // sebelumnya) -- pola seed yang sama seperti test stock-production-points.
    db.prepare(`
      INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
      VALUES (?, ?, 50, CURRENT_TIMESTAMP)
    `).run(storeId, created.id);

    const blockedRes = await worker.fetch(request(`/api/admin/master/products/editor/${created.id}`, {
      token, store: 'KANTOR', method: 'PATCH', body: newProductBody({ baseUnitId: mlUnitId })
    }), env);
    assert.equal(blockedRes.status, 409);
    const blockedBody = await blockedRes.json();
    assert.equal(blockedBody.code, 'BASE_UNIT_HISTORY_CONFIRM_REQUIRED');
    assert.match(blockedBody.error, /TIDAK akan diubah/);

    const stillPcs = db.prepare('SELECT base_unit_id FROM products WHERE id = ?').get(created.id);
    assert.equal(stillPcs.base_unit_id, pcsUnitId, 'satuan tidak boleh berubah sebelum admin konfirmasi ulang');

    const logCount = db.prepare('SELECT COUNT(*) AS n FROM product_base_unit_change_log WHERE product_id = ?').get(created.id);
    assert.equal(logCount.n, 0, 'belum dikonfirmasi -- belum ada jejak audit yang ditulis');
  } finally {
    db.close();
  }
});

test('submit ulang dengan confirmUnitChange:true benar-benar ganti label satuan, angka stok TIDAK direcompute, dan tercatat di jejak audit', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const storeId = db.prepare('SELECT id FROM stores WHERE code = ?').get('KANTOR').id;
    const mlUnitId = `unit_${storeId}_ml`;

    const createRes = await worker.fetch(request('/api/admin/master/products/editor', {
      token, store: 'KANTOR', method: 'POST', body: newProductBody()
    }), env);
    const created = await createRes.json();
    const pcsUnitId = db.prepare('SELECT base_unit_id FROM products WHERE id = ?').get(created.id).base_unit_id;

    db.prepare(`
      INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
      VALUES (?, ?, 50, CURRENT_TIMESTAMP)
    `).run(storeId, created.id);

    const confirmedRes = await worker.fetch(request(`/api/admin/master/products/editor/${created.id}`, {
      token, store: 'KANTOR', method: 'PATCH',
      body: newProductBody({ baseUnitId: mlUnitId, confirmUnitChange: true })
    }), env);
    assert.equal(confirmedRes.status, 200);

    const product = db.prepare('SELECT base_unit_id, purchase_price FROM products WHERE id = ?').get(created.id);
    assert.equal(product.base_unit_id, mlUnitId, 'label satuan sekarang ml');
    assert.equal(product.purchase_price, 2_000_000_000, 'harga beli (scaled) tidak ikut direcompute -- relabel murni');

    const balance = db.prepare('SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?').get(storeId, created.id);
    assert.equal(balance.quantity, 50, 'qty stok yang sudah ada TIDAK dikalikan rasio apa pun -- angka lama tetap dipakai apa adanya, cuma labelnya yang berubah');

    const log = db.prepare('SELECT * FROM product_base_unit_change_log WHERE product_id = ?').get(created.id);
    assert.ok(log, 'perubahan yang dikonfirmasi wajib punya jejak audit');
    assert.equal(log.from_unit_id, pcsUnitId);
    assert.equal(log.to_unit_id, mlUnitId);
    assert.equal(log.changed_by_role, 'OWNER');
    assert.equal(log.stock_quantity_at_change, 50);
  } finally {
    db.close();
  }
});
