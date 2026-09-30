// Menerjemahkan penolakan dari penyedia AI jadi kalimat yang bisa dipakai orang
// untuk mencari sebabnya.
//
// Versi pertama cuma bilang "Mesin AI menolak permintaan (401)" dan sengaja
// membuang isi balasan penyedia, karena badan error kadang memuat potongan
// permintaan. Akibatnya waktu kunci ditolak tidak ada yang bisa membedakan
// "kunci salah", "kunci dicabut", "layanannya belum diaktifkan", atau "jatah
// habis" — padahal penyedia sudah menyebut alasannya persis.
//
// Kompromi: alasan dari penyedia hanya diteruskan untuk kegagalan kredensial
// dan jatah (401, 403, 429, plus 400 yang terbukti soal akun), yang isinya
// soal akun, bukan soal isi permintaan. Status lain tetap generik, hanya
// ditambah kode status penyedia yang berupa satu token. Kunci API sendiri dan pola kunci
// selalu disamarkan, dan hasil akhirnya dipotong pendek.

const MAKS_PANJANG = 220;

const POLA_KUNCI = [
  /AQ\.[A-Za-z0-9_\-.]{10,}/g,
  /AIza[A-Za-z0-9_\-]{10,}/g,
  /sk-[A-Za-z0-9_\-]{10,}/g
];

const PETUNJUK = Object.freeze({
  401: 'Kunci ditolak: belum dikenali penyedia (salah jenis, sudah dicabut, atau salah salin).',
  403: 'Kunci dikenali tapi tidak boleh dipakai untuk ini (layanan belum diaktifkan atau kunci dibatasi).',
  429: 'Jatah pemakaian habis atau terlalu sering dipanggil. Tunggu sebentar lalu coba lagi.'
});

// Gemini tidak memakai 401 untuk kunci yang salah: kunci tidak valid, kunci
// kedaluwarsa, dan lokasi server yang tidak didukung semuanya datang sebagai
// 400. Versi sebelumnya menganggap semua 400 "soal isi permintaan" dan
// menyembunyikan alasannya — 2026-09-30 Caca cuma bilang "(400)" dan tidak
// ada yang bisa tahu sebabnya. 400 lain (misalnya skema ditolak) tetap
// disembunyikan; yang diteruskan hanya yang terbukti soal akun.
const ALASAN_AKUN = new Set([
  'API_KEY_INVALID',
  'API_KEY_EXPIRED',
  'API_KEY_SERVICE_BLOCKED',
  'API_KEY_HTTP_REFERRER_BLOCKED',
  'API_KEY_IP_ADDRESS_BLOCKED',
  'CONSUMER_SUSPENDED',
  'BILLING_DISABLED',
  'SERVICE_DISABLED'
]);

const POLA_AKUN = /\b(api key|location is not supported|billing|free tier is not available)\b/i;

const PETUNJUK_AKUN_400 = 'Ditolak karena akun atau kunci, bukan karena pertanyaannya (kunci tidak valid/kedaluwarsa, atau layanan tidak tersedia).';

function soalAkun(badan) {
  const rincian = Array.isArray(badan?.error?.details) ? badan.error.details : [];
  if (rincian.some(item => ALASAN_AKUN.has(item?.reason))) return true;
  return POLA_AKUN.test(String(badan?.error?.message ?? ''));
}

// Kode status penyedia (INVALID_ARGUMENT, invalid_api_key, …) aman ditampilkan
// untuk semua status: bentuknya satu token tetap, tidak bisa memuat isi
// permintaan. Apa pun yang tidak berbentuk begitu dibuang.
function kodeSingkat(nilai) {
  const teks = String(nilai ?? '');
  return /^[A-Za-z_]{3,40}$/.test(teks) ? teks : '';
}

export function samarkan(teks, kunci) {
  let hasil = String(teks ?? '');
  if (kunci && kunci.length >= 8) hasil = hasil.split(kunci).join('[kunci]');
  for (const pola of POLA_KUNCI) hasil = hasil.replace(pola, '[kunci]');
  return hasil;
}

function ringkas(teks) {
  const rapi = String(teks ?? '').replace(/\s+/g, ' ').trim();
  return rapi.length > MAKS_PANJANG ? `${rapi.slice(0, MAKS_PANJANG - 1)}…` : rapi;
}

/**
 * @param {number} status kode HTTP dari penyedia
 * @param {any} badan hasil JSON balasan penyedia (boleh null kalau tidak terbaca)
 * @param {string} kunci kunci API yang dipakai, supaya bisa disamarkan
 */
export function jelaskanPenolakan(status, badan, kunci) {
  // Gemini: { error: { message, status, details } }; OpenAI: { error: { message, code } }
  const asal = badan?.error?.message;
  const kodePenyedia = kodeSingkat(badan?.error?.status) || kodeSingkat(badan?.error?.code);
  const dasar = `Mesin AI menolak permintaan (${status}${kodePenyedia ? `, ${kodePenyedia}` : ''})`;
  const petunjuk = PETUNJUK[status] || (soalAkun(badan) ? PETUNJUK_AKUN_400 : '');
  if (!petunjuk) return `${dasar}.`;

  const alasan = asal ? ringkas(samarkan(asal, kunci)) : '';

  return alasan
    ? `${dasar}. ${petunjuk} Kata penyedia: "${alasan}"`
    : `${dasar}. ${petunjuk}`;
}
