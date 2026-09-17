import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// ADR-043: UI di public/admin-product-policy.js (bukan admin-master-menu.js
// atau admin.js -- itu dua file lain, admin.js adalah PIN-legacy single-store
// yang tidak dipakai jalur multi-store, admin-master-menu.js cuma dropdown
// menu tab). Source-level checks (pola sama seperti
// test/cashier-readonly-management-view.test.js) memastikan elemen kunci
// tetap ada, bukan menguji rendering DOM sungguhan.

test('product form gains an optional Kode Barang field, locked once a product already has one', async () => {
  const source = await read('public/admin-product-policy.js');
  assert.match(source, /id="productCode"/);
  assert.match(source, /id="productMasterName"/);
  assert.match(source, /product\?\.productMasterId/);
  assert.match(source, /codeInput\.readOnly = true/);
});

test('saveProductMaster only sends productCode when the field is still editable (product not yet coded)', async () => {
  const source = await read('public/admin-product-policy.js');
  assert.match(source, /if \(!el\('productCode'\)\?\.readOnly && el\('productCode'\)\?\.value\.trim\(\)\)/);
  assert.match(source, /payload\.productCode = el\('productCode'\)\.value\.trim\(\)/);
});

test('a Katalog Kode Barang Entity panel is mounted with an activate action and a recipe-reference editor', async () => {
  const source = await read('public/admin-product-policy.js');
  assert.match(source, /Katalog Kode Barang Entity/);
  assert.match(source, /api\('\/api\/admin\/product-masters'\)/);
  assert.match(source, /data-open-activate/);
  assert.match(source, /\/activate`/);
  assert.match(source, /data-save-recipe-editor/);
  assert.match(source, /\/recipe-components`/);
});

test('activation never blocks on missing local ingredients -- the UI never calls anything ingredient-related before activating', async () => {
  const source = await read('public/admin-product-policy.js');
  const activateFn = source.slice(source.indexOf('async function activateCatalogEntry'), source.indexOf('function parseRecipeEditorText'));
  assert.doesNotMatch(activateFn, /ingredient/i, 'activation payload must only carry name/category/price -- resep tetap best-effort, tidak pernah jadi syarat aktivasi');
});
