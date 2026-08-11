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

test('main customer page uses one login form without role selection and keeps guest checkout', async () => {
  const [html, login] = await Promise.all([
    read('public/customer.html'),
    read('public/customer-login.js')
  ]);
  assert.match(html, /customer-login\.css/);
  assert.match(html, /customer-login\.js/);
  assert.match(html, /Bisa beli tanpa login/);
  assert.doesNotMatch(login, /data-entry-role=/);
  assert.doesNotMatch(login, /setRole\(/);
  assert.match(login, /\/api\/auth\/login/);
  assert.match(login, /payload\.role === 'OWNER'/);
  assert.match(login, /payload\.role === 'CASHIER'/);
  assert.match(login, /payload\.role !== 'CUSTOMER'/);
  assert.match(login, /lekerOwnerToken/);
  assert.match(login, /lekerCashierToken/);
  assert.match(login, /lekerCustomerToken:/);
  assert.match(login, /Customer ID:/);
  assert.match(login, /Lanjut beli tanpa login/);
});

test('unified login resolves role server side and shared customer scope server side', async () => {
  const [index, unified] = await Promise.all([
    read('src/index.js'),
    read('src/unified-login.js')
  ]);
  assert.match(index, /handleUnifiedLoginApi/);
  assert.match(index, /unifiedLoginResponse/);
  assert.match(unified, /pathname !== '\/api\/auth\/login'/);
  assert.match(unified, /FROM owner_accounts/);
  assert.match(unified, /FROM cashiers c/);
  assert.match(unified, /FROM customers c/);
  assert.match(unified, /role: 'OWNER'/);
  assert.match(unified, /role: 'CASHIER'/);
  assert.match(unified, /role: 'CUSTOMER'/);
  assert.match(unified, /AMBIGUOUS_LOGIN/);
  assert.match(unified, /resolveCustomerScope\(env\.DB, selectedStore\.id\)/);
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
});
