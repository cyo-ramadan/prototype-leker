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
