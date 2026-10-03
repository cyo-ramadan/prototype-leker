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
//   - Draft TIDAK menjalankan pratinjau per bahan. Versi pertama (2026-10-03) memanggil
//     pratinjau untuk tiap bahan dalam satu permintaan: 17 bahan = puluhan kueri sekaligus,
//     melewati batas kerja per permintaan paket Cloudflare gratis (alasan yang sama
//     dengan buat_barang_banyak bertahap). Draft cukup satu bacaan daftar bahan; dampak
//     per bahan dihitung saat bahan itu dijalankan (satu bahan per permintaan).
//   - Bahan yang ternyata sudah benar (tidak ada penjualan yang berubah dan harga
//     rata-ratanya sudah sama) dilewati otomatis, tidak menghentikan sisanya.

import { cocokkanSatu, teks, tanggalDari, BELUM_KETEMU } from './caca-aksi-dasar.js';
import { tampilSkala } from './caca-hitung.js';
import { hargaPerSatuan } from './caca-aksi-hpp.js';

const JALUR = '/api/admin/hpp-recalculation';
export const BATAS_HPP_BANYAK = 60;
const ANGKA_ID = /^\d{1,9}$/;
const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const HARGA = /^\d{1,12}(\.\d{1,6})?$/;
const SKALA = /^\d{1,24}$/;

const rupiahSkala = (skala) => `Rp${tampilSkala(BigInt(skala))}`;
// Jawaban Hitung Ulang HPP kalau tidak ada yang perlu diubah (src/hpp-recalculation.js).
const SUDAH_SAMA = /^Tidak ada penjualan yang HPP-nya berubah/;

function bentukValid(daftar) {
  if (!Array.isArray(daftar) || !daftar.length || daftar.length > BATAS_HPP_BANYAK) return false;
  return daftar.every((b) => ANGKA_ID.test(String(b?.componentProductId))
    && typeof b.name === 'string' && b.name.length > 0 && b.name.length <= 120
    && typeof b.satuan === 'string' && b.satuan.length <= 20
    && typeof b.unitCost === 'string' && HARGA.test(b.unitCost)
    && typeof b.sebelumSkala === 'string' && SKALA.test(b.sebelumSkala)
    && typeof b.hargaSkala === 'string' && SKALA.test(b.hargaSkala)
    && typeof b.from === 'string' && TANGGAL.test(b.from));
}

function susunDraft(daftar) {
  const tanggal = [...new Set(daftar.map((b) => b.from))].sort();
  return {
    aksi: 'koreksi_hpp_banyak',
    bertahap: true,
    judul: `Una mau mengoreksi HPP ${daftar.length} bahan — dicek dulu ya:`,
    baris: [
      ['Jumlah bahan', String(daftar.length)],
      ['Mulai tanggal', tanggal.length === 1 ? tanggal[0] : `${tanggal[0]} s/d ${tanggal[tanggal.length - 1]} (per baris)`]
    ],
    tabel: {
      kolom: ['Bahan', 'Sekarang', 'Harga benar', 'Mulai'],
      isi: daftar.map((b) => [b.name, `${rupiahSkala(b.sebelumSkala)}/${b.satuan}`, `${rupiahSkala(b.hargaSkala)}/${b.satuan}`, b.from])
    },
    dampak: [
      'Dijalankan berurutan persis seperti daftar ini, satu bahan per langkah. Bahan baku harus di depan olahan (larutan) supaya harga olahan dihitung dari harga bahan yang sudah benar.',
      'Penjualan sejak tanggal mulai dihitung ulang dengan harga benar. Jumlah penjualan dan selisih HPP tiap bahan tercatat di Riwayat Hitung Ulang HPP setelah dijalankan.',
      'Hanya HPP yang berubah: stok, nominal pembelian, dan uang laci tidak disentuh. Untung di tanggal-tanggal itu ikut berubah sebesar kebalikan selisih HPP.',
      'Bahan yang ternyata sudah benar dilewati otomatis.',
      'Di gerai berpembukuan, jurnal koreksinya dibuat otomatis (jurnal lama tidak diedit).'
    ],
    muatan: { daftar }
  };
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
    // membaca ulang -- yang dijalankan persis yang tadi dikonfirmasi.
    const beku = ctx.draftAsli?.muatan;
    if (beku && Array.isArray(beku.daftar)) {
      if (!bentukValid(beku.daftar)) {
        return { ok: false, tanya: 'Daftar koreksinya kayaknya berubah. Minta Una menyusun ulang ya.' };
      }
      return { ok: true, draft: susunDraft(beku.daftar) };
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

    const daftar = [];
    const dipakai = new Set();
    // Semua nama, harga, dan tanggal diperiksa sebelum draft tampil: satu salah ketik
    // tidak boleh baru ketahuan di tengah jalan.
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

      daftar.push({
        componentProductId: Number(bahan.productId),
        name: bahan.name,
        satuan: bahan.unitSymbol || bahan.unitCode || 'satuan',
        unitCost: harga.teks,
        // Hanya untuk ditampilkan: harga rata-rata tercatat dibulatkan ke skala 1.000.000.
        sebelumSkala: String(BigInt(Math.max(0, Math.round(Number(bahan.averageCostRupiah || 0) * 1_000_000)))),
        hargaSkala: String(harga.skala),
        from: dari
      });
    }
    return { ok: true, draft: susunDraft(daftar) };
  },

  async postingBagian(draft, bagian, ctx) {
    const baris = draft.muatan.daftar[bagian];
    const reason = `Koreksi HPP ${baris.name} lewat Una (harga benar ${rupiahSkala(baris.hargaSkala)} per ${baris.satuan}, koreksi massal)`.slice(0, 300);
    const hasil = await ctx.kirim('POST', JALUR, {
      componentProductId: baris.componentProductId, unitCost: baris.unitCost, from: baris.from, reason
    });
    if (!hasil.ok) {
      if (hasil.status === 409 && SUDAH_SAMA.test(String(hasil.error ?? ''))) {
        return { ok: true, hasil: 'sudah_sesuai', nama: baris.name, id: baris.componentProductId };
      }
      return hasil;
    }
    return { ok: true, hasil: 'dikoreksi', nama: baris.name, id: baris.componentProductId };
  },

  posting() {
    return { ok: false, status: 409, error: 'Draft ini dijalankan bertahap. Muat ulang halaman lalu minta Una menyusun ulang ya.' };
  }
});

export const AKSI_HPP_BANYAK = Object.freeze([koreksiHppBanyak]);
