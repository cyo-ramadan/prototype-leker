import test from 'node:test';
import assert from 'node:assert/strict';
import { uraikanAngka, cocokkanBarang, periksaRekap } from '../src/caca-rekap-reader.js';

// Angka di lembar rekap ditulis gaya Indonesia: titik memisahkan ribuan.
// Kalau ini salah urai, seluruh rupiah di lembar meleset 1000 kali lipat.
test('angka gaya Indonesia diurai sebagai integer rupiah', () => {
  assert.equal(uraikanAngka('7.000').nilai, 7000);
  assert.equal(uraikanAngka('122.500').nilai, 122500);
  assert.equal(uraikanAngka('516.000').nilai, 516000);
  assert.equal(uraikanAngka('21').nilai, 21);
  assert.equal(uraikanAngka('-1').nilai, -1);
});

test('sel kosong tidak diisi tebakan', () => {
  assert.equal(uraikanAngka('').ada, false);
  assert.equal(uraikanAngka('-').ada, false);
  assert.equal(uraikanAngka(null).ada, false);
});

test('angka janggal ditandai, bukan dipaksa jadi nilai', () => {
  assert.equal(uraikanAngka('7,5').nilai, null);
  assert.ok(uraikanAngka('7,5').janggal);
  assert.equal(uraikanAngka('7.50').nilai, null);
  assert.equal(uraikanAngka('abc').nilai, null);
});

test('uang tidak pernah jadi floating point', () => {
  const nilai = uraikanAngka('808.000').nilai;
  assert.equal(Number.isInteger(nilai), true);
  assert.equal(nilai, 808000);
});

const daftarBarang = [
  { id: 11, name: 'Thai Tea' },
  { id: 12, name: 'Blackcurrant' },
  { id: 13, name: 'Lemon Honey' }
];

test('nama barang dicocokkan ke master gerai, beda spasi tetap ketemu', () => {
  assert.equal(cocokkanBarang('thaitea', daftarBarang).id, 11);
  assert.equal(cocokkanBarang('lemon honey', daftarBarang).id, 13);
});

test('barang yang tidak ada di master tidak ditebak-tebak', () => {
  assert.equal(cocokkanBarang('matcha', daftarBarang), null);
  assert.equal(cocokkanBarang('', daftarBarang), null);
});

function jenisKonfirmasi(hasil) {
  return hasil.perlu_konfirmasi.map(item => item.jenis);
}

test('jumlah yang tidak cocok dilaporkan, bukan dibetulkan diam-diam', () => {
  const hasil = periksaRekap({
    penjualan: [{ nama_tertulis: 'Thai Tea', jumlah_terjual: '6', harga_satuan: '10.000', jumlah: '70.000' }],
    pengeluaran: [],
    pengurang_setoran: [],
    ringkasan_tertulis: { total_penjualan: '70.000', total_pengeluaran: '', setoran: '' }
  }, daftarBarang);

  assert.ok(jenisKonfirmasi(hasil).includes('JUMLAH_TIDAK_COCOK'));
  assert.equal(hasil.penjualan[0].jumlah_hitung, 60000);
  assert.equal(hasil.penjualan[0].jumlah_tertulis, 70000);
});

test('stok turun lebih banyak dari yang tercatat terjual jadi pertanyaan', () => {
  const hasil = periksaRekap({
    penjualan: [{ nama_tertulis: 'Blackcurrant', stok_awal: '22', stok_sisa: '9', jumlah_terjual: '2', harga_satuan: '7.000', jumlah: '14.000' }],
    pengeluaran: [],
    pengurang_setoran: [],
    ringkasan_tertulis: { total_penjualan: '14.000', total_pengeluaran: '', setoran: '' }
  }, daftarBarang);

  assert.ok(jenisKonfirmasi(hasil).includes('SELISIH_STOK'));
  assert.equal(hasil.penjualan[0].qty, 2, 'angka yang tertulis tetap dipakai apa adanya');
});

// Invariant #8: saldo negatif bukan bug. Dilaporkan, tidak di-abs() supaya rapi.
test('stok minus dilaporkan apa adanya', () => {
  const hasil = periksaRekap({
    penjualan: [{ nama_tertulis: 'Thai Tea', stok_awal: '0', stok_sisa: '-1', jumlah_terjual: '1', harga_satuan: '8.000', jumlah: '8.000' }],
    pengeluaran: [],
    pengurang_setoran: [],
    ringkasan_tertulis: { total_penjualan: '8.000', total_pengeluaran: '', setoran: '' }
  }, daftarBarang);

  assert.ok(jenisKonfirmasi(hasil).includes('STOK_MINUS'));
  assert.equal(hasil.penjualan[0].stok_sisa, -1);
});

// Invariant #5: gerai ditentukan sesi login server-side, tidak pernah dari isi pesan.
test('cabang yang tertulis di lembar tidak dipakai menentukan gerai', () => {
  const hasil = periksaRekap({
    cabang_tertulis: 'mekarwangi',
    penjualan: [],
    pengeluaran: [],
    pengurang_setoran: [],
    ringkasan_tertulis: { total_penjualan: '', total_pengeluaran: '', setoran: '' }
  }, daftarBarang);

  assert.ok(jenisKonfirmasi(hasil).includes('CABANG_DARI_LEMBAR'));
});

test('pengurang setoran ditanyakan artinya, tidak dianggap beban', () => {
  const hasil = periksaRekap({
    penjualan: [],
    pengeluaran: [],
    pengurang_setoran: [{ nama_tertulis: 'Qris', jumlah: '181.000' }],
    ringkasan_tertulis: { total_penjualan: '', total_pengeluaran: '', setoran: '' }
  }, daftarBarang);

  assert.ok(jenisKonfirmasi(hasil).includes('ARTI_PENGURANG_SETORAN'));
  assert.equal(hasil.ringkasan.total_pengurang_setoran, 181000);
});

// Angka asli dari lembar rekap Bos Cyo, 06-Sep-26 cabang mekarwangi.
test('lembar asli: total dan setoran dihitung ulang oleh kode', () => {
  const hasil = periksaRekap({
    tanggal_tertulis: '06-Sep-26',
    cabang_tertulis: 'mekarwangi',
    penjualan: [
      { nama_tertulis: 'apel', stok_awal: '28', stok_sisa: '27', jumlah_terjual: '1', harga_satuan: '7.000', jumlah: '7.000' },
      { nama_tertulis: 'blackcurrant', stok_awal: '29', stok_sisa: '24', jumlah_terjual: '5', harga_satuan: '7.000', jumlah: '35.000' },
      { nama_tertulis: 'leci', stok_awal: '27', stok_sisa: '22', jumlah_terjual: '5', harga_satuan: '7.000', jumlah: '35.000' },
      { nama_tertulis: 'lemon honey', stok_awal: '20', stok_sisa: '16', jumlah_terjual: '4', harga_satuan: '7.000', jumlah: '28.000' },
      { nama_tertulis: 'coklat', stok_awal: '18', stok_sisa: '14', jumlah_terjual: '4', harga_satuan: '8.000', jumlah: '32.000' },
      { nama_tertulis: 'mangga', stok_awal: '22', stok_sisa: '9', jumlah_terjual: '2', harga_satuan: '7.000', jumlah: '14.000' },
      { nama_tertulis: 'cappucino', stok_awal: '24', stok_sisa: '20', jumlah_terjual: '3', harga_satuan: '8.000', jumlah: '24.000' },
      { nama_tertulis: 'thaitea', stok_awal: '21', stok_sisa: '13', jumlah_terjual: '6', harga_satuan: '10.000', jumlah: '60.000' },
      { nama_tertulis: 'milk tea leci', stok_awal: '', stok_sisa: '-1', jumlah_terjual: '1', harga_satuan: '8.000', jumlah: '8.000' },
      { nama_tertulis: 'milk tea', stok_awal: '', stok_sisa: '0', jumlah_terjual: '7', harga_satuan: '7.000', jumlah: '49.000' },
      { nama_tertulis: 'original jasmin', stok_awal: '', stok_sisa: '0', jumlah_terjual: '86', harga_satuan: '6.000', jumlah: '516.000' }
    ],
    pengeluaran: [
      { nama_tertulis: 'gula', banyaknya: '7', jumlah: '122.500' },
      { nama_tertulis: 'galon', banyaknya: '3', jumlah: '33.000' },
      { nama_tertulis: 'susu', banyaknya: '4', jumlah: '27.000' },
      { nama_tertulis: 'es', banyaknya: '4', jumlah: '72.000' }
    ],
    pengurang_setoran: [{ nama_tertulis: 'Qris', jumlah: '181.000' }],
    ringkasan_tertulis: { total_penjualan: '808.000', total_pengeluaran: '254.500', setoran: '372.500' }
  }, daftarBarang);

  assert.equal(hasil.ringkasan.total_penjualan, 808000);
  assert.equal(hasil.ringkasan.total_pengeluaran, 254500);
  assert.equal(hasil.ringkasan.setoran, 372500);
  assert.equal(jenisKonfirmasi(hasil).includes('TOTAL_TIDAK_COCOK'), false);
  assert.ok(jenisKonfirmasi(hasil).includes('STOK_MINUS'));
  assert.ok(jenisKonfirmasi(hasil).includes('SELISIH_STOK'));
});
