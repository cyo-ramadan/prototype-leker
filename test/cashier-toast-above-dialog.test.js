import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 2026-09-13, Bos Cyo: "Proses Penjualan" tampak diam total -- tombol sempat
// redup lalu segar lagi (request beneran jalan dan dapat balasan), tapi
// dialog tetap terbuka dan tidak ada pesan yang kelihatan sama sekali.
// Root cause: <dialog> yang dibuka lewat showModal() (dialog Penjualan, Beli
// Bahan, dst) dirender di browser top layer, yang selalu tergambar di atas
// SEMUA elemen normal termasuk position:fixed apa pun z-index-nya. toast()
// menaruh pesannya sebagai child <body> biasa -- selama dialog modal masih
// terbuka, pesan itu tertutup total di belakang dialog, tidak pernah
// kelihatan, walau request-nya sendiri sukses terkirim dan dapat balasan.
const cashierUi = readFileSync(new URL('../public/cashier.js', import.meta.url), 'utf8');

test('toast() reparents into the open <dialog> so error messages are not hidden behind it', () => {
  const toastFn = cashierUi.match(/function toast\(message\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(toastFn, 'toast() function must exist');
  assert.match(toastFn, /document\.querySelector\(['"]dialog\[open\]['"]\)/);
  assert.match(toastFn, /\(openDialog \|\| document\.body\)\.appendChild\(node\)/);
});
