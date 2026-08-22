import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migrationDir = new URL('../migrations/', import.meta.url);
const migrations = () => readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
const read = file => readFileSync(new URL(file, migrationDir), 'utf8');

function migratedDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of migrations()) sqlite.exec(read(file));
  return sqlite;
}

const schemaObjects = (sqlite, tblName) =>
  sqlite.prepare(`SELECT type, name FROM sqlite_schema WHERE tbl_name = ? ORDER BY type, name`).all(tblName);

test('migration 0042 lands without error and journal_rules keeps its two indexes and two triggers', () => {
  const sqlite = migratedDb();
  const objects = schemaObjects(sqlite, 'journal_rules').map(row => `${row.type}:${row.name}`);
  assert.ok(objects.includes('index:idx_journal_rules_category_order'));
  assert.ok(objects.includes('index:idx_journal_rules_one_default'));
  assert.ok(objects.includes('trigger:trg_journal_rule_scope_insert'));
  assert.ok(objects.includes('trigger:trg_journal_rule_scope_update'));
});

test('migration 0042 does not add, remove, or change any existing journal_rules row', () => {
  const before = migratedDb();
  const beforeRows = JSON.stringify(
    before.prepare(`SELECT id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, is_active, sort_order, is_default FROM journal_rules ORDER BY id`).all()
  );

  // Build the historical snapshot exactly as it existed before 0042. Later
  // migrations may legitimately depend on schema introduced by 0042, so they
  // must not be replayed into this pre-0042 fixture.
  const withoutChoiceGroups = new DatabaseSync(':memory:');
  withoutChoiceGroups.exec('PRAGMA foreign_keys = ON;');
  for (const file of migrations()) {
    if (file >= '0042_') break;
    withoutChoiceGroups.exec(read(file));
  }
  const beforeRowsPre0042 = JSON.stringify(
    withoutChoiceGroups.prepare(`SELECT id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, is_active, sort_order, is_default FROM journal_rules ORDER BY id`).all()
  );

  assert.equal(beforeRows, beforeRowsPre0042);
});

test('creating a new store still seeds journal_rules exactly as before (seed triggers survive the rebuild)', () => {
  const withChoiceGroups = migratedDb();
  const withoutChoiceGroups = new DatabaseSync(':memory:');
  withoutChoiceGroups.exec('PRAGMA foreign_keys = ON;');
  for (const file of migrations()) {
    if (file >= '0042_') break;
    withoutChoiceGroups.exec(read(file));
  }

  for (const db of [withChoiceGroups, withoutChoiceGroups]) {
    db.exec(`INSERT INTO stores (id, code, store_name) VALUES ('store_seed_test', 'SEEDTEST', 'Seed Test')`);
  }

  const rulesOf = db => JSON.stringify(
    db.prepare(`SELECT source_type, side, label, sort_order FROM journal_rules WHERE store_id = 'store_seed_test' ORDER BY source_type, side, label`).all()
  );

  assert.equal(rulesOf(withChoiceGroups), rulesOf(withoutChoiceGroups));
});

test('journal_rules accepts source_type=choice_group only when paired with a valid choice_group_id, and rejects it otherwise', () => {
  const sqlite = migratedDb();
  const store = sqlite.prepare(`SELECT id FROM stores LIMIT 1`).get();
  const category = sqlite.prepare(`SELECT id FROM transaction_categories WHERE store_id = ? AND code = 'operational' LIMIT 1`).get(store.id);
  const account = sqlite.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = ? AND type = 'EXPENSE' LIMIT 1`).get(store.id);

  sqlite.exec(`INSERT INTO accounting_choice_groups (id, store_id, code, name) VALUES ('grp_test', '${store.id}', 'JENIS_BEBAN', 'Jenis Beban')`);
  sqlite.exec(`INSERT INTO accounting_choice_options (id, choice_group_id, store_id, code, name, account_id) VALUES ('opt_test', 'grp_test', '${store.id}', 'LISTRIK', 'Listrik', '${account.id}')`);

  // Valid: choice_group source_type with a matching choice_group_id.
  assert.doesNotThrow(() => sqlite.exec(`
    INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, choice_group_id)
    VALUES ('rule_ok', '${store.id}', '${category.id}', 'Jenis Beban', 'DEBIT', 'choice_group', 'grp_test')
  `));

  // Invalid: choice_group source_type without a choice_group_id must be rejected by the CHECK.
  assert.throws(() => sqlite.exec(`
    INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type)
    VALUES ('rule_missing_group', '${store.id}', '${category.id}', 'Jenis Beban', 'DEBIT', 'choice_group')
  `));

  // Invalid: fixed_account_id set together with choice_group_id must be rejected.
  assert.throws(() => sqlite.exec(`
    INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, choice_group_id, fixed_account_id)
    VALUES ('rule_both', '${store.id}', '${category.id}', 'Jenis Beban', 'DEBIT', 'choice_group', 'grp_test', '${account.id}')
  `));
});

test('accounting_choice_options rejects an option whose account belongs to a different store', () => {
  const sqlite = migratedDb();
  const stores = sqlite.prepare(`SELECT id FROM stores ORDER BY id`).all();
  assert.ok(stores.length >= 2, 'fixture needs at least two stores to prove the cross-store guard');
  const [storeA, storeB] = stores;
  const foreignAccount = sqlite.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = ? LIMIT 1`).get(storeB.id);

  sqlite.exec(`INSERT INTO accounting_choice_groups (id, store_id, code, name) VALUES ('grp_cross', '${storeA.id}', 'JENIS_BEBAN', 'Jenis Beban')`);

  assert.throws(() => sqlite.exec(`
    INSERT INTO accounting_choice_options (id, choice_group_id, store_id, code, name, account_id)
    VALUES ('opt_cross', 'grp_cross', '${storeA.id}', 'LISTRIK', 'Listrik', '${foreignAccount.id}')
  `), /CHOICE_OPTION_SCOPE_MISMATCH/);
});

test('accounting_choice_options allows at most one active default per group', () => {
  const sqlite = migratedDb();
  const store = sqlite.prepare(`SELECT id FROM stores LIMIT 1`).get();
  const accounts = sqlite.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = ? LIMIT 2`).all(store.id);
  assert.ok(accounts.length >= 2);

  sqlite.exec(`INSERT INTO accounting_choice_groups (id, store_id, code, name) VALUES ('grp_default', '${store.id}', 'JENIS_BEBAN', 'Jenis Beban')`);
  sqlite.exec(`
    INSERT INTO accounting_choice_options (id, choice_group_id, store_id, code, name, account_id, is_default)
    VALUES ('opt_a', 'grp_default', '${store.id}', 'A', 'A', '${accounts[0].id}', 1)
  `);
  assert.throws(() => sqlite.exec(`
    INSERT INTO accounting_choice_options (id, choice_group_id, store_id, code, name, account_id, is_default)
    VALUES ('opt_b', 'grp_default', '${store.id}', 'B', 'B', '${accounts[1].id}', 1)
  `));
});

test('migration 0043 makes accounting_choice_options.account_id nullable, per ADR-033 §8 and Bos Cyo\'s 2026-08-20 clarification', () => {
  const sqlite = migratedDb();
  const info = sqlite.prepare(`PRAGMA table_info(accounting_choice_options)`).all();
  const accountIdColumn = info.find(c => c.name === 'account_id');
  assert.equal(accountIdColumn.notnull, 0);

  const store = sqlite.prepare(`SELECT id FROM stores LIMIT 1`).get();
  sqlite.exec(`INSERT INTO accounting_choice_groups (id, store_id, code, name) VALUES ('grp_noacc', '${store.id}', 'NOACC_GROUP', 'No Account Group')`);

  assert.doesNotThrow(() => sqlite.exec(`
    INSERT INTO accounting_choice_options (id, choice_group_id, store_id, code, name)
    VALUES ('opt_noacc', 'grp_noacc', '${store.id}', 'GENERIC', 'Generic option, no account yet')
  `));

  const row = sqlite.prepare(`SELECT account_id FROM accounting_choice_options WHERE id = 'opt_noacc'`).get();
  assert.equal(row.account_id, null);
});

test('migration 0043 does not add, remove, or change any existing accounting_choice_options row, and preserves its indexes/triggers', () => {
  const before = migratedDb();
  const beforeRows = JSON.stringify(
    before.prepare(`SELECT id, choice_group_id, store_id, code, name, account_id, is_default, sort_order, is_active FROM accounting_choice_options ORDER BY id`).all()
  );

  const withoutFix = new DatabaseSync(':memory:');
  withoutFix.exec('PRAGMA foreign_keys = ON;');
  for (const file of migrations()) {
    if (file === '0043_choice_option_account_optional.sql') continue;
    withoutFix.exec(read(file));
  }
  const beforeRowsPre0043 = JSON.stringify(
    withoutFix.prepare(`SELECT id, choice_group_id, store_id, code, name, account_id, is_default, sort_order, is_active FROM accounting_choice_options ORDER BY id`).all()
  );
  assert.equal(beforeRows, beforeRowsPre0043);

  const objects = schemaObjects(before, 'accounting_choice_options').map(row => `${row.type}:${row.name}`);
  assert.ok(objects.includes('index:idx_choice_options_group_order'));
  assert.ok(objects.includes('index:idx_choice_options_one_default'));
  assert.ok(objects.includes('trigger:trg_choice_option_scope_insert'));
  assert.ok(objects.includes('trigger:trg_choice_option_scope_update'));
});

test('accounting_choice_options scope guard only checks the account when one is present (NULL account_id is not mistaken for a scope violation)', () => {
  const sqlite = migratedDb();
  const store = sqlite.prepare(`SELECT id FROM stores LIMIT 1`).get();
  sqlite.exec(`INSERT INTO accounting_choice_groups (id, store_id, code, name) VALUES ('grp_guard', '${store.id}', 'GUARD_GROUP', 'Guard Group')`);
  sqlite.exec(`INSERT INTO accounting_choice_options (id, choice_group_id, store_id, code, name) VALUES ('opt_guard', 'grp_guard', '${store.id}', 'A', 'A')`);

  // A real cross-store account must still be rejected once one is provided.
  const stores = sqlite.prepare(`SELECT id FROM stores ORDER BY id`).all();
  const foreignAccount = sqlite.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = ? LIMIT 1`).get(stores[1].id);
  assert.throws(() => sqlite.exec(`
    UPDATE accounting_choice_options SET account_id = '${foreignAccount.id}' WHERE id = 'opt_guard'
  `), /CHOICE_OPTION_SCOPE_MISMATCH/);
});

test('accounting_journal_lines gains choice_group_code/choice_option_code, default empty string, existing rows unaffected', () => {
  const sqlite = migratedDb();
  const info = sqlite.prepare(`PRAGMA table_info(accounting_journal_lines)`).all().map(c => c.name);
  assert.ok(info.includes('choice_group_code'));
  assert.ok(info.includes('choice_option_code'));
});
