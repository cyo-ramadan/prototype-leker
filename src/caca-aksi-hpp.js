// Koreksi HPP lewat Una (Bos Cyo 2026-10-03, setelah HPP Bubuk Matcha Genengan
// tercatat Rp1.899.004 per pcs): "tool untuk ngubah hpp yang urgent ... lebih
// bagusnya tool untuk rekap ulang hpp dari tanggal yang salah, fitur itu sudah
// ada juga sekarang".
//
// Una TIDAK membuat jalur baru: ini merangkai Hitung Ulang HPP yang sudah ada
// (src/hpp-recalculation.js, tab "Hitung Ulang HPP") — pratinjau, lalu draft,
// lalu "Ya". Semua aturannya ikut: hanya HPP yang berubah, snapshot lama tidak
// ditulis ulang (koreksi = catatan baru), jurnal koreksi dibuat untuk gerai
// berpembukuan, dan riwayatnya tampil di layar yang sama.
//
// Dua bentuk, satu alat:
//   - "rekap ulang" : harga benar berlaku sejak tanggal tertentu; HPP penjualan
//     sejak tanggal itu dihitung ulang dan harga rata-rata bahan dibetulkan.
//   - "ke depan saja" (urgent): cuma harga rata-rata bahan yang diganti, supaya
//     penjualan berikutnya tidak memakai angka yang salah; yang sudah lewat
//     dibiarkan. Dicapai dengan tanggal mulai di masa depan, tanpa jalur baru.
//
// Tanggal "yang salah" dicari KODE kalau tidak disebut: tanggal pertama saat
// HPP bahan itu di penjualan melenceng lebih dari 20% dari harga benar. Angka
// yang menentukan dan tanggalnya tertulis di draft, jadi salah-tebak kelihatan
// sebelum "Ya" — dan bisa diperbaiki dengan menyebut tanggalnya.

import { rupiah } from './caca-nominal.js';
import { cocokkanSatu, teks, tanggalDari, TANGGAL } from './caca-aksi-dasar.js';
import { uraikanNominal } from './caca-nominal.js';
import { keSkala, tampilSkala } from './caca-hitung.js';

const JALUR = '/api/admin/hpp-recalculation';
const TANGGAL_AWAL = '2000-01-01';
const AMBANG_MELENCENG = 0.2;
const MAKS_BARIS_TABEL = 12;

const MODE = Object.freeze({ ULANG: 'ulang', KE_DEPAN: 'ke_depan' });

/** "1.200" / "1,5jt" / "0,5" / "12.75" → {teks:'0.5', skala:BigInt} per satuan. Nol ditolak. */
export function hargaPerSatuan(tertulis) {
  const mentah = teks(tertulis, 40);
  const bersih = mentah.replace(/rp\.?/gi, '').replace(/\s+/g, '');
  const bulat = uraikanNominal(mentah);
  if (bulat.ok && bulat.nilai > 0) return { ok: true, teks: String(bulat.nilai), skala: keSkala(String(bulat.nilai)) };
  // Harga per satuan boleh pecahan (Rp0,5 per gram). Koma desimal gaya
  // Indonesia, atau titik dengan 1-2 digit di belakangnya.
  const pecahan = bersih.match(/^(\d+)[,.](\d{1,6})$/);
  if (pecahan && !(bersih.includes('.') && pecahan[2].length === 3)) {
    const normal = `${pecahan[1]}.${pecahan[2]}`;
    const skala = keSkala(normal);
    if (skala && skala > 0n) return { ok: true, teks: normal, skala };
  }
  if (bulat.ok) return { ok: false, tanya: 'Harga per satuannya tidak boleh nol. Berapa yang benar?' };
  return { ok: false, tanya: `Harga "${mentah}" belum kebaca. Tulis harga benar per satuannya ya, mis. 1200 atau 0,5.` };
}

const rupiahSkala = (skala) => `Rp${tampilSkala(skala)}`;

function besok(hariIni) {
  const tanggal = new Date(`${hariIni}T00:00:00Z`);
  tanggal.setUTCDate(tanggal.getUTCDate() + 1);
  return tanggal.toISOString().slice(0, 10);
}

const selisih = (nilai) => `${nilai < 0 ? '−' : nilai > 0 ? '+' : ''}${rupiah(Math.abs(nilai))}`;

/** Tanggal pertama yang HPP-nya melenceng jauh dari harga benar; null kalau tidak ada. */
function cariTanggalMelenceng(byDate) {
  return byDate.find((hari) => {
    const beda = Math.abs(hari.deltaRupiah);
    return beda >= 1 && beda >= AMBANG_MELENCENG * Math.max(hari.oldHppRupiah, hari.newHppRupiah);
  })?.businessDate ?? null;
}

async function pratinjau(ctx, muatan) {
  const hasil = await ctx.kirim('POST', `${JALUR}/preview`, {
    componentProductId: muatan.componentProductId, unitCost: muatan.unitCost, from: muatan.from
  });
  if (!hasil.ok) return hasil;
  return { ok: true, ringkasan: hasil.data.summary };
}

const hitungUlangHpp = Object.freeze({
  nama: 'hitung_ulang_hpp',
  lingkup: 'gerai',
  petunjuk: 'mengoreksi HPP sebuah bahan yang tercatat salah/tidak wajar dan menghitung ulang HPP penjualan sejak tanggal yang salah, mis. "HPP bubuk matcha harusnya 1.200 per pcs, betulkan dari tanggal 28" atau "HPP gula ngaco, harusnya 15 per gram". Tanpa tanggal, Una cari sendiri tanggal pertama yang melenceng. "hanya_harga" untuk yang cuma mau ganti harga ke depan tanpa menyentuh penjualan lama.',
  skema: {
    hpp_bahan: { type: 'string', description: 'hitung_ulang_hpp: nama bahan PERSIS seperti disebut.' },
    hpp_harga: { type: 'string', description: 'hitung_ulang_hpp: harga BENAR per satuan PERSIS seperti disebut, mis. "1200" atau "0,5". Kosongkan kalau tidak disebut.' },
    hpp_dari: { type: 'string', description: 'hitung_ulang_hpp: YYYY-MM-DD, hanya kalau penanya menyebut tanggal mulai yang salah.' },
    hpp_hanya_harga: { type: 'boolean', description: 'hitung_ulang_hpp: true kalau penanya hanya mau mengganti harga ke depan, tanpa menghitung ulang penjualan lama.' }
  },

  async siapkan(t, ctx) {
    const tertulis = teks(t?.hpp_bahan, 100);
    if (!tertulis) return { ok: false, tanya: 'HPP bahan yang mana yang mau dikoreksi?' };

    const daftar = await ctx.baca(`${JALUR}/components`);
    if (!daftar.ok) return daftar;
    const bahanList = daftar.data.components ?? [];
    const cocok = cocokkanSatu(tertulis, bahanList, { label: 'bahan', namaDari: (b) => b.name });
    if (!cocok.ok) {
      const contoh = bahanList.slice(0, 8).map((b) => b.name).join(', ');
      return { ok: false, tanya: /tidak ketemu\.$/.test(cocok.tanya) && contoh ? `${cocok.tanya} Yang bisa dikoreksi HPP-nya: ${contoh}${bahanList.length > 8 ? ', …' : ''}.` : cocok.tanya };
    }
    const bahan = cocok.nilai;
    const satuan = bahan.unitSymbol || bahan.unitCode || 'satuan';
    // Hanya untuk ditampilkan: harga rata-rata tercatat dibulatkan ke skala 1.000.000.
    const sekarang = BigInt(Math.max(0, Math.round(Number(bahan.averageCostRupiah || 0) * 1_000_000)));

    if (!teks(t?.hpp_harga, 40)) {
      return { ok: false, tanya: `HPP ${bahan.name} sekarang tercatat ${rupiahSkala(sekarang)} per ${satuan}. Harga yang benar berapa per ${satuan}?` };
    }
    const harga = hargaPerSatuan(t.hpp_harga);
    if (!harga.ok) return harga;

    // Saat "Ya" ditekan, tanggal dan caranya diambil dari draft yang dilihat
    // (dibekukan): pencarian ulang bisa bergeser karena penjualan baru, dan
    // yang dikonfirmasi harus persis yang tadi tampil.
    const beku = ctx.draftAsli?.muatan;
    let mode;
    let dari;
    let otomatis = false;
    if (beku && TANGGAL.test(String(beku.from ?? '')) && Object.values(MODE).includes(beku.mode)) {
      mode = beku.mode;
      dari = beku.from;
      otomatis = beku.otomatis === true;
    } else if (t?.hpp_hanya_harga === true) {
      mode = MODE.KE_DEPAN;
      dari = besok(ctx.hariIni);
    } else if (teks(t?.hpp_dari, 10)) {
      const tanggal = tanggalDari(t.hpp_dari, ctx.hariIni);
      if (!tanggal.ok) return tanggal;
      mode = MODE.ULANG;
      dari = tanggal.nilai;
    } else {
      mode = MODE.ULANG;
      otomatis = true;
      const awal = await pratinjau(ctx, { componentProductId: bahan.productId, unitCost: harga.teks, from: TANGGAL_AWAL });
      if (!awal.ok) {
        return { ok: false, tanya: /Terlalu banyak penjualan/.test(awal.error ?? '')
          ? 'Penjualannya banyak banget buat Una cari sendiri. Penjualan yang HPP-nya salah mulai tanggal berapa?'
          : awal.error };
      }
      dari = cariTanggalMelenceng(awal.ringkasan.byDate ?? []);
      if (!dari) {
        // Tidak ada penjualan yang melenceng jauh: yang salah cuma harga rata-rata.
        mode = MODE.KE_DEPAN;
        dari = besok(ctx.hariIni);
        otomatis = false;
      }
    }

    const muatan = { componentProductId: bahan.productId, unitCost: harga.teks, from: dari, mode, otomatis };
    const hasil = await pratinjau(ctx, muatan);
    if (!hasil.ok) return { ok: false, tanya: hasil.error };
    const s = hasil.ringkasan;

    if (!s.lineCount && !s.averageCostOnly) {
      return { ok: false, tanya: `HPP ${bahan.name} sudah ${rupiahSkala(harga.skala)} per ${satuan} dan tidak ada penjualan yang HPP-nya beda. Tidak ada yang perlu dikoreksi.` };
    }

    const kemarin = (s.byDate ?? []).filter((hari) => hari.businessDate < ctx.hariIni);
    const jumlahJual = kemarin.reduce((sum, hari) => sum + hari.saleCount, 0);
    const totalSelisih = kemarin.reduce((sum, hari) => sum + hari.deltaRupiah, 0);
    const tabel = kemarin.length
      ? {
          kolom: ['Tanggal', 'Jual', 'HPP lama', 'HPP baru', 'Selisih'],
          isi: [
            ...kemarin.slice(0, MAKS_BARIS_TABEL).map((hari) => [hari.businessDate, String(hari.saleCount), rupiah(hari.oldHppRupiah), rupiah(hari.newHppRupiah), selisih(hari.deltaRupiah)]),
            ...(kemarin.length > MAKS_BARIS_TABEL ? [[`… ${kemarin.length - MAKS_BARIS_TABEL} tanggal lain`, '', '', '', '']] : [])
          ]
        }
      : undefined;

    const keDepan = mode === MODE.KE_DEPAN;
    const reason = `Koreksi HPP ${bahan.name} lewat Una (harga benar ${rupiahSkala(harga.skala)} per ${satuan})`.slice(0, 300);
    const dampak = keDepan
      ? [
          `Cuma harga rata-rata ${bahan.name} yang diganti, dari ${rupiahSkala(sekarang)} ke ${rupiahSkala(harga.skala)} per ${satuan}: penjualan berikutnya langsung memakai harga yang benar.`,
          'HPP penjualan yang sudah lewat tidak berubah. Mau sekalian membetulkan penjualan lama? Bilang tanggal mulainya.',
          'Stok, nominal pembelian, dan uang laci tidak disentuh.'
        ]
      : [
          ...(otomatis ? [`Tanggal mulai dicari Una: tanggal pertama saat HPP ${bahan.name} di penjualan melenceng lebih dari 20% dari harga benar. Kalau salah, sebut tanggal yang benar.`] : []),
          'Hanya HPP yang berubah: stok, nominal pembelian, dan uang laci tidak disentuh.',
          'Untung di tanggal-tanggal itu ikut berubah sebesar kebalikan selisih HPP.',
          `Harga rata-rata ${bahan.name} diganti ke ${rupiahSkala(harga.skala)} per ${satuan}, supaya penjualan berikutnya langsung benar.`,
          'Penjualan hari ini, kalau ada, ikut dihitung ulang.',
          'Catatannya tersimpan permanen di Riwayat Hitung Ulang HPP; di gerai berpembukuan, jurnal koreksinya dibuat otomatis.'
        ];

    return {
      ok: true,
      draft: {
        aksi: 'hitung_ulang_hpp',
        judul: keDepan
          ? `Una mau membetulkan harga rata-rata ${bahan.name} — dicek dulu ya:`
          : `Una mau menghitung ulang HPP ${bahan.name} — dicek dulu ya:`,
        baris: [
          ['Bahan', bahan.name],
          ['Tercatat sekarang', `${rupiahSkala(sekarang)} per ${satuan}`],
          ['Harga benar', `${rupiahSkala(harga.skala)} per ${satuan}`],
          ...(keDepan ? [] : [['Mulai tanggal', otomatis ? `${dari} (dicari Una)` : dari]]),
          ...(keDepan ? [] : [['Penjualan terdampak (s/d kemarin)', String(jumlahJual)], ['Selisih HPP (s/d kemarin)', `${selisih(totalSelisih)}`]])
        ],
        ...(tabel ? { tabel } : {}),
        dampak,
        muatan: { ...muatan, bahan: bahan.name, reason }
      }
    };
  },

  async posting(draft, ctx) {
    const { componentProductId, unitCost, from, reason, bahan } = draft.muatan;
    const hasil = await ctx.kirim('POST', JALUR, { componentProductId, unitCost, from, reason });
    if (!hasil.ok) return hasil;
    const s = hasil.data?.summary ?? {};
    if (s.averageCostOnly) {
      return { ok: true, jawaban: `Sudah Una betulkan harga rata-rata ${bahan}: ${rupiah(s.previousAverageCostRupiah)} → ${rupiah(s.newAverageCostRupiah)} per satuan. Penjualan berikutnya langsung memakai harga ini.` };
    }
    const dijurnal = (hasil.data?.journals ?? []).filter((j) => j.status === 'POSTED').length;
    return {
      ok: true,
      jawaban: `Sudah Una hitung ulang HPP ${bahan}: HPP dikoreksi ${selisih(Number(s.deltaRupiah) || 0)} pada ${s.saleCount ?? 0} penjualan${dijurnal ? `, ${dijurnal} jurnal koreksi masuk pembukuan` : ''}.`
    };
  }
});

export const AKSI_HPP = Object.freeze([hitungUlangHpp]);
