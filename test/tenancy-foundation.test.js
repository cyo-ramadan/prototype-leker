import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migrationDir = new URL('../migrations/', import.meta.url);

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function userTables(sqlite) {
  return sqlite
    .prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map(row => row.name);
}

function columnsOf(sqlite, table) {
  return sqlite.prepare(`PRAGMA table_info("${table}")`).all().map(row => row.name);
}

// Captures the full contents of every table so a change anywhere is visible,
// not just in the tables we happen to suspect.
function snapshot(sqlite) {
  const state = {};
  for (const table of userTables(sqlite)) {
    state[table] = JSON.stringify(sqlite.prepare(`SELECT * FROM "${table}"`).all());
  }
  return state;
}

function changedTables(before, after) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter(name => before[name] !== after[name]).sort();
}

function seedTwoCustomers(sqlite) {
  const opened = '2026-01-01T00:00:00Z';
  sqlite.exec(`
    INSERT INTO tenants (id, name) VALUES ('TEN-A', 'Customer A'), ('TEN-B', 'Customer B');
    INSERT INTO entities (id, name) VALUES
      ('ENT-A1','A1'), ('ENT-A2','A2'), ('ENT-A3','A3'),
      ('ENT-B1','B1'), ('ENT-B2','B2'), ('ENT-B3','B3'), ('ENT-B4','B4'), ('ENT-B5','B5');
    INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from) VALUES
      ('T-A1','ENT-A1','TEN-A','${opened}'), ('T-A2','ENT-A2','TEN-A','${opened}'),
      ('T-A3','ENT-A3','TEN-A','${opened}'),
      ('T-B1','ENT-B1','TEN-B','${opened}'), ('T-B2','ENT-B2','TEN-B','${opened}'),
      ('T-B3','ENT-B3','TEN-B','${opened}'), ('T-B4','ENT-B4','TEN-B','${opened}'),
      ('T-B5','ENT-B5','TEN-B','${opened}');
  `);
}

// The merge the owner described: the customer with 5 units joins the customer
// with 3. Membership is closed and reopened; nothing else is written.
function mergeCustomer(sqlite, { from, into, at }) {
  const moving = sqlite
    .prepare(`SELECT entity_id FROM entity_tenancy WHERE tenant_id = ? AND effective_to IS NULL`)
    .all(from)
    .map(row => row.entity_id);

  sqlite
    .prepare(`UPDATE entity_tenancy SET effective_to = ? WHERE tenant_id = ? AND effective_to IS NULL`)
    .run(at, from);

  const insert = sqlite.prepare(
    `INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from, reason) VALUES (?, ?, ?, ?, ?)`
  );
  for (const entityId of moving) {
    insert.run(`T-${entityId}-MERGED`, entityId, into, at, `merged from ${from}`);
  }
  return moving.length;
}

function entitiesOfTenantAsOf(sqlite, tenantId, at) {
  return sqlite
    .prepare(
      `SELECT entity_id FROM entity_tenancy
       WHERE tenant_id = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
       ORDER BY entity_id`
    )
    .all(tenantId, at, at)
    .map(row => row.entity_id);
}

test('the migration chain applies cleanly and links every gerai to a books owner', () => {
  const sqlite = freshDatabase();
  const unlinked = sqlite.prepare(`SELECT COUNT(*) AS n FROM stores WHERE entity_id IS NULL`).get().n;
  assert.equal(unlinked, 0, 'every store must have an entity after backfill');

  const stores = sqlite.prepare(`SELECT COUNT(*) AS n FROM stores`).get().n;
  const openTenancies = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM entity_tenancy WHERE effective_to IS NULL`)
    .get().n;
  assert.equal(openTenancies, stores, 'each backfilled entity gets exactly one open tenancy');
});

test('entities does not store its tenant, because that link moves', () => {
  const sqlite = freshDatabase();
  assert.ok(
    !columnsOf(sqlite, 'entities').includes('tenant_id'),
    'entities.tenant_id would turn a customer merge into a rewrite and erase past ownership'
  );
});

test('tenant and group identity stay out of every other table', () => {
  const sqlite = freshDatabase();
  // ADR-030: the ledger anchors to entity_id alone. Tenant lives only in the
  // membership relation and in tenant-scoped configuration; group lives only in
  // its membership. Anything else carrying these columns would have to be
  // rewritten on merge, and posted journals may not be rewritten.
  const tenantHolders = [];
  const groupHolders = [];
  for (const table of userTables(sqlite)) {
    const columns = columnsOf(sqlite, table);
    if (columns.includes('tenant_id')) tenantHolders.push(table);
    if (columns.includes('group_id')) groupHolders.push(table);
  }
  assert.deepEqual(tenantHolders.sort(), ['consolidation_groups', 'entity_tenancy']);

  // group_id belongs to Customer Sharing Group (ADR-003) and means something
  // else entirely. Consolidation deliberately spells its column
  // consolidation_group_id so the two never blur into one another.
  assert.deepEqual(groupHolders.sort(), ['customer_share_group_stores']);
});

test('an entity cannot belong to two customers at the same time', () => {
  const sqlite = freshDatabase();
  seedTwoCustomers(sqlite);
  assert.throws(
    () =>
      sqlite
        .prepare(`INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from) VALUES (?,?,?,?)`)
        .run('T-DUP', 'ENT-B1', 'TEN-A', '2026-03-01T00:00:00Z'),
    /UNIQUE|constraint/i,
    'a second open tenancy for one entity must be rejected'
  );
});

test('merging two customers writes nothing outside the tenancy relation', () => {
  const sqlite = freshDatabase();
  seedTwoCustomers(sqlite);

  const before = snapshot(sqlite);
  const moved = mergeCustomer(sqlite, { from: 'TEN-B', into: 'TEN-A', at: '2026-06-01T00:00:00Z' });
  const after = snapshot(sqlite);

  assert.equal(moved, 5);
  // This is the property the whole design exists to buy: posted journals are
  // immutable, so a merge must not be able to touch them. Comparing every table
  // proves it for the whole database rather than for the tables we thought of.
  assert.deepEqual(
    changedTables(before, after),
    ['entity_tenancy'],
    'a customer merge must not write to any table except entity_tenancy'
  );
});

test('history survives the merge and consolidation resolves as of a date', () => {
  const sqlite = freshDatabase();
  seedTwoCustomers(sqlite);
  mergeCustomer(sqlite, { from: 'TEN-B', into: 'TEN-A', at: '2026-06-01T00:00:00Z' });

  const afterMerge = entitiesOfTenantAsOf(sqlite, 'TEN-A', '2026-09-01T00:00:00Z');
  assert.equal(afterMerge.length, 8, 'all eight units report under the surviving customer');

  // A consolidated report for a period before the merge must still show the
  // structure that existed then. Restating it is a separate, explicit decision.
  const beforeMergeA = entitiesOfTenantAsOf(sqlite, 'TEN-A', '2026-03-01T00:00:00Z');
  const beforeMergeB = entitiesOfTenantAsOf(sqlite, 'TEN-B', '2026-03-01T00:00:00Z');
  assert.equal(beforeMergeA.length, 3);
  assert.equal(beforeMergeB.length, 5);

  const afterMergeB = entitiesOfTenantAsOf(sqlite, 'TEN-B', '2026-09-01T00:00:00Z');
  assert.equal(afterMergeB.length, 0, 'the absorbed customer holds nothing after the merge date');
});
