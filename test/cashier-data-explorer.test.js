import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierDataApi } from '../src/cashier-data-explorer.js';
import { hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
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

async function cashierToken(db, storeId) {
  const cashier = db.prepare('SELECT id FROM cashiers WHERE store_id = ? AND is_active = 1 ORDER BY id LIMIT 1').get(storeId);
  const token = `cashier-data-token-${storeId}`;
  const tokenHash = await hashCredential(token);
  db.prepare(`
    INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at)
    VALUES (?, ?, '2026-08-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(tokenHash, cashier.id);
  return { token, cashierId: cashier.id };
}

function openDrawer(db, id, storeId, cashierId) {
  db.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES (?, ?, ?, 100000, 'OPEN', '2026-08-17T00:00:00.000Z')
  `).run(id, storeId, cashierId);
}

function request(pathname, { token, params = '' } = {}) {
  return new Request(`https://example.test${pathname}${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}

test('Kasir Data Transaksi sees its own store sale, scoped without a client-supplied store param', async () => {
  const db = migratedDatabase();
  try {
    const { token, cashierId } = await cashierToken(db, 'store_001');
    const { cashierId: cashierIdG002 } = await cashierToken(db, 'store_002');
    openDrawer(db, 'drawer_g001_test', 'store_001', cashierId);
    openDrawer(db, 'drawer_g002_test', 'store_002', cashierIdG002);
    db.prepare(`
      INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, customer_name, total_amount, created_at)
      VALUES ('sale_g001_test', 'store_001', 'drawer_g001_test', ?, 'Budi', 25000, '2026-08-17T09:00:00.000Z')
    `).run(cashierId);
    db.prepare(`
      INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, customer_name, total_amount, created_at)
      VALUES ('sale_g002_test', 'store_002', 'drawer_g002_test', ?, 'Sinta', 30000, '2026-08-17T09:00:00.000Z')
    `).run(cashierIdG002);

    const env = { DB: new D1Database(db) };
    const response = await handleCashierDataApi(
      request('/api/cashier/data/transactions', { token }),
      env,
      '/api/cashier/data/transactions'
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    const ids = body.transactions.map(item => item.id);
    assert.ok(ids.includes('sale_g001_test'), 'must see its own store sale');
    assert.ok(!ids.includes('sale_g002_test'), 'must never see another store sale even without a store param');
  } finally {
    db.close();
  }
});

test('Kasir Data Stok reuses the same balance/movement query as Admin, scoped to its own store', async () => {
  const db = migratedDatabase();
  try {
    const product = db.prepare("SELECT id FROM products WHERE store_id = 'store_001' LIMIT 1").get();
    assert.ok(product, 'G001 seed product required');
    const { token } = await cashierToken(db, 'store_001');
    const env = { DB: new D1Database(db) };

    const balances = await handleCashierDataApi(request('/api/cashier/data/stock', { token }), env, '/api/cashier/data/stock');
    assert.equal(balances.status, 200);
    const balancesBody = await balances.json();
    assert.ok(balancesBody.stocks.some(row => row.productId === product.id));

    const movements = await handleCashierDataApi(
      request(`/api/cashier/data/stock/${product.id}/movements`, { token }),
      env,
      `/api/cashier/data/stock/${product.id}/movements`
    );
    assert.equal(movements.status, 200);
    const movementsBody = await movements.json();
    assert.equal(movementsBody.product.productId, product.id);
  } finally {
    db.close();
  }
});

test('Kasir Data endpoints require a cashier session and are read-only', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const unauthorized = await handleCashierDataApi(request('/api/cashier/data/transactions'), env, '/api/cashier/data/transactions');
    assert.equal(unauthorized.status, 401);

    const { token } = await cashierToken(db, 'store_001');
    const write = await handleCashierDataApi(
      new Request('https://example.test/api/cashier/data/transactions', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }),
      env,
      '/api/cashier/data/transactions'
    );
    assert.equal(write.status, 405);
  } finally {
    db.close();
  }
});
