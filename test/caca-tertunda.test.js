import test from 'node:test';
import assert from 'node:assert/strict';
import { jawabPertanyaan } from '../src/caca-agen.js';
import { cariAksi } from '../src/caca-aksi.js';
import { jawabanPendek, isiKolomDariJawaban, gabungTangkapan, bersihkanTertunda, mintaBatal, terdengarBingung } from '../src/caca-tertunda.js';

// Bos Cyo 2026-10-09 (tangkapan layar): "bikin barang tutup cup manual, harganya
// 12rb dapet 50 pcs, jualnya sama dengan harga beli" → Una bertanya terus,
// "5000" dikira perintah lain, nama barang ditanya berulang.

const KONTEKS = { nama: 'Bos', peran: 'Entity Admin', storeCode: 'MANDALA', storeName: 'Mandala', hariIni: '2026-10-09', lingkup: 'gerai', namaLingkup: 'Mandala' };
const BOOTSTRAP = { units: [{ id: 'u_pcs', code: 'PCS', name: 'Pieces', symbol: 'pcs', isActive: true }], products: [] };
const jalur = { baca: async (p) => (p === '/api/admin/manufacturing/bootstrap' ? { ok: true, data: BOOTSTRAP } : { ok: false, error: p }), kirim: async () => ({ ok: true, data: {} }) };

function model(...balasan) {
  const panggilan = [];
  return { panggilan, panggilModel: async (env, p) => { panggilan.push(p); return balasan[panggilan.length - 1] ?? { ok: false, status: 502, error: 'habis' }; } };
}
const pilih = (alat, isi = {}) => ({ ok: true, value: { alat, ...isi } });

test('jawaban "5000" melengkapi tugas yang tertunda walau model memilih alat lain', async () => {
  const m1 = model(pilih('buat_barang', { barang_nama: 'tutup cup manual', barang_harga_beli: '12rb' }));
  const satu = await jawabPertanyaan('bikin barang namanya tutup cup manual, harga beli 12rb', KONTEKS, { env: {}, panggilModel: m1.panggilModel, jalurAksi: jalur });
  assert.equal(satu.belumLengkap, true);
  assert.match(satu.jawaban, /Harga jual "tutup cup manual" berapa/);
  assert.equal(satu.tertunda.alat, 'buat_barang');
  assert.equal(satu.tertunda.kurang, 'barang_harga_jual');
  assert.equal(satu.tertunda.tangkapan.barang_nama, 'tutup cup manual');

  // Model "lupa" dan memilih ubah_barang — persis kejadian di layar Bos.
  const m2 = model(pilih('ubah_barang', { ubah_daftar: [{ barang: 'tutup cup manual' }] }));
  const dua = await jawabPertanyaan('5000', KONTEKS, { env: {}, panggilModel: m2.panggilModel, jalurAksi: jalur, tertunda: satu.tertunda });
  assert.match(m2.panggilan[0].content[0].text, /TUGAS YANG SEDANG UNA KERJAKAN: alat buat_barang/);
  assert.equal(dua.perluKonfirmasi, true, dua.jawaban);
  assert.equal(dua.draft.muatan.name, 'tutup cup manual');
  assert.equal(dua.draft.muatan.price, 5000);
  assert.equal(dua.draft.muatan.purchasePrice, 12000, 'harga beli yang sudah disebut tidak ditimpa');
  assert.equal(dua.draft.tangkapan.barang_harga_jual, '5000', 'tangkapan draft = isian gabungan, lolos periksa ulang "Ya"');
});

test('nama yang ditanyakan diisi dari jawaban Bos, dan "harga jualnya 120" mengisi harga', async () => {
  const tertunda = { alat: 'buat_barang', tangkapan: { barang_harga_jual: '120' }, tanya: 'Nama barangnya apa?', kurang: 'barang_nama' };
  const m = model(pilih('buat_barang', {}));
  const hasil = await jawabPertanyaan('nama barangnya tutup cup manual', KONTEKS, { env: {}, panggilModel: m.panggilModel, jalurAksi: jalur, tertunda });
  assert.equal(hasil.draft.muatan.name, 'tutup cup manual');
  assert.equal(hasil.draft.muatan.price, 120);
  assert.equal(isiKolomDariJawaban('barang_harga_jual', 'harga jualnya 120'), '120');
  assert.equal(isiKolomDariJawaban('barang_harga_jual', 'ga tau'), null);
});

test('"12rb dapet 50 pcs, jual sama dengan harga beli" dihitung kode: Rp240 per pcs', async () => {
  const hasil = await cariAksi('buat_barang').siapkan({ barang_nama: 'tutup cup manual', barang_harga_beli: '12rb', barang_isi: '50', barang_jual_sama_beli: true }, { ...jalur, namaLingkup: 'Mandala' });
  assert.equal(hasil.ok, true, hasil.tanya);
  assert.equal(hasil.draft.muatan.purchasePrice, 240);
  assert.equal(hasil.draft.muatan.price, 240);
  assert.ok(hasil.draft.dampak.some((d) => /per satuan 240/.test(d)));
  assert.ok(hasil.draft.dampak.some((d) => /disamakan dengan harga beli/.test(d)));
  // Model menaruh 12rb di harga jual + "sama dengan beli": tetap dibaca sebagai harga beli.
  const terbalik = await cariAksi('buat_barang').siapkan({ barang_nama: 'tutup cup', barang_harga_jual: '12rb', barang_isi: '50', barang_jual_sama_beli: true }, { ...jalur, namaLingkup: 'Mandala' });
  assert.equal(terbalik.draft.muatan.price, 240);
  // Tidak habis dibagi: ditanyakan, bukan dibulatkan diam-diam.
  const ganjil = await cariAksi('buat_barang').siapkan({ barang_nama: 'x', barang_harga_beli: '10rb', barang_isi: '3', barang_harga_jual: '5rb' }, jalur);
  assert.equal(ganjil.ok, false);
  assert.equal(ganjil.kurang, 'barang_harga_beli');
});

test('bingung → Una menjelaskan ulang tugasnya; batal → tugas dilepas; tanpa panggil model', async () => {
  const tertunda = { alat: 'buat_barang', tangkapan: { barang_nama: 'tutup cup manual', barang_harga_beli: '12rb' }, tanya: 'Harga jual "tutup cup manual" berapa?', kurang: 'barang_harga_jual' };
  const m = model();
  const bingung = await jawabPertanyaan('ga jelas lu', KONTEKS, { env: {}, panggilModel: m.panggilModel, jalurAksi: jalur, tertunda });
  assert.match(bingung.jawaban, /tutup cup manual/);
  assert.match(bingung.jawaban, /Harga jual "tutup cup manual" berapa/);
  assert.deepEqual(bingung.tertunda, tertunda);
  const batal = await jawabPertanyaan('gajadi deh', KONTEKS, { env: {}, panggilModel: m.panggilModel, jalurAksi: jalur, tertunda });
  assert.equal(batal.tertunda, null);
  assert.equal(m.panggilan.length, 0);
  assert.ok(mintaBatal('batal'));
  assert.equal(mintaBatal('tutup cup manual'), false);
  assert.equal(terdengarBingung('harga jualnya 5000 maksudnya'), false, 'ada angka = jawaban, bukan bingung');
});

test('perintah baru yang jelas melepas tugas lama', async () => {
  const tertunda = { alat: 'buat_barang', tangkapan: { barang_nama: 'tutup cup manual' }, tanya: 'Harga jual berapa?', kurang: 'barang_harga_jual' };
  const m = model(pilih('laba_periode', { periode: 'hari_ini' }), { ok: true, value: { jawaban: 'Untung 117.000.' } });
  const hasil = await jawabPertanyaan('untung hari ini berapa', KONTEKS, { env: {}, panggilModel: m.panggilModel, jalankan: async () => ({ ok: true, data: { untung: 117000 } }), tertunda });
  assert.equal(hasil.alat, 'laba_periode');
  assert.equal(hasil.tertunda, undefined);
  assert.equal(jawabanPendek('untung hari ini berapa'), false);
  assert.equal(jawabanPendek('harga es teh berapa?'), false);
  assert.equal(jawabanPendek('5000'), true);
  assert.equal(jawabanPendek('tutup cup manual'), true);
});

test('tugas tertunda dari browser dibersihkan: alat liar, kolom liar, ukuran', () => {
  const kolom = (a) => (a === 'buat_barang' ? ['barang_nama', 'barang_harga_jual'] : null);
  assert.equal(bersihkanTertunda({ alat: 'hapus_semua' }, kolom), null);
  assert.equal(bersihkanTertunda('x', kolom), null);
  const t = bersihkanTertunda({ alat: 'buat_barang', tangkapan: { barang_nama: 'a', jahat: 'DROP' }, kurang: 'jahat', tanya: 'x'.repeat(999) }, kolom);
  assert.deepEqual(t.tangkapan, { barang_nama: 'a' });
  assert.equal(t.kurang, null);
  assert.equal(t.tanya.length, 300);
  assert.equal(bersihkanTertunda({ alat: 'buat_barang', tangkapan: { barang_nama: 'y'.repeat(1999), barang_harga_jual: ['z'.repeat(30000)] } }, kolom), null);
  assert.deepEqual(gabungTangkapan({ a: '1', b: '' }, { a: '2', b: '3' }, ['a', 'b'], { lengkapi: true }), { a: '1', b: '3' });
  assert.deepEqual(gabungTangkapan({ a: '1' }, { a: '2' }, ['a']), { a: '2' });
});

test('kalimat Bos dibaca kode: model lupa nama & harga, draft tetap lengkap (dan lolos periksa "Ya")', async () => {
  const { uraiPesanBarang, periksaUlangDraft } = await import('../src/caca-aksi.js');
  assert.deepEqual(uraiPesanBarang('bikin barang namanya tutup cup manual, harganya 12rb dapet 50 pcs. jual nya sama dengan harga beli'),
    { barang_nama: 'tutup cup manual', barang_isi: '50', barang_harga_beli: '12rb', barang_jual_sama_beli: true });
  assert.deepEqual(uraiPesanBarang('5000'), {});
  // Model hanya memilih alat, tanpa isian — persis pesan pertama di layar Bos.
  const m = model(pilih('buat_barang', {}));
  const hasil = await jawabPertanyaan('bikin barang namanya tutup cup manual, harganya 12rb dapet 50 pcs. jual nya sama dengan harga beli', KONTEKS, { env: {}, panggilModel: m.panggilModel, jalurAksi: jalur });
  assert.equal(hasil.perluKonfirmasi, true, hasil.jawaban);
  assert.equal(hasil.draft.muatan.name, 'tutup cup manual');
  assert.equal(hasil.draft.muatan.purchasePrice, 240);
  assert.equal(hasil.draft.muatan.price, 240);
  const diperiksa = await periksaUlangDraft(hasil.draft, { ...jalur, namaLingkup: 'Mandala', lingkup: 'gerai' });
  assert.equal(diperiksa.ok, true, diperiksa.error);
});
