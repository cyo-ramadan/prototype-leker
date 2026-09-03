import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCostMasterApi } from '../src/cost-master.js';
import { hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const costMasterSource = readFileSync(new URL('../src/cost-master.js', import.meta.url), 'utf8');

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

async function adminToken(db, storeId) {
  const adminId = `admin_test_${storeId}`;
  db.prepare(`
    INSERT INTO store_admins (id, store_id, username, password_hash, display_name)
    VALUES (?, ?, ?, ?, ?)
  `).run(adminId, storeId, `admin_${storeId}`, 'x', 'Test Admin');
  const token = `token_${storeId}`;
  const tokenHash = await hashCredential(token);
  db.prepare(`
    INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at)
    VALUES (?, ?, '2026-08-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(tokenHash, adminId);
  return token;
}

function request(pathname, { method = 'GET', token, body, store = 'G002' } = {}) {
  return new Request(`https://example.test${pathname}?store=${store}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

test('Jenis Biaya CRUD never inserts/updates an Accounting rule id (ADR-029 boundary)', () => {
  assert.doesNotMatch(costMasterSource, /INSERT INTO cost_types[\s\S]*?accounting_component_rule_id/);
  assert.doesNotMatch(costMasterSource, /UPDATE cost_types[\s\S]*?accounting_component_rule_id/);
});

test('a store with zero seeded Jenis Biaya can create one from Master Biaya and see it appear', async () => {
  const db = migratedDatabase();
  try {
    // store_002 mirrors the real gap: only store_001 got cost_types seeded by
    // migration 0034, every other store (confirmed in production) starts with
    // zero rows and an empty "Jenis Biaya" dropdown.
    const before = db.prepare("SELECT COUNT(*) AS n FROM cost_types WHERE store_id = 'store_002'").get();
    assert.equal(before.n, 0, 'store_002 must start with no Jenis Biaya (matches the reported bug)');

    const token = await adminToken(db, 'store_002');
    const env = { DB: new D1Database(db) };

    const createResponse = await handleCostMasterApi(
      request('/api/admin/master/cost-types', { method: 'POST', token, body: { name: 'Pengiriman' } }),
      env,
      '/api/admin/master/cost-types'
    );
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.ok, true);
    assert.equal(created.costTypes.length, 1);
    assert.equal(created.costTypes[0].name, 'Pengiriman');
    assert.equal(created.costTypes[0].isActive, true);

    const row = db.prepare('SELECT store_id, code, accounting_component_rule_id, is_active FROM cost_types WHERE id = ?').get(created.id);
    assert.equal(row.store_id, 'store_002');
    assert.equal(row.code, 'PENGIRIMAN');
    assert.equal(row.accounting_component_rule_id, null, 'must stay NULL per ADR-029, not become an Accounting authority');
    assert.equal(row.is_active, 1);

    const bootstrap = await handleCostMasterApi(
      request('/api/admin/master/costs', { method: 'GET', token }),
      env,
      '/api/admin/master/costs'
    );
    const bootstrapBody = await bootstrap.json();
    assert.equal(bootstrapBody.costTypes.length, 1);
    assert.equal(bootstrapBody.costTypes[0].id, created.id);
  } finally {
    db.close();
  }
});

test('duplicate Jenis Biaya code is rejected with a friendly error, editing the same row is not', async () => {
  const db = migratedDatabase();
  try {
    const token = await adminToken(db, 'store_002');
    const env = { DB: new D1Database(db) };

    const first = await handleCostMasterApi(
      request('/api/admin/master/cost-types', { method: 'POST', token, body: { name: 'Kemasan' } }),
      env, '/api/admin/master/cost-types'
    );
    const firstBody = await first.json();

    const duplicate = await handleCostMasterApi(
      request('/api/admin/master/cost-types', { method: 'POST', token, body: { name: 'kemasan' } }),
      env, '/api/admin/master/cost-types'
    );
    assert.equal(duplicate.status, 400);

    const editSelf = await handleCostMasterApi(
      request(`/api/admin/master/cost-types/${firstBody.id}`, { method: 'PATCH', token, body: { name: 'Kemasan Ulang', isActive: false } }),
      env, `/api/admin/master/cost-types/${firstBody.id}`
    );
    assert.equal(editSelf.status, 200);
    const editedBody = await editSelf.json();
    assert.equal(editedBody.costTypes[0].name, 'Kemasan Ulang');
    assert.equal(editedBody.costTypes[0].isActive, false);
  } finally {
    db.close();
  }
});
