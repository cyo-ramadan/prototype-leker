import test from 'node:test';
import assert from 'node:assert/strict';
import {
  keSkala, dariSkala, tampilSkala, tambahTurunan, saringBaris, urutkanBaris,
  jalankanHitung, petaDaftar, ambilDaftar, ambilKolom
} from '../src/caca-hitung.js';

const barang = [
  { id: 1, name: 'Leker Coklat', price: 10000, averageCost: 7500, purchasePrice: 7000 },
  { id: 2, name: 'Es Teh', price: 3000, averageCost: 3500.5, purchasePrice: 3000 },
  { id: 3, name: 'Tepung', price: 0, averageCost: 12.345678, purchasePrice: 10 },
  { id: 4, name: 'Gula', price: '15000', averageCost: '15000.000001', purchasePrice: 14000 },
  { id: 5, name: 'Telur', price: 2000, averageCost: null, purchasePrice: 1500 }
];

// --- angka skala: tidak pernah float -----------------------------------------

test('keSkala/dariSkala: bulat, desimal, minus, dan half-up di digit ke-7', () => {
  assert.equal(keSkala(10000), 10_000_000_000n);
  assert.equal(keSkala('12.345678'), 12_345_678n);
  assert.equal(keSkala('12.3456785'), 12_345_679n); // half-up
  assert.equal(keSkala('12.3456784'), 12_345_678n);
  assert.equal(keSkala('-0.5'), -500_000n);
  assert.equal(keSkala('abc'), null);
  assert.equal(keSkala(null), null);
  assert.equal(keSkala(Number.NaN), null);
  assert.equal(dariSkala(12_345_678n), '12.345678');
  assert.equal(dariSkala(-500_000n), '-0.5');
  assert.equal(dariSkala(10_000_000_000n), '10000');
});

test('0.1 + 0.2 tidak melenceng seperti float', () => {
  const hasil = tambahTurunan([{ a: 0.1, b: 0.2 }], [{ nama: 'jumlah', kolom_a: 'a', operasi: 'tambah', kolom_b: 'b' }]);
  assert.equal(hasil.baris[0].jumlah, '0.3');
});

test('tampilSkala: pemisah ribuan Indonesia, koma desimal, minus tidak dibuang', () => {
  assert.equal(tampilSkala(keSkala(1500000)), '1.500.000');
  assert.equal(tampilSkala(keSkala('1234.5')), '1.234,5');
  assert.equal(tampilSkala(keSkala(-1044250)), '−1.044.250');
});

// --- kolom turunan -----------------------------------------------------------

test('turunan: margin = harga jual kurang HPP; baris tanpa nilai jadi kosong, bukan nol', () => {
  const { baris } = tambahTurunan(barang, [{ nama: 'margin', kolom_a: 'price', operasi: 'kurang', kolom_b: 'averageCost' }]);
  assert.deepEqual(baris.map((b) => b.margin), ['2500', '-500.5', '-12.345678', '-0.000001', null]);
});

test('turunan: persen_dari dan bagi dibulatkan half-up, bagi nol jadi kosong', () => {
  const { baris } = tambahTurunan(
    [{ a: 2500, b: 10000 }, { a: 1, b: 3 }, { a: 5, b: 0 }],
    [{ nama: 'persen', kolom_a: 'a', operasi: 'persen_dari', kolom_b: 'b' }]
  );
  assert.deepEqual(baris.map((b) => b.persen), ['25', '33.333333', null]);
});

test('turunan: operasi tak dikenal dan nama kolom aneh ditolak dengan pesan', () => {
  assert.match(tambahTurunan([{}], [{ nama: 'x', kolom_a: 'a', operasi: 'pangkat', kolom_b: 'b' }]).error, /tidak dikenal/);
  assert.match(tambahTurunan([{}], [{ nama: 'x;drop', kolom_a: 'a', operasi: 'kurang', kolom_b: 'b' }]).error, /tidak valid/);
});

// --- menyaring ---------------------------------------------------------------

test('saring: HPP lebih dari harga jual — membandingkan dua kolom, tanpa melihat urutan huruf', () => {
  const hasil = saringBaris(barang, [{ kolom: 'averageCost', op: 'lebih_dari', bandingkan_kolom: 'price' }]);
  // "15000.000001" > "15000" hanya benar kalau dibandingkan sebagai angka persis.
  assert.deepEqual(hasil.baris.map((b) => b.name), ['Es Teh', 'Tepung', 'Gula']);
});

test('saring: kosong/ada, mengandung tanpa beda huruf besar, sama untuk teks', () => {
  assert.deepEqual(saringBaris(barang, [{ kolom: 'averageCost', op: 'kosong' }]).baris.map((b) => b.name), ['Telur']);
  assert.equal(saringBaris(barang, [{ kolom: 'averageCost', op: 'ada' }]).baris.length, 4);
  assert.deepEqual(saringBaris(barang, [{ kolom: 'name', op: 'mengandung', nilai: 'LEKER' }]).baris.map((b) => b.id), [1]);
  assert.deepEqual(saringBaris(barang, [{ kolom: 'name', op: 'sama', nilai: 'gula' }]).baris.map((b) => b.id), [4]);
});

test('saring: banyak syarat berlaku bersamaan; operator liar ditolak', () => {
  const hasil = saringBaris(barang, [
    { kolom: 'price', op: 'min_sama', nilai: '3000' },
    { kolom: 'price', op: 'maks_sama', nilai: '10000' }
  ]);
  assert.deepEqual(hasil.baris.map((b) => b.id), [1, 2]);
  assert.match(saringBaris(barang, [{ kolom: 'price', op: 'DROP' }]).error, /tidak dikenal/);
});

test('kolom bertitik dan nama kolom tanpa beda huruf besar', () => {
  assert.equal(ambilKolom({ a: { b: 5 } }, 'a.b'), 5);
  assert.equal(ambilKolom({ AverageCost: 7 }, 'averagecost'), 7);
  assert.equal(ambilKolom({ a: 1 }, 'a.b'), undefined);
});

// --- mengurutkan -------------------------------------------------------------

test('urut: angka (bukan huruf), baris tanpa nilai selalu di bawah, urutan sama dipertahankan', () => {
  const naik = urutkanBaris(barang, { kolom: 'averageCost', arah: 'naik' }).map((b) => b.id);
  const turun = urutkanBaris(barang, { kolom: 'averageCost', arah: 'turun' }).map((b) => b.id);
  assert.deepEqual(naik, [3, 2, 1, 4, 5]);
  assert.deepEqual(turun, [4, 1, 2, 3, 5]);
});

// --- satu paket hitung --------------------------------------------------------

test('pertanyaan Bos Cyo: barang yang HPP-nya di atas harga jual, urut selisih terburuk', () => {
  const hasil = jalankanHitung(barang, {
    turunan: [{ nama: 'margin', kolom_a: 'price', operasi: 'kurang', kolom_b: 'averageCost' }],
    saring: [{ kolom: 'margin', op: 'kurang_dari', nilai: '0' }],
    urut: { kolom: 'margin', arah: 'naik' },
    kolom: ['name', 'price', 'averageCost', 'margin']
  });
  assert.equal(hasil.ok, true);
  assert.equal(hasil.jumlahCocok, 3);
  assert.deepEqual(hasil.kolom, ['name', 'price', 'averageCost', 'margin']);
  assert.deepEqual(hasil.isi.map((b) => b[0]), ['Es Teh', 'Tepung', 'Gula']);
  assert.deepEqual(hasil.isi[0], ['Es Teh', '3.000', '3.500,5', '−500,5']);
});

test('agregat: jumlah, rata, terkecil, terbesar, banyak, dan per kelompok', () => {
  const baris = [
    { gerai: 'BEJI', total: 100.5 }, { gerai: 'BEJI', total: 200 }, { gerai: 'DERMO', total: '50.25' }, { gerai: 'DERMO', total: null }
  ];
  const jumlah = jalankanHitung(baris, { agregat: { fungsi: 'jumlah', kolom: 'total' } });
  assert.deepEqual(jumlah.isi, [['350,75', '4']]);
  assert.deepEqual(jalankanHitung(baris, { agregat: { fungsi: 'rata', kolom: 'total' } }).isi[0][0], '116,916667');
  assert.deepEqual(jalankanHitung(baris, { agregat: { fungsi: 'terkecil', kolom: 'total' } }).isi[0][0], '50,25');
  assert.deepEqual(jalankanHitung(baris, { agregat: { fungsi: 'banyak' } }).isi, [['4', '4']]);

  const perGerai = jalankanHitung(baris, { agregat: { fungsi: 'jumlah', kolom: 'total', per: 'gerai' } });
  assert.deepEqual(perGerai.isi, [['BEJI', '300,5', '2'], ['DERMO', '50,25', '2']]);
});

test('jumlah baris yang cocok dan pemotongan dilaporkan jujur', () => {
  const banyak = Array.from({ length: 120 }, (_, i) => ({ n: i, v: i }));
  const hasil = jalankanHitung(banyak, { urut: { kolom: 'v', arah: 'turun' }, ambil: 500 });
  assert.equal(hasil.jumlahCocok, 120);
  assert.equal(hasil.isi.length, 50);
  assert.equal(hasil.terpotong, true);
  assert.equal(hasil.isi[0][1], '119');
});

test('fungsi agregat liar ditolak, daftar bukan array ditolak', () => {
  assert.match(jalankanHitung(barang, { agregat: { fungsi: 'median', kolom: 'price' } }).error, /tidak dikenal/);
  assert.match(jalankanHitung(null, {}).error, /tidak ditemukan/);
});

// --- peta bentuk -------------------------------------------------------------

test('petaDaftar menemukan daftar sampai kedalaman 2, lengkap dengan kolom dan contoh', () => {
  const peta = petaDaftar({ store: { code: 'G001' }, products: barang, laporan: { assets: [{ code: '1103', balance: -5 }] }, kosong: [] });
  assert.deepEqual(peta.map((d) => [d.jalur, d.banyak]), [['products', 5], ['laporan.assets', 1], ['kosong', 0]]);
  const harga = peta[0].kolom.find((k) => k.nama === 'price');
  assert.equal(harga.jenis, 'angka');
  // Kolom yang kosong di baris pertama tapi terisi di baris lain tetap dikenali jenisnya.
  assert.equal(peta[0].kolom.find((k) => k.nama === 'averageCost').jenis, 'angka');
});

test('ambilDaftar: jalur bertitik, bukan array → null', () => {
  assert.equal(ambilDaftar({ a: { b: [1] } }, 'a.b').length, 1);
  assert.equal(ambilDaftar({ a: 5 }, 'a'), null);
  assert.equal(ambilDaftar({ a: [] }, 'b'), null);
});
