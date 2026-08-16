import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ACCOUNTING_ACCOUNT_TYPES,
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

test('runtime source tree does not reference reconciled orphan Accounting tables', () => {
  const references = collectReferences();
  console.log(`ACCOUNTING_ORPHAN_SCHEMA_AUDIT=${JSON.stringify(references)}`);
  const activeReferences = references.filter(reference => reference.classification === 'ACTIVE_CODE_PATH');
  assert.deepEqual(activeReferences, [], `active orphan-schema references detected: ${JSON.stringify(activeReferences)}`);
});

test('fresh schema keeps chart_of_accounts as the sole five-type Chart-of-Accounts table', () => {
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
    assert.deepEqual(typedAccountTables, ['chart_of_accounts']);

    const journalLineForeignKeys = sqlite.prepare(`PRAGMA foreign_key_list(accounting_journal_lines)`).all();
    assert.equal(journalLineForeignKeys.some(row => row.table === 'chart_of_accounts'), true);
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

test('remote schema verifier rejects orphan or parallel Chart-of-Accounts tables', () => {
  const canonicalSql = `CREATE TABLE chart_of_accounts (type TEXT CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')))`;
  assert.deepEqual(accountingSchemaViolations([{ results: [{ name: 'chart_of_accounts', sql: canonicalSql }] }]), {
    forbiddenTables: [],
    parallelAccountTables: []
  });

  const rogueSql = `CREATE TABLE shadow_accounts (account_type TEXT CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')))`;
  const violations = accountingSchemaViolations([{ results: [
    { name: 'chart_of_accounts', sql: canonicalSql },
    { name: 'accounting_accounts', sql: 'CREATE TABLE accounting_accounts (id TEXT)' },
    { name: 'shadow_accounts', sql: rogueSql }
  ] }]);
  assert.deepEqual(violations.forbiddenTables, ['accounting_accounts']);
  assert.deepEqual(violations.parallelAccountTables, ['shadow_accounts']);
});
