import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ACCOUNTING_ACCOUNT_TYPES,
  ALLOWED_ACCOUNT_REFERENCE_TABLES,
  FORBIDDEN_REMOTE_TABLES,
  accountingSchemaViolations
} from '../scripts/verify-remote-schema.mjs';

const repositoryRoot = resolve(new URL('..', import.meta.url).pathname);
const migrationDirectory = resolve(repositoryRoot, 'migrations');
const auditFile = 'test/accounting-orphan-schema-audit.test.js';
const orphanTableNames = [...FORBIDDEN_REMOTE_TABLES];
const ignoredDirectories = new Set(['.git', 'node_modules']);
const textExtensions = new Set(['.js', '.mjs', '.cjs', '.json', '.sql', '.md', '.html', '.css', '.yml', '.yaml', '.txt']);

function walk(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    if (ignoredDirectories.has(name)) continue;
    const absolutePath = resolve(directory, name);
    const info = statSync(absolutePath);
    if (info.isDirectory()) files.push(...walk(absolutePath));
    else files.push(absolutePath);
  }
  return files;
}

function classify(path) {
  if (path.startsWith('test/')) return 'TEST_FIXTURE';
  if (path.startsWith('migrations/')) return 'MIGRATION';
  if (path === 'scripts/verify-remote-schema.mjs') return 'SCHEMA_GUARD';
  if (path.startsWith('src/') || path.startsWith('public/') || path.startsWith('scripts/')) return 'ACTIVE_CODE_PATH';
  return 'DOCUMENTATION_OR_OTHER';
}

function collectReferences() {
  const references = [];
  for (const absolutePath of walk(repositoryRoot)) {
    const path = relative(repositoryRoot, absolutePath).replaceAll('\\', '/');
    if (path === auditFile || !textExtensions.has(extname(path))) continue;
    const lines = readFileSync(absolutePath, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const tableName of orphanTableNames) {
        if (line.includes(tableName)) {
          references.push({ tableName, path, line: index + 1, classification: classify(path), text: line.trim() });
        }
      }
    });
  }
  return references;
}

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const name of readdirSync(migrationDirectory).filter(file => /^\d{4}_.+\.sql$/.test(file)).sort()) {
    sqlite.exec(readFileSync(resolve(migrationDirectory, name), 'utf8'));
  }
  return sqlite;
}

function schemaRows(sqlite) {
  return sqlite.prepare(`SELECT name, sql FROM sqlite_schema WHERE type = 'table' ORDER BY name`).all();
}

// Mirrors the actual drift found on live D1 on 2026-08-19: a second orphan family from the same
// unmerged PR #3 experiment (pos_tenants/pos_terminals/pos_integration_settings, plus a trigger
// that has been silently populating them on every store insert) that the original migration
// 0037 never knew to clean up. Applying every migration up through 0036, then hand-creating this
// drift exactly as it exists live, is what actually reproduces the CHECK constraint failure that
// broke the real Cloudflare build (SQLITE_CONSTRAINT_CHECK, "ok = 1") -- a fresh database never
// hits it, since these tables never exist there in the first place.
function databaseWithLiveDrift() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  const migrationFiles = readdirSync(migrationDirectory)
    .filter(file => /^\d{4}_.+\.sql$/.test(file) && file < '0037')
    .sort();
  for (const name of migrationFiles) sqlite.exec(readFileSync(resolve(migrationDirectory, name), 'utf8'));

  sqlite.exec(`
    CREATE TABLE pos_tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE pos_terminals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (store_id, code),
      FOREIGN KEY (tenant_id) REFERENCES pos_tenants(id),
      FOREIGN KEY (store_id) REFERENCES stores(id)
    );
    CREATE TABLE accounting_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE pos_integration_settings (
      store_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      terminal_id TEXT NOT NULL DEFAULT '',
      warehouse_id TEXT NOT NULL DEFAULT '',
      retained_earnings_account_id TEXT,
      accounting_module TEXT NOT NULL DEFAULT '@maxi/accounting',
      accounting_version TEXT NOT NULL DEFAULT '1.3.0',
      warehouse_module TEXT NOT NULL DEFAULT '@maxi/warehouse',
      warehouse_version TEXT NOT NULL DEFAULT '2.0.0',
      pos_module TEXT NOT NULL DEFAULT '@maxi/pos-core',
      pos_version TEXT NOT NULL DEFAULT '1.0.0',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (store_id) REFERENCES stores(id),
      FOREIGN KEY (retained_earnings_account_id) REFERENCES accounting_accounts(id)
    );
    CREATE TRIGGER trg_store_integration_defaults
    AFTER INSERT ON stores
    BEGIN
      INSERT OR IGNORE INTO pos_terminals (id, tenant_id, store_id, code, name)
      VALUES ('terminal_' || NEW.id, 'tenant_leker', NEW.id, 'POS-01', 'Terminal Utama');
      INSERT OR IGNORE INTO pos_integration_settings (store_id, tenant_id, terminal_id)
      VALUES (NEW.id, 'tenant_leker', 'terminal_' || NEW.id);
    END;
    INSERT INTO pos_tenants (id, name) VALUES ('tenant_leker', 'Leker');
  `);
  const store = sqlite.prepare(`SELECT id FROM stores LIMIT 1`).get();
  if (store) {
    sqlite.prepare(`INSERT OR IGNORE INTO pos_terminals (id, tenant_id, store_id, code, name)
      VALUES ('terminal_' || ?, 'tenant_leker', ?, 'POS-01', 'Terminal Utama')`).run(store.id, store.id);
    sqlite.prepare(`INSERT OR IGNORE INTO pos_integration_settings (store_id, tenant_id, terminal_id)
      VALUES (?, 'tenant_leker', 'terminal_' || ?)`).run(store.id, store.id);
  }
  return sqlite;
}

test('migration 0037 reconciles the second orphan family (pos_tenants/pos_terminals/pos_integration_settings) found on live D1', () => {
  const sqlite = databaseWithLiveDrift();
  try {
    // Reproduces the exact live failure this migration is fixing: without the fix, this exec
    // throws SQLITE_CONSTRAINT_CHECK ("ok = 1") because the guard correctly refuses to drop
    // accounting_accounts while pos_integration_settings still references it.
    sqlite.exec(readFileSync(resolve(migrationDirectory, '0037_accounting_schema_reconciliation.sql'), 'utf8'));

    const names = new Set(schemaRows(sqlite).map(row => row.name));
    for (const orphan of ['accounting_accounts', 'accounting_dimensions', 'accounting_opening_balances',
      'accounting_transaction_mappings', 'pos_tenants', 'pos_terminals', 'pos_integration_settings']) {
      assert.equal(names.has(orphan), false, `${orphan} must be dropped`);
    }
    assert.equal(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='trigger' AND name='trg_store_integration_defaults'`).get().n,
      0,
      'the trigger that kept repopulating the orphan tables must be dropped too'
    );

    const log = sqlite.prepare(`
      SELECT pos_tenants_rows, pos_terminals_rows, pos_integration_settings_rows
      FROM accounting_schema_reconciliation_log WHERE change_id = 'LEKER-ACC-SCHEMA-RECON-20260817'
    `).get();
    assert.equal(log.pos_tenants_rows, 1);
    assert.equal(log.pos_integration_settings_rows >= 0, true);

    assert.equal(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM accounting_schema_backup_20260817_pos_tenants`).get().n,
      1,
      'the snapshot must preserve the row before drop'
    );
  } finally {
    sqlite.close();
  }
});

test('runtime source tree does not reference reconciled orphan Accounting tables', () => {
  const references = collectReferences();
  console.log(`ACCOUNTING_ORPHAN_SCHEMA_AUDIT=${JSON.stringify(references)}`);
  const activeReferences = references.filter(reference => reference.classification === 'ACTIVE_CODE_PATH');
  assert.deepEqual(activeReferences, [], `active orphan-schema references detected: ${JSON.stringify(activeReferences)}`);
});

test('fresh schema keeps chart_of_accounts as canonical while typed compatibility references stay non-runtime', () => {
  const sqlite = freshDatabase();
  try {
    const rows = schemaRows(sqlite);
    const names = new Set(rows.map(row => row.name));
    assert.equal(names.has('chart_of_accounts'), true);
    for (const tableName of orphanTableNames) assert.equal(names.has(tableName), false, `${tableName} must stay absent`);

    const typedAccountTables = rows
      .filter(row => {
        const sql = String(row.sql || '').toUpperCase();
        return ACCOUNTING_ACCOUNT_TYPES.every(accountType => sql.includes(`'${accountType}'`));
      })
      .map(row => row.name);
    assert.deepEqual(typedAccountTables, ['accounting_account_refs', 'chart_of_accounts']);
    assert.deepEqual(ALLOWED_ACCOUNT_REFERENCE_TABLES, ['accounting_account_refs']);

    const journalLineForeignKeys = sqlite.prepare(`PRAGMA foreign_key_list(accounting_journal_lines)`).all();
    assert.equal(journalLineForeignKeys.some(row => row.table === 'chart_of_accounts'), true);
    assert.equal(journalLineForeignKeys.some(row => row.table === 'accounting_account_refs'), false);
    assert.equal(journalLineForeignKeys.some(row => orphanTableNames.includes(row.table)), false);

    const reconciliation = sqlite.prepare(`
      SELECT canonical_account_table, accounts_rows, dimensions_rows, opening_balances_rows, transaction_mappings_rows
      FROM accounting_schema_reconciliation_log
      WHERE change_id = 'LEKER-ACC-SCHEMA-RECON-20260817'
    `).get();
    assert.equal(reconciliation?.canonical_account_table, 'chart_of_accounts');
    assert.deepEqual(
      [reconciliation?.accounts_rows, reconciliation?.dimensions_rows, reconciliation?.opening_balances_rows, reconciliation?.transaction_mappings_rows],
      [0, 0, 0, 0]
    );
  } finally {
    sqlite.close();
  }
});

test('remote schema verifier allows registered compatibility refs and rejects orphan or parallel COA tables', () => {
  const canonicalSql = `CREATE TABLE chart_of_accounts (type TEXT CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')))`;
  const referenceSql = `CREATE TABLE accounting_account_refs (account_type TEXT CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')), external_account_id TEXT)`;
  assert.deepEqual(accountingSchemaViolations([{ results: [
    { name: 'chart_of_accounts', sql: canonicalSql },
    { name: 'accounting_account_refs', sql: referenceSql }
  ] }]), {
    forbiddenTables: [],
    parallelAccountTables: []
  });

  const rogueSql = `CREATE TABLE shadow_accounts (account_type TEXT CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')))`;
  const violations = accountingSchemaViolations([{ results: [
    { name: 'chart_of_accounts', sql: canonicalSql },
    { name: 'accounting_account_refs', sql: referenceSql },
    { name: 'accounting_accounts', sql: 'CREATE TABLE accounting_accounts (id TEXT)' },
    { name: 'shadow_accounts', sql: rogueSql }
  ] }]);
  assert.deepEqual(violations.forbiddenTables, ['accounting_accounts']);
  assert.deepEqual(violations.parallelAccountTables, ['shadow_accounts']);
});
