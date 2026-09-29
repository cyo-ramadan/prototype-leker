import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../migrations/0006_owner_branch_drawer_transactions.sql', import.meta.url);
const adminApiUrl = new URL('../src/admin-multistore.js', import.meta.url);
const adminUiUrl = new URL('../public/admin.js', import.meta.url);
const branchHtmlUrl = new URL('../public/branch-admin.html', import.meta.url);

test('prototype Owner account is seeded with temporary password 123456 hash', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS owner_accounts/);
  assert.match(migration, /8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92/);
  assert.match(migration, /'owner'/);
});

test('branch product form submits products to branch scoped protected endpoint', async () => {
  const [api, ui, html] = await Promise.all([
    readFile(adminApiUrl, 'utf8'),
    readFile(adminUiUrl, 'utf8'),
    readFile(branchHtmlUrl, 'utf8')
  ]);

  assert.match(api, /request\.method === 'POST' && pathname === '\/api\/admin\/products'/);
  assert.match(api, /INSERT INTO products \(id, store_id/);
  assert.match(api, /purchase_price/);
  assert.match(api, /image_data/);
  assert.match(api, /store\.id/);
  assert.match(ui, /saveProduct/);
  assert.match(ui, /'\/api\/admin\/products'/);
  assert.match(html, /id="productName"/);
  assert.match(html, /id="productPurchasePrice"/);
  assert.match(html, /admin-product-policy\.js\?v=20260926-katalog-di-master-barang-v1/);
  assert.match(html, /admin-manufacturing\.js\?v=20260915-tab-icon-theme-v1/);
  assert.match(html, /admin-master-menu\.js\?v=20260915-tab-icon-theme-v1/);
  assert.match(html, /id="productPrice"/);
  assert.match(html, /id="productCategory"/);
  assert.match(html, /Simpan barang/);
});

// Bos Cyo, 2026-09-26 (gerai Mandala): katalog Kode Barang Entity harus ada DI
// DALAM kotak Master barang (bukan anak grid ketiga yang jatuh ke kolom kiri di
// bawah form), dan gerai tanpa kategori tetap bisa menambah barang lewat kolom
// "Kategori baru" -- dropdown kosong + required dulu memblokir submit.
test('product master catalog lives inside Master barang card and new category can be typed', async () => {
  const policy = await readFile(new URL('../public/admin-product-policy.js', import.meta.url), 'utf8');
  const mount = policy.slice(policy.indexOf('function mountCatalogPanel()'), policy.indexOf('function catalogEntryById('));
  assert.match(mount, /list\.insertAdjacentHTML\('afterend'/);
  assert.doesNotMatch(mount, /card\.insertAdjacentHTML/);
  assert.match(policy, /el\('productCategory'\)\?\.removeAttribute\('required'\)/);
  assert.match(policy, /id="productCategoryNew"/);
  assert.match(policy, /el\('productCategoryNew'\)\?\.value\.trim\(\) \|\| el\('productCategory'\)\.value/);
});
