import test from 'node:test';
import assert from 'node:assert/strict';
import {
  jawabPertanyaan, bersihkanKerja, teksPengamatan, MAKS_PUTARAN, MAKS_LANGKAH_KERJA, MAKS_PANJANG_PENGAMATAN
} from '../src/caca-agen.js';

// Mode agen berputar (Bos Cyo 2026-10-05): Una melihat hasil alatnya lalu
// memutuskan langkah berikutnya sendiri, sampai tuntas.

const konteks = {
  nama: 'Bos Cyo', peran: 'Owner', storeCode: 'G001', storeName: 'Mandala', hariIni: '2026-10-05', lingkup: 'gerai', namaLingkup: 'Mandala'
};

function modelPalsu(...balasan) {
  const panggilan = [];
  const panggilModel = async (env, permintaan) => {
    panggilan.push(permintaan);
    return balasan[panggilan.length - 1] ?? { ok: false, status: 502, error: 'model kehabisan balasan' };
  };
  return { panggilModel, panggilan };
}
const pilih = (alat, tambahan = {}) => ({ ok: true, value: { alat, ...tambahan } });
const teksDikirim = (permintaan) => permintaan.content.map((b) => b.text).join('\n');

test('agen melihat hasil alat lalu menjawab dari catatan kerja, tanpa langkah susun terpisah', async () => {
  const { panggilModel, panggilan } = modelPalsu(
    pilih('laba_periode', { periode: 'kemarin', lanjut: true, judul_langkah: 'Cek untung kemarin' }),
    pilih('selesai', { jawaban_akhir: 'Kemarin untungnya 539.000, Bos.' })
  );
  const jalankan = async () => ({ ok: true, data: { untung: 539000 }, periode: { dari: '2026-10-04', sampai: '2026-10-04' } });

  const hasil = await jawabPertanyaan('untung kemarin berapa? kalau jelek kasih tau', konteks, { env: {}, panggilModel, jalankan });

  assert.equal(panggilan.length, 2);
  assert.match(teksDikirim(panggilan[1]), /Catatan kerja Una/);
  assert.match(teksDikirim(panggilan[1]), /539000/, 'hasil alat terlihat di putaran berikutnya');
  assert.match(teksDikirim(panggilan[1]), /Cek untung kemarin/);
  assert.equal(hasil.jawaban, 'Kemarin untungnya 539.000, Bos.');
  assert.equal(hasil.peringatan, null);
  assert.equal(hasil.kerja.length, 1);
  assert.equal(hasil.kerja[0].judul, 'Cek untung kemarin');
});

test('tanpa lanjut=true perilakunya tetap sekali tembak seperti dulu', async () => {
  const { panggilModel, panggilan } = modelPalsu(
    pilih('laba_periode', { periode: 'hari_ini' }),
    { ok: true, value: { jawaban: 'Untungnya 117.000.' } }
  );
  const jalankan = async () => ({ ok: true, data: { untung: 117000 }, periode: { dari: '2026-10-05', sampai: '2026-10-05' } });
  const hasil = await jawabPertanyaan('untung hari ini?', konteks, { env: {}, panggilModel, jalankan });
  assert.equal(panggilan.length, 2);
  assert.equal(hasil.jawaban, 'Untungnya 117.000.');
  assert.equal(hasil.kerja, null);
  assert.equal(hasil.lanjutkan, undefined);
});

test('angka karangan di jawaban akhir: Una diminta memperbaiki diri sekali', async () => {
  const { panggilModel, panggilan } = modelPalsu(
    pilih('laba_periode', { periode: 'kemarin', lanjut: true }),
    pilih('selesai', { jawaban_akhir: 'Kemarin untungnya 900.000.' }),
    { ok: true, value: { jawaban: 'Kemarin untungnya 539.000.' } }
  );
  const jalankan = async () => ({ ok: true, data: { untung: 539000 } });
  const hasil = await jawabPertanyaan('untung kemarin', konteks, { env: {}, panggilModel, jalankan });
  assert.equal(panggilan.length, 3);
  assert.match(teksDikirim(panggilan[2]), /900\.000/);
  assert.equal(hasil.jawaban, 'Kemarin untungnya 539.000.');
  assert.equal(hasil.peringatan, null);
});

test('kalau tetap mengarang angka, jawaban diberi peringatan', async () => {
  const { panggilModel } = modelPalsu(
    pilih('laba_periode', { periode: 'kemarin', lanjut: true }),
    pilih('selesai', { jawaban_akhir: 'Untungnya 900.000.' }),
    { ok: true, value: { jawaban: 'Untungnya 901.000.' } }
  );
  const hasil = await jawabPertanyaan('untung kemarin', konteks, { env: {}, panggilModel, jalankan: async () => ({ ok: true, data: { untung: 539000 } }) });
  assert.match(hasil.peringatan, /901\.000/);
});

test('"selesai" tanpa data tidak boleh menyebut angka (menjawab dari ingatan)', async () => {
  const { panggilModel, panggilan } = modelPalsu(pilih('selesai', { jawaban_akhir: 'Stok gula tinggal 1.200 gram.' }));
  const hasil = await jawabPertanyaan('stok gula berapa', konteks, { env: {}, panggilModel });
  assert.equal(panggilan.length, 1);
  assert.doesNotMatch(hasil.jawaban, /1\.200/);
  assert.equal(hasil.belumLengkap, true);
});

test('obrolan ringan boleh langsung "selesai"', async () => {
  const { panggilModel } = modelPalsu(pilih('selesai', { jawaban_akhir: 'Sama-sama Bos!' }));
  const hasil = await jawabPertanyaan('makasih Una', konteks, { env: {}, panggilModel });
  assert.equal(hasil.jawaban, 'Sama-sama Bos!');
  assert.equal(hasil.kerja, null);
});

test('putaran satu permintaan habis: kirim lanjutkan + catatan kerja, lalu lanjut di permintaan berikutnya', async () => {
  const putar = Array.from({ length: MAKS_PUTARAN }, (_, i) => pilih('laba_periode', { periode: 'kemarin', lanjut: true, judul_langkah: `Langkah ${i + 1}` }));
  const { panggilModel } = modelPalsu(...putar);
  let jalan = 0;
  const jalankan = async () => { jalan += 1; return { ok: true, data: { ke: jalan } }; };
  const pertama = await jawabPertanyaan('kerjaan panjang', konteks, { env: {}, panggilModel, jalankan });
  assert.equal(pertama.lanjutkan, true);
  assert.equal(pertama.kerja.length, MAKS_PUTARAN);

  // Permintaan kedua membawa catatan kerja dari browser.
  const kedua = modelPalsu(pilih('selesai', { jawaban_akhir: 'Beres, Bos.' }));
  const hasil = await jawabPertanyaan('kerjaan panjang', konteks, { env: {}, panggilModel: kedua.panggilModel, jalankan, kerja: pertama.kerja });
  assert.match(teksDikirim(kedua.panggilan[0]), /Langkah 4/);
  assert.equal(hasil.jawaban, 'Beres, Bos.');
  assert.equal(hasil.kerja.length, MAKS_PUTARAN);
});

test('lanjutan tidak memakai alat pasti: pesan daftar HPP tidak memotong kerjaan', async () => {
  const { panggilModel, panggilan } = modelPalsu(pilih('selesai', { jawaban_akhir: 'Oke Bos.' }));
  await jawabPertanyaan('hpp gula = 17,5\nhpp kopi = 200', konteks, {
    env: {}, panggilModel, kerja: [{ alat: 'cek_barang', judul: 'Cek', hasil: 'Gula | 17' }]
  });
  assert.equal(panggilan.length, 1, 'model tetap ditanya, bukan langsung koreksi_hpp_banyak');
});

test('batas langkah total: Una berhenti dan bilang terus terang', async () => {
  const kerja = Array.from({ length: MAKS_LANGKAH_KERJA }, (_, i) => ({ alat: 'cek_barang', judul: `L${i}`, hasil: 'x' }));
  const { panggilModel, panggilan } = modelPalsu();
  const hasil = await jawabPertanyaan('lanjut', konteks, { env: {}, panggilModel, kerja });
  assert.equal(panggilan.length, 0);
  assert.match(hasil.jawaban, /berhenti dulu/);
});

test('draft di tengah kerjaan: berhenti menunggu "Ya" dan menandai lanjutSesudahYa', async () => {
  const { panggilModel } = modelPalsu(pilih('catat_pengeluaran', {
    keterangan: 'gas', nominal_tertulis: '22rb', pihak_tertulis: 'Pak Slamet', lanjut: true, judul_langkah: 'Catat gas'
  }));
  const hasil = await jawabPertanyaan('catat gas 22rb ke pak slamet, terus cek hutang', konteks, { env: {}, panggilModel });
  assert.equal(hasil.perluKonfirmasi, true);
  assert.equal(hasil.lanjutSesudahYa, true);
  assert.equal(hasil.kerja.length, 1);
  assert.match(hasil.kerja[0].hasil, /menunggu "Ya"/);
});

test('catatan kerja dari browser dibersihkan: alat aneh, panjang, jumlah', () => {
  const kotor = [
    null,
    { alat: 'cek_barang; DROP', judul: 'a'.repeat(300), hasil: 'b'.repeat(MAKS_PANJANG_PENGAMATAN + 500) },
    { alat: '', hasil: 'tanpa alat' },
    ...Array.from({ length: 30 }, (_, i) => ({ alat: 'baca_api', judul: `j${i}`, hasil: `h${i}` }))
  ];
  const bersih = bersihkanKerja(kotor);
  assert.ok(bersih.length <= MAKS_LANGKAH_KERJA);
  assert.ok(bersih.every((k) => /^[a-z_]+$/.test(k.alat)));
  assert.equal(bersih[bersih.length - 1].judul, 'j29', 'yang terbaru dipertahankan');
  assert.deepEqual(bersihkanKerja('bukan daftar'), []);
});

test('pengamatan memuat jawaban + tabel, dan dipotong kalau kepanjangan', () => {
  const teks = teksPengamatan({ jawaban: 'Ada 2 barang.', tabel: { kolom: ['Barang', 'Harga'], isi: [['Es Teh', '5.000'], ['Kopi', '8.000']] } });
  assert.match(teks, /Ada 2 barang/);
  assert.match(teks, /Es Teh \| 5\.000/);
  const panjang = teksPengamatan({ data: { isi: 'x'.repeat(10000) } });
  assert.ok(panjang.length <= MAKS_PANJANG_PENGAMATAN);
});

test('satu putaran per permintaan (panel): langkah pertama langsung dibalas supaya bisa dicentang', async () => {
  const { panggilModel, panggilan } = modelPalsu(
    pilih('laba_periode', { periode: 'kemarin', lanjut: true, judul_langkah: 'Cek untung kemarin' })
  );
  const hasil = await jawabPertanyaan('untung kemarin, terus bandingkan', konteks, {
    env: {}, panggilModel, jalankan: async () => ({ ok: true, data: { untung: 539000 } }), maksPutaran: 1
  });
  assert.equal(panggilan.length, 1);
  assert.equal(hasil.lanjutkan, true);
  assert.equal(hasil.kerja[0].judul, 'Cek untung kemarin');
});
