// Alat Una: atur rentang harga beli wajar banyak barang sekaligus (Bos Cyo, 2026-10-04:
// "buatkan juga agar dia mengentry range harga beli yang diperbolehkan, untuk barang2
// sekarang ambil nilai benernya lalu berikan nilai 25% selisihnya").
//
// Jalurnya sama dengan layar admin: POST /api/admin/purchase-price-ranges (satu batch).
// Pembelian kasir di luar rentang ditolak server (src/purchase-price-ranges.js).
//
// Dua bentuk baris, dibaca KODE dari teks pesan (model Una = Gemini lite; daftar panjang
// tidak boleh bergantung pada tangkapan model):
//   "Gula = 17,666667 per g"         -> harga acuan; rentang = acuan ± persen (bawaan 25%)
//   "Gula = 13,25 - 22,08 per g"     -> rentang ditulis langsung
// Persen diambil dari teks ("selisih 25%", "±20%"); kalau tidak disebut, 25%.
// Semua hitungan memakai integer skala 1.000.000 (BigInt), dibulatkan half-up.

import { cocokkanSatu, teks, BELUM_KETEMU } from './caca-aksi-dasar.js';
import { hargaPerSatuan } from './caca-aksi-hpp.js';
import { tampilSkala } from './caca-hitung.js';

const JALUR = '/api/admin/purchase-price-ranges';
export const BATAS_RENTANG = 100;
export const PERSEN_BAWAAN = 25;
const SKALA = 1_000_000n;
const ANGKA_ID = /^\d{1,9}$/;
const ANGKA_SKALA = /^\d{1,24}$/;

const RENTANG = /^\s*(?:\d{1,3}\s*[.)]\s*)?(.+?)\s*[=:]\s*(?:rp\.?\s*)?(\d[\d.,]*)\s*(?:-|–|s\/d|sampai)\s*(?:rp\.?\s*)?(\d[\d.,]*)\s*(?:(?:\/|per\s+)\s*[a-z]+)?\s*\.?\s*$/i;
const ACUAN = /^\s*(?:\d{1,3}\s*[.)]\s*)?(.+?)\s*[=:]\s*(?:rp\.?\s*)?(\d[\d.,]*)\s*(?:(?:\/|per\s+)\s*[a-z]+)?\s*\.?\s*$/i;
const PERSEN = /(?:±|\+\/?-|\bselisih\b|\btoleransi\b|\bboleh\b)[^\n%]{0,30}?(\d{1,2})\s*%/i;

/** Baris rentang/acuan dari teks pesan + persen. */
export function uraiDaftarRentang(teksPesan) {
  const daftar = [];
  for (const baris of String(teksPesan ?? '').split(/\r?\n/)) {
    const r = baris.match(RENTANG);
    if (r) { daftar.push({ barang: r[1].trim(), min: r[2].replace(/[.,]$/, ''), max: r[3].replace(/[.,]$/, '') }); continue; }
    const a = baris.match(ACUAN);
    if (a && !/harga per satuan|desimal/i.test(a[1])) daftar.push({ barang: a[1].trim(), harga: a[2].replace(/[.,]$/, '') });
  }
  const persen = String(teksPesan ?? '').match(PERSEN)?.[1];
  return { daftar: daftar.filter((b) => b.barang && b.barang.length <= 100), persen: persen ? Number(persen) : null };
}

const kaliPersen = (skala, persen) => (skala * BigInt(persen) + 50n) / 100n;
const desimal = (skala) => {
  const n = BigInt(skala);
  const pecahan = (n % SKALA).toString().padStart(6, '0').replace(/0+$/, '');
  return `${n / SKALA}${pecahan ? `.${pecahan}` : ''}`;
};
const rupiahSkala = (skala) => `Rp${tampilSkala(BigInt(skala))}`;

function bentukValid(daftar) {
  if (!Array.isArray(daftar) || !daftar.length || daftar.length > BATAS_RENTANG) return false;
  return daftar.every((b) => ANGKA_ID.test(String(b?.productId)) && typeof b.name === 'string' && b.name.length > 0 && b.name.length <= 120
    && typeof b.satuan === 'string' && b.satuan.length <= 20
    && ANGKA_SKALA.test(String(b.minScaled)) && ANGKA_SKALA.test(String(b.maxScaled))
    && (b.basisScaled === null || ANGKA_SKALA.test(String(b.basisScaled)))
    && BigInt(b.minScaled) > 0n && BigInt(b.maxScaled) >= BigInt(b.minScaled));
}

function susunDraft(daftar, persen) {
  return {
    aksi: 'atur_rentang_harga_beli',
    judul: `Una mau mengatur rentang harga beli wajar ${daftar.length} barang — dicek dulu ya:`,
    baris: [['Jumlah barang', String(daftar.length)], ...(persen !== null ? [['Selisih dari harga acuan', `±${persen}%`]] : [])],
    tabel: {
      kolom: ['Barang', 'Harga acuan', 'Batas bawah', 'Batas atas'],
      isi: daftar.map((b) => [b.name, b.basisScaled === null ? '—' : `${rupiahSkala(b.basisScaled)}/${b.satuan}`, `${rupiahSkala(b.minScaled)}/${b.satuan}`, `${rupiahSkala(b.maxScaled)}/${b.satuan}`])
    },
    dampak: [
      'Pembelian kasir yang harga per satuannya di luar rentang akan DITOLAK dengan pesan yang menyebut harga wajarnya, supaya salah ketik qty/harga tidak merusak HPP.',
      'Harga per satuan = total belanja barang itu ÷ qty (dalam satuan dasar barang).',
      'Rentang yang sudah ada untuk barang yang sama diganti. Barang lain tidak berubah. Kalau harga pasar berubah, atur ulang rentangnya.'
    ],
    muatan: { daftar, persen }
  };
}

const aturRentang = Object.freeze({
  nama: 'atur_rentang_harga_beli',
  lingkup: 'gerai',
  petunjuk: 'MENGATUR rentang harga beli wajar per satuan untuk satu atau banyak barang di gerai yang sedang dibuka, mis. "atur rentang harga beli, selisih 25%: Gula = 17,5 per g, Teh Jasmine = 1500 per pcs" atau "Gula = 13 - 22". Pembelian kasir di luar rentang ditolak. Bukan untuk mengubah HPP (itu koreksi_hpp_banyak).',
  skema: {
    ar_daftar: {
      type: 'array',
      description: 'atur_rentang_harga_beli: satu objek per barang, urut seperti ditulis.',
      items: {
        type: 'object',
        required: ['barang'],
        properties: {
          barang: { type: 'string', description: 'Nama barang PERSIS seperti ditulis.' },
          harga: { type: 'string', description: 'Harga acuan per satuan PERSIS seperti ditulis (kalau rentang dihitung dari persen).' },
          min: { type: 'string', description: 'Batas bawah per satuan PERSIS seperti ditulis (kalau rentang ditulis langsung).' },
          max: { type: 'string', description: 'Batas atas per satuan PERSIS seperti ditulis (kalau rentang ditulis langsung).' }
        }
      }
    },
    ar_persen: { type: 'string', description: 'atur_rentang_harga_beli: persen selisih dari harga acuan kalau disebut, mis. "25".' }
  },

  async siapkan(t, ctx) {
    const beku = ctx.draftAsli?.muatan;
    if (beku && Array.isArray(beku.daftar)) {
      if (!bentukValid(beku.daftar)) return { ok: false, tanya: 'Daftar rentangnya kayaknya berubah. Minta Una menyusun ulang ya.' };
      const persen = Number.isInteger(beku.persen) && beku.persen > 0 && beku.persen < 100 ? beku.persen : null;
      return { ok: true, draft: susunDraft(beku.daftar, persen) };
    }

    const dariPesan = uraiDaftarRentang(ctx.pesan);
    let mentah = (Array.isArray(t?.ar_daftar) ? t.ar_daftar : []).filter((b) => teks(b?.barang, 100));
    if (dariPesan.daftar.length > mentah.length) mentah = dariPesan.daftar;
    if (!mentah.length) return { ok: false, tanya: 'Barang apa saja yang mau diatur rentang harga belinya, dan harga acuannya berapa per satuan?' };
    if (mentah.length > BATAS_RENTANG) return { ok: false, tanya: `Kebanyakan untuk sekali jalan (maks ${BATAS_RENTANG} barang). Bagi dua ya.` };

    const persenTeks = dariPesan.persen ?? (teks(t?.ar_persen, 3) ? Number(teks(t.ar_persen, 3)) : null);
    const persen = persenTeks ?? PERSEN_BAWAAN;
    if (!Number.isInteger(persen) || persen <= 0 || persen >= 100) return { ok: false, tanya: 'Selisihnya berapa persen? Antara 1 sampai 99.' };

    const ref = await ctx.baca('/api/admin/master/products/editor?ringkas=1');
    if (!ref.ok) return ref;
    const produk = (ref.data.products ?? []).filter((p) => p.isActive !== false);

    const daftar = [];
    const dipakai = new Set();
    let pakaiPersen = false;
    for (const baris of mentah) {
      const cocok = cocokkanSatu(teks(baris.barang, 100), produk, { label: 'barang', namaDari: (p) => p.name });
      if (!cocok.ok) return BELUM_KETEMU.test(cocok.tanya) ? { ok: false, tanya: `${cocok.tanya} (di ${ctx.namaLingkup || 'gerai ini'}; barang nonaktif tidak ikut dicari.)` } : cocok;
      const p = cocok.nilai;
      if (dipakai.has(p.id)) return { ok: false, tanya: `"${p.name}" disebut dua kali. Rentang yang mana yang benar?` };
      dipakai.add(p.id);
      const satuan = p.unitSymbol || 'satuan';

      let minScaled; let maxScaled; let basisScaled = null;
      if (teks(baris.min, 40) && teks(baris.max, 40)) {
        const min = hargaPerSatuan(baris.min);
        const max = hargaPerSatuan(baris.max);
        if (!min.ok) return { ok: false, tanya: `${p.name} (batas bawah): ${min.tanya}` };
        if (!max.ok) return { ok: false, tanya: `${p.name} (batas atas): ${max.tanya}` };
        if (max.skala < min.skala) return { ok: false, tanya: `${p.name}: batas atas lebih kecil dari batas bawah.` };
        minScaled = min.skala; maxScaled = max.skala;
      } else if (teks(baris.harga, 40)) {
        const harga = hargaPerSatuan(baris.harga);
        if (!harga.ok) return { ok: false, tanya: `${p.name}: ${harga.tanya}` };
        basisScaled = harga.skala;
        minScaled = kaliPersen(basisScaled, 100 - persen);
        maxScaled = kaliPersen(basisScaled, 100 + persen);
        if (minScaled <= 0n) minScaled = 1n;
        pakaiPersen = true;
      } else {
        return { ok: false, tanya: `Harga acuan ${p.name} berapa per ${satuan}?` };
      }
      daftar.push({ productId: Number(p.id), name: p.name, satuan, minScaled: String(minScaled), maxScaled: String(maxScaled), basisScaled: basisScaled === null ? null : String(basisScaled) });
    }
    return { ok: true, draft: susunDraft(daftar, pakaiPersen ? persen : null) };
  },

  async posting(draft, ctx) {
    const { daftar } = draft.muatan;
    const hasil = await ctx.kirim('POST', JALUR, {
      items: daftar.map((b) => ({ productId: b.productId, min: desimal(b.minScaled), max: desimal(b.maxScaled), basis: b.basisScaled === null ? null : desimal(b.basisScaled) }))
    });
    if (!hasil.ok) return hasil;
    return { ok: true, jawaban: `Beres, rentang harga beli ${daftar.length} barang di ${ctx.namaLingkup || 'gerai ini'} sudah Una atur. Pembelian kasir di luar rentang sekarang ditolak dengan pesan harga wajarnya.` };
  }
});

export const AKSI_RENTANG = Object.freeze([aturRentang]);
