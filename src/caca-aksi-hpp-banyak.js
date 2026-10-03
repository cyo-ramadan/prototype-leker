// Alat Una: koreksi HPP banyak bahan sekaligus -- Bos Cyo 2026-10-03: "una uda bisa
// beresin hpp2 anomali dan hitungkan ulang dari september". Hasil audit_hpp berisi
// puluhan bahan per gerai; menyuruh Una satu-satu (satu draft, satu "Ya" per bahan)
// tidak masuk akal.
//
// Sama sekali tidak ada jalur baru: tiap baris = satu Hitung Ulang HPP biasa
// (src/hpp-recalculation.js, alat hitung_ulang_hpp), jadi semua aturannya ikut:
// hanya HPP yang berubah, koreksi = catatan baru (snapshot lama tidak ditulis ulang),
// jurnal koreksi dibuat untuk gerai berpembukuan.
//
// Bedanya dengan hitung_ulang_hpp:
//   - Satu draft untuk seluruh daftar, satu "Ya" per gerai. Dijalankan bertahap
//     (satu bahan per permintaan) seperti ubah_barang.
//   - URUTAN dijaga persis seperti diminta. audit_hpp mengurutkan bahan baku dulu,
//     olahan (larutan) sesudahnya; alat ini tidak mengubah urutan.
//   - Tanggal mulai TIDAK dicari sendiri: harus disebut (satu tanggal untuk semua,
//     atau per baris). Sengaja: koreksi massal tanpa tanggal yang jelas = tebakan massal.
//   - Harga yang sama dengan yang tercatat dan tanpa penjualan terdampak dilewati.

import { rupiah } from './caca-nominal.js';
import { cocokkanSatu, teks, tanggalDari, BELUM_KETEMU } from './caca-aksi-dasar.js';
import { tampilSkala } from './caca-hitung.js';
import { hargaPerSatuan } from './caca-aksi-hpp.js';

const JALUR = '/api/admin/hpp-recalculation';
export const BATAS_HPP_BANYAK = 30;
const ANGKA_ID = /^\d{1,9}$/;
const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const HARGA = /^\d{1,12}(\.\d{1,6})?$/;
const SKALA = /^\d{1,24}$/;

const rupiahSkala = (skala) => `Rp${tampilSkala(BigInt(skala))}`;
const selisih = (nilai) => `${nilai < 0 ? '−' : nilai > 0 ? '+' : ''}${rupiah(Math.abs(nilai))}`;

function bentukValid(daftar) {
  if (!Array.isArray(daftar) || !daftar.length || daftar.length > BATAS_HPP_BANYAK) return false;
  return daftar.every((b) => ANGKA_ID.test(String(b?.componentProductId))
    && typeof b.name === 'string' && b.name.length > 0 && b.name.length <= 120
    && typeof b.satuan === 'string' && b.satuan.length <= 20
    && typeof b.unitCost === 'string' && HARGA.test(b.unitCost)
    && typeof b.sebelumSkala === 'string' && SKALA.test(b.sebelumSkala)
    && typeof b.hargaSkala === 'string' && SKALA.test(b.hargaSkala)
    && typeof b.from === 'string' && TANGGAL.test(b.from)
    && Number.isInteger(b.jual) && b.jual >= 0
    && Number.isFinite(b.selisihRupiah)
    && typeof b.hanyaHarga === 'boolean');
}

function susunDraft(daftar, sudahSesuai) {
  const jual = daftar.reduce((jumlah, b) => jumlah + b.jual, 0);
  const total = daftar.reduce((jumlah, b) => jumlah + b.selisihRupiah, 0);
  const tanggal = [...new Set(daftar.map((b) => b.from))].sort();
  const hanyaHarga = daftar.filter((b) => b.hanyaHarga).length;
  return {
    aksi: 'koreksi_hpp_banyak',
    bertahap: true,
    judul: `Una mau mengoreksi HPP ${daftar.length} bahan — dicek dulu ya:`,
    baris: [
      ['Jumlah bahan', String(daftar.length)],
      ['Mulai tanggal', tanggal.length === 1 ? tanggal[0] : `${tanggal[0]} s/d ${tanggal[tanggal.length - 1]} (per baris)`],
      ['Penjualan terdampak (s/d kemarin)', String(jual)],
      ['Selisih HPP total (s/d kemarin)', selisih(total)]
    ],
    tabel: {
      kolom: ['Bahan', 'Sekarang', 'Harga benar', 'Jual', 'Selisih HPP'],
      isi: daftar.map((b) => [b.name, `${rupiahSkala(b.sebelumSkala)}/${b.satuan}`, `${rupiahSkala(b.hargaSkala)}/${b.satuan}`, String(b.jual), b.hanyaHarga ? 'harga saja' : selisih(b.selisihRupiah)])
    },
    dampak: [
      'Dijalankan berurutan persis seperti daftar ini. Bahan baku harus di depan olahan (larutan) supaya harga olahan dihitung dari harga bahan yang sudah benar.',
      'Hanya HPP yang berubah: stok, nominal pembelian, dan uang laci tidak disentuh.',
      'Untung di tanggal-tanggal itu ikut berubah sebesar kebalikan selisih HPP.',
      ...(hanyaHarga ? [`${hanyaHarga} bahan tidak punya penjualan terdampak: hanya harga rata-ratanya yang dibetulkan (supaya penjualan berikutnya benar).`] : []),
      'Catatannya tersimpan permanen di Riwayat Hitung Ulang HPP; di gerai berpembukuan, jurnal koreksinya dibuat otomatis (jurnal lama tidak diedit).',
      ...(sudahSesuai.length ? [`Sudah sesuai, dilewati: ${sudahSesuai.slice(0, 10).join(', ')}${sudahSesuai.length > 10 ? ', …' : ''}.`] : [])
    ],
    muatan: { daftar, sudahSesuai }
  };
}

async function pratinjau(ctx, { componentProductId, unitCost, from }) {
  const hasil = await ctx.kirim('POST', `${JALUR}/preview`, { componentProductId, unitCost, from });
  if (!hasil.ok) return hasil;
  return { ok: true, ringkasan: hasil.data.summary };
}

const koreksiHppBanyak = Object.freeze({
  nama: 'koreksi_hpp_banyak',
  lingkup: 'gerai',
  bertahap: true,
  petunjuk: 'MENGOREKSI HPP BANYAK bahan sekaligus di gerai yang sedang dibuka dan menghitung ulang HPP penjualan sejak tanggal mulai, dari satu daftar "bahan = harga benar per satuan", mis. daftar hasil audit_hpp atau daftar yang ditempel Bos: "Gula = 17.5, Teh Jasmine = 1500, Larutan Gula = 11.3 mulai 2026-09-21". Dipakai kalau bahannya 2 atau lebih (satu bahan saja = hitung_ulang_hpp). Urutan daftar dijaga persis; bahan baku taruh di depan, olahan/larutan di belakang. Tanggal mulai WAJIB disebut. Lingkup: satu gerai (pilih gerainya dulu).',
  skema: {
    kh_daftar: {
      type: 'array',
      description: 'koreksi_hpp_banyak: satu objek per bahan, URUTAN persis seperti disebut.',
      items: {
        type: 'object',
        required: ['bahan', 'harga'],
        properties: {
          bahan: { type: 'string', description: 'Nama bahan PERSIS seperti disebut (tanpa nama gerai).' },
          harga: { type: 'string', description: 'Harga BENAR per satuan PERSIS seperti disebut, mis. "1500" atau "17.5" atau "0,4375".' },
          dari: { type: 'string', description: 'YYYY-MM-DD khusus bahan ini, hanya kalau berbeda dari kh_dari.' }
        }
      }
    },
    kh_dari: { type: 'string', description: 'koreksi_hpp_banyak: YYYY-MM-DD tanggal mulai harga benar untuk semua bahan di daftar (kecuali yang punya "dari" sendiri).' }
  },

  async siapkan(t, ctx) {
    // Konfirmasi (potongan mana pun): isi dibekukan di draft yang dilihat, tanpa
    // pratinjau ulang -- penjualan baru tidak boleh menggeser yang sudah dikonfirmasi.
    const beku = ctx.draftAsli?.muatan;
    if (beku && Array.isArray(beku.daftar)) {
      if (!bentukValid(beku.daftar) || !Array.isArray(beku.sudahSesuai)) {
        return { ok: false, tanya: 'Daftar koreksinya kayaknya berubah. Minta Una menyusun ulang ya.' };
      }
      return { ok: true, draft: susunDraft(beku.daftar, beku.sudahSesuai.map(String).slice(0, 60)) };
    }

    const mentah = (Array.isArray(t?.kh_daftar) ? t.kh_daftar : []).filter((b) => teks(b?.bahan, 100));
    if (mentah.length < 1) return { ok: false, tanya: 'Bahan apa saja yang HPP-nya mau dikoreksi, dan harga benarnya berapa per satuan?' };
    if (mentah.length > BATAS_HPP_BANYAK) return { ok: false, tanya: `Kebanyakan untuk sekali jalan (maks ${BATAS_HPP_BANYAK} bahan). Bagi jadi dua daftar, bahan baku dulu.` };

    let tanggalSemua = null;
    if (teks(t?.kh_dari, 10)) {
      const tanggal = tanggalDari(t.kh_dari, ctx.hariIni);
      if (!tanggal.ok) return tanggal;
      tanggalSemua = tanggal.nilai;
    }

    const komponen = await ctx.baca(`${JALUR}/components`);
    if (!komponen.ok) return komponen;
    const bahanList = komponen.data.components ?? [];

    const disusun = [];
    const dipakai = new Set();
    // Semua nama dan harga diperiksa SEBELUM pratinjau pertama: satu salah ketik
    // tidak boleh baru ketahuan setelah belasan permintaan.
    for (const baris of mentah) {
      const tertulis = teks(baris.bahan, 100);
      const cocok = cocokkanSatu(tertulis, bahanList, { label: 'bahan', namaDari: (b) => b.name });
      if (!cocok.ok) {
        const contoh = bahanList.slice(0, 8).map((b) => b.name).join(', ');
        return { ok: false, tanya: BELUM_KETEMU.test(cocok.tanya) && contoh ? `${cocok.tanya} (di ${ctx.namaLingkup || 'gerai ini'}). Yang bisa dikoreksi HPP-nya: ${contoh}${bahanList.length > 8 ? ', …' : ''}.` : cocok.tanya };
      }
      const bahan = cocok.nilai;
      if (dipakai.has(bahan.productId)) return { ok: false, tanya: `"${bahan.name}" disebut dua kali. Harga yang mana yang benar?` };
      dipakai.add(bahan.productId);

      if (!teks(baris.harga, 40)) return { ok: false, tanya: `Harga benar ${bahan.name} berapa per ${bahan.unitSymbol || bahan.unitCode || 'satuan'}?` };
      const harga = hargaPerSatuan(baris.harga);
      if (!harga.ok) return { ok: false, tanya: `${bahan.name}: ${harga.tanya}` };

      let dari = tanggalSemua;
      if (teks(baris.dari, 10)) {
        const tanggal = tanggalDari(baris.dari, ctx.hariIni);
        if (!tanggal.ok) return { ok: false, tanya: `${bahan.name}: ${tanggal.tanya}` };
        dari = tanggal.nilai;
      }
      if (!dari) return { ok: false, tanya: 'Koreksi dihitung ulang mulai tanggal berapa? Sebut satu tanggal untuk semua bahan, atau per bahan.' };

      disusun.push({
        bahan,
        harga,
        dari,
        satuan: bahan.unitSymbol || bahan.unitCode || 'satuan',
        // Hanya untuk ditampilkan: harga rata-rata tercatat dibulatkan ke skala 1.000.000.
        sebelumSkala: BigInt(Math.max(0, Math.round(Number(bahan.averageCostRupiah || 0) * 1_000_000)))
      });
    }

    const daftar = [];
    const sudahSesuai = [];
    for (const item of disusun) {
      const hasil = await pratinjau(ctx, { componentProductId: item.bahan.productId, unitCost: item.harga.teks, from: item.dari });
      if (!hasil.ok) return { ok: false, tanya: `${item.bahan.name}: ${hasil.error}` };
      const s = hasil.ringkasan;
      if (!s.lineCount && !s.averageCostOnly) { sudahSesuai.push(item.bahan.name); continue; }
      const sampaiKemarin = (s.byDate ?? []).filter((hari) => hari.businessDate < ctx.hariIni);
      daftar.push({
        componentProductId: Number(item.bahan.productId),
        name: item.bahan.name,
        satuan: item.satuan,
        unitCost: item.harga.teks,
        sebelumSkala: String(item.sebelumSkala),
        hargaSkala: String(item.harga.skala),
        from: item.dari,
        jual: sampaiKemarin.reduce((jumlah, hari) => jumlah + hari.saleCount, 0),
        selisihRupiah: sampaiKemarin.reduce((jumlah, hari) => jumlah + hari.deltaRupiah, 0),
        hanyaHarga: Boolean(s.averageCostOnly)
      });
    }
    if (!daftar.length) {
      return { ok: false, tanya: `Semua bahan itu HPP-nya sudah sesuai dan tidak ada penjualan yang beda (${sudahSesuai.slice(0, 8).join(', ')}). Tidak ada yang perlu dikoreksi.` };
    }
    return { ok: true, draft: susunDraft(daftar, sudahSesuai) };
  },

  async postingBagian(draft, bagian, ctx) {
    const baris = draft.muatan.daftar[bagian];
    const reason = `Koreksi HPP ${baris.name} lewat Una (harga benar ${rupiahSkala(baris.hargaSkala)} per ${baris.satuan}, koreksi massal)`.slice(0, 300);
    const hasil = await ctx.kirim('POST', JALUR, {
      componentProductId: baris.componentProductId, unitCost: baris.unitCost, from: baris.from, reason
    });
    if (!hasil.ok) return hasil;
    return { ok: true, hasil: 'dikoreksi', nama: baris.name, id: baris.componentProductId };
  },

  posting() {
    return { ok: false, status: 409, error: 'Draft ini dijalankan bertahap. Muat ulang halaman lalu minta Una menyusun ulang ya.' };
  }
});

export const AKSI_HPP_BANYAK = Object.freeze([koreksiHppBanyak]);
