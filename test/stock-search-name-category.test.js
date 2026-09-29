import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Bos Cyo, 2026-09-29: "untuk stok, cari barang itu bisa di search
// berdasarkan nama, kategori atau contain text ya." Admin sudah begitu
// (admin-stock.js menggabungkan productName + itemTypeName jadi satu
// haystack sebelum .includes(query)) -- yang ketinggalan adalah versi
// kasir/CS di cashier-data-explorer.js, yang cuma mencocokkan productName.
// Disamakan supaya kedua sisi konsisten.

const adminStockUi = readFileSync(new URL('../public/admin-stock.js', import.meta.url), 'utf8');
const cashierDataExplorerUi = readFileSync(new URL('../public/cashier-data-explorer.js', import.meta.url), 'utf8');

test('Admin Stok search sudah mencocokkan nama ATAU kategori (itemTypeName) sebagai contain-text', () => {
  assert.match(adminStockUi, /\$\{item\.productName \|\| ''\} \$\{item\.itemTypeName \|\| ''\}/);
  assert.match(adminStockUi, /haystack\.includes\(query\)/);
});

test('Kasir/CS Stok search ikut mencocokkan nama ATAU kategori (itemTypeName), bukan cuma nama', () => {
  assert.match(cashierDataExplorerUi, /\$\{item\.productName \|\| ''\} \$\{item\.itemTypeName \|\| ''\}.*includes\(query\)/);
});
