import test from 'node:test';
import assert from 'node:assert/strict';
import { bersihkan, gabungGerai, MAKS_BARIS_PER_DAFTAR } from '../src/caca-baca-aman.js';

test('rahasia dibuang seluruhnya, kuncinya pun tidak tersisa', () => {
  const { data, catatan } = bersihkan({
    cashiers: [{ id: 1, username: 'andi', passwordHash: 'abc123', pin: '1234', sessionToken: 'tok', apiKey: 'k', employeeName: 'Andi' }],
    otpSecret: 'x'
  });
  assert.deepEqual(data, { cashiers: [{ id: 1, username: 'andi', employeeName: 'Andi' }] });
  assert.match(catatan.join(), /isian rahasia dibuang/);
  assert.equal(JSON.stringify(data).includes('abc123'), false);
});

test('gambar dan data besar diganti penanda, bukan dikirim ke model', () => {
  const { data } = bersihkan({
    products: [{ name: 'Leker', imageData: 'data:image/png;base64,AAAA', emoji: '🥞', note: 'x'.repeat(5000) }],
    storeLogo: 'data:image/jpeg;base64,BBBB'
  });
  assert.equal(data.products[0].imageData, '[gambar dibuang]');
  assert.equal(data.products[0].note, '[data besar dibuang]');
  assert.equal(data.products[0].emoji, '🥞');
  assert.equal(data.storeLogo, '[gambar dibuang]');
});

test('kontak dan identitas pribadi disamarkan nilainya, kuncinya tetap ada', () => {
  const { data } = bersihkan({
    employees: [{ fullName: 'Rina', phone: '08123456789', address: 'Jl. Mawar 1', idNumber: '350101', email: 'r@x.id', accountNumber: '123' }]
  });
  assert.deepEqual(data.employees[0], {
    fullName: 'Rina', phone: '[disamarkan]', address: '[disamarkan]', idNumber: '[disamarkan]', email: '[disamarkan]', accountNumber: '[disamarkan]'
  });
});

test('angka dan data biasa lewat apa adanya, termasuk saldo negatif', () => {
  const asli = { saldo: -1044250, aktif: true, nama: 'Rekening Bersama', kosong: null, daftar: [1, 2, 3] };
  assert.deepEqual(bersihkan(asli).data, asli);
});

test('data asli tidak diubah, daftar kelewat panjang dipotong dan dicatat', () => {
  const asli = { baris: Array.from({ length: MAKS_BARIS_PER_DAFTAR + 5 }, (_, i) => ({ i })), pin: '1' };
  const { data, catatan } = bersihkan(asli);
  assert.equal(asli.pin, '1');
  assert.equal(data.baris.length, MAKS_BARIS_PER_DAFTAR);
  assert.match(catatan.join(), /dipotong/);
});

test('gabungGerai: daftar digabung dengan _gerai, isian tunggal jadi satu baris per gerai', () => {
  const hasil = gabungGerai([
    { kode: 'BEJI', data: { stocks: [{ n: 'Gula', q: 5 }], totals: { revenue: 100, expense: 40 }, status: 'ok' } },
    { kode: 'DERMO', data: { stocks: [{ n: 'Tepung', q: 9 }], totals: { revenue: 70, expense: 10 }, status: 'ok' } }
  ]);
  assert.deepEqual(hasil.stocks, [{ _gerai: 'BEJI', n: 'Gula', q: 5 }, { _gerai: 'DERMO', n: 'Tepung', q: 9 }]);
  assert.deepEqual(hasil.ringkasan_gerai, [
    { _gerai: 'BEJI', 'totals.revenue': 100, 'totals.expense': 40, status: 'ok' },
    { _gerai: 'DERMO', 'totals.revenue': 70, 'totals.expense': 10, status: 'ok' }
  ]);
});
