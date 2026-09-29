import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// Bos Cyo, 2026-09-19: "mandala itu mau liat barang entity aja ga bisa, jadi
// maunya kan nanti aktifin dari entity ... bikin sistem upload barang lewat
// admin entity dan uploadnya juga di master barang entity ya" -- panel Entity
// Admin sebelumnya cuma bisa MELIHAT katalog Kode Barang, tidak bisa bikin
// baru; satu-satunya jalan bikin Kode Barang adalah nebeng field "Kode
// Barang" saat satu gerai bikin barangnya sendiri. Ini menambah jalur
// top-down: Entity Admin/Owner upload Kode Barang duluan lewat panelnya
// sendiri, gerai mana pun (termasuk yang belum punya barang sama sekali)
// tinggal Aktifkan dari Admin Gerai masing-masing.

test('entity-admin.html gains an upload form for Kode Barang baru', async () => {
  const html = await read('public/entity-admin.html');
  assert.match(html, /id="entityProductMasterForm"/);
  assert.match(html, /id="entityProductMasterCode"/);
  assert.match(html, /id="entityProductMasterName"/);
  assert.match(html, /id="entityProductMasterPhoto"/);
});

test('entity-admin.js wires the upload form to POST /api/admin/product-masters, and adds an edit action calling PATCH', async () => {
  const source = await read('public/entity-admin.js');
  assert.match(source, /entityProductMasterForm'\)\?\.addEventListener\('submit', submitEntityProductMasterForm\)/);
  assert.match(source, /async function submitEntityProductMasterForm/);
  assert.match(source, /method: 'POST'/);
  assert.match(source, /api\/admin\/product-masters\?store=/);
  assert.match(source, /data-edit-entity-pm/);
  assert.match(source, /async function editEntityProductMaster/);
  assert.match(source, /method: 'PATCH'/);
});

test('upload form compresses the photo client-side before sending it as imageData, same maxSide/quality convention as admin.js', async () => {
  const source = await read('public/entity-admin.js');
  assert.match(source, /async function entityProductMasterImageToDataUrl/);
  assert.match(source, /maxSide = 800/);
  assert.match(source, /toDataURL\('image\/jpeg', 0\.76\)/);
});

// Bos Cyo, 2026-09-19: "jangan cuma 3 variable itu, tambahkan yang lain
// seperti resep dsb" -- form upload dan tiap baris katalog di panel Entity
// Admin sekarang juga punya editor resep acuan, format sama persis
// admin-product-policy.js (satu bahan per baris, "nama | takaran").
test('upload form and each catalog row gain a resep acuan editor, same one-line-per-ingredient format as admin-product-policy.js', async () => {
  const html = await read('public/entity-admin.html');
  assert.match(html, /id="entityProductMasterRecipe"/);

  const source = await read('public/entity-admin.js');
  assert.match(source, /function parseEntityRecipeEditorText/);
  assert.match(source, /recipeComponents/);
  assert.match(source, /data-toggle-entity-recipe/);
  assert.match(source, /data-save-entity-recipe/);
  assert.match(source, /async function saveEntityProductMasterRecipe/);
  assert.match(source, /\/recipe-components\?store=/);
});
