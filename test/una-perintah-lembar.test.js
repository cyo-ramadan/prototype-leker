import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { perintahLembar, uraiRentang, bersihkanKonteksLembar, rentangUntukDibaca } from '../src/una-perintah-lembar.js';
import { jawabPertanyaan } from '../src/caca-agen.js';

const fixture = nama => JSON.parse(readFileSync(new URL(`./fixtures/una-live/${nama}`, import.meta.url), 'utf8'));
const KEMAMPUAN = new Map(fixture('kemampuan.json').capabilities.map(c => [c.id, c]));
const HARI_INI = '2026-10-15';
const sc = (lain = {}) => ({ conversationId: 'c1', turnId: 'turn_a1', scopeEpoch: 7, activeSurfaceId: null, surfaceRevision: null, surfaceKind: null, page: null, filters: null, selection: null, lastAction: null, ...lain });
const laporanDiWorkspace = (filters = { from: '2026-10-01', to: '2026-10-10' }) => sc({
  activeSurfaceId: 'srf_3f9d2a10-7c1e-4b8a-9d55-0a1b2c3d4e5f', surfaceRevision: 3, surfaceKind: 'page',
  page: { halaman: 'entity', tab: 'reports' }, filters
});
const entity = (surfaceContext, lain = {}) => ({ peran: 'Entity Admin', lingkup: 'entity', hariIni: HARI_INI, surfaceContext, ...lain });

function cekPerintah(cmd, s) {
  const d = KEMAMPUAN.get(cmd.capabilityId);
  assert.ok(d, cmd.capabilityId);
  assert.equal(cmd.capabilityVersion, d.version);
  assert.equal(cmd.origin, 'code');
  assert.equal(cmd.turnId, s.turnId);
  assert.equal(cmd.scopeEpoch, s.scopeEpoch);
  assert.match(cmd.actionId, /^act_[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(cmd.params).filter(k => !d.params.properties[k]), [], 'parameter asing');
  for (const r of d.params.required) assert.ok(cmd.params[r] !== undefined, r);
}

test('skenario Bos: buka laporan + 1 sampai 10 Oktober dari chat (laporan belum terbuka)', () => {
  const s = sc();
  const hasil = perintahLembar('buka laporan, ganti range tanggal 1 sampai 10 oktober', entity(s));
  assert.equal(hasil.alat, 'ui_aksi');
  assert.deepEqual(hasil.uiActions.map(a => a.capabilityId), ['page.open', 'report.set_filters']);
  assert.deepEqual(hasil.uiActions[0].params, { halaman: 'entity', tab: 'reports', display: 'workspace' });
  assert.deepEqual(hasil.uiActions[1].params, { from: '2026-10-01', to: '2026-10-10' });
  assert.equal(hasil.rentang.dibaca, '1–10 Oktober 2026');
  for (const a of hasil.uiActions) cekPerintah(a, s);
});

test('laporan sudah di Workspace: cukup set_filters; koreksi satu ujung memakai filter yang tampil', () => {
  const s = laporanDiWorkspace();
  const ganti = perintahLembar('ganti range tanggal 1 sampai 10 oktober', entity(s));
  assert.deepEqual(ganti.uiActions.map(a => a.capabilityId), ['report.set_filters']);
  const koreksi = perintahLembar('eh sampai tanggal 8 aja', entity(s));
  assert.deepEqual(koreksi.uiActions[0].params, { from: '2026-10-01', to: '2026-10-08' });
  // Bos mengubah filter sendiri jadi 5-20 September: koreksi berikutnya memakai itu.
  const manual = perintahLembar('mulai tanggal 10 aja', entity(laporanDiWorkspace({ from: '2026-09-05', to: '2026-09-20' })));
  assert.deepEqual(manual.uiActions[0].params, { from: '2026-09-10', to: '2026-09-20' });
  const mundur = perintahLembar('kalau minggu sebelumnya?', entity(laporanDiWorkspace({ from: '2026-10-08', to: '2026-10-14' })));
  assert.deepEqual(mundur.uiActions[0].params, { from: '2026-10-01', to: '2026-10-07' });
});

test('laporan terbuka di menu biasa: dipindah ke Workspace dulu', () => {
  const hasil = perintahLembar('ganti tanggal 1 sampai 10 oktober', entity(sc({ page: { halaman: 'entity', tab: 'reports' }, filters: { from: '2026-10-01', to: '2026-10-15' } })));
  assert.deepEqual(hasil.uiActions.map(a => a.capabilityId), ['page.open', 'report.set_filters']);
});

test('aturan tahun dan tanggal (kontrak 3.3)', () => {
  // Tahun dari filter aktif, bukan tahun berjalan.
  assert.deepEqual(uraiRentang('1 sampai 10 maret', { sc: laporanDiWorkspace({ from: '2025-01-01', to: '2025-01-31' }), hariIni: HARI_INI }), { ok: true, from: '2025-03-01', to: '2025-03-10' });
  assert.deepEqual(uraiRentang('1 sampai 10 oktober', { sc: null, hariIni: HARI_INI }), { ok: true, from: '2026-10-01', to: '2026-10-10' });
  assert.deepEqual(uraiRentang('28 desember sampai 5 januari 2027', { sc: null, hariIni: HARI_INI }), { ok: true, from: '2026-12-28', to: '2027-01-05' });
  assert.deepEqual(uraiRentang('tgl 28 sept - 5 okt', { sc: null, hariIni: HARI_INI }), { ok: true, from: '2026-09-28', to: '2026-10-05' });
  assert.equal(uraiRentang('30 sampai 31 februari', { sc: null, hariIni: HARI_INI }).ok, false);
  assert.equal(uraiRentang('10 oktober sampai 1 oktober', { sc: null, hariIni: HARI_INI }).ok, false);
  assert.equal(rentangUntukDibaca('2026-09-28', '2026-10-05'), '28 September – 5 Oktober 2026');
  assert.equal(rentangUntukDibaca('2025-12-28', '2026-01-05'), '28 Desember 2025 – 5 Januari 2026');
});

test('tanggal tidak sah atau terbalik: klarifikasi, tanpa aksi', () => {
  const hasil = perintahLembar('ganti laporan tanggal 10 oktober sampai 1 oktober', entity(sc()));
  assert.equal(hasil.belumLengkap, true);
  assert.deepEqual(hasil.uiActions, []);
  assert.match(hasil.jawaban, /sesudah tanggal akhir/);
});

test('bukan wilayah modul ini: tulis, tanya angka, gerai, panel lama, atau tanpa laporan', () => {
  const s = laporanDiWorkspace();
  assert.equal(perintahLembar('catat pengeluaran laporan 1 sampai 10 oktober', entity(s)), null);
  assert.equal(perintahLembar('berapa omset 1 sampai 10 oktober', entity(s)), null);
  assert.equal(perintahLembar('ganti tanggal laporan 1 sampai 10 oktober', entity(s, { lingkup: 'gerai', peran: 'Admin' })), null);
  assert.equal(perintahLembar('ganti tanggal laporan 1 sampai 10 oktober', entity(null)), null);
  assert.equal(perintahLembar('sampai tanggal 8', entity(sc())), null);
  assert.equal(perintahLembar('buka laporan', entity(sc())), null, 'buka saja tetap lewat buka_layar');
});

test('Entity Admin dengan chat di lingkup gerai: diarahkan ke Entity, tidak dilempar ke model', () => {
  const hasil = perintahLembar('buka laporan tanggal 1 sampai 10 oktober', entity(sc(), { lingkup: 'gerai' }));
  assert.equal(hasil.belumLengkap, true);
  assert.deepEqual(hasil.uiActions, []);
  assert.match(hasil.jawaban, /pilih "Entity"/i);
  assert.equal(perintahLembar('buka laporan', entity(sc(), { lingkup: 'gerai' })), null, 'buka saja tetap buka_layar');
  assert.equal(perintahLembar('ganti tanggal laporan gerai 1 sampai 10 oktober', entity(sc(), { lingkup: 'gerai' })), null);
});

test('konteks lembar dari browser dibersihkan; bentuk asing dibuang', () => {
  const contoh = fixture('aksi.json').surfaceContextExample;
  assert.deepEqual(bersihkanKonteksLembar(contoh), contoh);
  assert.equal(bersihkanKonteksLembar({ ...contoh, turnId: 'x' }), null);
  assert.equal(bersihkanKonteksLembar({ ...contoh, pad: 'a'.repeat(5000) }), null);
  const kotor = bersihkanKonteksLembar({ ...contoh, activeSurfaceId: 'javascript:alert(1)', page: { halaman: 'entity', tab: '../x' }, filters: { from: '2026-02-30', to: '2026-10-08', stores: ['G001', '<b>'] }, principalKey: 'owner:1' });
  assert.equal(kotor.activeSurfaceId, null);
  assert.equal(kotor.page, null);
  assert.deepEqual(kotor.filters, { to: '2026-10-08' });
  assert.ok(!('principalKey' in kotor));
});

test('agen: perintah lembar dijawab kode tanpa memanggil model', async () => {
  const hasil = await jawabPertanyaan('Una, ganti range tanggal laporan 1 sampai 10 oktober', { ...entity(sc()), riwayat: [] }, {
    panggilModel: async () => { throw new Error('model tidak boleh dipanggil'); }
  });
  assert.equal(hasil.alat, 'ui_aksi');
  assert.equal(hasil.uiActions.length, 2);
});
