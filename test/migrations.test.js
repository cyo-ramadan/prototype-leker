import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';

test('all migrations apply in order and new-store integration defaults are recoverable', async () => {
  const migrationsUrl = new URL('../migrations/', import.meta.url);
  const names = (await readdir(migrationsUrl)).filter(name => name.endsWith('.sql')).sort();
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of names) db.exec(await readFile(new URL(name, migrationsUrl), 'utf8'));
  assert.equal(names.at(-1), '0012_pos_integration_foundation.sql');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_integration_settings').get().n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounting_accounts').get().n, 22);

  db.prepare(`INSERT INTO stores (id, code, store_name, address, logo_data, is_active) VALUES ('store_test', 'T001', 'Test', '', '', 1)`).run();
  assert.equal(db.prepare(`SELECT terminal_id FROM pos_integration_settings WHERE store_id = 'store_test'`).get().terminal_id, 'terminal_store_test');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM pos_terminals WHERE store_id = 'store_test'`).get().n, 1);
  db.close();
});
