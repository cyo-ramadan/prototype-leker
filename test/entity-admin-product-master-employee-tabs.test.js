import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// Bos Cyo, 2026-09-17: "kasih tombol masterbarang dan nama karyawan di
// panel entity" -- Master Barang dan Karyawan sudah entity-scoped di
// backend (src/product-master.js, src/employee-master.js); ini menambah
// dua tab BARU di panel Entity Admin sendiri (bukan lewat Admin Gerai)
// supaya Entity Admin bisa melihat keduanya tanpa harus buka satu gerai
// spesifik dulu. Aktivasi barang (Gunakan/Aktifkan) tetap di Admin Gerai
// saja -- itu perlu konteks harga/kategori gerai, tidak dipindah ke sini.

test('entity-admin.html gains Master Barang and Karyawan tabs with their own sections', async () => {
  const html = await read('public/entity-admin.html');
  assert.match(html, /data-entity-tab="productmasters"/);
  assert.match(html, /data-entity-tab="employees"/);
  assert.match(html, /id="entityTab-productmasters"/);
  assert.match(html, /id="entityTab-employees"/);
  assert.match(html, /id="entityProductMasterList"/);
  assert.match(html, /id="entityEmployeeList"/);
  assert.match(html, /id="entityEmployeeForm"/);
});

test('switchEntityTab wires the two new tabs and lazily loads their data', async () => {
  const source = await read('public/entity-admin.js');
  assert.match(source, /name === 'productmasters'/);
  assert.match(source, /name === 'employees'/);
  assert.match(source, /loadEntityProductMasters\(\)/);
  assert.match(source, /loadEntityEmployees\(\)/);
});

test('entity-level Master Barang and Karyawan views call the existing entity-scoped endpoints, never a store-specific activate action', async () => {
  const source = await read('public/entity-admin.js');
  assert.match(source, /api\/admin\/product-masters\?store=/);
  assert.match(source, /api\/admin\/employees\?store=/);
  assert.doesNotMatch(source, /\/activate`/, 'aktivasi barang tetap tanggung jawab Admin Gerai, bukan panel Entity Admin');
});

test('adding an entity-level employee from this panel forces scope ENTITY (no home store context exists here)', async () => {
  const source = await read('public/entity-admin.js');
  assert.match(source, /scope: 'ENTITY'/);
});
