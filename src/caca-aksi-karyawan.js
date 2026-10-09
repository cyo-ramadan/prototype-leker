// Alat baca Una untuk urusan karyawan (Bos Cyo 2026-10-10, uji karyawan: "bagaimana
// cara mengetahui setoran cs yang masih dibawa?"). Panduan caranya ada di kamus
// (src/caca-jelaskan.js); alat ini menjawab ANGKANYA langsung dari layar Setoran CS
// (GET /api/admin/employee-deposits/overview — sumber yang sama dengan tab Setoran CS,
// saldo menurut buku Akuntansi, ADR-054). Hanya membaca; ACC tetap di layarnya.
// Saldo boleh negatif (setoran lebih) dan ditampilkan apa adanya (invariant #8).

import { tampilSkala } from './caca-hitung.js';

const skala = (rupiah) => BigInt(Math.round(Number(rupiah || 0) * 1_000_000));
const rp = (nilaiSkala) => `Rp${tampilSkala(nilaiSkala)}`;

export const cekSetoranCs = Object.freeze({
  nama: 'cek_setoran_cs',
  lingkup: 'gerai',
  baca: true,
  petunjuk: 'MELIHAT setoran CS/kasir: siapa yang masih membawa uang setoran laci (belum disetor ke kantor), berapa sisanya, dan yang menunggu ACC, mis. "setoran cs yang masih dibawa siapa aja?", "piutang setoran rika berapa?".',
  skema: {},

  async siapkan(_t, ctx) {
    const ref = await ctx.baca('/api/admin/employee-deposits/overview');
    if (!ref.ok) return ref;
    const gerai = ctx.namaLingkup || 'gerai ini';
    const saldo = (ref.data?.balances ?? []).map((b) => ({
      nama: b.employeeName || '(tanpa nama)',
      sisa: skala(b.balanceRupiah),
      menunggu: skala(b.pendingAmountRupiah),
      belumBuku: skala(b.belumMasukBukuRupiah)
    })).filter((b) => b.sisa !== 0n || b.menunggu !== 0n);
    const antre = (ref.data?.pending ?? []).length;
    if (!saldo.length) {
      return {
        ok: true,
        jawaban: `Di ${gerai} tidak ada CS yang masih membawa setoran${antre ? `, tapi ada ${antre} setoran yang menunggu ACC` : ''}.`,
        tawaran: [{ jenis: 'buka', layar: 'setoran-cs', label: 'Buka Setoran CS' }]
      };
    }
    const total = saldo.reduce((n, b) => n + b.sisa, 0n);
    return {
      ok: true,
      jawaban: `Setoran yang masih dibawa CS di ${gerai}: total ${rp(total)} dari ${saldo.length} orang${antre ? `; ${antre} bukti transfer menunggu ACC` : ''}.`,
      tabel: {
        kolom: ['CS', 'Masih dibawa', 'Menunggu ACC'],
        isi: saldo.map((b) => [b.nama, rp(b.sisa), b.menunggu ? rp(b.menunggu) : '—'])
      },
      tawaran: [{ jenis: 'buka', layar: 'setoran-cs', label: 'Buka Setoran CS' }]
    };
  }
});

export const AKSI_KARYAWAN = Object.freeze([cekSetoranCs]);
