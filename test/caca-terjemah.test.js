import test from 'node:test';
import assert from 'node:assert/strict';
import { terjemahkanPesan, bakukanTanggal, lengkapiTanggal, bakukanAngka, uraiSegmenDaftar } from '../src/caca-terjemah.js';
import { jawabPertanyaan, alatPasti } from '../src/caca-agen.js';

// Bos Cyo, 2026-10-04: "buatkan kodingan untuk sistem yang bisa menerjemahkan bahasa chat
// ke format yang sesuai ... selebihnya sistem harus mempunyai tool untuk itu" (model Una
// = Gemini lite). Penerjemah mengubah tanggal, daftar satu baris, dan tipe barang ke bentuk
// baku sebelum pemilih alat; kalimat biasa tidak disentuh.

const H = '2026-10-04';

test('tanggal: nama bulan, angka, dan "tanggal 28" saja -> YYYY-MM-DD, tidak pernah di masa depan', () => {
  assert.equal(bakukanTanggal('mulai 28 September', H), 'mulai 2026-09-28');
  assert.equal(bakukanTanggal('dari tgl 22/9', H), 'mulai 2026-09-22');
  assert.equal(bakukanTanggal('sejak tanggal 28', H), 'mulai 2026-09-28', 'tanggal 28 sesudah hari ini (4) -> bulan lalu');
  assert.equal(bakukanTanggal('dari tanggal 2', H), 'mulai 2026-10-02');
  assert.equal(bakukanTanggal('mulai 13 sept 2026', H), 'mulai 2026-09-13');
  assert.equal(bakukanTanggal('mulai 2026-09-28', H), 'mulai 2026-09-28', 'bentuk baku dibiarkan');
  assert.equal(lengkapiTanggal({ hari: 31, bulan: 2 }, H), null, 'tanggal mustahil tidak ditebak');
  assert.equal(bakukanTanggal('harga 17/5 per gram', H), 'harga 17/5 per gram', 'angka/angka tanpa kata mulai/dari tidak dianggap tanggal');
});

test('angka chat: rb/jt dikalikan dengan integer, pecahan koma tetap koma', () => {
  assert.equal(bakukanAngka('1,5', 'rb'), '1500');
  assert.equal(bakukanAngka('3', 'rb'), '3000');
  assert.equal(bakukanAngka('2,25', 'jt'), '2250000');
  assert.equal(bakukanAngka('0,4375', undefined), '0,4375');
});

test('daftar satu baris: koma+spasi/titik koma/"dan" memisah barang, koma tanpa spasi tetap desimal', () => {
  assert.deepEqual(uraiSegmenDaftar('air mineral 0,4375, gula 17,67; teh vanilla 1,5rb dan sedotan 52,1/pcs'), [
    { nama: 'air mineral', angka: '0,4375', satuan: '' },
    { nama: 'gula', angka: '17,67', satuan: '' },
    { nama: 'teh vanilla', angka: '1500', satuan: '' },
    { nama: 'sedotan', angka: '52,1', satuan: 'per pcs' }
  ]);
  assert.equal(uraiSegmenDaftar('gula, teh, dan air'), null, 'tanpa angka = bukan daftar harga');
});

test('pesan HPP ketik bebas -> format baku yang dikenali alatPasti', () => {
  const { teks, catatan } = terjemahkanPesan('koreksi hpp mandala mulai 28 september: air mineral 0,4375, gula 17,67, teh vanilla 1,5rb', H);
  assert.equal(teks, 'koreksi hpp mandala mulai 2026-09-28:\n1. air mineral = 0,4375\n2. gula = 17,67\n3. teh vanilla = 1500');
  assert.deepEqual(catatan, ['tanggal', 'daftar']);
  assert.equal(alatPasti(teks), 'koreksi_hpp_banyak');
});

test('tipe barang dan rentang harga ketik bebas', () => {
  assert.equal(terjemahkanPesan('jadikan bahan baku: gula, air mineral', H).teks, 'Tipe "bahan baku": gula, air mineral');
  assert.equal(alatPasti(terjemahkanPesan('jadikan bahan baku: gula, air mineral', H).teks), 'betulkan_klasifikasi_barang');
  const rentang = terjemahkanPesan('atur rentang harga beli beji, boleh selisih 25%: gula 17,5, lid sealer 39,5', H).teks;
  assert.equal(alatPasti(rentang), 'atur_rentang_harga_beli');
});

test('kalimat biasa tidak disentuh', () => {
  for (const m of ['untung hari ini berapa?', 'beli gas 22rb ke pak slamet, bayarnya nanti', 'stok gula, teh, dan air berapa?', 'Es Teh 5rb, Kopi 8rb']) {
    assert.equal(terjemahkanPesan(m, H).diubah, false, m);
  }
});

test('Una ujung ke ujung: pesan bebas satu baris jadi draft koreksi HPP 3 bahan tanpa memanggil model', async () => {
  let dipanggil = 0;
  const komponen = ['Air Mineral', 'Gula', 'Teh Vanilla'].map((name, i) => ({ productId: 50 + i, name, unitSymbol: 'pcs', averageCostRupiah: 1 }));
  const jalurAksi = { baca: async () => ({ ok: true, data: { components: komponen } }), kirim: async () => ({ ok: false, error: 'tidak boleh menulis' }) };
  const hasil = await jawabPertanyaan('koreksi hpp mandala mulai 28 september: air mineral 0,4375, gula 17,67, teh vanilla 1,5rb',
    { nama: 'Bos', peran: 'Owner', storeCode: 'MANDALA', storeName: 'Mandala', hariIni: H, lingkup: 'gerai', namaLingkup: 'Mandala' },
    { env: {}, panggilModel: async () => { dipanggil += 1; return { ok: true, value: { alat: 'tidak_ada' } }; }, jalurAksi });
  assert.equal(dipanggil, 0);
  assert.equal(hasil.alat, 'koreksi_hpp_banyak', hasil.jawaban);
  assert.deepEqual(hasil.draft.muatan.daftar.map((b) => [b.name, b.unitCost, b.from]), [
    ['Air Mineral', '0.4375', '2026-09-28'], ['Gula', '17.67', '2026-09-28'], ['Teh Vanilla', '1500', '2026-09-28']
  ]);
});

test('satu bahan kalimat biasa: model tetap dipakai, tetapi tanggalnya sudah baku saat dikirim ke model', async () => {
  let dikirim = '';
  await jawabPertanyaan('hpp gula harusnya 17,5 dari tanggal 28', { nama: 'Bos', peran: 'Owner', storeCode: 'BEJI', storeName: 'Beji', hariIni: H, lingkup: 'gerai', namaLingkup: 'Beji' },
    { env: {}, panggilModel: async (env, req) => { dikirim ||= req.content.map((c) => c.text).join(' '); return { ok: true, value: { alat: 'tidak_ada' } }; } });
  assert.match(dikirim, /mulai 2026-09-28/);
});
