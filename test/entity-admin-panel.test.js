import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleEntityAdminApi, requireManagement, hashCredential } from '../src/owner-auth.js';
import { handleApprovalQueueApi } from '../src/approval-queue.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const entityAdminHtml = readFileSync(new URL('../public/entity-admin.html', import.meta.url), 'utf8');
const entityAdminUi = readFileSync(new URL('../public/entity-admin.js', import.meta.url), 'utf8');
const branchAuthUi = readFileSync(new URL('../public/branch-owner-auth.js', import.meta.url), 'utf8');

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
    return { success: true, meta: { changes: Number(result.changes || 0) } };
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

async function seedEntityAdmin(db, { id = 'entity_admin_test', entityId = 'ENT-GALEH', username = 'entityadmin.galeh', password = 'rahasia123' } = {}) {
  const passwordHash = await hashCredential(password);
  db.prepare(`
    INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active)
    VALUES (?, ?, ?, ?, 'Entity Admin Galeh', 1)
  `).run(id, entityId, username, passwordHash);
  return { id, entityId, username, password };
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

test('Entity Admin can log in and only sees stores under its own entity', async () => {
  const db = migratedDatabase();
  try {
    const seed = await seedEntityAdmin(db);
    const env = { DB: new D1Database(db) };

    const loginResponse = await handleEntityAdminApi(
      request('/api/entity-admin/login', { method: 'POST', body: { username: seed.username, password: seed.password } }),
      env, '/api/entity-admin/login'
    );
    assert.equal(loginResponse.status, 200);
    const loginBody = await loginResponse.json();
    assert.equal(loginBody.role, 'ENTITY_ADMIN');
    assert.equal(loginBody.entityAdmin.entityId, 'ENT-GALEH');
    assert.ok(loginBody.token);

    const storesResponse = await handleEntityAdminApi(
      request('/api/entity-admin/stores', { token: loginBody.token }),
      env, '/api/entity-admin/stores'
    );
    assert.equal(storesResponse.status, 200);
    const storesBody = await storesResponse.json();
    assert.ok(storesBody.stores.some(store => store.code === 'IKAN01'));
    assert.ok(storesBody.stores.every(store => store.entityId === 'ENT-GALEH'));
    assert.ok(!storesBody.stores.some(store => store.code === 'G001'));

    const meResponse = await handleEntityAdminApi(request('/api/entity-admin/me', { token: loginBody.token }), env, '/api/entity-admin/me');
    assert.equal(meResponse.status, 200);

    const wrongLogin = await handleEntityAdminApi(
      request('/api/entity-admin/login', { method: 'POST', body: { username: seed.username, password: 'salah' } }),
      env, '/api/entity-admin/login'
    );
    assert.equal(wrongLogin.status, 401);
  } finally {
    db.close();
  }
});

test('requireManagement grants Entity Admin access to its own entity stores and rejects stores outside it', async () => {
  const db = migratedDatabase();
  try {
    const seed = await seedEntityAdmin(db);
    const env = { DB: new D1Database(db) };

    const loginResponse = await handleEntityAdminApi(
      request('/api/entity-admin/login', { method: 'POST', body: { username: seed.username, password: seed.password } }),
      env, '/api/entity-admin/login'
    );
    const { token } = await loginResponse.json();

    const inEntity = await requireManagement(request(`/api/admin/products?store=IKAN01`, { token }), env.DB);
    assert.equal(inEntity.ok, true);
    assert.equal(inEntity.authType, 'ENTITY_ADMIN');
    assert.equal(inEntity.entityAdmin.id, seed.id);

    const outsideEntity = await requireManagement(request(`/api/admin/products?store=G001`, { token }), env.DB);
    assert.equal(outsideEntity.ok, false);
    assert.equal(outsideEntity.response.status, 403);
    const outsideBody = await outsideEntity.response.json();
    assert.equal(outsideBody.code, 'ENTITY_ADMIN_STORE_SCOPE_MISMATCH');

    const storeManagement = await requireManagement(request(`/api/admin/stores?store=IKAN01`, { token }), env.DB);
    assert.equal(storeManagement.ok, false);
    const storeManagementBody = await storeManagement.response.json();
    assert.equal(storeManagementBody.code, 'OWNER_ONLY');
  } finally {
    db.close();
  }
});

test('actions taken by Entity Admin inside a store are attributed to ENTITY_ADMIN, not generic ADMIN', async () => {
  const db = migratedDatabase();
  try {
    const seed = await seedEntityAdmin(db);
    const env = { DB: new D1Database(db) };

    const loginResponse = await handleEntityAdminApi(
      request('/api/entity-admin/login', { method: 'POST', body: { username: seed.username, password: seed.password } }),
      env, '/api/entity-admin/login'
    );
    const { token } = await loginResponse.json();

    const store = db.prepare(`SELECT id FROM stores WHERE code = 'IKAN01'`).get();
    db.prepare(`
      INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active)
      VALUES ('cashier_entity_admin_test', 'kasir.galeh', 'x', 'Kasir Galeh', ?, 1)
    `).run(store.id);
    db.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES ('drawer_entity_admin_test', ?, 'cashier_entity_admin_test', 0, 'OPEN', '2026-09-03T00:00:00.000Z')
    `).run(store.id);
    db.prepare(`
      INSERT INTO approval_requests (
        id, store_id, drawer_session_id, cashier_id, request_type,
        approval_status, posting_status, payload_json, created_at, updated_at
      ) VALUES ('approval_entity_admin_test', ?, 'drawer_entity_admin_test', 'cashier_entity_admin_test', 'CASH_FLOW', 'pending_approval', 'unposted', '{}', '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z')
    `).run(store.id);

    const pathname = '/api/management/approval-requests/approval_entity_admin_test';
    const decisionRequest = new Request(`https://example.test${pathname}?store=IKAN01`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'REJECT', note: 'Ditolak Entity Admin' })
    });
    const decisionResponse = await handleApprovalQueueApi(decisionRequest, env, pathname);
    assert.equal(decisionResponse.status, 200);

    const row = db.prepare(`SELECT approved_by_role, approved_by_id FROM approval_requests WHERE id = ?`).get('approval_entity_admin_test');
    assert.equal(row.approved_by_role, 'ENTITY_ADMIN');
    assert.equal(row.approved_by_id, seed.id);
  } finally {
    db.close();
  }
});

test('Entity Admin page and branch-owner-auth wiring exist', () => {
  assert.match(entityAdminHtml, /id="entityAdminLoginBtn"/);
  assert.match(entityAdminHtml, /id="entityAdminStoreList"/);
  assert.match(entityAdminUi, /\/api\/entity-admin\/login/);
  assert.match(entityAdminUi, /\/api\/entity-admin\/stores/);
  assert.match(entityAdminUi, /lekerEntityAdminToken/);

  assert.match(branchAuthUi, /lekerEntityAdminToken/);
  assert.match(branchAuthUi, /isEntityAdmin/);
});
