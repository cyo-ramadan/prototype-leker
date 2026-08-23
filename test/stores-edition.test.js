import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migrationDir = new URL('../migrations/', import.meta.url);
const EDITION_MIGRATION = '0045_stores_edition.sql';

const migrationFiles = () => readdirSync(migrationDir)
  .filter(name => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const readMigration = file => readFileSync(new URL(file, migrationDir), 'utf8');

// Any migration written after 0045 that touches the `edition` column (e.g. a
// new store's onboarding migration setting edition='LITE') cannot run without
// it either -- skip those too, not just 0045 itself, or the includeEdition:false
// branch crashes on "no such column" instead of showing 0045's isolated effect.
const dependsOnEdition = file => file === EDITION_MIGRATION || /\bedition\b/.test(readMigration(file));

function migratedDb({ includeEdition = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of migrationFiles()) {
    if (!includeEdition && dependsOnEdition(file)) continue;
    sqlite.exec(readMigration(file));
  }
  return sqlite;
}

function stableStoreSnapshot(sqlite, storeId) {
  const tables = sqlite.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name <> 'stores'
    ORDER BY name
  `).all().map(row => row.name);

  const snapshot = {};
  for (const table of tables) {
    const columns = sqlite.prepare(`PRAGMA table_info("${table}")`).all();
    if (!columns.some(column => column.name === 'store_id')) continue;

    const stableColumns = columns
      .map(column => column.name)
      .filter(name => !name.endsWith('_at'));
    const selected = stableColumns.map(name => `"${name}"`).join(', ');
    const rows = sqlite.prepare(`SELECT ${selected} FROM "${table}" WHERE store_id = ?`)
      .all(storeId)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    if (rows.length > 0) snapshot[table] = rows;
  }
  return snapshot;
}

test('stores.edition is constrained, defaults existing and new stores to ACCOUNTING', () => {
  const sqlite = migratedDb();
  try {
    const column = sqlite.prepare(`PRAGMA table_info(stores)`).all()
      .find(row => row.name === 'edition');
    assert.equal(String(column?.type).toUpperCase(), 'TEXT');
    assert.equal(Number(column?.notnull), 1);
    assert.equal(String(column?.dflt_value), "'ACCOUNTING'");
    // Scoped to Leker's own original gerai, not "every row in the table": a
    // tenant onboarded later may legitimately set edition='LITE' explicitly.
    // The default itself is proven right below by inserting a store that
    // omits the column entirely.
    assert.deepEqual(
      sqlite.prepare(`SELECT DISTINCT edition FROM stores WHERE code IN ('G001', 'G002', 'M002') ORDER BY edition`).all()
        .map(row => row.edition),
      ['ACCOUNTING']
    );

    sqlite.prepare(`
      INSERT INTO stores (id, code, store_name)
      VALUES ('store_edition_default', 'EDITIONDEFAULT', 'Edition Default')
    `).run();
    assert.equal(
      sqlite.prepare(`SELECT edition FROM stores WHERE id = 'store_edition_default'`).get().edition,
      'ACCOUNTING'
    );
    assert.throws(
      () => sqlite.prepare(`
        INSERT INTO stores (id, code, store_name, edition)
        VALUES ('store_edition_invalid', 'EDITIONINVALID', 'Edition Invalid', 'PREMIUM')
      `).run(),
      /CHECK constraint failed/i
    );
  } finally {
    sqlite.close();
  }
});

test('migration preserves existing data and ACCOUNTING store scaffolding exactly', () => {
  const beforeMigration = migratedDb({ includeEdition: false });
  const afterMigration = migratedDb();
  try {
    const existingBefore = stableStoreSnapshot(beforeMigration, 'store_001');
    beforeMigration.exec(readMigration(EDITION_MIGRATION));
    assert.deepEqual(stableStoreSnapshot(beforeMigration, 'store_001'), existingBefore);
    assert.deepEqual(
      beforeMigration.prepare(`SELECT id, edition FROM stores ORDER BY id`).all(),
      beforeMigration.prepare(`SELECT id, 'ACCOUNTING' AS edition FROM stores ORDER BY id`).all()
    );

    const storeId = 'store_edition_accounting';
    beforeMigration.prepare(`
      INSERT INTO stores (id, code, store_name, edition)
      VALUES (?, 'EDITIONACC', 'Edition Accounting', 'ACCOUNTING')
    `).run(storeId);

    const withoutEdition = migratedDb({ includeEdition: false });
    try {
      withoutEdition.prepare(`
        INSERT INTO stores (id, code, store_name)
        VALUES (?, 'EDITIONACC', 'Edition Accounting')
      `).run(storeId);
      assert.deepEqual(
        stableStoreSnapshot(beforeMigration, storeId),
        stableStoreSnapshot(withoutEdition, storeId)
      );
    } finally {
      withoutEdition.close();
    }

    afterMigration.prepare(`
      INSERT INTO stores (id, code, store_name, edition)
      VALUES (?, 'EDITIONACC', 'Edition Accounting', 'ACCOUNTING')
    `).run(storeId);
    assert.deepEqual(
      stableStoreSnapshot(afterMigration, storeId),
      stableStoreSnapshot(beforeMigration, storeId)
    );
  } finally {
    beforeMigration.close();
    afterMigration.close();
  }
});

test('LITE and FLEXIBLE keep accountless POS methods while targeted Accounting seeds stay gated', () => {
  const sqlite = migratedDb();
  try {
    for (const edition of ['LITE', 'FLEXIBLE']) {
      const suffix = edition.toLowerCase();
      const storeId = `store_edition_${suffix}`;
      sqlite.prepare(`
        INSERT INTO stores (id, code, store_name, edition)
        VALUES (?, ?, ?, ?)
      `).run(storeId, `EDITION${edition}`, `Edition ${edition}`, edition);

      assert.deepEqual(
        sqlite.prepare(`
          SELECT code, account_id, is_default
          FROM payment_methods
          WHERE store_id = ?
          ORDER BY code
        `).all(storeId).map(row => ({ ...row })),
        [
          { code: 'BANK', account_id: null, is_default: 0 },
          { code: 'CASH', account_id: null, is_default: 1 },
          { code: 'NON_CASH', account_id: null, is_default: 0 },
          { code: 'PAYABLE', account_id: null, is_default: 0 }
        ]
      );

      assert.deepEqual(
        sqlite.prepare(`SELECT code FROM chart_of_accounts WHERE store_id = ? ORDER BY code`)
          .all(storeId).map(row => row.code),
        ['SYS-ADJ'],
        '0026 residual account stays explicitly outside this task; 0028 cash-flow accounts are now gated (migration 0049)'
      );
      assert.deepEqual(
        sqlite.prepare(`SELECT code FROM transaction_categories WHERE store_id = ? ORDER BY code`)
          .all(storeId).map(row => row.code),
        [],
        '0028 cash-flow categories are now gated by edition (migration 0049)'
      );
      assert.equal(
        sqlite.prepare(`SELECT COUNT(*) AS n FROM journal_rules WHERE store_id = ?`).get(storeId).n,
        0,
        '0028 cash-flow rules are now gated by edition (migration 0049)'
      );
      assert.equal(
        sqlite.prepare(`SELECT COUNT(*) AS n FROM item_categories WHERE store_id = ?`).get(storeId).n,
        0
      );
      assert.equal(
        sqlite.prepare(`
          SELECT COUNT(*) AS n FROM payment_methods
          WHERE store_id = ? AND code = 'RECEIVABLE_OFFSET'
        `).get(storeId).n,
        0
      );
      assert.equal(
        sqlite.prepare(`SELECT COUNT(*) AS n FROM accounting_sequences WHERE store_id = ?`)
          .get(storeId).n,
        2,
        '0024 sequence rows are an accepted residual outside this task'
      );

      assert.doesNotThrow(() => sqlite.prepare(`
        INSERT INTO product_kinds (id, store_id, code, name)
        VALUES (?, ?, 'RAW_MATERIAL', 'Bahan Baku')
      `).run(`kind_${suffix}`, storeId));
      assert.equal(
        sqlite.prepare(`SELECT COUNT(*) AS n FROM item_categories WHERE store_id = ?`).get(storeId).n,
        0
      );
    }
  } finally {
    sqlite.close();
  }
});

test('the three corrected trigger boundaries are present in the migrated schema', () => {
  const sqlite = migratedDb();
  try {
    const triggerSql = name => sqlite.prepare(`
      SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = ?
    `).get(name)?.sql ?? '';

    assert.match(
      triggerSql('trg_stores_seed_accounting_settings_defaults'),
      /WHEN\s+NEW\.edition\s*=\s*'ACCOUNTING'/i
    );
    assert.match(
      triggerSql('trg_product_kinds_seed_accounting_mapping'),
      /stores[\s\S]+edition\s*=\s*'ACCOUNTING'/i
    );
    assert.match(
      triggerSql('trg_payment_methods_cash_default_after_insert'),
      /edition\s*=\s*'ACCOUNTING'/i
    );
    assert.match(
      triggerSql('trg_stores_seed_pos_payment_methods_defaults'),
      /NEW\.edition\s+IN\s*\(\s*'LITE'\s*,\s*'FLEXIBLE'\s*\)/i
    );
  } finally {
    sqlite.close();
  }
});
