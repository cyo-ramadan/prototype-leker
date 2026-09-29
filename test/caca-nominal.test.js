import test from 'node:test';
import assert from 'node:assert/strict';
import { uraikanNominal, rupiah } from '../src/caca-nominal.js';

const nilai = (teks) => uraikanNominal(teks);

test('singkatan sehari-hari jadi rupiah penuh', () => {
  assert.equal(nilai('22rb').nilai, 22000);
  assert.equal(nilai('22 rb').nilai, 22000);
  assert.equal(nilai('22ribu').nilai, 22000);
  assert.equal(nilai('150k').nilai, 150000);
  assert.equal(nilai('2jt').nilai, 2000000);
  assert.equal(nilai('2 juta').nilai, 2000000);
});

test('pecahan bersatuan dibaca sebagai desimal', () => {
  assert.equal(nilai('1,5jt').nilai, 1500000);
  assert.equal(nilai('1.5jt').nilai, 1500000);
  assert.equal(nilai('2,5rb').nilai, 2500);
});

// Ini bedanya dengan angka bersatuan: tanpa satuan, titik adalah pemisah ribuan.
test('tanpa satuan, titik dibaca sebagai pemisah ribuan', () => {
  assert.equal(nilai('22.000').nilai, 22000);
  assert.equal(nilai('1.500.000').nilai, 1500000);
  assert.equal(nilai('22000').nilai, 22000);
});

test('awalan Rp dan spasi tidak mengganggu', () => {
  assert.equal(nilai('Rp 22.000').nilai, 22000);
  assert.equal(nilai('rp22rb').nilai, 22000);
});

// Nominal salah yang terlanjur masuk baru ketahuan waktu buku tidak cocok,
// jadi yang tidak jelas ditanyakan balik — tidak pernah ditebak.
test('yang ambigu ditanyakan balik, bukan ditebak', () => {
  assert.equal(nilai('22,5').ok, false, 'koma tanpa satuan tidak jelas maksudnya');
  assert.equal(nilai('1.5').ok, false, 'bukan format ribuan yang lazim');
  assert.equal(nilai('dua puluh ribu').ok, false);
  assert.equal(nilai('').ok, false);
  assert.equal(nilai('22bh').ok, false, 'satuan tak dikenal');
});

test('pertanyaan balik selalu berisi kalimat, bukan kode error', () => {
  for (const masukan of ['22,5', '', 'dua puluh ribu', '22bh']) {
    const hasil = nilai(masukan);
    assert.equal(hasil.ok, false);
    assert.ok(hasil.tanya.length > 5, `"${masukan}" harus punya pertanyaan yang bisa dibaca orang`);
  }
});

test('nol dan angka kelewat besar ditolak', () => {
  assert.equal(nilai('0').ok, false);
  assert.equal(nilai('2000jt').ok, false, 'dua triliun — hampir pasti kelebihan nol');
});

test('pecahan yang tidak jatuh di rupiah bulat ditolak', () => {
  assert.equal(nilai('1,5').ok, false);
  assert.equal(nilai('0,5rb').nilai, 500, 'setengah ribu masih rupiah bulat');
  assert.equal(nilai('0,0005rb').ok, false, 'jatuhnya pecahan rupiah');
});

test('hasilnya selalu integer, tidak pernah pecahan mengambang', () => {
  for (const masukan of ['22rb', '1,5jt', '22.000', '150k']) {
    assert.equal(Number.isInteger(nilai(masukan).nilai), true, masukan);
  }
});

test('nominal ditampilkan dengan pemisah ribuan', () => {
  assert.equal(rupiah(1500000), '1.500.000');
  assert.equal(rupiah(22000), '22.000');
});
