import test from 'node:test';
import assert from 'node:assert/strict';
import { siapkanDraftPengeluaran, bangunPermintaanPengeluaran, postingPengeluaran } from '../src/caca-tulis.js';
import { jawabPertanyaan, ALAT_CATAT_PENGELUARAN } from '../src/caca-agen.js';

const hariIni = '2026-09-29';
const tangkapan = (ubah = {}) => ({
  keterangan: 'beli gas',
  nominal_tertulis: '22rb',
  pihak_tertulis: 'Pak Slamet',
  ...ubah
});

test('perintah lengkap jadi draft dengan nominal rupiah bulat', () => {
  const hasil = siapkanDraftPengeluaran(tangkapan(), { hariIni });

  assert.equal(hasil.ok, true);
  assert.equal(hasil.draft.nominal, 22000);
  assert.equal(Number.isInteger(hasil.draft.nominal), true);
  assert.equal(hasil.draft.keterangan, 'beli gas');
  assert.equal(hasil.draft.pihak, 'Pak Slamet');
  assert.equal(hasil.draft.tanggal, hariIni, 'tanpa tanggal disebut, pakai hari ini');
});

// Konfirmasi yang cuma mengulang perintah gampang di-klik tanpa dibaca. Yang
// membuat orang berhenti adalah akibat yang tidak dia duga.
test('draft menyebut akibatnya, bukan mengulang perintah', () => {
  const { draft } = siapkanDraftPengeluaran(tangkapan(), { hariIni });
  const dampak = draft.dampak.join(' ').toLowerCase();

  assert.match(dampak, /hutang/, 'yang paling tidak diduga: ini hutang, bukan uang tunai keluar');
  assert.match(dampak, /pak slamet/i);
  assert.match(dampak, /22\.000/);
  assert.match(dampak, /belum ada uang yang keluar/i);
});

test('yang kurang ditanyakan balik, bukan diisi tebakan', () => {
  assert.equal(siapkanDraftPengeluaran(tangkapan({ pihak_tertulis: '' }), { hariIni }).ok, false);
  assert.equal(siapkanDraftPengeluaran(tangkapan({ keterangan: '' }), { hariIni }).ok, false);
  assert.equal(siapkanDraftPengeluaran(tangkapan({ nominal_tertulis: '' }), { hariIni }).ok, false);
});

test('pertanyaan balik soal pihak menyebut ulang apa yang sudah ditangkap', () => {
  const hasil = siapkanDraftPengeluaran(tangkapan({ pihak_tertulis: '' }), { hariIni });
  assert.match(hasil.tanya, /beli gas/);
  assert.match(hasil.tanya, /22\.000/);
});

test('tanggal masa depan ditolak', () => {
  const hasil = siapkanDraftPengeluaran(tangkapan({ tanggal_tertulis: '2027-01-01' }), { hariIni });
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /masa depan/i);
});

test('tanggal mundur yang disebut penanya dipakai apa adanya', () => {
  const hasil = siapkanDraftPengeluaran(tangkapan({ tanggal_tertulis: '2026-09-20' }), { hariIni });
  assert.equal(hasil.draft.tanggal, '2026-09-20');
});

function requestPenyuruh() {
  return new Request('https://leker.test/api/caca/catat', {
    method: 'POST',
    headers: { Authorization: 'Bearer token-penyuruh' }
  });
}

test('permintaan pencatatan membawa kredensial penyuruh dan gerai dari sesi', () => {
  const { draft } = siapkanDraftPengeluaran(tangkapan(), { hariIni });
  const permintaan = bangunPermintaanPengeluaran(draft, { request: requestPenyuruh(), storeCode: 'G002' });

  assert.equal(permintaan.headers.get('Authorization'), 'Bearer token-penyuruh');
  assert.ok(permintaan.url.includes('/api/admin/operational-expenses'));
  assert.ok(permintaan.url.includes('store=G002'));
  assert.equal(permintaan.method, 'POST');
});

test('isi yang dikirim sesuai bentuk yang diminta endpoint Bea Operasional', async () => {
  const { draft } = siapkanDraftPengeluaran(tangkapan(), { hariIni });
  const permintaan = bangunPermintaanPengeluaran(draft, { request: requestPenyuruh(), storeCode: 'G001' });
  const isi = await permintaan.json();

  assert.equal(isi.category, 'BEA_LAINNYA');
  assert.equal(isi.amount, 22000);
  assert.equal(isi.counterpartyType, 'OTHER');
  assert.equal(isi.counterpartyName, 'Pak Slamet');
  assert.equal(isi.businessDate, hariIni);
});

test('penolakan dari jalur pencatatan diteruskan apa adanya', async () => {
  const { draft } = siapkanDraftPengeluaran(tangkapan(), { hariIni });
  const hasil = await postingPengeluaran(draft, {
    request: requestPenyuruh(),
    env: {},
    storeCode: 'G001',
    handler: async () => ({ ok: false, status: 409, json: async () => ({ error: 'Gerai ini belum terhubung Entity, Hutang butuh itu.' }) })
  });

  assert.equal(hasil.ok, false);
  assert.equal(hasil.status, 409);
  assert.match(hasil.error, /belum terhubung Entity/);
});

// --- hemat kuota: inti ADR-045 Tahap B ------------------------------------

const konteks = { nama: 'Bos Cyo', peran: 'Owner', storeCode: 'G001', storeName: 'Tunas Regency', hariIni };

function modelPalsu(balasan) {
  const panggilan = [];
  return {
    panggilan,
    panggilModel: async (env, permintaan) => {
      panggilan.push(permintaan);
      return balasan[panggilan.length - 1] ?? { ok: false, status: 502, error: 'kehabisan balasan' };
    }
  };
}

// Kalau tiap langkah diserahkan ke model (pahami, susun konfirmasi, baca "ya",
// laporkan), satu pencatatan makan 4-5 panggilan. Ini yang menjaga tetap satu.
test('mencatat pengeluaran cuma sekali panggil mesin AI', async () => {
  const { panggilModel, panggilan } = modelPalsu([
    { ok: true, value: { alat: ALAT_CATAT_PENGELUARAN, ...tangkapan() } }
  ]);

  const hasil = await jawabPertanyaan('beli gas 22rb ke Pak Slamet', konteks, { env: {}, panggilModel });

  assert.equal(panggilan.length, 1, 'draft disusun kode, bukan panggilan model kedua');
  assert.equal(hasil.perluKonfirmasi, true);
  assert.equal(hasil.draft.nominal, 22000);
});

test('satu panggilan itu sekaligus memilih alat dan menangkap isinya', async () => {
  const { panggilModel, panggilan } = modelPalsu([
    { ok: true, value: { alat: ALAT_CATAT_PENGELUARAN, ...tangkapan() } }
  ]);
  await jawabPertanyaan('beli gas 22rb ke Pak Slamet', konteks, { env: {}, panggilModel });

  const skema = panggilan[0].schema.properties;
  assert.ok(skema.alat.enum.includes(ALAT_CATAT_PENGELUARAN));
  assert.ok(skema.nominal_tertulis, 'isian pengeluaran ikut di skema yang sama');
  assert.ok(skema.periode, 'isian alat baca juga masih di skema yang sama');
});

test('perintah yang belum lengkap tetap cuma sekali panggil', async () => {
  const { panggilModel, panggilan } = modelPalsu([
    { ok: true, value: { alat: ALAT_CATAT_PENGELUARAN, ...tangkapan({ pihak_tertulis: '' }) } }
  ]);

  const hasil = await jawabPertanyaan('beli gas 22rb', konteks, { env: {}, panggilModel });

  assert.equal(panggilan.length, 1);
  assert.equal(hasil.belumLengkap, true);
  assert.equal(hasil.draft, undefined, 'belum jadi draft selama belum lengkap');
});

test('mencatat tidak pernah menyentuh alat baca', async () => {
  let alatBacaDijalankan = false;
  const { panggilModel } = modelPalsu([
    { ok: true, value: { alat: ALAT_CATAT_PENGELUARAN, ...tangkapan() } }
  ]);

  await jawabPertanyaan('beli gas 22rb ke Pak Slamet', konteks, {
    env: {},
    panggilModel,
    jalankan: async () => { alatBacaDijalankan = true; return { ok: true, data: {} }; }
  });

  assert.equal(alatBacaDijalankan, false);
});

test('yang belum dilayani ditolak jujur, bukan dipaksakan ke alat yang mirip', async () => {
  const { panggilModel } = modelPalsu([
    { ok: true, value: { alat: 'tidak_ada', alasan_kosong: 'Caca belum bisa mencatat penjualan.' } }
  ]);

  const hasil = await jawabPertanyaan('catat penjualan 3 es teh 15rb', konteks, { env: {}, panggilModel });

  assert.equal(hasil.alat, null);
  assert.match(hasil.jawaban, /belum bisa mencatat penjualan/i);
});
