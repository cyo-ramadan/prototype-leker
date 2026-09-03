import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('owner sits above branches and branch workspace owns masters', async () => {
  const [indexSource, ownerHtml, branchHtml, ownerSource] = await Promise.all([
    read('src/index.js'),
    read('public/owner.html'),
    read('public/branch-admin.html'),
    read('src/owner-auth.js')
  ]);
  assert.match(indexSource, /'\/admin': '\/owner\.html'/);
  assert.match(indexSource, /page === 'admin'.*branch-admin\.html/s);
  assert.match(ownerHtml, /Login Owner/);
  assert.match(ownerHtml, /CREATE GERAI/);
  assert.match(ownerHtml, /Gerai berada di atas seluruh master dan transaksi/);
  assert.match(branchHtml, /Master barang/);
  assert.match(branchHtml, /Master supplier/);
  assert.doesNotMatch(branchHtml, /data-tab="branches"/);
  assert.match(ownerSource, /POST' && pathname === '\/api\/owner\/stores'/);
  assert.doesNotMatch(ownerSource, /INSERT INTO products/);
});

test('drawer and transaction schema are isolated by store', async () => {
  const migration = await read('migrations/0006_owner_branch_drawer_transactions.sql');
  for (const table of ['suppliers', 'cash_drawer_sessions', 'sales', 'sale_items', 'purchases', 'expenses', 'other_income']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /idx_cash_drawer_one_open_per_store/);
  assert.match(migration, /WHERE status = 'OPEN'/);
  assert.match(migration, /store_id TEXT NOT NULL/g);
  assert.match(migration, /owner_accounts/);
  assert.match(migration, /'owner'/);
});

test('only drawer owner can perform cashier writes', async () => {
  const [drawerSource, indexSource] = await Promise.all([
    read('src/cashier-drawer.js'),
    read('src/index.js')
  ]);
  assert.match(drawerSource, /DRAWER_OWNED_BY_OTHER/);
  assert.match(drawerSource, /drawer\.cashierId !== cashier\.id/);
  assert.match(drawerSource, /\/api\/cashier\/sales/);
  assert.match(drawerSource, /\/api\/cashier\/purchases/);
  assert.match(drawerSource, /\/api\/cashier\/expenses/);
  assert.match(drawerSource, /\/api\/cashier\/other-income/);
  assert.match(indexSource, /requireDrawerOwner\(env\.DB, auth\.cashier\)/);
});

test('cashier page has product menu, draft, and drawer controls', async () => {
  const [html, js, enhancement] = await Promise.all([
    read('public/cashier.html'),
    read('public/cashier.js'),
    read('public/cashier-enhancements.js')
  ]);
  assert.match(html, /Pilih Menu/);
  assert.match(html, /Draft Menu/);
  assert.match(html, /Buka Laci/);
  assert.match(html, /Beli Bahan/);
  assert.match(html, /Pengeluaran/);
  assert.match(html, /Pendapatan Lain/);
  assert.match(html, /📊 Data/);
  assert.match(enhancement, /Detail Laci/);
  assert.match(js, /\/api\/cashier\/menu/);
  assert.match(js, /\/api\/cashier\/drawer\/open/);
  assert.match(js, /PROSES PENJUALAN|processSale/);
});

test('cashier and supplier masters are scoped to the selected branch', async () => {
  const [cashierApi, supplierApi, cashierUi] = await Promise.all([
    read('src/cashier-auth.js'),
    read('src/suppliers.js'),
    read('public/admin-cashiers.js')
  ]);
  assert.match(cashierApi, /WHERE c\.store_id = \?/);
  assert.match(cashierApi, /VALUES \(\?, \?, \?, \?, \?, 1/);
  assert.match(supplierApi, /WHERE store_id = \?/);
  assert.match(supplierApi, /store\.id/);
  assert.doesNotMatch(cashierUi, /id="cashierStore"/);
});
