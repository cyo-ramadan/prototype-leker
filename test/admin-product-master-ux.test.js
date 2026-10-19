import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const masterMenu = readFileSync(new URL('../public/admin-master-menu.js', import.meta.url), 'utf8');

test('Master Barang exposes a client-side search without rebuilding product rows on every keystroke', () => {
  assert.match(masterMenu, /id="productSearch" type="search"/);
  assert.match(masterMenu, /placeholder="Cari nama, kategori, peran barang\.\.\."/);
  assert.match(masterMenu, /querySelectorAll\('\.master-row'\)/);
  assert.match(masterMenu, /row\.hidden = !matches/);
  assert.match(masterMenu, /search\?\.addEventListener\('input', applyProductFilter\)/);
  assert.match(masterMenu, /new MutationObserver\(scheduleFilter\)\.observe\(productList/);
  assert.doesNotMatch(masterMenu, /search\?\.addEventListener\('input',[\s\S]{0,180}innerHTML\s*=/);
});

test('desktop Master Barang keeps editor and product list independently reachable inside the viewport', () => {
  assert.match(masterMenu, /@media \(min-width:901px\)/);
  assert.match(masterMenu, /#tab-products #productForm\{[^}]*max-height:calc\(100dvh - 112px\)[^}]*overflow-y:auto/);
  assert.match(masterMenu, /#tab-products \.list-card\{[^}]*position:sticky[^}]*max-height:calc\(100dvh - 112px\)/);
  assert.match(masterMenu, /#tab-products \.list-card #productList\{[^}]*overflow-y:auto/);
  assert.match(masterMenu, /id="productSettingsShortcut"/);
  assert.match(masterMenu, /productOperationalDetails/);
  assert.match(masterMenu, /@media \(max-width:900px\)[\s\S]*position:static;max-height:none;overflow:visible/);
});
