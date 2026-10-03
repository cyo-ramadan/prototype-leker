import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jawabPertanyaan } from '../src/caca-agen.js';
import { uraiDaftarHpp } from '../src/caca-aksi-hpp-banyak.js';
import { uraiDaftarTipe } from '../src/caca-aksi-klasifikasi.js';

// Kejadian 2026-10-04 06.51 (screenshot Bos Cyo): blok Langkah 1 MANDALA (8 bahan)
// ditempel ke Una; Una memilih koreksi_hpp_banyak tetapi model mengembalikan daftar
// kosong, sehingga Una balik bertanya "Bahan apa saja yang HPP-nya mau dikoreksi...?".
// Sekarang daftar dibaca langsung dari teks yang ditempel.

const BLOK_MANDALA = `Una, koreksi HPP MANDALA mulai 2026-09-28 pakai koreksi_hpp_banyak, satu draft untuk semua. Urutan harus persis begini (bahan baku dulu, larutan di belakang). Harga per satuan, koma = desimal (jangan diubah jadi titik):
1. Air Mineral = 0,4375 per ml
2. Gula = 17,666667 per pcs
3. Lid Sealer = 39,5 per pcs
4. Sedotan = 52,1 per pcs
5. Teh Vanilla = 1500 per pcs
6. Larutan Gula = 11,315104 per ml
7. Larutan Teh Poci Jasmine = 1,003538 per ml
8. Larutan Teh Poci Vanilla = 1,1875 per ml`;

const BLOK_TIPE = `Una, di MANDALA: betulkan Tipe Barang dulu pakai betulkan_klasifikasi_barang. Jenis Barang jangan diubah, satuan jangan diubah.
Tipe "bahan baku": Air Mineral, Gula, Teh Vanilla.
Tipe "setengah jadi": Larutan Gula, Larutan Teh Poci Jasmine.`;

const konteks = { nama: 'Bos Cyo', peran: 'Owner', storeCode: 'MANDALA', storeName: 'Mandala', hariIni: '2026-10-04', lingkup: 'gerai', namaLingkup: 'Mandala' };

const NAMA = ['Air Mineral', 'Gula', 'Lid Sealer', 'Sedotan', 'Teh Vanilla', 'Larutan Gula', 'Larutan Teh Poci Jasmine', 'Larutan Teh Poci Vanilla'];

test('uraiDaftarHpp: blok Langkah 1 terbaca utuh, urutan dan angka apa adanya, tanggal mulai ikut', () => {
  const { daftar, dari } = uraiDaftarHpp(BLOK_MANDALA);
  assert.equal(dari, '2026-09-28');
  assert.deepEqual(daftar.map((b) => b.bahan), NAMA);
  assert.deepEqual(daftar.map((b) => b.harga), ['0,4375', '17,666667', '39,5', '52,1', '1500', '11,315104', '1,003538', '1,1875']);
});

test('uraiDaftarHpp: baris kalimat biasa (termasuk "koma = desimal") tidak ikut terbaca', () => {
  assert.deepEqual(uraiDaftarHpp('Una, koreksi HPP mulai 2026-09-28. Harga per satuan, koma = desimal (jangan diubah jadi titik):').daftar, []);
  assert.deepEqual(uraiDaftarHpp('Gula harusnya 17,5 ya').daftar, []);
});

test('semua blok Langkah 1 di INSTRUKSI-UNA-HPP-SEPTEMBER.md terbaca lengkap', () => {
  const doc = readFileSync(new URL('../INSTRUKSI-UNA-HPP-SEPTEMBER.md', import.meta.url), 'utf8');
  const blok = [...doc.matchAll(/```\n(Una, koreksi HPP [\s\S]*?)\n```/g)].map((m) => m[1]);
  assert.ok(blok.length >= 8);
  for (const isi of blok) {
    const baris = isi.split('\n').filter((b) => /^\d+\. /.test(b)).length;
    const { daftar, dari } = uraiDaftarHpp(isi);
    assert.equal(daftar.length, baris, isi.split('\n')[0]);
    assert.match(dari, /^2026-09-\d{2}$/);
  }
});

test('Una: model mengembalikan daftar kosong, draft tetap berisi 8 bahan dari teks', async () => {
  const komponen = NAMA.map((name, i) => ({ productId: 200 + i, name, unitSymbol: /Larutan|Air/.test(name) ? 'ml' : 'pcs', averageCostRupiah: 1 }));
  const jalurAksi = {
    baca: async (path) => (path === '/api/admin/hpp-recalculation/components' ? { ok: true, data: { components: komponen } } : { ok: false, error: path }),
    kirim: async () => ({ ok: false, error: 'tidak boleh menulis saat menyusun draft' })
  };
  const panggilModel = async () => ({ ok: true, value: { alat: 'koreksi_hpp_banyak', kh_daftar: [], kh_dari: null } });
  const hasil = await jawabPertanyaan(BLOK_MANDALA, konteks, { env: {}, panggilModel, jalurAksi });
  assert.equal(hasil.perluKonfirmasi, true, hasil.jawaban);
  assert.deepEqual(hasil.draft.muatan.daftar.map((b) => b.name), NAMA);
  assert.deepEqual(hasil.draft.muatan.daftar.map((b) => b.unitCost), ['0.4375', '17.666667', '39.5', '52.1', '1500', '11.315104', '1.003538', '1.1875']);
  assert.ok(hasil.draft.muatan.daftar.every((b) => b.from === '2026-09-28'));
});

test('uraiDaftarTipe + Una: blok Langkah 0 terbaca walau tangkapan model kosong', async () => {
  assert.deepEqual(uraiDaftarTipe(BLOK_TIPE), [
    { barang: 'Air Mineral', tipe: 'bahan baku' }, { barang: 'Gula', tipe: 'bahan baku' }, { barang: 'Teh Vanilla', tipe: 'bahan baku' },
    { barang: 'Larutan Gula', tipe: 'setengah jadi' }, { barang: 'Larutan Teh Poci Jasmine', tipe: 'setengah jadi' }
  ]);
  const TIPE = [
    { id: 't_raw', code: 'RAW_MATERIAL', name: 'Bahan Baku', isActive: true },
    { id: 't_semi', code: 'SEMI_FINISHED', name: 'Barang Setengah Jadi', isActive: true },
    { id: 't_fin', code: 'FINISHED_GOOD', name: 'Barang Jadi', isActive: true }
  ];
  const products = ['Air Mineral', 'Gula', 'Teh Vanilla', 'Larutan Gula', 'Larutan Teh Poci Jasmine'].map((name, i) => ({ id: i + 1, name, isActive: true, itemTypeId: 't_fin', productKindId: 'k', baseUnitId: 'u' }));
  const jalurAksi = {
    baca: async () => ({ ok: true, data: { products, itemTypes: TIPE, productKinds: [], units: [] } }),
    kirim: async () => ({ ok: false, error: 'tidak boleh menulis saat menyusun draft' })
  };
  const panggilModel = async () => ({ ok: true, value: { alat: 'betulkan_klasifikasi_barang', kb_daftar: null } });
  const hasil = await jawabPertanyaan(BLOK_TIPE, konteks, { env: {}, panggilModel, jalurAksi });
  assert.equal(hasil.perluKonfirmasi, true, hasil.jawaban);
  assert.deepEqual(hasil.draft.muatan.daftar.map((b) => [b.name, b.perubahan.itemTypeId]), [
    ['Air Mineral', 't_raw'], ['Gula', 't_raw'], ['Teh Vanilla', 't_raw'], ['Larutan Gula', 't_semi'], ['Larutan Teh Poci Jasmine', 't_semi']
  ]);
});

// Bos Cyo 2026-10-04: "ai nya tu gemini lite yang paling jelek, jadi harus toolnya yang pinter".
test('alatPasti: daftar baku dikenali kode, model TIDAK dipanggil sama sekali', async () => {
  const { alatPasti } = await import('../src/caca-agen.js');
  assert.equal(alatPasti(BLOK_MANDALA), 'koreksi_hpp_banyak');
  assert.equal(alatPasti(BLOK_TIPE), 'betulkan_klasifikasi_barang');
  assert.equal(alatPasti('untung hari ini berapa?'), null);
  assert.equal(alatPasti('HPP gula harusnya 17,5 dari tanggal 28'), null, 'satu bahan dengan kalimat biasa tetap lewat model');
  assert.equal(alatPasti('Es Teh = 5000\nKopi = 8000'), null, 'daftar harga tanpa kata HPP bukan koreksi HPP');

  let dipanggil = 0;
  const komponen = NAMA.map((name, i) => ({ productId: 300 + i, name, unitSymbol: 'pcs', averageCostRupiah: 1 }));
  const jalurAksi = { baca: async () => ({ ok: true, data: { components: komponen } }), kirim: async () => ({ ok: false, error: 'x' }) };
  const panggilModel = async () => { dipanggil += 1; return { ok: true, value: { alat: 'tidak_ada' } }; };
  const hasil = await jawabPertanyaan(BLOK_MANDALA, konteks, { env: {}, panggilModel, jalurAksi });
  assert.equal(dipanggil, 0);
  assert.equal(hasil.alat, 'koreksi_hpp_banyak');
  assert.equal(hasil.draft.muatan.daftar.length, 8);
});

test('alatPasti di lingkup entity: tetap diminta pilih gerai dulu, tidak dijalankan', async () => {
  const hasil = await jawabPertanyaan(BLOK_MANDALA, { ...konteks, lingkup: 'entity' }, { env: {}, panggilModel: async () => ({ ok: false, error: 'tidak dipanggil' }), jalurAksi: {} });
  assert.equal(hasil.belumLengkap, true);
  assert.match(hasil.jawaban, /Pilih gerainya dulu/);
});
