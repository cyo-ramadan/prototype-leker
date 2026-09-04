import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('cashier migration seeds two cashiers in different stores', async () => {
  const migration = await read('migrations/0005_cashier_auth.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS cashiers/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS cashier_sessions/);
  assert.match(migration, /'wowo'.*'store_001'/s);
  assert.match(migration, /'wiwi'.*'store_002'/s);
  assert.match(migration, /'G002'/);
});

test('cashier API derives store from authenticated session and drawer gates writes', async () => {
  const index = await read('src/index.js');
  const auth = await read('src/cashier-auth.js');
  assert.match(index, /requireCashier\(request, env\.DB\)/);
  assert.match(index, /auth\.cashier\.store\.id/);
  assert.match(index, /\/api\/cashier\/orders/);
  assert.match(index, /requireDrawerOwner\(env\.DB, auth\.cashier\)/);
  assert.match(auth, /JOIN cashiers c ON c\.id = cs\.cashier_id/);
  assert.match(auth, /JOIN stores s ON s\.id = c\.store_id/);
});

test('cashier master lives inside branch workspace and customer keeps store selector', async () => {
  const branchHtml = await read('public/branch-admin.html');
  const adminCashiers = await read('public/admin-cashiers.js');
  const customerHtml = await read('public/customer.html');
  const customerStores = await read('public/customer-store-select.js');
  assert.match(branchHtml, /admin-cashiers\.js/);
  assert.match(adminCashiers, /Tambah kasir/);
  assert.match(adminCashiers, /Nama karyawan/);
  assert.match(adminCashiers, /otomatis terikat ke gerai workspace/i);
  assert.doesNotMatch(adminCashiers, /id="cashierStore"/);
  assert.match(customerHtml, /customer-store-select\.js/);
  assert.match(customerStores, /Pilih gerai/);
  assert.match(customerStores, /\/s\/\$\{encodeURIComponent\(code\)\}\/customer/);
});

test('cashier browser uses bearer token authenticated queue and drawer endpoints', async () => {
  const html = await read('public/cashier.html');
  const js = await read('public/cashier.js');
  assert.match(html, /Login Kasir/);
  assert.match(html, /Draft Menu/);
  assert.match(html, /Buka Laci/);
  assert.match(js, /Authorization = `Bearer \$\{state\.token\}`/);
  assert.match(js, /\/api\/cashier\/login/);
  assert.match(js, /\/api\/cashier\/orders/);
  assert.match(js, /\/api\/cashier\/drawer/);
  assert.match(js, /cashier\.store\.code/);
});
