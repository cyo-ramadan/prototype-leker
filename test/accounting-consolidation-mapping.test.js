import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  listMappedAccountsForGroup,
  resolveGroupAccountMapping
} from '../src/accounting-consolidation.js';

const migrationDir = new URL('../migrations/', import.meta.url);

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function d1(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...args) {
          return {
            async first() { return statement.get(...args) || null; },
            async all() { return { results: statement.all(...args) }; }
          };
        }
      };
    }
  };
}

function seedMapping(sqlite) {
  const store = sqlite.prepare(`
    SELECT s.id, s.entity_id, a.id AS account_id, a.code AS account_code
    FROM stores s
    JOIN chart_of_accounts a ON a.store_id = s.id
    WHERE s.entity_id IS NOT NULL
    ORDER BY s.id, a.code
    LIMIT 1
  `).get();
  assert.ok(store, 'fixture needs a backfilled store with a chart account');

  sqlite.prepare(`
    INSERT INTO consolidation_groups (id, tenant_id, name)
    VALUES ('CG-TEST', 'TEN-PROTOTYPE', 'Group Test')
  `).run();
  sqlite.prepare(`
    INSERT INTO consolidation_membership (
      id, entity_id, consolidation_group_id, effective_from
    ) VALUES ('CM-TEST', ?, 'CG-TEST', '2026-01-01T00:00:00Z')
  `).run(store.entity_id);
  sqlite.prepare(`
    INSERT INTO consolidation_group_accounts (
      id, consolidation_group_id, code, name, type, effective_from
    ) VALUES ('CGA-CASH', 'CG-TEST', '1000', 'Kas Group', 'ASSET', '2026-01-01T00:00:00Z')
  `).run();
  sqlite.prepare(`
    INSERT INTO consolidation_account_mapping (
      id, consolidation_group_id, store_id, account_id,
      consolidation_group_account_id, effective_from
    ) VALUES ('CAM-CASH', 'CG-TEST', ?, ?, 'CGA-CASH', '2026-01-01T00:00:00Z')
  `).run(store.id, store.account_id);

  return store;
}

test('0047 adds versioned group CoA mapping without recreating foundation ownership tables', () => {
  const sqlite = freshDatabase();
  try {
    const tables = sqlite.prepare(`
      SELECT name FROM sqlite_schema WHERE type = 'table'
      AND name IN (
        'consolidation_groups', 'consolidation_membership',
        'consolidation_group_accounts', 'consolidation_account_mapping'
      ) ORDER BY name
    `).all().map(row => row.name);
    assert.deepEqual(tables, [
      'consolidation_account_mapping',
      'consolidation_group_accounts',
      'consolidation_groups',
      'consolidation_membership'
    ]);

    for (const table of ['consolidation_group_accounts', 'consolidation_account_mapping']) {
      const columns = sqlite.prepare(`PRAGMA table_info("${table}")`).all().map(row => row.name);
      assert.ok(columns.includes('effective_from'));
      assert.ok(columns.includes('effective_to'));
      assert.ok(!columns.includes('tenant_id'), `${table} must not denormalize tenant ownership`);
      assert.ok(!columns.includes('entity_id'), `${table} must resolve Entity from store membership at read time`);
    }
  } finally {
    sqlite.close();
  }
});

test('resolver derives Entity through store and returns the effective group account mapping', async () => {
  const sqlite = freshDatabase();
  try {
    const store = seedMapping(sqlite);
    const resolved = await resolveGroupAccountMapping(d1(sqlite), {
      consolidationGroupId: 'CG-TEST',
      storeId: store.id,
      accountId: store.account_id,
      asOf: '2026-03-01T00:00:00Z'
    });

    assert.equal(resolved?.entityId, store.entity_id);
    assert.equal(resolved?.storeId, store.id);
    assert.equal(resolved?.accountId, store.account_id);
    assert.equal(resolved?.groupAccountId, 'CGA-CASH');
    assert.equal(resolved?.groupAccountCode, '1000');
  } finally {
    sqlite.close();
  }
});

test('resolver fails closed when the Entity is not a member of the group as of the requested period', async () => {
  const sqlite = freshDatabase();
  try {
    const store = seedMapping(sqlite);
    sqlite.prepare(`
      UPDATE consolidation_membership
      SET effective_to = '2026-04-01T00:00:00Z'
      WHERE id = 'CM-TEST'
    `).run();

    const beforeClose = await resolveGroupAccountMapping(d1(sqlite), {
      consolidationGroupId: 'CG-TEST', storeId: store.id, accountId: store.account_id,
      asOf: '2026-03-01T00:00:00Z'
    });
    const afterClose = await resolveGroupAccountMapping(d1(sqlite), {
      consolidationGroupId: 'CG-TEST', storeId: store.id, accountId: store.account_id,
      asOf: '2026-05-01T00:00:00Z'
    });

    assert.ok(beforeClose);
    assert.equal(afterClose, null);
  } finally {
    sqlite.close();
  }
});

test('mapping history is closed and reopened instead of overwritten', async () => {
  const sqlite = freshDatabase();
  try {
    const store = seedMapping(sqlite);
    sqlite.prepare(`
      UPDATE consolidation_account_mapping
      SET effective_to = '2026-06-01T00:00:00Z'
      WHERE id = 'CAM-CASH'
    `).run();
    sqlite.prepare(`
      INSERT INTO consolidation_group_accounts (
        id, consolidation_group_id, code, name, type, effective_from
      ) VALUES ('CGA-CASH-NEW', 'CG-TEST', '1001', 'Kas Group Baru', 'ASSET', '2026-06-01T00:00:00Z')
    `).run();
    sqlite.prepare(`
      INSERT INTO consolidation_account_mapping (
        id, consolidation_group_id, store_id, account_id,
        consolidation_group_account_id, effective_from
      ) VALUES ('CAM-CASH-NEW', 'CG-TEST', ?, ?, 'CGA-CASH-NEW', '2026-06-01T00:00:00Z')
    `).run(store.id, store.account_id);

    const oldMapping = await resolveGroupAccountMapping(d1(sqlite), {
      consolidationGroupId: 'CG-TEST', storeId: store.id, accountId: store.account_id,
      asOf: '2026-03-01T00:00:00Z'
    });
    const newMapping = await resolveGroupAccountMapping(d1(sqlite), {
      consolidationGroupId: 'CG-TEST', storeId: store.id, accountId: store.account_id,
      asOf: '2026-08-01T00:00:00Z'
    });

    assert.equal(oldMapping?.groupAccountId, 'CGA-CASH');
    assert.equal(newMapping?.groupAccountId, 'CGA-CASH-NEW');
    assert.equal(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM consolidation_account_mapping`).get().n,
      2,
      'mapping history must be preserved as separate rows'
    );
  } finally {
    sqlite.close();
  }
});

test('group listing returns only mappings whose Entity membership and mapping are effective', async () => {
  const sqlite = freshDatabase();
  try {
    const store = seedMapping(sqlite);
    const active = await listMappedAccountsForGroup(d1(sqlite), {
      consolidationGroupId: 'CG-TEST',
      asOf: '2026-03-01T00:00:00Z'
    });
    assert.equal(active.length, 1);
    assert.equal(active[0].entityId, store.entity_id);

    sqlite.prepare(`
      UPDATE consolidation_membership
      SET effective_to = '2026-04-01T00:00:00Z'
      WHERE id = 'CM-TEST'
    `).run();
    const inactive = await listMappedAccountsForGroup(d1(sqlite), {
      consolidationGroupId: 'CG-TEST',
      asOf: '2026-05-01T00:00:00Z'
    });
    assert.deepEqual(inactive, []);
  } finally {
    sqlite.close();
  }
});

test('one source account cannot have two simultaneously open mappings in the same group', () => {
  const sqlite = freshDatabase();
  try {
    const store = seedMapping(sqlite);
    assert.throws(() => sqlite.prepare(`
      INSERT INTO consolidation_account_mapping (
        id, consolidation_group_id, store_id, account_id,
        consolidation_group_account_id, effective_from
      ) VALUES ('CAM-DUP', 'CG-TEST', ?, ?, 'CGA-CASH', '2026-02-01T00:00:00Z')
    `).run(store.id, store.account_id), /UNIQUE|constraint/i);
  } finally {
    sqlite.close();
  }
});
