import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('customer store selection persists the intended gerai before navigation', async () => {
  const source = await read('public/customer-store-select.js');
  const persistIndex = source.indexOf("localStorage.setItem('lekerCustomerStoreCode', code)");
  const navigateIndex = source.indexOf('location.href = `/s/${encodeURIComponent(code)}/customer`');

  assert.notEqual(persistIndex, -1, 'selected customer store must be persisted');
  assert.notEqual(navigateIndex, -1, 'store picker must navigate to scoped customer path');
  assert.ok(persistIndex < navigateIndex, 'store selection must be persisted before navigation starts');
  assert.match(source, /normalizeStoreCode\(select\.value\)/);
});

test('customer shell cache-busts the store selector routing fix', async () => {
  const html = await read('public/customer.html');
  assert.match(html, /customer-store-select\.js\?v=20260907-customer-store-routing-v1/);
});

test('store context keeps path store authoritative and remembered store as fallback', async () => {
  const source = await read('public/store-context.js');
  assert.match(source, /const selected = pathStore \|\| adminSessionStore \|\| localStorage\.getItem\(rememberedKey\) \|\| 'G001'/);
  assert.match(source, /if \(pathStore\)[\s\S]*localStorage\.setItem\(rememberedKey, pathStore\)/);
});

test('Dermo QR entry pins Dermo before opening the scoped customer menu', async () => {
  const html = await read('public/dermo.html');
  const persistIndex = html.indexOf("localStorage.setItem('lekerCustomerStoreCode', 'DERMO')");
  const navigateIndex = html.indexOf('location.replace(destination)');
  const destination = '/s/DERMO/customer?storeLock=DERMO&source=qr-dermo';

  assert.match(html, /MAXI Leker Dermo/);
  assert.ok(html.includes(destination), 'Dermo entry must target the scoped Dermo customer menu');
  assert.notEqual(persistIndex, -1, 'Dermo entry must remember the Dermo store');
  assert.notEqual(navigateIndex, -1, 'Dermo entry must navigate to the customer menu');
  assert.ok(persistIndex < navigateIndex, 'Dermo store must be persisted before navigation starts');
});

test('customer store picker stays hidden only when the requested lock matches the active store', async () => {
  const source = await read('public/customer-store-select.js');
  const lockReadIndex = source.indexOf("new URLSearchParams(location.search).get('storeLock')");
  const lockGuardIndex = source.indexOf('if (requestedLock && requestedLock === current)');
  const pickerStyleIndex = source.indexOf("const style = document.createElement('style')");

  assert.notEqual(lockReadIndex, -1, 'store lock must be read from the entry URL');
  assert.notEqual(lockGuardIndex, -1, 'store lock must match the active store before suppressing the picker');
  assert.notEqual(pickerStyleIndex, -1, 'normal customer pages must still build the store picker');
  assert.ok(lockReadIndex < lockGuardIndex && lockGuardIndex < pickerStyleIndex, 'lock check must happen before store picker UI is created');
  assert.match(source, /document\.documentElement\.dataset\.customerStoreLocked = current/);
});
