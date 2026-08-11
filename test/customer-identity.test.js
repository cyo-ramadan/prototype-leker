import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('customer identity migration is store scoped and preserves guest orders', async () => {
  const sql = await read('migrations/0007_customer_identity_unified_entry.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS customers/);
  assert.match(sql, /store_id TEXT NOT NULL/);
  assert.match(sql, /UNIQUE \(store_id, customer_code\)/);
  assert.match(sql, /UNIQUE \(store_id, username\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS customer_sessions/);
  assert.match(sql, /FROM contacts c/);
  assert.match(sql, /ALTER TABLE orders ADD COLUMN customer_id TEXT/);
});

test('customer login and customer master use explicit owner sharing scope', async () => {
  const [customers, sharing] = await Promise.all([
    read('src/customers.js'),
    read('src/customer-sharing.js')
  ]);
  assert.match(customers, /resolveCustomerScope\(db, store\.id\)/);
  assert.match(customers, /c\.store_id IN \(\$\{placeholders\(scopedIds\.length\)\}\)/);
  assert.match(customers, /requireManagement\(request, db\)/);
  assert.match(customers, /customerCode/);
  assert.match(customers, /customer_sessions/);
  assert.match(sharing, /customer_share_group_stores/);
  assert.match(sharing, /username_key/);
  assert.match(sharing, /bentrok antar gerai/);
});

test('main customer page exposes Pelanggan and Karyawan login tabs while keeping guest checkout', async () => {
  const [html, split] = await Promise.all([
    read('public/customer.html'),
    read('public/auth-entry-split.js')
  ]);
  assert.match(html, /customer-login\.css/);
  assert.match(html, /auth-entry-split\.css/);
  assert.match(html, /customer-login\.js[\s\S]*auth-entry-split\.js/);
  assert.match(html, /Bisa beli tanpa login/);
  assert.match(split, />Pelanggan<\/button>/);
  assert.match(split, />Karyawan<\/button>/);
  assert.match(split, /\/api\/auth\/customer-login/);
  assert.match(split, /\/api\/auth\/staff-login/);
  assert.match(split, /lekerOwnerToken/);
  assert.match(split, /lekerAdminToken/);
  assert.match(split, /lekerAdminStoreCode/);
  assert.match(split, /lekerCashierToken/);
  assert.match(split, /lekerCustomerToken:/);
});

test('separated login resolves staff rank and customer sharing scope server side', async () => {
  const [index, unified] = await Promise.all([
    read('src/index.js'),
    read('src/unified-login.js')
  ]);
  assert.match(index, /handleUnifiedLoginApi/);
  assert.match(index, /unifiedLoginResponse/);
  assert.match(unified, /\/api\/auth\/customer-login/);
  assert.match(unified, /\/api\/auth\/staff-login/);
  assert.match(unified, /FROM owner_accounts/);
  assert.match(unified, /FROM store_admins a/);
  assert.match(unified, /FROM cashiers c/);
  assert.match(unified, /FROM customers c/);
  assert.match(unified, /AMBIGUOUS_STAFF_LOGIN/);
  assert.match(unified, /resolveCustomerScope\(db, selectedStore\.id\)/);
});

test('logged customer identity is derived server side when order is created', async () => {
  const [index, orders, db] = await Promise.all([
    read('src/index.js'),
    read('src/orders-multistore.js'),
    read('src/db-multistore.js')
  ]);
  assert.match(index, /optionalCustomerFromRequest\(request, env\.DB, store\.id\)/);
  assert.match(index, /customerId: customer\?\.id \|\| null/);
  assert.match(orders, /customerId: sanitizeText\(payload\?\.customerId/);
  assert.match(db, /customer_id/);
  assert.match(db, /order\.customerId \|\| null/);
});

test('branch workspace keeps Pelanggan separate from staff access and shows sharing status', async () => {
  const [html, ui] = await Promise.all([
    read('public/branch-admin.html'),
    read('public/admin-customers.js')
  ]);
  assert.match(html, /admin-customers\.js/);
  assert.match(ui, /Master pelanggan/);
  assert.match(ui, /Tambah pelanggan/);
  assert.match(ui, /\/api\/admin\/customers/);
  assert.match(ui, /Berbagi Pelanggan/);
  assert.match(ui, /Asal/);
  assert.match(ui, /legacyTab\.hidden = true/);
  assert.doesNotMatch(html, /Tambah gerai/);
  assert.doesNotMatch(ui, /owner_accounts/);
  assert.doesNotMatch(ui, /cashier_sessions/);
  assert.doesNotMatch(ui, /store_admin_sessions/);
});
