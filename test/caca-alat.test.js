import test from 'node:test';
import assert from 'node:assert/strict';
import { hitungPeriode, bangunPermintaanAlat, jalankanAlat, daftarAlatUntukModel } from '../src/caca-alat.js';

// Periode dihitung kode, bukan model. Salah sehari di sini bikin laporan
// bergeser tanpa ada yang terlihat aneh, jadi batas-batasnya diuji ketat.
test('periode harian dihitung dari tanggal bisnis, bukan dari jam server', () => {
  assert.deepEqual(hitungPeriode('hari_ini', {}, '2026-09-21'), { ok: true, dari: '2026-09-21', sampai: '2026-09-21' });
  assert.deepEqual(hitungPeriode('kemarin', {}, '2026-09-21'), { ok: true, dari: '2026-09-20', sampai: '2026-09-20' });
});

test('kemarin tetap benar saat lompat bulan dan tahun', () => {
  assert.equal(hitungPeriode('kemarin', {}, '2026-03-01').dari, '2026-02-28');
  assert.equal(hitungPeriode('kemarin', {}, '2026-01-01').dari, '2025-12-31');
});

test('tujuh hari terakhir termasuk hari ini, jadi tujuh hari bukan delapan', () => {
  const hasil = hitungPeriode('7_hari_terakhir', {}, '2026-09-21');
  assert.deepEqual(hasil, { ok: true, dari: '2026-09-15', sampai: '2026-09-21' });
});

test('bulan ini berhenti di hari ini, tidak sampai akhir bulan', () => {
  assert.deepEqual(hitungPeriode('bulan_ini', {}, '2026-09-21'), { ok: true, dari: '2026-09-01', sampai: '2026-09-21' });
});

test('bulan lalu dihitung penuh, termasuk Februari dan lompatan tahun', () => {
  assert.deepEqual(hitungPeriode('bulan_lalu', {}, '2026-03-15'), { ok: true, dari: '2026-02-01', sampai: '2026-02-28' });
  assert.deepEqual(hitungPeriode('bulan_lalu', {}, '2026-01-10'), { ok: true, dari: '2025-12-01', sampai: '2025-12-31' });
});

test('rentang tanpa tanggal jelas ditanyakan balik, bukan ditebak', () => {
  assert.equal(hitungPeriode('rentang', {}, '2026-09-21').ok, false);
  assert.equal(hitungPeriode('rentang', { dari: '2026-09-01' }, '2026-09-21').ok, false);
});

test('rentang terbalik ditolak', () => {
  const hasil = hitungPeriode('rentang', { dari: '2026-09-20', sampai: '2026-09-01' }, '2026-09-21');
  assert.equal(hasil.ok, false);
});

test('periode yang tidak dikenali tidak diam-diam jadi hari ini', () => {
  assert.equal(hitungPeriode('minggu_depan', {}, '2026-09-21').ok, false);
  assert.equal(hitungPeriode(undefined, {}, '2026-09-21').ok, false);
});

test('daftar alat untuk model tidak membocorkan alamat endpoint', () => {
  const daftar = daftarAlatUntukModel();
  assert.ok(daftar.includes('laba_periode'));
  assert.equal(daftar.includes('/api/'), false, 'model memilih nama alat, bukan menyusun URL');
});

function requestPenyuruh() {
  return new Request('https://leker.test/api/caca/tanya', {
    method: 'POST',
    headers: { Authorization: 'Bearer token-penyuruh' }
  });
}

// K1 ADR-045: Caca tidak punya kredensial sendiri. Kalau header penyuruh tidak
// ikut, endpoint akan melayani permintaan tanpa tahu siapa yang meminta.
test('kredensial penyuruh ikut dalam permintaan ke endpoint aslinya', () => {
  const hasil = bangunPermintaanAlat('stok_sisa', {}, { request: requestPenyuruh(), storeCode: 'G002' });

  assert.equal(hasil.ok, true);
  assert.equal(hasil.permintaan.headers.get('Authorization'), 'Bearer token-penyuruh');
  assert.ok(hasil.permintaan.url.includes('/api/admin/stock'));
});

// K2, invariant #5: gerai tidak pernah ditentukan dari isi pesan.
test('gerai datang dari sesi, apa pun yang model taruh di parameter', () => {
  const hasil = bangunPermintaanAlat('stok_sisa', { store: 'G999', gerai: 'Beji' }, {
    request: requestPenyuruh(),
    storeCode: 'G002'
  });

  assert.ok(hasil.permintaan.url.includes('store=G002'));
  assert.equal(hasil.permintaan.url.includes('G999'), false);
  assert.equal(hasil.permintaan.url.includes('Beji'), false);
});

test('periode diterjemahkan jadi tanggal sebelum sampai ke endpoint', () => {
  const hasil = bangunPermintaanAlat('laba_periode', { periode: 'kemarin' }, {
    request: requestPenyuruh(),
    storeCode: 'G001',
    hariIni: '2026-09-21'
  });

  assert.ok(hasil.permintaan.url.includes('from=2026-09-20'));
  assert.ok(hasil.permintaan.url.includes('to=2026-09-20'));
  assert.deepEqual(hasil.periode, { dari: '2026-09-20', sampai: '2026-09-20' });
});

test('alat di luar daftar ditolak sebelum permintaan apa pun disusun', () => {
  const hasil = bangunPermintaanAlat('hapus_semua_penjualan', {}, { request: requestPenyuruh(), storeCode: 'G001' });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.permintaan, undefined);
  assert.match(hasil.error, /tidak ada di daftar/i);
});

test('periode yang tidak jelas menghentikan permintaan, bukan diteruskan apa adanya', () => {
  const hasil = bangunPermintaanAlat('laba_periode', { periode: 'rentang' }, {
    request: requestPenyuruh(),
    storeCode: 'G001',
    hariIni: '2026-09-21'
  });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.permintaan, undefined);
});

// Penolakan wewenang diteruskan apa adanya supaya penyuruh tahu batasnya,
// bukan mengira Caca yang rusak.
test('penolakan dari endpoint diteruskan, bukan ditelan', async () => {
  const alatPalsu = {
    perluPeriode: false,
    pathname: '/api/admin/stock',
    query: () => ({}),
    handler: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Admin Budi hanya berwenang pada gerai G002.' })
    })
  };

  const disusun = bangunPermintaanAlat('stok_sisa', {}, { request: requestPenyuruh(), storeCode: 'G005' });
  const response = await alatPalsu.handler(disusun.permintaan, {}, alatPalsu.pathname);
  const data = await response.json();

  assert.equal(response.ok, false);
  assert.equal(response.status, 403);
  assert.match(data.error, /hanya berwenang/);
});

test('jalankanAlat menolak alat tak dikenal tanpa menyentuh jaringan', async () => {
  const hasil = await jalankanAlat('bikin_jurnal', {}, { request: requestPenyuruh(), env: {}, storeCode: 'G001' });
  assert.equal(hasil.ok, false);
  assert.match(hasil.error, /tidak ada di daftar/i);
});
