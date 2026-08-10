import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../migrations/0002_admin_master_data.sql', import.meta.url);
const indexUrl = new URL('../src/index.js', import.meta.url);
const adminApiUrl = new URL('../src/admin-multistore.js', import.meta.url);
const ownerHtmlUrl = new URL('../public/owner.html', import.meta.url);
const branchHtmlUrl = new URL('../public/branch-admin.html', import.meta.url);
const customerJsUrl = new URL('../public/customer.js', import.meta.url);
const responsiveCssUrl = new URL('../public/customer-responsive.css', import.meta.url);

test('branch master schema covers store identity products categories and contacts', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /purchase_price INTEGER/);
  assert.match(migration, /image_data TEXT/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS categories/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS store_settings/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS contacts/);
});

test('owner console sits above branch master workspace', async () => {
  const [index, adminApi, ownerHtml, branchHtml] = await Promise.all([
    readFile(indexUrl, 'utf8'),
    readFile(adminApiUrl, 'utf8'),
    readFile(ownerHtmlUrl, 'utf8'),
    readFile(branchHtmlUrl, 'utf8')
  ]);
  assert.match(index, /'\/admin': '\/owner\.html'/);
  assert.match(index, /page === 'admin'.*branch-admin\.html/s);
  assert.match(adminApi, /requireManagement/);
  assert.match(adminApi, /\/api\/admin\/products/);
  assert.match(adminApi, /\/api\/admin\/categories/);
  assert.match(adminApi, /\/api\/admin\/contacts/);
  assert.match(ownerHtml, /Create gerai/i);
  assert.match(branchHtml, /Master barang/);
  assert.match(branchHtml, /Master supplier/);
  assert.match(branchHtml, /Master customer\/contact/);
  assert.doesNotMatch(branchHtml, /data-tab="branches"/);
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
