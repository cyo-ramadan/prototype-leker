import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('drawer reporting schema separates cash and non-cash and preserves point rule ambiguity', async () => {
  const migration = await read('migrations/0008_branch_admin_drawer_customer_sharing.sql');
  assert.match(migration, /ALTER TABLE sales ADD COLUMN payment_method/);
  assert.match(migration, /ALTER TABLE purchases ADD COLUMN payment_method/);
  assert.match(migration, /ALTER TABLE expenses ADD COLUMN payment_method/);
  assert.match(migration, /shift_label/);
  assert.match(migration, /closing_note/);
  assert.match(migration, /incentive_amount/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS customer_share_groups/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS customer_share_group_stores/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS customer_point_ledger/);
  assert.match(migration, /No earning\/redeem conversion is invented here/);
});

test('branch admin menu contains cashier data accounting report and drawer detail areas', async () => {
  const [html, cashierUi, adminDrawerUi] = await Promise.all([
    read('public/branch-admin.html'),
    read('public/admin-cashiers.js'),
    read('public/admin-drawers.js')
  ]);
  assert.match(html, /Data Barang/);
  assert.match(cashierUi, /Tambah kasir/);
  assert.match(cashierUi, /Master kasir gerai/);
  assert.match(adminDrawerUi, /Akuntansi/);
  assert.match(adminDrawerUi, /Laporan/);
  assert.match(adminDrawerUi, /Detail Laci/);
  assert.match(adminDrawerUi, /\/api\/admin\/drawers/);
  assert.match(adminDrawerUi, /Coming next/);
});

test('drawer report is readable by admin and cashier only inside their store scope', async () => {
  const [adminApi, cashierApi, report] = await Promise.all([
    read('src/admin-drawers.js'),
    read('src/cashier-drawer.js'),
    read('src/drawer-report.js')
  ]);
  assert.match(adminApi, /requireManagement\(request, env\.DB\)/);
  assert.match(adminApi, /buildDrawerReport\(env\.DB, store\.id/);
  assert.match(cashierApi, /listStoreDrawers\(db, cashier\.store\.id\)/);
  assert.match(cashierApi, /buildDrawerReport\(db, cashier\.store\.id/);
  assert.match(report, /WHERE d\.store_id = \? AND d\.id = \?/);
  assert.match(report, /WHERE s\.store_id = \? AND s\.drawer_session_id = \?/);
});

test('drawer detail renderer exposes requested operational sections and responsible cashier', async () => {
  const renderer = await read('public/drawer-report-ui.js');
  for (const marker of [
    'Penanggung jawab',
    '1. PENJUALAN BAYAR TUNAI',
    '2. PROMOSI',
    '3A. BELANJA BAHAN BAYAR TUNAI',
    '4.1 OPERASIONAL KAS',
    '4.2 OPERASIONAL NON KAS',
    '5. MASAK',
    '6. STOK SISA',
    'PERHITUNGAN',
    '1B. PENJUALAN BAYAR NON TUNAI',
    '3B. BELANJA BAHAN BAYAR NON TUNAI',
    'PENYESUAIAN STOK',
    'KAS MASUK'
  ]) assert.match(renderer, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('owner controls customer sharing groups without merging other branch data', async () => {
  const [ownerHtml, ownerJs, sharing, customers] = await Promise.all([
    read('public/owner.html'),
    read('public/owner.js'),
    read('src/customer-sharing.js'),
    read('src/customers.js')
  ]);
  assert.match(ownerHtml, /Berbagi Pelanggan/);
  assert.match(ownerJs, /\/api\/owner\/customer-sharing/);
  assert.match(sharing, /requireOwner\(request, env\.DB\)/);
  assert.match(sharing, /customer_share_group_stores/);
  assert.match(sharing, /Gerai .* sudah tergabung di grup/);
  assert.match(customers, /sharedStores/);
  assert.match(customers, /store\.id/);
});

test('cashier keeps one drawer writer while drawer history remains readable', async () => {
  const [drawerApi, enhancement] = await Promise.all([
    read('src/cashier-drawer.js'),
    read('public/cashier-enhancements.js')
  ]);
  assert.match(drawerApi, /DRAWER_OWNED_BY_OTHER/);
  assert.match(drawerApi, /drawer\.cashierId !== cashier\.id/);
  assert.match(drawerApi, /\/api\/cashier\/drawers/);
  assert.match(enhancement, /Detail Laci/);
  assert.match(enhancement, /paymentMethod/);
  assert.match(enhancement, /dialogShiftLabel/);
  assert.match(enhancement, /dialogClosingNote/);
});
