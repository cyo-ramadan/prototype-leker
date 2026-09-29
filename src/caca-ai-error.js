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
// dan jatah (401, 403, 429), yang isinya soal akun, bukan soal isi
// permintaan. Status lain tetap generik. Kunci API sendiri dan pola kunci
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
  const dasar = `Mesin AI menolak permintaan (${status})`;
  const petunjuk = PETUNJUK[status];
  if (!petunjuk) return `${dasar}.`;

  // Gemini: { error: { message, status } }; OpenAI: { error: { message, code } }
  const asal = badan?.error?.message;
  const alasan = asal ? ringkas(samarkan(asal, kunci)) : '';

  return alasan
    ? `${dasar}. ${petunjuk} Kata penyedia: "${alasan}"`
    : `${dasar}. ${petunjuk}`;
}
