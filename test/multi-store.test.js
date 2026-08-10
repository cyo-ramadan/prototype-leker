import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildOrderNo } from '../src/orders-multistore.js';

const migrationUrl = new URL('../migrations/0004_multi_store.sql', import.meta.url);
const indexUrl = new URL('../src/index.js', import.meta.url);
const dbUrl = new URL('../src/db-multistore.js', import.meta.url);
const adminUrl = new URL('../src/admin-multistore.js', import.meta.url);
const ownerUrl = new URL('../src/owner-auth.js', import.meta.url);
const browserUrl = new URL('../public/store-context.js', import.meta.url);

test('multi-store migration isolates all operational master and order tables', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS stores/);
  for (const table of ['products', 'categories', 'contacts', 'orders', 'order_items', 'order_status_history']) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?store_id TEXT NOT NULL`));
  }
  assert.match(sql, /UNIQUE \(store_id, name\)/);
  assert.match(sql, /UNIQUE \(store_id, business_date, order_no\)/);
  assert.match(sql, /SELECT id, 'store_001'/);
});

test('runtime resolves store context server-side before public data access', async () => {
  const [index, db] = await Promise.all([readFile(indexUrl, 'utf8'), readFile(dbUrl, 'utf8')]);
  assert.match(index, /resolveStore/);
  assert.match(index, /storeTokenFromUrl/);
  assert.match(index, /\/s\\\/\(\[\^\/\]\+\)/);
  assert.match(db, /WHERE store_id = \? AND is_active = 1/);
  assert.match(db, /WHERE store_id = \?\n    ORDER BY created_at DESC/);
  assert.match(db, /WHERE store_id = \? AND id = \?/);
});

test('Owner creates stores while branch masters remain store scoped', async () => {
  const [admin, owner] = await Promise.all([readFile(adminUrl, 'utf8'), readFile(ownerUrl, 'utf8')]);
  assert.match(owner, /POST' && pathname === '\/api\/owner\/stores'/);
  assert.doesNotMatch(owner, /INSERT INTO products/);
  assert.match(admin, /WHERE store_id = \? AND name = \?/);
  assert.match(admin, /WHERE id = \? AND store_id = \?/);
  assert.match(admin, /INSERT INTO contacts \(id, store_id/);
  assert.match(admin, /INSERT INTO products \(id, store_id/);
});

test('browser route scopes API and active-order storage by store', async () => {
  const browser = await readFile(browserUrl, 'utf8');
  assert.match(browser, /url\.searchParams\.set\('store'/);
  assert.match(browser, /lekerActiveOrderId/);
  assert.match(browser, /window\.lekerStorePath/);
});

test('order number carries store code', () => {
  assert.equal(buildOrderNo('MLG01', 7), 'MLG01-007');
});
