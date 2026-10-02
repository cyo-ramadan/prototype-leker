import test from 'node:test';
import assert from 'node:assert/strict';
import { bumbui, gayaJawaban, gayaSelesai } from '../src/caca-gaya.js';

const selalu = () => 0;
const tidakPernah = () => 0.99;

test('bumbu hanya menempel di depan/belakang, kalimat dan angkanya tidak berubah', () => {
  const asli = 'Beji: jurnal JRN-0007, akun dinonaktifkan\nDermo: sudah diubah';
  const hasil = gayaSelesai(asli, selalu);
  assert.match(hasil, /^Peh, lumayan juga ini\.\n/);
  assert.ok(hasil.includes('Beji: jurnal JRN-0007, akun dinonaktifkan'));
  assert.ok(hasil.includes('Dermo: sudah diubah'));
});

test('selesai satu hal: titik akhir dilepas lalu diberi hhe/wkwk', () => {
  assert.equal(gayaSelesai('Sudah Una catat Bea Gajinya.', selalu), 'Sudah Una catat Bea Gajinya hhe');
});

test('kadang-kadang saja: dengan peluang tidak kena, kalimat tetap asli', () => {
  assert.equal(gayaSelesai('Sudah Una catat Bea Gajinya.', tidakPernah), 'Sudah Una catat Bea Gajinya.');
});

test('tidak dibumbui dua kali', () => {
  assert.equal(bumbui('Peh, banyak ya hhe', ['berat', 'beres'], selalu), 'Peh, banyak ya hhe');
});

test('draft tidak pernah disentuh; draft berat dapat pengantar terpisah', () => {
  const draft = { judul: 'Una mau ...', tabel: { isi: [[1], [2], [3]] }, muatan: { langkah: [] } };
  const hasil = gayaJawaban({ draft, jawaban: null }, selalu);
  assert.match(hasil.sapaan, /^Peh/);
  assert.equal(draft.judul, 'Una mau ...');

  const ringan = gayaJawaban({ draft: { judul: 'x', muatan: {} }, jawaban: null }, selalu);
  assert.equal(ringan.sapaan, null);
});

test('jawaban susunan model tidak dibumbui lagi; hasil cek yang janggal dapat "ckck"', () => {
  assert.equal(gayaJawaban({ jawaban: 'Untung hari ini 117.000.', data: {} }, selalu).jawaban, 'Untung hari ini 117.000.');
  assert.match(gayaJawaban({ jawaban: '2 dari 3 gerai belum cocok.', tabel: {} }, selalu).jawaban, /^Ckck\./);
});
