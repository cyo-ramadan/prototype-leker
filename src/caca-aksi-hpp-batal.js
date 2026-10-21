// Bereskan HPP pembelian yang dibatalkan / diganti nominal lewat Una (Bos Cyo, 2026-10-21: "harusnya ada
// tool untuk menghitung ulang tadi secara otomatis, jadi itu bisa dipake untuk una betulin nanti, cuman
// makenya ya tau waktu lah ... diatas jam 11 malem sampe sebelum jam 7 pagi").
//
// Una TIDAK menghitung sendiri: ini merangkai Putar Ulang HPP (src/hpp-putar-ulang.js) lewat endpoint
// Admin yang sama -- pratinjau dulu (bahan, HPP tercatat -> HPP benar, selisih pemakaian), lalu "Ya".
// Di luar jam sepi Una menolak sopan; sistem juga menjalankannya sendiri tiap malam lewat cron. Izin
// yang TERTAHAN (riwayatnya tidak cocok) ditampilkan alasannya dan tidak ikut diposting.

import { rupiah } from './caca-nominal.js';
import { tampilSkala } from './caca-hitung.js';

const JALUR = '/api/management/transaction-void-permits';
const hpp = (scaled) => `Rp${tampilSkala(BigInt(Math.trunc(Number(scaled) || 0)))}`;

function ringkasBahan(bahan) {
  return bahan.map((b) => `${b.nama} ${hpp(b.hppTercatat)} → ${hpp(b.hppBenar)}`).join('; ');
}

const bereskan = Object.freeze({
  nama: 'bereskan_hpp_pembelian_batal',
  lingkup: 'gerai',
  petunjuk: 'menghitung ulang HPP bahan dari pembelian yang dibatalkan / diganti nominalnya sesudah bahannya terpakai (status "HPP menunggu dihitung ulang"), mis. "bereskan HPP pembelian yang dihapus kemarin" atau "hitung ulang HPP air mineral yang pembeliannya dibatalkan". Hanya boleh jam 23.00–07.00 WIB.',
  skema: {},

  async siapkan(_t, ctx) {
    const daftar = await ctx.baca(`${JALUR}/hpp-putar-ulang`);
    if (!daftar.ok) return daftar;
    const items = daftar.data.items ?? [];
    if (!items.length) return { ok: false, tanya: 'Tidak ada pembelian batal yang HPP-nya menunggu dihitung ulang di gerai ini.' };
    if (!daftar.data.jamSepi) {
      return { ok: false, tanya: `${daftar.data.pesanJam} Ada ${items.length} pembelian yang menunggu; nanti malam sistem membereskannya sendiri, atau minta Una lagi di jam itu.` };
    }
    const siap = items.filter((item) => item.pratinjau?.ok);
    const tertahan = items.filter((item) => !item.pratinjau?.ok);
    if (!siap.length) {
      return { ok: false, tanya: `Semua pembelian yang menunggu tertahan dan perlu dicek manual: ${tertahan.map((item) => `${item.permit?.subject?.description || item.permit?.subjectId}: ${item.pratinjau?.alasan}`).join(' · ')}` };
    }
    const selisihTotal = siap.reduce((sum, item) => sum + item.pratinjau.bahan.reduce((s, b) => s + Math.abs(Number(b.selisihHppRupiah) || 0), 0), 0);
    return {
      ok: true,
      draft: {
        aksi: 'bereskan_hpp_pembelian_batal',
        judul: `Una mau menghitung ulang HPP ${siap.length} pembelian yang dibatalkan — dicek dulu ya:`,
        baris: siap.map((item) => [
          `${item.permit?.subject?.description || 'Pembelian'} · ${rupiah(Number(item.permit?.subject?.amount) || 0)}`,
          ringkasBahan(item.pratinjau.bahan)
        ]),
        dampak: [
          'Hanya harga rata-rata (HPP) bahan yang diganti: uang laci, stok, dan jurnal pembelian sudah dibereskan saat ACC.',
          `HPP pemakaian bahan yang sudah lewat tidak ditulis ulang; selisihnya sekitar ${rupiah(selisihTotal)} dicatat di izinnya.`,
          ...(tertahan.length ? [`${tertahan.length} pembelian lain tertahan dan tidak ikut: ${tertahan.map((item) => item.pratinjau?.alasan).join(' · ')}`] : [])
        ],
        muatan: { permitIds: siap.map((item) => item.permit.id) }
      }
    };
  },

  async posting(draft, ctx) {
    const berhasil = [];
    const gagal = [];
    for (const id of draft.muatan.permitIds ?? []) {
      const hasil = await ctx.kirim('POST', `${JALUR}/${encodeURIComponent(id)}/hpp-putar-ulang`);
      if (hasil.ok) berhasil.push(ringkasBahan(hasil.data?.bahan ?? []));
      else gagal.push(hasil.error);
    }
    if (!berhasil.length) return { ok: false, error: gagal.join(' · ') || 'Hitung ulang HPP gagal.' };
    return {
      ok: true,
      jawaban: `Sudah Una hitung ulang HPP ${berhasil.length} pembelian: ${berhasil.join(' · ')}.${gagal.length ? ` Yang belum: ${gagal.join(' · ')}` : ''}`
    };
  }
});

export const AKSI_HPP_BATAL = Object.freeze([bereskan]);
