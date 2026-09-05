import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleEntityAdminApi, requireManagement } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const pilotMigration = readFileSync(new URL('../migrations/0064_kantor_pendem_mandala_entity_admin_pilot.sql', import.meta.url), 'utf8');

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

test('migration 0064 groups Kantor/Pendem/Mandala under one entity and seeds Rika + Alfina', () => {
  assert.match(pilotMigration, /'ENT-KPM'/);
  assert.match(pilotMigration, /'entityadmin_rika'/);
  assert.match(pilotMigration, /'entityadmin_alfina'/);
  assert.match(pilotMigration, /WHERE code IN \('KANTOR', 'PENDEM', 'MANDALA'\)/);
});

test('Rika and Alfina can log in and both see all three grouped stores', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };

    for (const { username, password, displayName } of [
      { username: 'entityadmin_rika', password: 'rika_entity123', displayName: 'Rika (Akuntan)' },
      { username: 'entityadmin_alfina', password: 'alfina_entity123', displayName: 'Alfina (HR)' }
    ]) {
      const loginResponse = await handleEntityAdminApi(
        request('/api/entity-admin/login', { method: 'POST', body: { username, password } }),
        env, '/api/entity-admin/login'
      );
      assert.equal(loginResponse.status, 200, `${username} should be able to log in`);
      const loginBody = await loginResponse.json();
      assert.equal(loginBody.entityAdmin.displayName, displayName);
      assert.equal(loginBody.entityAdmin.entityId, 'ENT-KPM');

      const storesResponse = await handleEntityAdminApi(
        request('/api/entity-admin/stores', { token: loginBody.token }),
        env, '/api/entity-admin/stores'
      );
      const storesBody = await storesResponse.json();
      const codes = storesBody.stores.map(store => store.code).sort();
      assert.deepEqual(codes, ['KANTOR', 'MANDALA', 'PENDEM']);

      for (const code of codes) {
        const auth = await requireManagement(request(`/api/admin/products?store=${code}`, { token: loginBody.token }), env.DB);
        assert.equal(auth.ok, true, `${username} should be authorized on ${code}`);
        assert.equal(auth.authType, 'ENTITY_ADMIN');
      }

      const outside = await requireManagement(request('/api/admin/products?store=G001', { token: loginBody.token }), env.DB);
      assert.equal(outside.ok, false, `${username} must not reach G001, which is outside ENT-KPM`);
    }
  } finally {
    db.close();
  }
});

test("Pendem's pre-existing journal history keeps its original ENT-PENDEM attribution after regrouping", () => {
  const db = migratedDatabase();
  try {
    const orphanedEntity = db.prepare(`SELECT id FROM entities WHERE id = 'ENT-PENDEM'`).get();
    assert.ok(orphanedEntity, 'ENT-PENDEM must still exist so historical journal rows referencing it stay valid');

    const pendemStoreEntity = db.prepare(`SELECT entity_id FROM stores WHERE code = 'PENDEM'`).get();
    assert.equal(pendemStoreEntity.entity_id, 'ENT-KPM', 'the store itself now points at the new grouped entity going forward');
  } finally {
    db.close();
  }
});
