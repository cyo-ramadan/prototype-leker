// Otak Caca untuk tanya-jawab (ADR-045 Tahap A).
//
// Dua langkah yang sengaja dipisah:
//   1. Model MEMILIH satu alat dari daftar. Dia tidak menyusun URL, tidak
//      menghitung tanggal, tidak menyentuh data.
//   2. Kode menjalankan alat itu lewat endpoint aslinya, lalu model MENYUSUN
//      kalimat dari angka yang baru saja pulang.
//
// Pemisahan ini yang menegakkan aturan "angka keuangan tidak pernah datang dari
// ingatan model" (ADR-044): di langkah 2 model cuma punya data hasil query,
// jadi tidak ada angka lain yang bisa dia sebut.

import { callStructured } from './caca-ai-client.js';
import { ALAT_BACA, PERIODE, daftarAlatUntukModel, jalankanAlat } from './caca-alat.js';

const SKEMA_PILIH_ALAT = Object.freeze({
  type: 'object',
  required: ['alat'],
  properties: {
    alat: {
      type: 'string',
      enum: [...ALAT_BACA.map((alat) => alat.nama), 'tidak_ada'],
      description: 'Nama alat yang paling cocok, atau "tidak_ada" kalau tidak ada yang bisa menjawab.'
    },
    periode: { type: 'string', enum: [...PERIODE] },
    dari: { type: 'string', description: 'YYYY-MM-DD, hanya kalau periode = rentang.' },
    sampai: { type: 'string', description: 'YYYY-MM-DD, hanya kalau periode = rentang.' },
    alasan_kosong: { type: 'string', description: 'Kalau alat = tidak_ada, jelaskan singkat kenapa.' }
  }
});

const SKEMA_JAWABAN = Object.freeze({
  type: 'object',
  required: ['jawaban'],
  properties: {
    jawaban: { type: 'string', description: 'Jawaban untuk pemilik toko, bahasa Indonesia sehari-hari.' }
  }
});

function kalimatKonteks(konteks) {
  return [
    `Yang bertanya: ${konteks.nama} (${konteks.peran}).`,
    `Gerai yang sedang dibuka: ${konteks.storeName} (${konteks.storeCode}).`,
    `Hari ini tanggal ${konteks.hariIni}.`
  ].join('\n');
}

function promptPilihAlat(konteks) {
  return [
    'Kamu Caca, asisten toko. Tugasmu di langkah ini cuma satu: memilih alat yang paling cocok',
    'untuk menjawab pertanyaan, dan menentukan periodenya.',
    '',
    kalimatKonteks(konteks),
    '',
    'Alat yang tersedia:',
    daftarAlatUntukModel(),
    '',
    'Aturan:',
    '- Jangan menghitung tanggal sendiri. Sebut periodenya saja (hari_ini, kemarin, 7_hari_terakhir,',
    '  bulan_ini, bulan_lalu). Pakai "rentang" hanya kalau penanya menyebut tanggal tertentu.',
    '- Kalau tidak ada alat yang cocok, jawab "tidak_ada". Jangan memaksakan alat yang mirip.',
    '- Kamu belum bisa mencatat, mengubah, atau membatalkan apa pun. Kalau yang diminta itu,',
    '  jawab "tidak_ada" dan sebutkan alasannya.'
  ].join('\n');
}

function promptSusunJawaban(konteks) {
  return [
    'Kamu Caca, asisten toko. Susun jawaban singkat dari data yang diberikan.',
    '',
    kalimatKonteks(konteks),
    '',
    'Aturan keras:',
    '- SEMUA angka harus berasal dari data yang diberikan. Dilarang menyebut angka yang tidak ada di situ,',
    '  termasuk angka yang kamu ingat dari percakapan sebelumnya.',
    '- Kalau data tidak memuat yang ditanyakan, bilang belum ada datanya. Jangan mengira-ira.',
    '- Tulis rupiah dengan pemisah ribuan, mis. 808.000.',
    '- Bahasa sehari-hari, 1-3 kalimat. Tidak perlu basa-basi pembuka.',
    '- Kalau periodenya hari ini, ingatkan sekilas bahwa harinya masih jalan.',
    '- Kamu asisten otomatis. Kalau ditanya, jujur saja; jangan mengaku manusia.'
  ].join('\n');
}

/**
 * @param {string} pertanyaan pesan dari penyuruh
 * @param {object} konteks { nama, peran, storeCode, storeName, hariIni }
 * @param {object} jalur { request, env } — request asli, dipakai meminjam wewenang penyuruh
 */
export async function jawabPertanyaan(pertanyaan, konteks, {
  request,
  env,
  jalankan = jalankanAlat,
  panggilModel = callStructured
} = {}) {
  const pilihan = await panggilModel(env, {
    system: promptPilihAlat(konteks),
    content: [{ type: 'text', text: pertanyaan }],
    schema: SKEMA_PILIH_ALAT
  });
  if (!pilihan.ok) return { ok: false, status: pilihan.status, error: pilihan.error };

  const namaAlat = pilihan.value?.alat;
  if (!namaAlat || namaAlat === 'tidak_ada') {
    return {
      ok: true,
      alat: null,
      jawaban: pilihan.value?.alasan_kosong
        ? `Caca belum bisa bantu yang itu — ${pilihan.value.alasan_kosong}`
        : 'Caca belum bisa menjawab yang itu.'
    };
  }

  const hasil = await jalankan(namaAlat, pilihan.value, { request, env, storeCode: konteks.storeCode, hariIni: konteks.hariIni });
  if (!hasil.ok) return { ok: true, alat: namaAlat, jawaban: hasil.error, ditolak: true };

  const jawaban = await panggilModel(env, {
    system: promptSusunJawaban(konteks),
    content: [{
      type: 'text',
      text: [
        `Pertanyaan: ${pertanyaan}`,
        hasil.periode ? `Periode yang dipakai: ${hasil.periode.dari} sampai ${hasil.periode.sampai}` : '',
        'Data:',
        JSON.stringify(hasil.data)
      ].filter(Boolean).join('\n')
    }],
    schema: SKEMA_JAWABAN
  });
  if (!jawaban.ok) return { ok: false, status: jawaban.status, error: jawaban.error };

  return {
    ok: true,
    alat: namaAlat,
    periode: hasil.periode,
    jawaban: jawaban.value?.jawaban ?? '',
    data: hasil.data
  };
}
