import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Bos Cyo, 2026-09-29: CS gerai Kaliurang tidak bisa login di web customer
// ("tidak ada tulisannya login") sementara CS gerai lain normal. Diagnosis:
// public/customer-login.js sudah beberapa kali diedit (mis. 2026-09-13,
// fitur game/Insert Coin) tapi tag <script>-nya di customer.html TIDAK
// PERNAH punya query `?v=` sama sekali -- bukan "lupa dibump", tapi memang
// tidak ada versi apa pun sejak awal. Browser yang sempat cache file ini
// dari sebelum tombol Login ada (URL yang sama persis) tidak akan pernah
// refetch versi baru sendiri, persis gejala "cuma satu CS yang kena".
// Lihat KNOWN_PITFALLS.md "File JS lama yang diubah tapi query ?v= tidak
// dibump" -- ini kasus yang sama, cuma dari sisi "tidak pernah dikasih
// versi dari awal" bukan "lupa dibump ulang".

const customerHtml = readFileSync(new URL('../public/customer.html', import.meta.url), 'utf8');

test('customer-login.js dirujuk dengan query ?v= di customer.html supaya browser lama tidak nyangkut di versi sebelum tombol Login ada', () => {
  assert.match(customerHtml, /<script src="\/customer-login\.js\?v=[^"]+"><\/script>/);
});
