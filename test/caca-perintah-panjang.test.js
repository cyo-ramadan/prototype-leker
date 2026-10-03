import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jawabPertanyaan, susunRencana, MAKS_LANGKAH_RENCANA, MAKS_PERINTAH_LANGKAH } from '../src/caca-agen.js';
import { MAKS_PERTANYAAN } from '../src/caca-chat.js';

// Bos Cyo, 2026-10-03: "una kemarin sama sekali ga bisa menjalankan perintah yang
// terlalu panjang". Empat penyebab yang ditemukan di kode dan dijaga di sini:
//   1. prompt pemilih alat menyuruh model menolak semua alat tulis selain ubah/nonaktifkan/
//      hitung_ulang_hpp, dan mengarahkan daftar koreksi HPP ke hitung_ulang_hpp (satu bahan);
//   2. tiap langkah rencana dipotong 400 huruf (daftar koreksi buntung);
//   3. kotak ketik memotong tempelan di 4000 huruf tanpa peringatan;
//   4. draft koreksi massal memanggil pratinjau per bahan dalam satu permintaan.

const konteks = { nama: 'Bos Cyo', peran: 'Owner', storeCode: 'BEJI', storeName: 'Beji', hariIni: '2026-10-03', lingkup: 'gerai', namaLingkup: 'Beji' };

async function promptPemilih() {
  let system = '';
  await jawabPertanyaan('halo', konteks, {
    env: {},
    panggilModel: async (env, permintaan) => { system ||= permintaan.system; return { ok: true, value: { alat: 'tidak_ada' } }; }
  });
  return system;
}

test('prompt pemilih alat: daftar koreksi HPP diarahkan ke koreksi_hpp_banyak, bukan hitung_ulang_hpp', async () => {
  const system = await promptPemilih();
  assert.match(system, /2 bahan atau lebih[\s\S]*= koreksi_hpp_banyak/);
  assert.match(system, /Salin SEMUA baris ke kh_daftar/);
  assert.match(system, /betulkan_klasifikasi_barang/);
});

test('prompt pemilih alat: tidak lagi melarang alat tulis yang ada di daftar', async () => {
  const system = await promptPemilih();
  assert.doesNotMatch(system, /pengecualiannya: mengubah barang/, 'kalimat lama yang membuat model menolak alat akuntan sudah dicabut');
  for (const alat of ['koreksi_hpp_banyak', 'betulkan_klasifikasi_barang', 'sinkron_akuntansi', 'samakan_aturan_jurnal']) {
    assert.ok(system.includes(alat), `${alat} disebut sebagai alat yang boleh dipakai`);
  }
});

test('prompt pemilih alat: daftar panjang untuk satu alat bukan rencana; rencana wajib menyalin daftar lengkap', async () => {
  const system = await promptPemilih();
  assert.match(system, /Satu daftar panjang untuk SATU alat[\s\S]*bukan rencana/);
  assert.match(system, /WAJIB menyalin daftarnya[\s\S]*LENGKAP/);
});

test('rencana: perintah langkah yang memuat daftar 17 baris tidak terpotong, baris tetap terpisah', () => {
  const daftar = Array.from({ length: 17 }, (_, i) => `${i + 1}. Bahan Nomor ${i + 1} = ${1000 + i},5 per pcs`).join('\n');
  const perintah = `Una, koreksi HPP DERMO mulai 2026-09-13 pakai koreksi_hpp_banyak:\n${daftar}`;
  assert.ok(perintah.length > 400, 'uji ini memang lebih panjang dari batas lama');
  const langkah = susunRencana([
    { judul: 'Betulkan tipe', perintah: 'Una, betulkan tipe Bahan Pentol Rangu jadi bahan baku.' },
    { judul: 'Koreksi HPP', perintah }
  ]);
  assert.equal(langkah[1].perintah, perintah);
  assert.match(langkah[1].perintah, /17\. Bahan Nomor 17 = 1016,5 per pcs$/);
  assert.ok(MAKS_PERINTAH_LANGKAH >= 4000);
  assert.ok(MAKS_LANGKAH_RENCANA >= 8);
});

test('pesan: batas 8000 huruf, dan kotak ketik tidak lagi memotong tempelan diam-diam', () => {
  assert.equal(MAKS_PERTANYAAN, 8000);
  const panel = readFileSync(new URL('../public/caca-chat.js', import.meta.url), 'utf8');
  assert.doesNotMatch(panel, /id="cacaPertanyaan"[^>]*maxlength/, 'tanpa maxlength: kelebihan ditolak server dengan pesan jelas');
  const server = readFileSync(new URL('../src/caca-chat.js', import.meta.url), 'utf8');
  assert.match(server, /Pesannya kepanjangan/);
  assert.doesNotMatch(server, /pertanyaan \?\? ''\)\.trim\(\)\.slice\(0, MAKS_PERTANYAAN\)/, 'tidak dipotong diam-diam');
});
