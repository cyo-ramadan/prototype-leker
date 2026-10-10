import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bangunPeta, isiBerkas } from '../scripts/build-peta-una.mjs';
import { PETA_UNA, PENJELASAN, cariMenu } from '../src/caca-peta.js';
import { jelaskan } from '../src/caca-jelaskan.js';
import { jawabPertanyaan, panduanPasti } from '../src/caca-agen.js';
import { cariAksi } from '../src/caca-aksi.js';
import { kataInti } from '../src/caca-kata.js';

// Bos Cyo 2026-10-10: karyawan bertanya 10 hal "bagaimana cara ..." soal CS dan Una
// menjawab "belum punya penjelasan". Lalu: "bukan cuma bisa jawab spesifik itu, tapi
// case yang setype" + "kalo ada tambahan program lagi ... peta yang bisa di refresh sendiri".

test('PENJAGA: peta menu Una sama dengan daftar menu aplikasi sekarang (jalankan node scripts/build-peta-una.mjs)', () => {
  const sekarang = readFileSync(new URL('../generated/peta-una-data.js', import.meta.url), 'utf8');
  assert.equal(sekarang, isiBerkas(bangunPeta()), 'Menu aplikasi berubah tapi peta Una belum disegarkan: node scripts/build-peta-una.mjs');
});

test('PENJAGA: setiap menu punya penjelasan untuk Una (src/caca-peta.js PENJELASAN)', () => {
  const kosong = PETA_UNA.filter((m) => !PENJELASAN[`${m.halaman}:${m.tab}`]?.bisa).map((m) => `${m.halaman}:${m.tab}`);
  assert.deepEqual(kosong, [], `Menu baru belum diajarkan ke Una: ${kosong.join(', ')}`);
  const basi = Object.keys(PENJELASAN).filter((k) => !PETA_UNA.some((m) => `${m.halaman}:${m.tab}` === k));
  assert.deepEqual(basi, [], `Penjelasan untuk menu yang sudah tidak ada: ${basi.join(', ')}`);
});

const HARAPAN = [
  // kalimat asli karyawan
  ['bagaimana cara menambah nama karyawan misal atas nama Rika Nur?', 'karyawan_tambah'],
  ['bagaimana cara membuat akun untuk cs atas nama Rika Nur dengan jam kerja senin 09.00-22.00, selasa sampai sabtu 09.00-18.00, minggu libur', 'akun_cs'],
  ['bagaimana cara rekap setoran cs?', 'setoran_cs'],
  ['bagaimana cara mengetahui setoran cs yang masih dibawa?', 'setoran_cs'],
  ['bagaimana cara mengetahui gaji harian cs?', 'gaji_harian'],
  ['bagaimana cara menambahkan potongan cs yang tidak masuk?', 'potongan_gaji'],
  ['bagaimana jika cs jam masuknya tiap hari tidak sama?', 'jadwal_beda'],
  ['bagaimana cara penyesuaian gaji cs jika cs terlambat', 'telat_gaji'],
  ['bagaimana jika admin salah mengaktifkan akun cs back up yang harusnya diaktifkan di gerai pendem tapi malah diaktifkan di gerai beji?', 'backup_salah_gerai'],
  ['bagaimana jika cs tidak bisa presensi sehingga tidak ada rekap presensi pada tanggal atau hari tertentu?', 'presensi_gagal'],
  // kalimat lain yang setipe (bukan kalimat uji)
  ['gimana nambahin pegawai baru?', 'karyawan_tambah'],
  ['gimana kalau cs lupa absen kemarin, honornya gimana', 'presensi_gagal'],
  ['di mana tempat ngasih denda karyawan yang bolos', 'potongan_gaji'],
  ['gimana caranya liat uang setoran yang belum disetor kasir', 'setoran_cs'],
  ['gimana kalau akun cadangan kepencet aktif di cabang lain', 'backup_salah_gerai'],
  ['cara ngatur jam kerja yang beda tiap hari', 'akun_cs'],
  ['gimana cara kasih bonus lembur ke cs', 'potongan_gaji'],
  ['di mana lihat karyawan yang telat', 'telat_gaji'],
  // pertanyaan cara pakai tanpa panduan khusus -> peta menu
  ['cara ganti logo toko', 'menu:store'],
  ['gimana cara kasih diskon ke pembeli', 'menu:vouchers'],
  ['gimana cara bikin pengumuman buat karyawan', 'menu:announcement'],
  ['bagaimana cara bayar hutang ke supplier', 'menu:hutangpiutang'],
  ['gimana cara liat stok', 'menu:stock'],
  ['cara cek barang terlaris', 'menu:reports'],
  // kamus lama tetap
  ['HPP itu apa', 'hpp'],
  ['rekening bersama itu apa', 'rekening_bersama'],
  ['una bisa apa aja', 'kemampuan']
];

for (const [kalimat, topik] of HARAPAN) {
  test(`panduan: "${kalimat.slice(0, 60)}" → ${topik}`, () => {
    const hasil = jelaskan(kalimat);
    assert.equal(hasil.dikenal, true);
    assert.equal(hasil.topik, topik);
  });
}

test('pengenal kata: imbuhan dan sinonim jadi kata baku', () => {
  const k = kataInti('gimana nambahin pegawai, honornya dan absen');
  for (const kata of ['tambah', 'karyawan', 'gaji', 'presensi']) assert.ok(k.has(kata), kata);
  assert.equal(cariMenu('zzz qqq'), null);
});

test('pertanyaan cara pakai dijawab panduan TANPA panggilan pilih-alat (hanya satu pemeriksaan kecil); pertanyaan data tetap ke model', async () => {
  let dipanggil = 0;
  const sistem = [];
  const panggilModel = async (_env, p) => { dipanggil += 1; sistem.push(p.system); return { ok: true, value: { alat: 'tidak_ada' } }; };
  const KONTEKS = { nama: 'Bos', peran: 'Owner', storeCode: 'G1', storeName: 'G1', hariIni: '2026-10-10', lingkup: 'gerai', namaLingkup: 'G1' };
  const hasil = await jawabPertanyaan('bagaimana cara menambah nama karyawan misal atas nama Rika Nur?', KONTEKS, { env: {}, panggilModel });
  assert.equal(dipanggil, 1, 'satu panggilan kecil: Gemini memeriksa & memoles panduan');
  assert.match(sistem[0], /PANDUAN RESMI/, 'bukan panggilan pilih-alat yang besar');
  assert.equal(hasil.alat, 'jelaskan');
  assert.match(hasil.jawaban, /Tambah karyawan/, 'model gagal memilih → teks panduan asli');
  for (const data of ['untung hari ini berapa', 'setoran cs yang masih dibawa siapa aja?', 'gimana kalau harga es teh jadi 7rb', 'bikin barang namanya cup jumbo harga jual 2000']) {
    assert.equal(panduanPasti(data), null, data);
  }
});

test('model bilang "tidak ada alat" → Una mencari panduan dulu, bukan langsung "belum bisa"', async () => {
  const panggilModel = async () => ({ ok: true, value: { alat: 'tidak_ada', alasan_kosong: 'tidak ada alat' } });
  const KONTEKS = { nama: 'Bos', peran: 'Owner', storeCode: 'G1', storeName: 'G1', hariIni: '2026-10-10', lingkup: 'gerai', namaLingkup: 'G1' };
  const hasil = await jawabPertanyaan('tolong jelasin soal potongan gaji cs yang bolos', KONTEKS, { env: {}, panggilModel });
  assert.equal(hasil.alat, 'jelaskan');
  assert.match(hasil.jawaban, /Penyesuaian Gaji/);
});

test('cek_setoran_cs: angka dari layar Setoran CS, total dihitung kode, saldo negatif apa adanya', async () => {
  const ctx = {
    namaLingkup: 'Mandala',
    baca: async (p) => (p === '/api/admin/employee-deposits/overview'
      ? { ok: true, data: { pending: [{ id: 1 }], balances: [
        { employeeName: 'Rika Nur', balanceRupiah: 150000, pendingAmountRupiah: 50000, belumMasukBukuRupiah: 0 },
        { employeeName: 'Dewi', balanceRupiah: -2000, pendingAmountRupiah: 0, belumMasukBukuRupiah: 0 },
        { employeeName: 'Lunas', balanceRupiah: 0, pendingAmountRupiah: 0, belumMasukBukuRupiah: 0 }
      ] } }
      : { ok: false, error: p })
  };
  const hasil = await cariAksi('cek_setoran_cs').siapkan({}, ctx);
  assert.match(hasil.jawaban, /total Rp148\.000 dari 2 orang; 1 bukti transfer menunggu ACC/);
  assert.deepEqual(hasil.tabel.isi.map((b) => b[0]), ['Rika Nur', 'Dewi']);
  assert.equal(hasil.tabel.isi[1][1], 'Rp−2.000');
});
