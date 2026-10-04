import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Bos Cyo, 2026-10-04: kasir tertukar titik dan koma sehingga HPP kacau ("1.500" dibaca
// 1,5; qty "1.000" gram dibaca 1). Aturan: titik tidak bisa diketik, ribuan diberi titik
// otomatis, koma = desimal (hanya di harga per satuan).

const kode = readFileSync(new URL('../public/angka-input.js', import.meta.url), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(kode, sandbox);
const { rapikan, nilai, tampil } = sandbox.window.MAXIAngka;

test('rapikan: titik ribuan dibuat program, titik ketikan/tempelan tidak pernah jadi desimal', () => {
  assert.equal(rapikan('1500'), '1.500');
  assert.equal(rapikan('1234567'), '1.234.567');
  assert.equal(rapikan('1.500'), '1.500', 'tempelan bertitik dibaca ribuan');
  assert.equal(rapikan('15.00'), '1.500', 'titik di posisi "desimal" tetap tidak jadi desimal');
  assert.equal(rapikan('0001500'), '1.500');
  assert.equal(rapikan('abc12x3'), '123');
  assert.equal(rapikan(''), '');
});

test('rapikan: koma hanya di isian desimal, maks satu koma dan 6 angka pecahan', () => {
  assert.equal(rapikan('17,5', { desimal: true }), '17,5');
  assert.equal(rapikan('1500,25', { desimal: true }), '1.500,25');
  assert.equal(rapikan(',4375', { desimal: true }), '0,4375');
  assert.equal(rapikan('1,2,3', { desimal: true }), '1,23');
  assert.equal(rapikan('0,12345678', { desimal: true }), '0,123456');
  assert.equal(rapikan('12,', { desimal: true }), '12,', 'koma sedang diketik tetap terlihat');
  assert.equal(rapikan('17,5'), '175', 'isian bulat (qty/total) membuang koma');
});

test('nilai: titik = ribuan, koma = desimal; bentuk aneh = tidak valid', () => {
  assert.equal(nilai('1.500'), 1500);
  assert.equal(nilai('1.000'), 1000, 'qty 1.000 gram = 1000, bukan 1');
  assert.equal(nilai('17,5'), 17.5);
  assert.equal(nilai('0,4375'), 0.4375);
  assert.equal(nilai('1.500,25'), 1500.25);
  assert.ok(Number.isNaN(nilai('')));
  assert.ok(Number.isNaN(nilai('1,2,3')));
  assert.ok(Number.isNaN(nilai('12a')));
});

test('tampil: angka dari sistem ditampilkan dengan aturan yang sama', () => {
  assert.equal(tampil(18000), '18.000');
  assert.equal(tampil(0.4375, { desimal: true }), '0,4375');
  assert.equal(tampil(1500, { desimal: true }), '1.500');
  assert.equal(tampil(17.666667, { desimal: true }), '17,666667');
  assert.equal(tampil(10, { desimal: true }), '10');
  for (const n of [1, 52.1, 1583, 11.315104, 4.664]) assert.equal(nilai(tampil(n, { desimal: true })), n, `bolak-balik ${n}`);
});

test('PIMASATU: qty/harga/total bukan lagi input angka bawaan browser dan dibaca lewat aturan titik/koma', () => {
  const ui = readFileSync(new URL('../public/pimasatu-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /pimasatu-(qty|total)" type="number"/);
  assert.doesNotMatch(ui, /data-line-qty="\$\{index\}" type="number"/);
  assert.doesNotMatch(ui, /Number\((qty|price|total)\.value\)/, 'tidak ada lagi Number(...) mentah yang membaca "1.500" sebagai 1,5');
  assert.match(ui, /pasangAngka\(qty, false\); pasangAngka\(price, isToggleMode\); pasangAngka\(total, false\)/);
  const html = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');
  const posisiAngka = html.indexOf('/angka-input.js?v=');
  const posisiPimasatu = html.indexOf('/pimasatu-ui.js?v=');
  assert.ok(posisiAngka > 0 && posisiAngka < posisiPimasatu, 'angka-input dimuat sebelum PIMASATU');
  assert.doesNotMatch(html, /pimasatu-ui\.js\?v=1\.8\.0-fix-enter-implicit-submit/, 'versi dibump supaya browser kasir mengambil versi baru');
});
