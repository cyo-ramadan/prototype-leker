import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../migrations/0002_admin_master_data.sql', import.meta.url);
const indexUrl = new URL('../src/index.js', import.meta.url);
const adminApiUrl = new URL('../src/admin.js', import.meta.url);
const adminHtmlUrl = new URL('../public/admin.html', import.meta.url);
const customerJsUrl = new URL('../public/customer.js', import.meta.url);
const responsiveCssUrl = new URL('../public/customer-responsive.css', import.meta.url);

test('admin master schema covers store, products, categories, and contacts', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /purchase_price INTEGER/);
  assert.match(migration, /image_data TEXT/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS categories/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS store_settings/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS contacts/);
});

test('admin routes require a PIN for protected master data', async () => {
  const [index, adminApi, html] = await Promise.all([
    readFile(indexUrl, 'utf8'),
    readFile(adminApiUrl, 'utf8'),
    readFile(adminHtmlUrl, 'utf8')
  ]);
  assert.match(index, /'\/admin': '\/admin\.html'/);
  assert.match(index, /pathname\.startsWith\('\/api\/admin\/'\)/);
  assert.match(adminApi, /x-admin-pin/);
  assert.match(adminApi, /\/api\/admin\/setup/);
  assert.match(adminApi, /\/api\/admin\/products/);
  assert.match(adminApi, /\/api\/admin\/categories/);
  assert.match(adminApi, /\/api\/admin\/contacts/);
  assert.match(html, /Master barang/);
  assert.match(html, /Master customer\/contact/);
});

test('mobile menu uses a fixed control slot so quantity changes do not resize cards', async () => {
  const [customerJs, css] = await Promise.all([
    readFile(customerJsUrl, 'utf8'),
    readFile(responsiveCssUrl, 'utf8')
  ]);
  assert.match(customerJs, /class="menu-control-slot"/);
  assert.match(css, /\.menu-control-slot \{ width:106px; min-width:106px;/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.menu-card \{ min-width:0;/);
});
