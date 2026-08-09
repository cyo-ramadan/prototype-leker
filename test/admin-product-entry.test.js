import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../migrations/0003_set_prototype_admin_pin.sql', import.meta.url);
const adminApiUrl = new URL('../src/admin.js', import.meta.url);
const adminUiUrl = new URL('../public/admin.js', import.meta.url);
const adminHtmlUrl = new URL('../public/admin.html', import.meta.url);

test('prototype admin PIN is reset to 123456 via SHA-256 migration', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92/);
  assert.match(migration, /UPDATE store_settings/);
});

test('admin product form submits new products to the protected products endpoint', async () => {
  const [api, ui, html] = await Promise.all([
    readFile(adminApiUrl, 'utf8'),
    readFile(adminUiUrl, 'utf8'),
    readFile(adminHtmlUrl, 'utf8')
  ]);

  assert.match(api, /request\.method === 'POST' && pathname === '\/api\/admin\/products'/);
  assert.match(api, /INSERT INTO products/);
  assert.match(api, /purchase_price/);
  assert.match(api, /image_data/);
  assert.match(ui, /saveProduct/);
  assert.match(ui, /'\/api\/admin\/products'/);
  assert.match(html, /id="productName"/);
  assert.match(html, /id="productPurchasePrice"/);
  assert.match(html, /id="productPrice"/);
  assert.match(html, /id="productCategory"/);
  assert.match(html, /Simpan barang/);
});
