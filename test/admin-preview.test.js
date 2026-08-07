import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../public/admin.html', import.meta.url);
const previewJsUrl = new URL('../public/admin-preview.js', import.meta.url);
const previewCssUrl = new URL('../public/admin-preview.css', import.meta.url);

test('locked admin still exposes master navigation and clear API limit feedback', async () => {
  const [html, js, css] = await Promise.all([
    readFile(htmlUrl, 'utf8'),
    readFile(previewJsUrl, 'utf8'),
    readFile(previewCssUrl, 'utf8')
  ]);

  assert.match(html, /admin-preview\.css/);
  assert.match(html, /admin-preview\.js/);
  assert.match(js, /Tambah Barang/);
  assert.match(js, /Tambah Kategori/);
  assert.match(js, /Tambah Customer/);
  assert.match(js, /Request gagal/);
  assert.match(js, /429/);
  assert.match(js, /quota Cloudflare/);
  assert.match(css, /\.admin-locked/);
});
