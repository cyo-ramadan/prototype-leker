import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleOwnerApi, hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const ownerHtml = readFileSync(new URL('../public/owner.html', import.meta.url), 'utf8');
const ownerUi = readFileSync(new URL('../public/owner.js', import.meta.url), 'utf8');

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
  const owner = db.prepare('SELECT id FROM owner_accounts ORDER BY id LIMIT 1').get();
  const token = 'owner-tenant-entity-panel-token';
  const tokenHash = await hashCredential(token);
  db.prepare(`
    INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at)
    VALUES (?, ?, '2026-09-03T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(tokenHash, owner.id);
  return token;
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

test('Owner can create a tenant, then create an entity under it, and both show up in the lists', async () => {
  const db = migratedDatabase();
  try {
    const token = await ownerToken(db);
    const env = { DB: new D1Database(db) };

    const createdTenant = await handleOwnerApi(
      request('/api/owner/tenants', { token, method: 'POST', body: { name: 'PT Contoh Jaya' } }),
      env, '/api/owner/tenants'
    );
    assert.equal(createdTenant.status, 201);
    const tenantBody = await createdTenant.json();
    const tenant = tenantBody.tenants.find(item => item.name === 'PT Contoh Jaya');
    assert.ok(tenant, 'new tenant should appear in the returned list');
    assert.equal(tenant.status, 'ACTIVE');

    const listTenants = await handleOwnerApi(request('/api/owner/tenants', { token }), env, '/api/owner/tenants');
    const listTenantsBody = await listTenants.json();
    assert.ok(listTenantsBody.tenants.some(item => item.id === tenant.id));

    const createdEntity = await handleOwnerApi(
      request('/api/owner/entities', { token, method: 'POST', body: { name: 'Cabang Malang', tenantId: tenant.id } }),
      env, '/api/owner/entities'
    );
    assert.equal(createdEntity.status, 201);
    const entityBody = await createdEntity.json();
    const entity = entityBody.entities.find(item => item.name === 'Cabang Malang');
    assert.ok(entity);
    assert.equal(entity.tenantId, tenant.id);
    assert.equal(entity.tenantName, 'PT Contoh Jaya');

    // ADR-030: the open tenancy link lives in entity_tenancy, not a column on entities.
    const tenancyRow = db.prepare(`SELECT entity_id, tenant_id, effective_to FROM entity_tenancy WHERE entity_id = ?`).get(entity.id);
    assert.equal(tenancyRow.tenant_id, tenant.id);
    assert.equal(tenancyRow.effective_to, null);
  } finally {
    db.close();
  }
});

test('creating an entity under a nonexistent or inactive tenant is rejected', async () => {
  const db = migratedDatabase();
  try {
    const token = await ownerToken(db);
    const env = { DB: new D1Database(db) };

    const missing = await handleOwnerApi(
      request('/api/owner/entities', { token, method: 'POST', body: { name: 'X', tenantId: 'tenant_does_not_exist' } }),
      env, '/api/owner/entities'
    );
    assert.equal(missing.status, 400);

    db.prepare(`INSERT INTO tenants (id, name, status) VALUES ('tenant_suspended_test', 'Suspended Co', 'SUSPENDED')`).run();
    const suspended = await handleOwnerApi(
      request('/api/owner/entities', { token, method: 'POST', body: { name: 'X', tenantId: 'tenant_suspended_test' } }),
      env, '/api/owner/entities'
    );
    assert.equal(suspended.status, 400);
  } finally {
    db.close();
  }
});

test('a new store can be created directly under an entity, and an existing store\'s entity can be reassigned', async () => {
  const db = migratedDatabase();
  try {
    const token = await ownerToken(db);
    const env = { DB: new D1Database(db) };
    const tenant = db.prepare(`SELECT id FROM tenants LIMIT 1`).get();
    db.prepare(`INSERT INTO entities (id, name, status) VALUES ('entity_panel_test', 'Entity Test', 'ACTIVE')`).run();
    db.prepare(`
      INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from)
      VALUES ('tnc_panel_test', 'entity_panel_test', ?, CURRENT_TIMESTAMP)
    `).run(tenant.id);

    const createdStore = await handleOwnerApi(
      request('/api/owner/stores', { token, method: 'POST', body: { code: 'PANELTEST', storeName: 'Gerai Panel Test', entityId: 'entity_panel_test' } }),
      env, '/api/owner/stores'
    );
    assert.equal(createdStore.status, 201);
    const createdStoreBody = await createdStore.json();
    assert.equal(createdStoreBody.store.entityId, 'entity_panel_test');

    db.prepare(`INSERT INTO entities (id, name, status) VALUES ('entity_panel_test_2', 'Entity Test 2', 'ACTIVE')`).run();
    db.prepare(`
      INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from)
      VALUES ('tnc_panel_test_2', 'entity_panel_test_2', ?, CURRENT_TIMESTAMP)
    `).run(tenant.id);

    const patched = await handleOwnerApi(
      request(`/api/owner/stores/${createdStoreBody.store.id}`, {
        token, method: 'PATCH',
        body: { storeName: 'Gerai Panel Test', entityId: 'entity_panel_test_2' }
      }),
      env, `/api/owner/stores/${createdStoreBody.store.id}`
    );
    assert.equal(patched.status, 200);
    const patchedBody = await patched.json();
    assert.equal(patchedBody.store.entityId, 'entity_panel_test_2');

    const rejected = await handleOwnerApi(
      request('/api/owner/stores', { token, method: 'POST', body: { code: 'PANELTEST2', storeName: 'X', entityId: 'entity_does_not_exist' } }),
      env, '/api/owner/stores'
    );
    assert.equal(rejected.status, 400);
  } finally {
    db.close();
  }
});

test('Owner console wires the Tenant/Entity create forms and the store-create Entity picker', () => {
  assert.match(ownerHtml, /id="tenantCreateForm"/);
  assert.match(ownerHtml, /id="ownerTenantName"/);
  assert.match(ownerHtml, /id="entityCreateForm"/);
  assert.match(ownerHtml, /id="ownerEntityName"/);
  assert.match(ownerHtml, /id="ownerEntityTenant"/);
  assert.match(ownerHtml, /id="ownerStoreEntity"/);

  assert.match(ownerUi, /function createOwnerTenant\(event\)/);
  assert.match(ownerUi, /function createOwnerEntity\(event\)/);
  assert.match(ownerUi, /ownerApi\('\/api\/owner\/tenants'\)/);
  assert.match(ownerUi, /ownerApi\('\/api\/owner\/entities'\)/);
  assert.match(ownerUi, /entityId: ownerEl\('ownerStoreEntity'\)\.value \|\| null/);
  assert.match(ownerUi, /ownerEl\('tenantCreateForm'\)\.addEventListener\('submit', createOwnerTenant\)/);
  assert.match(ownerUi, /ownerEl\('entityCreateForm'\)\.addEventListener\('submit', createOwnerEntity\)/);
});
