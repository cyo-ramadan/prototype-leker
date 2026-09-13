import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierTrackedSaleApi } from '../src/cashier-sales-tracking.js';
import { hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);

// 2026-09-13, laporan Bos Cyo: klik "Teruskan ke Penjualan" di pesanan yang
// sudah "Sudah Jadi" (COMPLETED), isi keranjang di dialog Penjualan, klik
// "Proses Penjualan" -- dialognya tidak menutup dan penjualannya tidak
// tercatat. Root cause: handleCashierTrackedSaleApi menolak sourceOrderId
// apa pun yang statusnya bukan PREPARING (409), padahal tombol baru itu
// sengaja dipasang di kartu pesanan berstatus COMPLETED.

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(result.changes || 0) } };
  }
}

class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) { return statements.map(statement => statement.run()); }
}

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

async function fixture(db) {
  const sqlite = db.db;
  const store = sqlite.prepare(`SELECT id, code FROM stores WHERE code = 'G001' LIMIT 1`).get();
  const product = sqlite.prepare(`
    SELECT p.id, p.name, p.price
    FROM products p
    JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    WHERE p.store_id = ? AND p.base_unit_id IS NOT NULL AND t.can_sell = 1 AND p.is_active = 1
    ORDER BY p.id LIMIT 1
  `).get(store.id);
  const cashier = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1`).get(store.id);
  assert.ok(store?.id && product?.id && cashier?.id, 'expected seeded store/product/cashier fixtures from migrations');

  const rawToken = `test_token_${crypto.randomUUID()}`;
  const tokenHash = await hashCredential(rawToken);
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(tokenHash, cashier.id, new Date().toISOString(), expiresAt);

  const drawerId = `drawer_completed_sale_${crypto.randomUUID()}`;
  sqlite.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES (?, ?, ?, 0, 'OPEN', '2026-09-13T08:00:00.000Z')
  `).run(drawerId, store.id, cashier.id);

  return {
    storeId: store.id, storeCode: store.code, productId: Number(product.id), productName: product.name,
    unitPrice: Number(product.price), cashierId: cashier.id, drawerId, rawToken
  };
}

function seedOrder(db, fx, { orderId, status }) {
  const sqlite = db.db;
  const quantity = 2;
  const lineTotal = fx.unitPrice * quantity;
  sqlite.prepare(`
    INSERT INTO orders (
      id, store_id, customer_id, business_date, order_no, customer_name, table_label, general_note,
      total_amount, status, created_at, updated_at, ready_at, completed_at, cancelled_at,
      source, drawer_session_id
    ) VALUES (?, ?, NULL, '2026-09-13', ?, 'Walk-in', '', '', ?, ?, '2026-09-13T08:05:00.000Z', '2026-09-13T08:05:00.000Z', NULL, ?, NULL, 'customer', ?)
  `).run(orderId, fx.storeId, orderId, lineTotal, status, status === 'COMPLETED' ? '2026-09-13T08:20:00.000Z' : null, fx.drawerId);
  sqlite.prepare(`
    INSERT INTO order_items (id, store_id, order_id, product_id, product_name, unit_price, quantity, note, line_total, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, '2026-09-13T08:05:00.000Z')
  `).run(`${orderId}_item`, fx.storeId, orderId, fx.productId, fx.productName, fx.unitPrice, quantity, lineTotal);
}

function saleRequest(fx, orderId) {
  return new Request('https://leker.test/api/cashier/sales', {
    method: 'POST',
    headers: { Authorization: `Bearer ${fx.rawToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceOrderId: orderId,
      items: [{ productId: fx.productId, quantity: 2 }]
    })
  });
}

test('Teruskan ke Penjualan from a COMPLETED order actually records the sale', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const fx = await fixture(env.DB);
    seedOrder(env.DB, fx, { orderId: 'order_completed_ok', status: 'COMPLETED' });

    const response = await handleCashierTrackedSaleApi(saleRequest(fx, 'order_completed_ok'), env, '/api/cashier/sales');
    const payload = await response.json();
    assert.equal(response.status, 201, `expected the sale to succeed, got: ${JSON.stringify(payload)}`);
    assert.equal(payload.sourceOrderId, 'order_completed_ok');

    const saleRow = db.prepare('SELECT order_id, total_amount FROM sales WHERE order_id = ?').get('order_completed_ok');
    assert.ok(saleRow, 'expected a row in sales linked to the completed order');
    assert.equal(saleRow.total_amount, fx.unitPrice * 2);
  } finally {
    db.close();
  }
});

test('a second "Teruskan ke Penjualan" for the same order is rejected instead of double-charging', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const fx = await fixture(env.DB);
    seedOrder(env.DB, fx, { orderId: 'order_completed_twice', status: 'COMPLETED' });

    const first = await handleCashierTrackedSaleApi(saleRequest(fx, 'order_completed_twice'), env, '/api/cashier/sales');
    assert.equal(first.status, 201);

    const second = await handleCashierTrackedSaleApi(saleRequest(fx, 'order_completed_twice'), env, '/api/cashier/sales');
    const secondPayload = await second.json();
    assert.equal(second.status, 409);
    assert.match(secondPayload.error, /sudah diproses jadi penjualan/);

    const count = db.prepare('SELECT COUNT(*) AS n FROM sales WHERE order_id = ?').get('order_completed_twice');
    assert.equal(count.n, 1, 'must not create a second sale for the same order');
  } finally {
    db.close();
  }
});

test('an order still NEW (never accepted) cannot be turned into a sale', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const fx = await fixture(env.DB);
    seedOrder(env.DB, fx, { orderId: 'order_still_new', status: 'NEW' });

    const response = await handleCashierTrackedSaleApi(saleRequest(fx, 'order_still_new'), env, '/api/cashier/sales');
    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.match(payload.error, /Diterima atau Sudah Jadi/);

    const count = db.prepare('SELECT COUNT(*) AS n FROM sales WHERE order_id = ?').get('order_still_new');
    assert.equal(count.n, 0);
  } finally {
    db.close();
  }
});
