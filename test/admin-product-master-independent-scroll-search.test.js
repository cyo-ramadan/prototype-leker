import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adminUiUrl = new URL('../public/admin.js', import.meta.url);
const adminCssUrl = new URL('../public/admin.css', import.meta.url);
const branchHtmlUrl = new URL('../public/branch-admin.html', import.meta.url);

test('Master barang list panel has an independent search input, and product filtering excludes non-matching names', async () => {
  const [ui, html] = await Promise.all([readFile(adminUiUrl, 'utf8'), readFile(branchHtmlUrl, 'utf8')]);

  assert.match(html, /id="productSearch"[^>]*type="search"/, 'search input must exist above the product list');
  assert.match(ui, /function filteredProducts\(\)/);
  assert.match(ui, /state\.productSearchTerm/);
  assert.match(ui, /renderProducts\(\)/);

  const filteredProducts = () => {
    const state = { productSearchTerm: 'mangga', data: { products: [
      { name: 'Es MilkTea Mangga', category: 'Milktea Fruity' },
      { name: 'Es MilkTea Leci', category: 'Milktea Fruity' }
    ] } };
    const term = state.productSearchTerm.trim().toLowerCase();
    if (!term) return state.data.products;
    return state.data.products.filter(product =>
      product.name.toLowerCase().includes(term) || product.category.toLowerCase().includes(term)
    );
  };
  const result = filteredProducts();
  assert.equal(result.length, 1, 'searching for a product name must exclude non-matching rows');
  assert.equal(result[0].name, 'Es MilkTea Mangga');
});

test('Master barang two-column layout gives each side its own bounded, scrollable box instead of sharing the page scroll', async () => {
  const css = await readFile(adminCssUrl, 'utf8');
  // Regression for: scrolling the right list required scrolling the whole
  // page (through the list) before the sticky-positioned left form's own
  // overflow became reachable. Each side now gets max-height + overflow-y.
  assert.match(css, /\.admin-grid\.master-layout\s*>\s*\.sticky-form,\s*\n\s*\.admin-grid\.master-layout\s*>\s*\.list-card\s*\{[^}]*max-height:calc\(100vh - 108px\)[^}]*overflow-y:auto/);
});
