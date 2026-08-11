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

test('customer login and customer master are isolated to selected branch', async () => {
  const customers = await read('src/customers.js');
  assert.match(customers, /WHERE c\.store_id = \? AND c\.username = \? COLLATE NOCASE/);
  assert.match(customers, /requireManagement\(request, db\)/);
  assert.match(customers, /WHERE store_id = \?/);
  assert.match(customers, /customerCode/);
  assert.match(customers, /customer_sessions/);
  assert.match(customers, /Username atau password pelanggan salah untuk gerai ini/);
});

test('main customer page exposes unified login while guest checkout stays visible', async () => {
  const [html, login] = await Promise.all([
    read('public/customer.html'),
    read('public/customer-login.js')
  ]);
  assert.match(html, /customer-login\.css/);
  assert.match(html, /customer-login\.js/);
  assert.match(html, /Bisa beli tanpa login/);
  assert.match(login, /data-entry-role="customer"/);
  assert.match(login, /data-entry-role="cashier"/);
  assert.match(login, /data-entry-role="owner"/);
  assert.match(login, /lekerOwnerToken/);
  assert.match(login, /lekerCashierToken/);
  assert.match(login, /lekerCustomerToken:/);
  assert.match(login, /Customer ID:/);
  assert.match(login, /Lanjut beli tanpa login/);
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

test('branch workspace promotes Pelanggan master without exposing branch creation as a master', async () => {
  const [html, ui] = await Promise.all([
    read('public/branch-admin.html'),
    read('public/admin-customers.js')
  ]);
  assert.match(html, /admin-customers\.js/);
  assert.match(ui, /Master pelanggan/);
  assert.match(ui, /Tambah pelanggan/);
  assert.match(ui, /\/api\/admin\/customers/);
  assert.match(ui, /legacyTab\.hidden = true/);
  assert.doesNotMatch(html, /Tambah gerai/);
});
