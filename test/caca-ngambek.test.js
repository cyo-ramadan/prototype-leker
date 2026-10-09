import test from 'node:test';
import assert from 'node:assert/strict';
import { jawabPertanyaan, jangkarRencana, pecahKlausa } from '../src/caca-agen.js';
import { tingkatUlang, terapkanNgambek, kalimatNgambek, kunciBalasan, TINGKAT_KUNCI } from '../src/caca-tertunda.js';

// Bos Cyo 2026-10-09 (tiga tangkapan layar): rencana kehilangan harga pizza hot,
// pertanyaan "Harga jual pizza hot berapa?" berulang walau Bos bilang "coba baca
// sebelumnya", dan Bos tidak suka balasan yang sama berulang → Una "ngambek".

const KONTEKS = { nama: 'Bos', peran: 'Entity Admin', storeCode: 'MANDALA', storeName: 'Mandala', hariIni: '2026-10-09', lingkup: 'gerai', namaLingkup: 'Mandala' };
const PRODUK = [{ id: 7, name: 'es sejuk', price: 12000, purchasePrice: 5000, isActive: true, category: 'Menu' }];
const jalur = {
  baca: async (p) => {
    if (p === '/api/admin/manufacturing/bootstrap') return { ok: true, data: { units: [{ id: 'u_pcs', code: 'PCS', name: 'Pieces', symbol: 'pcs', isActive: true }], products: PRODUK } };
    if (p.startsWith('/api/admin/master/products/editor')) return { ok: true, data: { products: PRODUK } };
    return { ok: false, error: p };
  },
  kirim: async () => ({ ok: true, data: {} })
};
function model(...balasan) {
  const panggilan = [];
  return { panggilan, panggilModel: async (env, p) => { panggilan.push(p); return balasan[panggilan.length - 1] ?? { ok: false, status: 502, error: 'habis' }; } };
}
const pilih = (alat, isi = {}) => ({ ok: true, value: { alat, ...isi } });

test('langkah rencana mendapat lagi potongan kalimat asli Bos yang angkanya hilang', () => {
  const pesan = 'namanya ganti es mega mendung. sama bikin lagi barang baru namanya pizza hot harga jual 25000 harga beli 10000';
  assert.equal(pecahKlausa(pesan).length, 2);
  const [satu, dua] = jangkarRencana([
    { judul: 'Ubah nama draft', perintah: 'ganti nama draft jadi es mega mendung' },
    { judul: 'Buat barang baru', perintah: 'buat barang baru pizza hot' }
  ], pesan);
  assert.equal(satu.perintah, 'ganti nama draft jadi es mega mendung', 'langkah tanpa angka hilang tidak diubah');
  assert.match(dua.perintah, /harga jual 25000 harga beli 10000/);
});

test('sebelum bertanya, Una membaca ulang pesan Bos sebelumnya untuk barang yang sama', async () => {
  const riwayat = [
    { dari: 'saya', teks: 'namanya ganti es mega mendung. sama bikin lagi barang baru namanya pizza hot harga jual 25000 harga beli 10000' },
    { dari: 'una', teks: 'Siap, Una kerjakan bertahap ya.' },
    { dari: 'saya', teks: 'harga es kopi 9rb' }
  ];
  const m = model(pilih('buat_barang', { barang_nama: 'pizza hot' }));
  const hasil = await jawabPertanyaan('barang baru pizza hot nya mana', { ...KONTEKS, riwayat }, { env: {}, panggilModel: m.panggilModel, jalurAksi: jalur });
  assert.equal(hasil.perluKonfirmasi, true, hasil.jawaban);
  assert.equal(hasil.draft.muatan.price, 25000);
  assert.equal(hasil.draft.tangkapan.barang_harga_jual, '25000', 'ikut tangkapan, lolos periksa "Ya"');
});

test('koreksi barang yang barusan tercatat jadi ubah_barang, walau model memilih buat_barang', async () => {
  const tertunda = { alat: 'ubah_barang', tangkapan: { ubah_daftar: [{ barang: 'es sejuk' }] }, revisi: true, tercatat: true };
  const m = model(pilih('buat_barang', { barang_nama: 'es mega mendung' }));
  const hasil = await jawabPertanyaan('namanya ganti es mega mendung', KONTEKS, { env: {}, panggilModel: m.panggilModel, jalurAksi: jalur, tertunda });
  assert.match(m.panggilan[0].content[0].text, /BARU SAJA disimpan/);
  assert.equal(hasil.alat, 'ubah_barang', hasil.jawaban);
  assert.equal(hasil.draft.muatan.daftar[0].id, 7);
  assert.equal(hasil.draft.muatan.daftar[0].perubahan.name, 'es mega mendung');
});

test('balasan mentok yang sama berulang → ngambek bertingkat, lalu chat dikunci, lalu mulai lagi', () => {
  const tanya = 'Harga jual "pizza hot" berapa?';
  const tertunda = { alat: 'buat_barang', kurang: 'barang_harga_jual', tangkapan: { barang_nama: 'pizza hot' }, tanya };
  const hasil = { ok: true, alat: 'buat_barang', jawaban: tanya, belumLengkap: true, tertunda };
  const riwayat = [];
  const keluar = [];
  for (let i = 0; i < 7; i += 1) {
    const r = terapkanNgambek(hasil, riwayat);
    keluar.push(r);
    riwayat.push({ dari: 'saya', teks: 'coba baca sebelumnya' }, { dari: 'una', teks: r.jawaban });
  }
  assert.equal(keluar[0].jawaban, tanya, 'pertama kali tetap bertanya biasa');
  assert.match(keluar[1].jawaban, /Una kurang ngerti.*harga jual "pizza hot" berapa/);
  assert.match(keluar[2].jawaban, /rada lola.*ngambek/);
  assert.match(keluar[3].jawaban, /Udah lah, Una ngambek/);
  assert.match(keluar[4].jawaban, /#\$@\^##\^/);
  assert.equal(keluar[TINGKAT_KUNCI].ngambek.detik, 60);
  assert.equal(keluar[6].jawaban, tanya, 'sesudah dikunci, mulai lagi dari awal');
});

test('"Una belum bisa ..." berulang juga ngambek; jawaban data yang sama tidak', () => {
  assert.equal(kunciBalasan('Una belum bisa bantu yang itu — x'), kunciBalasan('Una belum bisa menjawab yang itu.'));
  const belumBisa = { ok: true, alat: null, jawaban: 'Una belum bisa menjawab yang itu.' };
  const r = terapkanNgambek(belumBisa, [{ dari: 'una', teks: 'Una belum bisa bantu yang itu — alat tidak ada' }]);
  assert.match(r.jawaban, /Una kurang ngerti.*maksud Bos/);
  const data = { ok: true, alat: 'laba_periode', jawaban: 'Untungnya 117.000.' };
  assert.equal(terapkanNgambek(data, [{ dari: 'una', teks: 'Untungnya 117.000.' }]).jawaban, 'Untungnya 117.000.');
  assert.equal(tingkatUlang('x', 'bukan daftar'), 0);
  assert.match(kalimatNgambek(4, 'apa'), /Una ngambek/);
});
