import test from 'node:test';
import assert from 'node:assert/strict';
import { jawabPertanyaan } from '../src/caca-agen.js';

const konteks = {
  nama: 'Bos Cyo',
  peran: 'Owner',
  storeCode: 'G001',
  storeName: 'Tunas Regency',
  hariIni: '2026-09-21'
};

/** Model palsu: balasan langkah 1 lalu langkah 2, sambil mencatat apa yang dikirim. */
function modelPalsu(...balasan) {
  const panggilan = [];
  const panggilModel = async (env, permintaan) => {
    panggilan.push(permintaan);
    const berikut = balasan[panggilan.length - 1];
    return berikut ?? { ok: false, status: 502, error: 'model kehabisan balasan' };
  };
  return { panggilModel, panggilan };
}

const pilih = (alat, tambahan = {}) => ({ ok: true, value: { alat, ...tambahan } });
const jawab = (teks) => ({ ok: true, value: { jawaban: teks } });

test('pertanyaan dijawab dari hasil alat, bukan dari model langsung', async () => {
  const { panggilModel, panggilan } = modelPalsu(
    pilih('laba_periode', { periode: 'hari_ini' }),
    jawab('Sampai sekarang untungnya 117.000.')
  );
  const jalankan = async () => ({ ok: true, data: { untung: 117000 }, periode: { dari: '2026-09-21', sampai: '2026-09-21' } });

  const hasil = await jawabPertanyaan('untung hari ini berapa?', konteks, { env: {}, panggilModel, jalankan });

  assert.equal(hasil.ok, true);
  assert.equal(hasil.alat, 'laba_periode');
  assert.equal(hasil.jawaban, 'Sampai sekarang untungnya 117.000.');
  assert.equal(panggilan.length, 2, 'dua langkah: pilih alat, lalu susun jawaban');
});

// Aturan ADR-044 yang tetap berlaku: angka keuangan tidak pernah datang dari
// ingatan model. Di langkah menyusun jawaban, satu-satunya angka yang tersedia
// baginya harus angka hasil query.
test('langkah menyusun jawaban benar-benar menerima data hasil query', async () => {
  const { panggilModel, panggilan } = modelPalsu(
    pilih('laba_periode', { periode: 'kemarin' }),
    jawab('Kemarin untungnya 539.000.')
  );
  const jalankan = async () => ({ ok: true, data: { penjualan: 539000 }, periode: { dari: '2026-09-20', sampai: '2026-09-20' } });

  await jawabPertanyaan('untung kemarin?', konteks, { env: {}, panggilModel, jalankan });

  const teksLangkahDua = panggilan[1].content.map((bagian) => bagian.text).join('\n');
  assert.ok(teksLangkahDua.includes('539000'), 'data asli ikut dikirim');
  assert.ok(teksLangkahDua.includes('2026-09-20'), 'periode yang benar-benar dipakai ikut disebut');
  assert.match(panggilan[1].system, /SEMUA angka harus berasal dari data/i);
});

test('alat tidak pernah dijalankan kalau model bilang tidak ada yang cocok', async () => {
  let dijalankan = false;
  const { panggilModel, panggilan } = modelPalsu(
    pilih('tidak_ada', { alasan_kosong: 'Caca belum bisa mencatat transaksi.' })
  );
  const jalankan = async () => { dijalankan = true; return { ok: true, data: {} }; };

  const hasil = await jawabPertanyaan('tolong catat penjualan 3 es teh', konteks, { env: {}, panggilModel, jalankan });

  assert.equal(dijalankan, false);
  assert.equal(hasil.alat, null);
  assert.match(hasil.jawaban, /belum bisa mencatat/i);
  assert.equal(panggilan.length, 1, 'tidak perlu langkah kedua');
});

// Penolakan wewenang tidak diserahkan ke model untuk "diperhalus" — kalau model
// yang menyusunnya, dia bisa mengarang alasan atau menawarkan jalan lain.
test('penolakan wewenang diteruskan apa adanya, tanpa lewat model', async () => {
  const { panggilModel, panggilan } = modelPalsu(pilih('stok_sisa'));
  const jalankan = async () => ({ ok: false, error: 'Admin Budi hanya berwenang pada gerai G002.', status: 403 });

  const hasil = await jawabPertanyaan('stok gula di gerai sebelah?', konteks, { env: {}, panggilModel, jalankan });

  assert.equal(hasil.ok, true);
  assert.equal(hasil.ditolak, true);
  assert.match(hasil.jawaban, /hanya berwenang/);
  assert.equal(panggilan.length, 1, 'model tidak diberi kesempatan mengarang alasan');
});

test('konteks penyuruh dan tanggal hari ini sampai ke model', async () => {
  const { panggilModel, panggilan } = modelPalsu(pilih('tidak_ada'));
  await jawabPertanyaan('halo', konteks, { env: {}, panggilModel, jalankan: async () => ({ ok: true, data: {} }) });

  assert.match(panggilan[0].system, /Bos Cyo/);
  assert.match(panggilan[0].system, /Tunas Regency/);
  assert.match(panggilan[0].system, /2026-09-21/);
});

test('model hanya boleh memilih nama alat yang ada di daftar', async () => {
  const { panggilModel, panggilan } = modelPalsu(pilih('tidak_ada'));
  await jawabPertanyaan('halo', konteks, { env: {}, panggilModel, jalankan: async () => ({ ok: true, data: {} }) });

  const pilihanAlat = panggilan[0].schema.properties.alat.enum;
  assert.ok(pilihanAlat.includes('laba_periode'));
  assert.ok(pilihanAlat.includes('tidak_ada'));
  assert.equal(pilihanAlat.includes('hapus_penjualan'), false);
});

test('mesin AI yang gagal dilaporkan sebagai gagal, bukan dijawab asal', async () => {
  const { panggilModel } = modelPalsu({ ok: false, status: 503, error: 'Kunci API belum dipasang.' });
  const hasil = await jawabPertanyaan('untung hari ini?', konteks, { env: {}, panggilModel, jalankan: async () => ({ ok: true, data: {} }) });

  assert.equal(hasil.ok, false);
  assert.equal(hasil.status, 503);
});
