// Bahan bersama alat tulis Una: pencocokan nama ke master dan penguraian
// angka/tanggal. Dipisah dari caca-aksi.js supaya alat di berkas lain
// (caca-aksi-bayar.js) memakai aturan yang persis sama — terutama aturan
// pencocokan satu arah, yang lahir dari bug nyata.

import { uraikanNominal } from './caca-nominal.js';

export const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

// --- pencocokan nama ------------------------------------------------------

export function normalkan(teks) {
  return String(teks ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Mencari satu baris yang namanya cocok. Sama persis dulu; kalau tidak ada,
 * baru "mengandung" — dan itu pun hanya dipakai kalau kandidatnya tepat satu.
 * Lebih dari satu kandidat dikembalikan sebagai pertanyaan, bukan dipilihkan.
 *
 * @returns {{ok:true, nilai:any} | {ok:false, tanya:string}}
 */
export function cocokkanSatu(tertulis, daftar, { label, namaDari, kunciLain = () => [] }) {
  const kunci = normalkan(tertulis);
  if (!kunci) return { ok: false, tanya: `${label} yang mana ya?` };

  const persis = daftar.filter((item) => [namaDari(item), ...kunciLain(item)].some((nama) => normalkan(nama) === kunci));
  if (persis.length === 1) return { ok: true, nilai: persis[0] };
  if (persis.length > 1) {
    return { ok: false, tanya: `Ada ${persis.length} ${label} bernama "${tertulis}". Yang mana ya?` };
  }

  // Satu arah saja: yang diucapkan boleh lebih pendek dari nama aslinya
  // ("terigu" -> "Tepung Terigu"), tidak sebaliknya. Dua arah membuat "Kas
  // Lama" (akun nonaktif) diam-diam cocok ke "Kas" — akun yang salah, tanpa
  // pertanyaan apa pun.
  const mirip = daftar.filter((item) => normalkan(namaDari(item)).includes(kunci));
  if (mirip.length === 1) return { ok: true, nilai: mirip[0] };
  if (mirip.length > 1) {
    const contoh = mirip.slice(0, 5).map((item) => `"${namaDari(item)}"`).join(', ');
    return { ok: false, tanya: `"${tertulis}" cocok dengan beberapa ${label}: ${contoh}. Yang mana ya?` };
  }
  return { ok: false, tanya: `${label[0].toUpperCase()}${label.slice(1)} "${tertulis}" tidak ketemu.` };
}

export function jumlahBulat(teks, label) {
  const hasil = uraikanNominal(teks);
  if (!hasil.ok) return { ok: false, tanya: `${label}: ${hasil.tanya}` };
  if (!Number.isInteger(hasil.nilai) || hasil.nilai <= 0) {
    return { ok: false, tanya: `${label} harus bilangan bulat lebih dari nol.` };
  }
  return { ok: true, nilai: hasil.nilai };
}

export function rupiahDari(teks, label, { bolehNol = false } = {}) {
  // Pengurai nominal sengaja menolak nol (pengeluaran nol tidak masuk akal),
  // tapi harga beli nol sah untuk barang yang dibuat sendiri lewat resep.
  if (bolehNol && /^(rp\.?)?\s*(0+|nol)$/i.test(String(teks ?? '').trim())) return { ok: true, nilai: 0 };
  const hasil = uraikanNominal(teks);
  if (!hasil.ok) return { ok: false, tanya: `${label}: ${hasil.tanya}` };
  if (hasil.nilai < 0 || (!bolehNol && hasil.nilai === 0)) return { ok: false, tanya: `${label} tidak boleh ${hasil.nilai < 0 ? 'minus' : 'nol'}.` };
  return { ok: true, nilai: hasil.nilai };
}

export function teks(nilai, max) {
  return String(nilai ?? '').trim().slice(0, max);
}

/** Tanggal yang disebut orang, atau hari ini kalau tidak disebut. Masa depan ditanyakan. */
export function tanggalDari(tertulis, hariIni) {
  const disebut = teks(tertulis, 10);
  if (disebut && !TANGGAL.test(disebut)) return { ok: false, tanya: 'Tanggalnya belum jelas. Tanggal berapa ya?' };
  const tanggal = disebut || hariIni;
  if (tanggal > hariIni) return { ok: false, tanya: 'Tanggalnya di masa depan. Maksudnya tanggal berapa?' };
  return { ok: true, nilai: tanggal };
}
