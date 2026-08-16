import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const repositoryRoot = resolve(new URL('..', import.meta.url).pathname);
const auditFile = 'test/accounting-orphan-schema-audit.test.js';
const orphanTableNames = [
  'accounting_accounts',
  'accounting_dimensions',
  'accounting_opening_balances',
  'accounting_transaction_mappings'
];
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

test('audit orphan Accounting schema references before reconciliation', () => {
  const references = collectReferences();
  console.log(`ACCOUNTING_ORPHAN_SCHEMA_AUDIT=${JSON.stringify(references)}`);
  const activeReferences = references.filter(reference => reference.classification === 'ACTIVE_CODE_PATH');
  assert.deepEqual(activeReferences, [], `active orphan-schema references detected: ${JSON.stringify(activeReferences)}`);
});
