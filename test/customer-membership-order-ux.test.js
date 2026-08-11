import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('G002 demo menu is no longer an identical G001 clone while preserving edited rows', async () => {
  const sql = await read('migrations/0010_customer_registration_points_order_ux.sql');
  assert.match(sql, /source\.name = products\.name/);
  assert.match(sql, /source\.price = products\.price/);
  assert.match(sql, /Leker Dubai Crunch/);
  assert.match(sql, /Leker Matcha Cheese/);
  assert.match(sql, /Signature G002/);
  assert.match(sql, /store_002/);
});

test('customer registration stays pending until branch admin approval', async () => {
  const [sql, membership, adminUi] = await Promise.all([
    read('migrations/0010_customer_registration_points_order_ux.sql'),
    read('src/customer-membership.js'),
    read('public/admin-customers.js')
  ]);
  assert.match(sql, /customer_registration_requests/);
  assert.match(sql, /'PENDING', 'APPROVED', 'REJECTED'/);
  assert.match(membership, /\/api\/customer\/register/);
  assert.match(membership, /status = 'PENDING'/);
  assert.match(membership, /action === 'REJECT'/);
  assert.match(membership, /action !== 'APPROVE'/);
  assert.match(membership, /INSERT INTO customers/);
  assert.match(adminUi, /Request jadi pelanggan/);
  assert.match(adminUi, /data-approve-customer-request/);
  assert.match(adminUi, /data-reject-customer-request/);
});

test('logged customer gets point balance and customer order history APIs', async () => {
  const membership = await read('src/customer-membership.js');
  assert.match(membership, /\/api\/customer\/points/);
  assert.match(membership, /COALESCE\(SUM\(points_delta\), 0\)/);
  assert.match(membership, /\/api\/customer\/orders/);
  assert.match(membership, /o\.customer_id = \?/);
  assert.match(membership, /o\.store_id IN/);
});

test('customer UI offers registration, shows zero-capable points and order status button', async () => {
  const [html, loginCss, loginJs] = await Promise.all([
    read('public/customer.html'),
    read('public/customer-login.css'),
    read('public/customer-login.js')
  ]);
  assert.doesNotMatch(html, /Kode kiosk \/ perangkat/);
  assert.match(html, /id="tableLabel" type="hidden"/);
  assert.match(loginJs, /Daftar jadi pelanggan/);
  assert.match(loginJs, /PENDING/);
  assert.match(loginJs, /Poin:/);
  assert.match(loginJs, /Number\(points \|\| 0\)/);
  assert.match(loginJs, /Pesanan Saya/);
  assert.match(loginJs, /\/api\/customer\/orders/);
  assert.match(loginJs, /customerName.*readOnly = true/s);
  assert.match(loginCss, /customer-name-locked/);
});

test('logged customer name is derived server side and kiosk label is retired from new order logic', async () => {
  const [index, orders, cashierCleanup] = await Promise.all([
    read('src/index.js'),
    read('src/orders-multistore.js'),
    read('public/cashier-order-cleanup.js')
  ]);
  assert.match(index, /customerName: customer\?\.customerName \|\| body\.value\?\.customerName/);
  assert.match(index, /customerId: customer\?\.id \|\| null/);
  assert.match(orders, /tableLabel: ''/);
  assert.doesNotMatch(orders, /payload\?\.tableLabel/);
  assert.match(cashierCleanup, /customer-meta/);
  assert.match(cashierCleanup, /split\(' · '\)/);
});
