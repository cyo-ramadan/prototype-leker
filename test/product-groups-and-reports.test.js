import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleProductGroupsApi } from '../src/product-groups.js';
import { handleCashierReportsApi } from '../src/cashier-reports.js';
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

async function cashierToken(db, storeId, label = storeId) {
  const cashier = db.prepare('SELECT id FROM cashiers WHERE store_id = ? AND is_active = 1 ORDER BY id LIMIT 1').get(storeId);
  const token = `product-groups-token-${label}`;
  const tokenHash = await hashCredential(token);
  db.prepare(`
    INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at)
    VALUES (?, ?, '2026-09-03T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(tokenHash, cashier.id);
  return { token, cashierId: cashier.id };
}

function request(pathname, { token, method = 'GET', body } = {}) {
  return new Request(`https://example.test${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

function storeProductIds(db, storeId, limit = 2) {
  return db.prepare('SELECT id FROM products WHERE store_id = ? ORDER BY id LIMIT ?').all(storeId, limit).map(row => row.id);
}

test('product groups: create, list, and fetch detail, scoped to the cashier own store', async () => {
  const db = migratedDatabase();
  try {
    const { token } = await cashierToken(db, 'store_001');
    const [productA, productB] = storeProductIds(db, 'store_001', 2);
    assert.ok(productA && productB, 'store_001 seed needs at least 2 products');
    const env = { DB: new D1Database(db) };

    const created = await handleProductGroupsApi(
      request('/api/cashier/product-groups', { token, method: 'POST', body: { name: 'Bahan Jasmin', productIds: [productA, productB] } }),
      env,
      '/api/cashier/product-groups'
    );
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.ok(createdBody.id);
    assert.ok(createdBody.groups.some(group => group.name === 'Bahan Jasmin' && group.itemCount === 2));

    const list = await handleProductGroupsApi(request('/api/cashier/product-groups', { token }), env, '/api/cashier/product-groups');
    const listBody = await list.json();
    assert.ok(listBody.groups.some(group => group.id === createdBody.id));

    const detail = await handleProductGroupsApi(
      request(`/api/cashier/product-groups/${createdBody.id}`, { token }),
      env,
      `/api/cashier/product-groups/${createdBody.id}`
    );
    assert.equal(detail.status, 200);
    const detailBody = await detail.json();
    assert.equal(detailBody.group.name, 'Bahan Jasmin');
    assert.deepEqual(detailBody.items.map(item => item.productId).sort(), [productA, productB].sort());
  } finally {
    db.close();
  }
});

test('product groups: rejects duplicate name, empty list, and a product from another store', async () => {
  const db = migratedDatabase();
  try {
    const { token } = await cashierToken(db, 'store_001');
    const [productA] = storeProductIds(db, 'store_001', 1);
    const [otherStoreProduct] = storeProductIds(db, 'store_002', 1);
    const env = { DB: new D1Database(db) };

    const first = await handleProductGroupsApi(
      request('/api/cashier/product-groups', { token, method: 'POST', body: { name: 'Dupe', productIds: [productA] } }),
      env,
      '/api/cashier/product-groups'
    );
    assert.equal(first.status, 201);

    const dup = await handleProductGroupsApi(
      request('/api/cashier/product-groups', { token, method: 'POST', body: { name: 'Dupe', productIds: [productA] } }),
      env,
      '/api/cashier/product-groups'
    );
    assert.equal(dup.status, 409);

    const empty = await handleProductGroupsApi(
      request('/api/cashier/product-groups', { token, method: 'POST', body: { name: 'Kosong', productIds: [] } }),
      env,
      '/api/cashier/product-groups'
    );
    assert.equal(empty.status, 400);

    const foreign = await handleProductGroupsApi(
      request('/api/cashier/product-groups', { token, method: 'POST', body: { name: 'Lintas Gerai', productIds: [otherStoreProduct] } }),
      env,
      '/api/cashier/product-groups'
    );
    assert.equal(foreign.status, 400);
  } finally {
    db.close();
  }
});

test('stock balance report: ALL/SELECTED/GROUP scopes return the curated set, GROUP resolves via the saved group', async () => {
  const db = migratedDatabase();
  try {
    const { token } = await cashierToken(db, 'store_001');
    const [productA, productB, productC] = storeProductIds(db, 'store_001', 3);
    const env = { DB: new D1Database(db) };

    const all = await handleCashierReportsApi(
      request('/api/cashier/reports/stock-balance?scope=ALL', { token }), env, '/api/cashier/reports/stock-balance'
    );
    assert.equal(all.status, 200);
    const allBody = await all.json();
    assert.ok(allBody.stocks.some(row => row.productId === productA));

    const selected = await handleCashierReportsApi(
      request(`/api/cashier/reports/stock-balance?scope=SELECTED&productIds=${productA},${productB}`, { token }),
      env, '/api/cashier/reports/stock-balance'
    );
    assert.equal(selected.status, 200);
    const selectedBody = await selected.json();
    assert.deepEqual(selectedBody.stocks.map(row => row.productId).sort(), [productA, productB].sort());

    const created = await handleProductGroupsApi(
      request('/api/cashier/product-groups', { token, method: 'POST', body: { name: 'Resep C', productIds: [productC] } }),
      env, '/api/cashier/product-groups'
    );
    const { id: groupId } = await created.json();

    const group = await handleCashierReportsApi(
      request(`/api/cashier/reports/stock-balance?scope=GROUP&groupId=${groupId}`, { token }),
      env, '/api/cashier/reports/stock-balance'
    );
    assert.equal(group.status, 200);
    const groupBody = await group.json();
    assert.deepEqual(groupBody.stocks.map(row => row.productId), [productC]);
  } finally {
    db.close();
  }
});

test('stock balance report: SELECTED without ids, GROUP with unknown id, and unknown scope all fail cleanly', async () => {
  const db = migratedDatabase();
  try {
    const { token } = await cashierToken(db, 'store_001');
    const env = { DB: new D1Database(db) };

    const noIds = await handleCashierReportsApi(
      request('/api/cashier/reports/stock-balance?scope=SELECTED', { token }), env, '/api/cashier/reports/stock-balance'
    );
    assert.equal(noIds.status, 400);

    const badGroup = await handleCashierReportsApi(
      request('/api/cashier/reports/stock-balance?scope=GROUP&groupId=nope', { token }), env, '/api/cashier/reports/stock-balance'
    );
    assert.equal(badGroup.status, 404);

    const badScope = await handleCashierReportsApi(
      request('/api/cashier/reports/stock-balance?scope=NOPE', { token }), env, '/api/cashier/reports/stock-balance'
    );
    assert.equal(badScope.status, 400);

    const unauthorized = await handleCashierReportsApi(
      request('/api/cashier/reports/stock-balance?scope=ALL'), env, '/api/cashier/reports/stock-balance'
    );
    assert.equal(unauthorized.status, 401);
  } finally {
    db.close();
  }
});
