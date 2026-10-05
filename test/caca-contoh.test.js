import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTOH, pilihContoh, teksContoh, skorContoh } from '../src/caca-contoh.js';
import { AKSI_TULIS } from '../src/caca-aksi.js';
import { ALAT_BACA } from '../src/caca-alat.js';
import { jawabPertanyaan, ALAT_BACA_API, ALAT_CATAT_PENGELUARAN, ALAT_RENCANA, ALAT_SELESAI } from '../src/caca-agen.js';

const ALAT_SAH = new Set([
  ...AKSI_TULIS.map((a) => a.nama), ...ALAT_BACA.map((a) => a.nama),
  ALAT_BACA_API, ALAT_CATAT_PENGELUARAN, ALAT_RENCANA, ALAT_SELESAI
]);
const BUKAN_ALAT = new Set(['catatan', 'sesudah', 'kalau']);

test('setiap contoh hanya menyebut alat yang benar-benar ada', () => {
  for (const contoh of CONTOH) {
    assert.ok(contoh.pesan && Array.isArray(contoh.langkah) && contoh.langkah.length, `contoh "${contoh.pesan}" lengkap`);
    for (const langkah of contoh.langkah) {
      for (const [, nama] of langkah.matchAll(/(?:^|-> )([a-z][a-z_]+)/g)) {
        if (BUKAN_ALAT.has(nama)) continue;
        assert.ok(ALAT_SAH.has(nama), `"${nama}" di contoh "${contoh.pesan}" bukan nama alat`);
      }
    }
  }
});

test('contoh yang dipilih sesuai pesan Bos, bukan semuanya', () => {
  const anomali = pilihContoh('cek harga yang anomali terus benerin');
  assert.match(anomali[0].pesan, /anomali/);
  assert.ok(anomali.length <= 4);
  assert.match(pilihContoh('catat gaji mas budi 2jt')[0].pesan, /gaji/);
  assert.match(pilihContoh('tolong masukin menu baru: es jeruk 8rb, teh tarik 10rb')[0].pesan, /masukin menu/);
  assert.deepEqual(pilihContoh('zzz qqq'), []);
  assert.equal(teksContoh('zzz qqq'), '');
  assert.ok(skorContoh('harga es teh berapa', { pesan: 'harga es teh leci berapa?' }) > skorContoh('harga es teh berapa', { pesan: 'catat gaji mbak rina 1,5jt' }));
});

test('contoh yang mirip ikut ke prompt pemilihan alat', async () => {
  const panggilan = [];
  const panggilModel = async (env, p) => { panggilan.push(p); return { ok: true, value: { alat: 'tidak_ada' } }; };
  await jawabPertanyaan('cek harga yang anomali terus benerin', {
    nama: 'Bos', peran: 'Owner', storeCode: 'G1', storeName: 'G1', hariIni: '2026-10-05', lingkup: 'gerai', namaLingkup: 'G1'
  }, { env: {}, panggilModel });
  assert.match(panggilan[0].system, /Contoh percakapan yang mirip/);
  assert.match(panggilan[0].system, /cek_harga_janggal/);
  assert.doesNotMatch(panggilan[0].system, /catat gaji mbak rina/, 'contoh yang tidak mirip tidak ikut');
});
