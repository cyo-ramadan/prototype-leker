// Pembersih hasil baca sebelum sampai ke model AI.
//
// Una boleh membaca semua endpoint baca (Bos Cyo 2026-10-02), tapi hasilnya
// dikirim ke penyedia AI di luar sana. Jadi SEMUA hasil lewat pembersih ini,
// tanpa kecuali — keamanannya tidak bergantung pada ingatan siapa pun untuk
// menyaring satu per satu endpoint:
//   1. rahasia (kata sandi, hash, PIN, token, kunci) dibuang;
//   2. gambar/foto/logo (base64 besar) dibuang — tak berguna bagi model dan mahal;
//   3. kontak dan identitas pribadi (telepon, email, alamat, nomor identitas,
//      nomor rekening) disamarkan — model tidak butuh itu untuk menjawab;
//   4. daftar yang kelewat panjang dipotong, dengan jumlah aslinya dicatat.
//
// Yang disamarkan hanya NILAI-nya, kuncinya tetap ada, supaya model tahu kolom itu
// ada tapi sengaja ditutup.

const KUNCI_RAHASIA = /(pass(word|wd)?|\bpin\b|pin_?(code|hash)|token|secret|hash|credential|otp|api[_-]?key|authorization|salt|signature_?data)/i;
const KUNCI_GAMBAR = /(image|logo|photo|foto|gambar|picture|avatar|blob|selfie)/i;
const KUNCI_PRIBADI = /(phone|telepon|telp|\bhp\b|whatsapp|\bwa\b|email|e-?mail|address|alamat|id_?number|nomor_?identitas|\bnik\b|\bktp\b|account_?number|nomor_?rekening|no_?rek|bank_?account)/i;

export const MAKS_BARIS_PER_DAFTAR = 3000;
export const MAKS_KEDALAMAN = 8;
const MAKS_PANJANG_TEKS = 600;

/**
 * @returns {{data:any, catatan:string[]}} salinan bersih; data asli tidak diubah
 */
export function bersihkan(data) {
  const dibuang = { rahasia: 0, gambar: 0, pribadi: 0, dipotong: [] };

  const proses = (nilai, kunci, kedalaman) => {
    if (kunci && KUNCI_RAHASIA.test(kunci)) {
      if (nilai !== null && nilai !== undefined && nilai !== '') dibuang.rahasia += 1;
      return undefined;
    }
    if (kunci && KUNCI_GAMBAR.test(kunci) && typeof nilai === 'string' && nilai) {
      dibuang.gambar += 1;
      return '[gambar dibuang]';
    }
    if (kunci && KUNCI_PRIBADI.test(kunci) && nilai !== null && nilai !== undefined && nilai !== '' && typeof nilai !== 'object') {
      dibuang.pribadi += 1;
      return '[disamarkan]';
    }
    if (typeof nilai === 'string') {
      if (/^data:[a-z]+\/[a-z0-9.+-]+;base64,/i.test(nilai) || nilai.length > 4000) {
        dibuang.gambar += 1;
        return '[data besar dibuang]';
      }
      return nilai.length > MAKS_PANJANG_TEKS ? `${nilai.slice(0, MAKS_PANJANG_TEKS)}…` : nilai;
    }
    if (nilai === null || typeof nilai !== 'object') return nilai;
    if (kedalaman >= MAKS_KEDALAMAN) return '[terlalu dalam]';

    if (Array.isArray(nilai)) {
      const dipakai = nilai.length > MAKS_BARIS_PER_DAFTAR ? nilai.slice(0, MAKS_BARIS_PER_DAFTAR) : nilai;
      if (dipakai !== nilai) dibuang.dipotong.push({ kunci: kunci || '(akar)', dari: nilai.length, jadi: dipakai.length });
      return dipakai.map((item) => proses(item, '', kedalaman + 1));
    }

    const hasil = {};
    for (const [k, v] of Object.entries(nilai)) {
      const bersih = proses(v, k, kedalaman + 1);
      if (bersih !== undefined) hasil[k] = bersih;
    }
    return hasil;
  };

  const bersih = proses(data, '', 0);
  const catatan = [];
  if (dibuang.rahasia) catatan.push(`${dibuang.rahasia} isian rahasia dibuang`);
  if (dibuang.gambar) catatan.push(`${dibuang.gambar} gambar/data besar dibuang`);
  if (dibuang.pribadi) catatan.push(`${dibuang.pribadi} kontak/identitas pribadi disamarkan`);
  for (const p of dibuang.dipotong) catatan.push(`daftar ${p.kunci} dipotong ${p.dari} -> ${p.jadi} baris`);
  return { data: bersih, catatan };
}

/**
 * Menggabungkan hasil baca beberapa gerai jadi satu: setiap daftar baris
 * digabung dan diberi kolom `_gerai`; isian tunggal (angka total, dst.) jadi satu
 * baris per gerai di daftar `ringkasan_gerai`, supaya bisa dihitung/dibandingkan
 * lewat mesin hitung yang sama.
 *
 * @param {{kode:string, data:any}[]} perGerai
 */
export function gabungGerai(perGerai) {
  const daftar = {};
  const ringkasan = [];

  for (const { kode, data } of perGerai) {
    const baris = { _gerai: kode };
    const telusuri = (nilai, jalur, kedalaman) => {
      if (Array.isArray(nilai)) {
        if (nilai.every((b) => b && typeof b === 'object' && !Array.isArray(b))) {
          if (!daftar[jalur]) daftar[jalur] = [];
          for (const b of nilai) daftar[jalur].push({ _gerai: kode, ...b });
        }
        return;
      }
      if (nilai && typeof nilai === 'object') {
        if (kedalaman >= 2) return;
        for (const [k, v] of Object.entries(nilai)) telusuri(v, jalur ? `${jalur}.${k}` : k, kedalaman + 1);
        return;
      }
      if (jalur) baris[jalur] = nilai;
    };
    telusuri(data, '', 0);
    ringkasan.push(baris);
  }

  return { ...daftar, ringkasan_gerai: ringkasan };
}
