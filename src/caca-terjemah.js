// Penerjemah bahasa chat -> format baku, khusus mekanisme chatbot Una (Bos Cyo,
// 2026-10-04): "buatkan kodingan untuk sistem yang bisa menerjemahkan bahasa chat ke
// format yang sesuai, cek batasan ai bodoh untuk bisa membantu, selebihnya sistem harus
// mempunyai tool untuk itu."
//
// Batas yang disadari: model Una adalah Gemini versi lite. Dia cukup untuk memilih alat
// dari kalimat bebas, tetapi tidak andal menyalin daftar panjang, angka pecahan, atau
// mengubah "28 September" jadi tanggal. Bagian-bagian itu dikerjakan KODE di sini,
// sebelum pemilih alat dan sebelum alat membaca pesannya:
//
//   1. Tanggal: "mulai 28 September", "dari tgl 28/9", "sejak tanggal 28" -> "mulai 2026-09-28".
//      Tahun/bulan yang tidak disebut diambil dari hari ini, mundur ke tahun/bulan lalu
//      kalau hasilnya jatuh di masa depan.
//   2. Daftar satu baris: "koreksi hpp mandala mulai 28 september: air mineral 0,4375,
//      gula 17,67, teh vanilla 1,5rb" -> satu bahan per baris "nama = angka".
//      Koma tanpa spasi tetap desimal; koma+spasi, titik koma, atau "dan" = pemisah barang.
//      "rb/ribu/k/jt/juta" dikalikan (1,5rb = 1500).
//   3. Tipe barang: "jadikan bahan baku: gula, air mineral" -> 'Tipe "bahan baku": gula, air mineral'.
//
// Sengaja konservatif: pesan hanya diubah kalau bentuknya yakin dikenali. Kalimat biasa
// (pertanyaan, catatan pengeluaran) dikembalikan apa adanya. Hasilnya selalu tampil di
// draft sebelum "Ya", jadi salah tafsir kelihatan.

const BULAN = Object.freeze([
  [/^jan(uari)?$/i, 1], [/^feb(ruari)?$/i, 2], [/^mar(et)?$/i, 3], [/^apr(il)?$/i, 4],
  [/^mei$/i, 5], [/^jun(i)?$/i, 6], [/^jul(i)?$/i, 7], [/^(agu(stus)?|agt|ags|aug)$/i, 8],
  [/^sep(t|tember)?$/i, 9], [/^okt(ober)?$/i, 10], [/^nov(ember)?$/i, 11], [/^des(ember)?$/i, 12]
]);
const NAMA_BULAN = '(jan(?:uari)?|feb(?:ruari)?|mar(?:et)?|apr(?:il)?|mei|jun(?:i)?|jul(?:i)?|agu(?:stus)?|agt|ags|aug|sep(?:t|tember)?|okt(?:ober)?|nov(?:ember)?|des(?:ember)?)';
const KATA_MULAI = '(mulai|dari|sejak)';

const pad = (n) => String(n).padStart(2, '0');

function bulanDari(teks) {
  return BULAN.find(([pola]) => pola.test(teks))?.[1] ?? null;
}

function tanggalValid(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Tanggal lengkap dari potongan; tahun/bulan kosong diisi dari hari ini, mundur bila di masa depan. */
export function lengkapiTanggal({ hari, bulan = null, tahun = null }, hariIni) {
  const [ty, tm] = String(hariIni).split('-').map(Number);
  let y = tahun ?? ty;
  let m = bulan ?? tm;
  if (y < 100) y += 2000;
  if (!tanggalValid(y, m, hari)) return null;
  let iso = `${y}-${pad(m)}-${pad(hari)}`;
  if (iso > hariIni) {
    if (bulan === null) { m -= 1; if (m === 0) { m = 12; y -= 1; } } else if (tahun === null) { y -= 1; } else { return iso; }
    if (!tanggalValid(y, m, hari)) return null;
    iso = `${y}-${pad(m)}-${pad(hari)}`;
  }
  return iso;
}

/** "mulai 28 September", "dari tgl 28/9", "sejak tanggal 28" -> "mulai YYYY-MM-DD". */
export function bakukanTanggal(teks, hariIni) {
  let hasil = String(teks ?? '');
  // 28 September [2026]
  hasil = hasil.replace(new RegExp(`\\b${KATA_MULAI}?(\\s*(?:tanggal|tgl\\.?))?\\s*(\\d{1,2})\\s+${NAMA_BULAN}\\b(?:\\s+(\\d{4}))?`, 'gi'), (asli, kata, _tgl, hari, bln, tahun) => {
    const iso = lengkapiTanggal({ hari: Number(hari), bulan: bulanDari(bln), tahun: tahun ? Number(tahun) : null }, hariIni);
    if (!iso) return asli;
    return kata ? `mulai ${iso}` : iso;
  });
  // mulai/dari/sejak [tanggal] 28/9[/2026] atau 28-9
  hasil = hasil.replace(new RegExp(`\\b${KATA_MULAI}\\s*(?:tanggal|tgl\\.?)?\\s*(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?\\b`, 'gi'), (asli, _kata, hari, bln, tahun) => {
    const iso = lengkapiTanggal({ hari: Number(hari), bulan: Number(bln), tahun: tahun ? Number(tahun) : null }, hariIni);
    return iso ? `mulai ${iso}` : asli;
  });
  // mulai/dari/sejak tanggal 28 (tanpa bulan) -> bulan ini, atau bulan lalu bila masih di depan
  hasil = hasil.replace(new RegExp(`\\b${KATA_MULAI}\\s*(?:tanggal|tgl\\.?)\\s*(\\d{1,2})\\b(?![/-]|\\d|\\s+${NAMA_BULAN})`, 'gi'), (asli, _kata, hari) => {
    const iso = lengkapiTanggal({ hari: Number(hari) }, hariIni);
    return iso ? `mulai ${iso}` : asli;
  });
  return hasil;
}

const KALI = Object.freeze({ rb: 1000n, ribu: 1000n, k: 1000n, jt: 1000000n, juta: 1000000n });

/** "1,5rb" -> "1500"; "0,4375" -> "0,4375"; "1.500" -> "1.500" (dibiarkan untuk pembaca harga). */
export function bakukanAngka(angka, satuanKali) {
  if (!satuanKali) return angka;
  const kali = KALI[satuanKali.toLowerCase()];
  const bersih = angka.replace(/\./g, '').replace(',', '.');
  const [bulat, pecahan = ''] = bersih.split('.');
  if (!/^\d+$/.test(bulat) || !/^\d*$/.test(pecahan)) return angka;
  const skala = 10n ** BigInt(pecahan.length);
  const nilai = BigInt(bulat + pecahan) * kali;
  if (nilai % skala !== 0n) {
    const bul = nilai / skala; const sisa = (nilai % skala).toString().padStart(pecahan.length, '0').replace(/0+$/, '');
    return `${bul},${sisa}`;
  }
  return String(nilai / skala);
}

const SEGMEN = /^\s*(?:\d{1,3}\s*[.)]\s*)?([a-z][^=:\d]*?[a-z)])\s*(?:=|:)?\s*(?:rp\.?\s*)?(\d[\d.,]*)\s*(rb|ribu|k|jt|juta)?\s*((?:\/|per\s+)\s*[a-z]+)?\s*\.?\s*$/i;

/** Satu baris "a 1, b 2,5, c 3rb" -> [{nama, angka, satuan}] atau null kalau tidak semua segmen dikenali. */
export function uraiSegmenDaftar(teks) {
  const potongan = String(teks ?? '').split(/,\s+|;\s*|\s+dan\s+/i).map((s) => s.trim()).filter(Boolean);
  if (potongan.length < 2) return null;
  const hasil = [];
  for (const p of potongan) {
    const cocok = p.match(SEGMEN);
    if (!cocok) return null;
    hasil.push({ nama: cocok[1].trim(), angka: bakukanAngka(cocok[2].replace(/[.,]$/, ''), cocok[3]), satuan: cocok[4] ? cocok[4].replace(/^\/\s*/, 'per ').replace(/\s+/g, ' ').trim() : '' });
  }
  return hasil;
}

const POLA_TIPE = /^(.*?)\b(?:jadikan|jadi(?:kan)?\s+tipe|ubah\s+tipe(?:nya)?\s+jadi|tipe(?:nya)?\s+jadi)\s+(bahan baku|setengah jadi|barang jadi)\s*:\s*(.+)$/i;

/**
 * Pesan chat -> format baku. { teks, diubah, catatan[] }.
 * @param {string} pesan
 * @param {string} hariIni YYYY-MM-DD
 */
export function terjemahkanPesan(pesan, hariIni) {
  const asli = String(pesan ?? '');
  const catatan = [];
  let teks = bakukanTanggal(asli, hariIni);
  if (teks !== asli) catatan.push('tanggal');

  const baris = teks.split(/\r?\n/);
  const keluar = [];
  for (const b of baris) {
    const tipe = b.match(POLA_TIPE);
    if (tipe) {
      if (tipe[1].trim()) keluar.push(tipe[1].trim());
      keluar.push(`Tipe "${tipe[2].toLowerCase()}": ${tipe[3].trim()}`);
      catatan.push('tipe');
      continue;
    }
    // Daftar satu baris sesudah titik dua: "koreksi hpp ... : a 1, b 2".
    const titikDua = b.indexOf(':');
    const relevan = /\b(hpp|rentang harga beli|harga beli)\b/i.test(teks);
    if (relevan && titikDua > 0) {
      const segmen = uraiSegmenDaftar(b.slice(titikDua + 1));
      if (segmen) {
        keluar.push(`${b.slice(0, titikDua).trim()}:`);
        segmen.forEach((s, i) => keluar.push(`${i + 1}. ${s.nama} = ${s.angka}${s.satuan ? ` ${s.satuan}` : ''}`));
        catatan.push('daftar');
        continue;
      }
    }
    keluar.push(b);
  }
  teks = keluar.join('\n');
  return { teks, diubah: teks !== asli, catatan: [...new Set(catatan)] };
}
