import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleProductCostHistoryApi } from '../src/product-cost-history.js';
import { hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const transactionCorrectionSource = readFileSync(new URL('../src/transaction-correction-executor.js', import.meta.url), 'utf8');

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

async function ownerToken(db) {
  const ownerId = 'owner_hpp_history_test';
  db.prepare(`
    INSERT INTO owner_accounts (id, username, password_hash, display_name)
    VALUES (?, 'owner_hpp_test', 'x', 'Test Owner')
  `).run(ownerId);
  const token = 'owner-hpp-history-token';
  const tokenHash = await hashCredential(token);
  db.prepare(`
    INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at)
    VALUES (?, ?, '2026-08-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(tokenHash, ownerId);
  return token;
}

function request(pathname, { token, store = 'G001' } = {}) {
  return new Request(`https://example.test${pathname}?store=${store}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}

test('purchase correction reversal also snapshots the restored HPP (source_type CORRECTION)', () => {
  assert.match(transactionCorrectionSource, /INSERT INTO product_average_cost_snapshots/);
  assert.match(transactionCorrectionSource, /'CORRECTION'/);
});

test('HPP history endpoint returns snapshots newest-first, converted back to real rupiah', async () => {
  const db = migratedDatabase();
  try {
    const product = db.prepare("SELECT id FROM products WHERE store_id = 'store_001' LIMIT 1").get();
    assert.ok(product, 'G001 seed product required');

    db.prepare(`
      INSERT INTO product_average_cost_snapshots (id, store_id, product_id, average_cost_scaled, source_type, source_id, created_at)
      VALUES ('snap_1', 'store_001', ?, 5000000, 'PURCHASE', 'purchase_1', '2026-08-01T00:00:00.000Z')
    `).run(product.id);
    db.prepare(`
      INSERT INTO product_average_cost_snapshots (id, store_id, product_id, average_cost_scaled, source_type, source_id, created_at)
      VALUES ('snap_2', 'store_001', ?, 5500000, 'PRODUCTION', 'run_1', '2026-08-02T00:00:00.000Z')
    `).run(product.id);

    const token = await ownerToken(db);
    const env = { DB: new D1Database(db) };
    const response = await handleProductCostHistoryApi(
      request(`/api/admin/products/${product.id}/cost-history`, { token }),
      env,
      `/api/admin/products/${product.id}/cost-history`
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.snapshots.length, 2);
    assert.equal(body.snapshots[0].sourceType, 'PRODUCTION');
    assert.equal(body.snapshots[0].averageCost, 5.5);
    assert.equal(body.snapshots[1].sourceType, 'PURCHASE');
    assert.equal(body.snapshots[1].averageCost, 5);
    assert.equal(body.nextCursor, null);
  } finally {
    db.close();
  }
});

test('HPP history endpoint is Admin/Owner only and store scoped', async () => {
  const db = migratedDatabase();
  try {
    const product = db.prepare("SELECT id FROM products WHERE store_id = 'store_001' LIMIT 1").get();
    const env = { DB: new D1Database(db) };

    const unauthorized = await handleProductCostHistoryApi(
      request(`/api/admin/products/${product.id}/cost-history`),
      env,
      `/api/admin/products/${product.id}/cost-history`
    );
    assert.equal(unauthorized.status, 401);

    const token = await ownerToken(db);
    const otherStoreId = 'product_not_in_store_002_' + product.id;
    const missing = await handleProductCostHistoryApi(
      request(`/api/admin/products/${product.id}/cost-history`, { token, store: 'G002' }),
      env,
      `/api/admin/products/${product.id}/cost-history`
    );
    assert.equal(missing.status, 404, otherStoreId);
  } finally {
    db.close();
  }
});
