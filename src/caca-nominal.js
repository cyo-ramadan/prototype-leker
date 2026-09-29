// Penguraian nominal yang diucapkan orang: "22rb", "1,5 juta", "22.000".
//
// Ini dikerjakan kode, bukan model, dengan alasan yang sama seperti tanggal di
// caca-alat.js: model yang menafsirkan "22rb" sendiri bisa mengembalikan 22,
// 22.000, atau 2.200.000 — dan ketiganya sama-sama terlihat wajar di layar.
// Tugas model cuma menyalin potongan nominalnya apa adanya dari kalimat.
//
// Hasilnya rupiah bulat (integer), sejalan dengan endpoint Bea Operasional yang
// juga memakai rupiah bulat — bukan skala 1.000.000 milik HPP/jurnal.

const SATUAN = Object.freeze([
  { pola: /^(rb|ribu|k)$/i, kali: 1_000 },
  { pola: /^(jt|juta)$/i, kali: 1_000_000 },
  { pola: /^(m|milyar|miliar)$/i, kali: 1_000_000_000 }
]);

const MAX_RUPIAH = 1_000_000_000;

function cariSatuan(teks) {
  return SATUAN.find((satuan) => satuan.pola.test(teks)) ?? null;
}

/**
 * @returns {{ok: true, nilai: number} | {ok: false, tanya: string}}
 * Yang tidak jelas dikembalikan sebagai pertanyaan, bukan tebakan — nominal
 * salah yang terlanjur masuk baru ketahuan waktu buku tidak cocok.
 */
export function uraikanNominal(teks) {
  const mentah = String(teks ?? '').trim();
  if (!mentah) return { ok: false, tanya: 'Nominalnya berapa ya?' };

  const bersih = mentah.replace(/rp\.?/gi, '').replace(/\s+/g, '').toLowerCase();
  const cocok = bersih.match(/^(-?[\d.,]+)([a-z]*)$/);
  if (!cocok) return { ok: false, tanya: `"${mentah}" belum kebaca sebagai nominal. Tulis angkanya ya?` };

  const [, angkaTeks, satuanTeks] = cocok;
  const satuan = satuanTeks ? cariSatuan(satuanTeks) : null;
  if (satuanTeks && !satuan) {
    return { ok: false, tanya: `Satuan "${satuanTeks}" belum Caca kenal. Tulis nominal penuhnya ya?` };
  }

  const negatif = angkaTeks.startsWith('-');
  const angka = negatif ? angkaTeks.slice(1) : angkaTeks;

  let dasar;
  if (satuan) {
    // Dengan satuan, titik dan koma dua-duanya dibaca sebagai desimal:
    // "1.5jt" dan "1,5jt" sama-sama berarti satu setengah juta.
    const desimal = angka.replace(',', '.');
    if ((desimal.match(/\./g) || []).length > 1) {
      return { ok: false, tanya: `"${mentah}" ambigu. Tulis nominal penuhnya ya?` };
    }
    dasar = Number(desimal);
    if (!Number.isFinite(dasar)) return { ok: false, tanya: `"${mentah}" belum kebaca sebagai nominal.` };
    dasar *= satuan.kali;
  } else {
    // Tanpa satuan, titik adalah pemisah ribuan gaya Indonesia — "22.000"
    // dua puluh dua ribu, bukan dua puluh dua koma nol.
    if (angka.includes(',')) {
      return { ok: false, tanya: `"${mentah}" pakai koma tanpa satuan. Maksudnya berapa rupiah?` };
    }
    const bagian = angka.split('.');
    if (bagian.length > 1) {
      const ribuanRapi = bagian.slice(1).every((b) => b.length === 3) && bagian[0].length >= 1 && bagian[0].length <= 3;
      if (!ribuanRapi) return { ok: false, tanya: `"${mentah}" bukan format ribuan yang lazim. Maksudnya berapa?` };
    }
    dasar = Number(bagian.join(''));
  }

  if (!Number.isFinite(dasar)) return { ok: false, tanya: `"${mentah}" belum kebaca sebagai nominal.` };
  if (!Number.isInteger(dasar)) {
    return { ok: false, tanya: `${mentah} jatuhnya bukan rupiah bulat. Maksudnya berapa?` };
  }
  if (dasar === 0) return { ok: false, tanya: 'Nominalnya nol. Maksudnya berapa?' };
  if (Math.abs(dasar) > MAX_RUPIAH) {
    return { ok: false, tanya: `${mentah} kebesaran — kelebihan nol? Tulis ulang nominalnya ya?` };
  }

  return { ok: true, nilai: negatif ? -dasar : dasar };
}

export function rupiah(nilai) {
  return new Intl.NumberFormat('id-ID').format(nilai);
}
