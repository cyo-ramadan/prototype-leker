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
  assert.match(db, /WHERE p\.store_id = \?[\s\S]*?p\.is_active = 1[\s\S]*?COALESCE\(t\.can_sell, 1\) = 1/);
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

test('an Admin entry point without /s/:code resolves the gerai from its own session, not the default', async () => {
  // Production report 2026-08-29: an Admin Gerai reaching /branch-admin directly
  // (bookmark/history, no /s/:code in the URL) landed on the default gerai and
  // was bounced to that gerai's customer page. Nothing in the URL says which
  // gerai the session belongs to; the login already recorded it, so the page
  // must read it instead of falling through to the default.
  const browser = await readFile(browserUrl, 'utf8');
  const guard = await readFile(new URL('../public/staff-entry-guard.js', import.meta.url), 'utf8');
  const branchAdmin = await readFile(new URL('../public/branch-admin.html', import.meta.url), 'utf8');

  assert.match(browser, /sessionStorage\.getItem\('lekerAdminStoreCode'\)/);
  assert.ok(
    browser.includes("pathStore || adminSessionStore ||"),
    'the session gerai must be consulted before any remembered/default fallback'
  );

  // Both scripts must key off the page's own declaration rather than guessing
  // from the URL shape, and the declaration has to land before either runs.
  assert.match(guard, /window\.LEKER_PAGE_CONTEXT === 'admin'/);
  assert.match(browser, /window\.LEKER_PAGE_CONTEXT === 'admin'/);
  const contextAt = branchAdmin.indexOf("window.LEKER_PAGE_CONTEXT = 'admin'");
  const guardAt = branchAdmin.indexOf('staff-entry-guard.js');
  const storeContextAt = branchAdmin.indexOf('store-context.js');
  assert.ok(contextAt > -1 && guardAt > -1 && storeContextAt > -1);
  assert.ok(contextAt < guardAt, 'page context must be declared before the entry guard runs');
  assert.ok(contextAt < storeContextAt, 'page context must be declared before store-context runs');
});

test('order number carries store code', () => {
  assert.equal(buildOrderNo('MLG01', 7), 'MLG01-007');
});
