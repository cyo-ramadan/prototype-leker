import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { listStores, resolveAuthorizedEntityIds, resolveStore } from '../src/stores.js';

const migrationDir = new URL('../migrations/', import.meta.url);

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function asD1(sqlite) {
  return {
    prepare(sql) {
      const bound = params => ({
        async first() {
          return sqlite.prepare(sql).get(...params) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...params) };
        }
      });
      return {
        ...bound([]),
        bind(...params) {
          return bound(params);
        }
      };
    }
  };
}

test('resolveStore and listStores expose the open Entity/Tenant context for every backfilled store', async () => {
  const sqlite = freshDatabase();
  const db = asD1(sqlite);
  const expected = sqlite.prepare(`
    SELECT s.id, s.code, s.store_name, s.entity_id, e.name AS entity_name, et.tenant_id
    FROM stores s
    JOIN entities e ON e.id = s.entity_id
    JOIN entity_tenancy et ON et.entity_id = s.entity_id AND et.effective_to IS NULL
    WHERE s.is_active = 1
    ORDER BY s.code ASC
  `).all();

  assert.ok(expected.length > 0, 'migration 0039 must backfill at least one active store');

  for (const row of expected) {
    const resolved = await resolveStore(db, row.code);
    assert.equal(resolved.id, row.id);
    assert.equal(resolved.storeName, row.store_name);
    assert.equal(resolved.entityId, row.entity_id);
    assert.equal(resolved.entityName, row.entity_name);
    assert.equal(resolved.tenantId, row.tenant_id);
  }

  const listed = await listStores(db);
  assert.deepEqual(
    listed.map(store => [store.code, store.entityId, store.entityName, store.tenantId]),
    expected.map(row => [row.code, row.entity_id, row.entity_name, row.tenant_id])
  );
});

test('resolveAuthorizedEntityIds returns exactly the open entities for the requested tenant', async () => {
  const sqlite = freshDatabase();
  const db = asD1(sqlite);
  const expected = sqlite.prepare(`
    SELECT entity_id
    FROM entity_tenancy
    WHERE tenant_id = 'TEN-PROTOTYPE' AND effective_to IS NULL
    ORDER BY entity_id ASC
  `).all().map(row => row.entity_id);

  assert.deepEqual(await resolveAuthorizedEntityIds(db, 'TEN-PROTOTYPE'), expected);

  sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('TEN-OTHER', 'Other Tenant');
    INSERT INTO entities (id, name) VALUES ('ENT-OTHER', 'Other Entity');
    INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from)
    VALUES ('ET-OTHER', 'ENT-OTHER', 'TEN-OTHER', CURRENT_TIMESTAMP);
  `);

  assert.deepEqual(await resolveAuthorizedEntityIds(db, 'TEN-PROTOTYPE'), expected);
  assert.deepEqual(await resolveAuthorizedEntityIds(db, 'TEN-OTHER'), ['ENT-OTHER']);
  assert.deepEqual(await resolveAuthorizedEntityIds(db, ''), []);
});
