// Peta menu aplikasi untuk Una: jawaban "bagaimana cara ... / di mana ..." yang
// belum punya panduan khusus di kamus (src/caca-jelaskan.js) tetap diarahkan ke
// layar yang tepat (Bos Cyo 2026-10-10).
//
// Dua lapis:
//   - generated/peta-una-data.js — DIBANGKITKAN dari public/nav-groups.js oleh
//     scripts/build-peta-una.mjs (menu apa saja yang ada, di grup mana, labelnya);
//   - PENJELASAN di bawah — ditulis tangan: di layar itu bisa apa, dan kata-kata yang
//     biasa dipakai orang untuk menanyakannya.
// test/caca-peta.test.js gagal kalau peta belum disegarkan atau ada menu tanpa
// penjelasan, jadi menu baru tidak bisa lolos tanpa diajarkan ke Una.

import { PETA_UNA } from '../generated/peta-una-data.js';
import { kataInti } from './caca-kata.js';

const NAMA_HALAMAN = Object.freeze({ gerai: 'Workspace Gerai', entity: 'Panel Pemilik (Entity)' });

export const PENJELASAN = Object.freeze({
  'gerai:store': { bisa: 'Ubah nama, logo, alamat gerai, dan titik lokasi + radius presensi karyawan.', kata: ['profil', 'logo', 'alamat', 'lokasi', 'gps', 'radius', 'titik'] },
  'gerai:transactions': { bisa: 'Lihat semua transaksi gerai: penjualan, pembelian, biaya, produksi, beserta detailnya.', kata: ['riwayat', 'transaksi', 'penjualan', 'pembelian', 'detail'] },
  'gerai:drawers': { bisa: 'Lihat laci kasir yang dibuka/ditutup, selisih kas, dan setoran laci per sesi.', kata: ['laci', 'kas', 'selisih', 'tutup laci', 'buka laci'] },
  'gerai:approvals': { bisa: 'Setujui atau tolak pengajuan kasir: pembatalan transaksi, izin, dan permintaan lain yang butuh ACC Admin.', kata: ['acc', 'setuju', 'persetujuan', 'pembatalan', 'izin', 'tolak'] },
  'gerai:products': { una: 'harga es teh jadi 7rb', bisa: 'Tambah, ubah, atau nonaktifkan barang: nama, harga jual, harga beli, kategori, foto, satuan.', kata: ['harga', 'tambah barang', 'nonaktif', 'foto', 'satuan'] },
  'gerai:categories': { bisa: 'Atur kategori barang (mis. Minuman, Makanan) dan urutannya di kasir.', kata: ['kategori', 'kelompok', 'urutan'] },
  'gerai:suppliers': { bisa: 'Daftar supplier/pemasok untuk pembelian bahan.', kata: ['supplier', 'pemasok', 'vendor'] },
  'gerai:stock': { una: 'stok gula tinggal berapa?', bisa: 'Lihat stok barang dan riwayat keluar-masuknya, serta penyesuaian stok (stock opname).', kata: ['stok', 'opname', 'sisa', 'keluar masuk'] },
  'gerai:costmasters': { bisa: 'Daftar jenis biaya rutin (listrik, sewa, gaji, dll.) yang dipakai saat mencatat biaya.', kata: ['jenis biaya', 'listrik', 'sewa', 'biaya rutin'] },
  'gerai:manufacturing': { una: 'resep es kopi susu: espresso 30ml, susu 150ml', bisa: 'Atur resep (bahan per menu), satuan, dan produksi barang racikan.', kata: ['resep', 'bahan', 'racik', 'produksi', 'satuan', 'komposisi'] },
  'gerai:hpp-recalc': { una: 'hpp gula harusnya 17,5 per gram mulai tanggal 1', bisa: 'Koreksi harga pokok bahan yang salah lalu hitung ulang HPP penjualan sejak tanggal tertentu.', kata: ['hpp', 'modal', 'hitung ulang', 'koreksi hpp'] },
  'gerai:warehouseSettingsTab': { bisa: 'Pengaturan gudang dan jadwal stock opname.', kata: ['gudang', 'opname'] },
  'gerai:employees': { bisa: 'Data orang (karyawan): tambah karyawan, tautkan ke username akunnya, dan lihat riwayat gaji per orang.', kata: ['karyawan', 'tambah karyawan', 'riwayat gaji', 'tautkan'] },
  'gerai:cashiers': { bisa: 'Akun login kasir/CS: username, password, jenis pembayaran & gaji per jam, jadwal kerja per hari, presensi, gaji, penyesuaian gaji, koreksi presensi, dan aktivasi akun backup.', kata: ['akun', 'kasir', 'cs', 'jadwal', 'gaji', 'presensi', 'potong', 'backup', 'cadang', 'password'] },
  'gerai:manual-book': { bisa: 'Tulis buku panduan kerja yang bisa dibaca kasir di Portal Staf.', kata: ['panduan', 'sop', 'manual', 'buku'] },
  'gerai:announcement': { bisa: 'Kirim pengumuman untuk semua karyawan (muncul di Portal Staf).', kata: ['pengumuman', 'info', 'broadcast'] },
  'gerai:daily-task': { bisa: 'Atur daftar tugas harian kasir dan lihat yang sudah dikerjakan.', kata: ['tugas', 'checklist', 'harian', 'kebersihan'] },
  'gerai:labarugi': { una: 'untung bulan ini berapa?', bisa: 'Laporan untung rugi gerai per periode.', kata: ['untung', 'rugi', 'laba', 'profit'] },
  'gerai:attendance-report': { bisa: 'Laporan presensi semua karyawan per periode, termasuk telat, di luar radius, dan yang tidak menutup presensi.', kata: ['presensi', 'absen', 'telat', 'rekap presensi', 'kehadiran'] },
  'gerai:permit-report': { bisa: 'Riwayat izin dan pengajuan koreksi presensi: menunggu, di-ACC, ditolak, kadaluarsa.', kata: ['izin', 'permit', 'koreksi', 'pengajuan'] },
  'gerai:cashier-raport': { bisa: 'Nilai kerja tiap kasir (raport) dari data harian.', kata: ['raport', 'nilai', 'kinerja', 'penilaian'] },
  'gerai:reports': { bisa: 'Kumpulan laporan gerai: penjualan, barang terlaris, dan rekap lainnya.', kata: ['laporan', 'rekap', 'terlaris', 'omzet'] },
  'gerai:setoran-cs': { una: 'setoran cs yang masih dibawa siapa aja?', bisa: 'Setoran uang laci dari CS: ACC bukti transfer, sisa setoran yang masih dibawa tiap CS, dan riwayatnya.', kata: ['setoran', 'setor', 'bukti transfer', 'piutang cs', 'dibawa'] },
  'gerai:accountingWorkspaceTab': { bisa: 'Pembukuan gerai: jurnal, buku besar, neraca, untuk akuntan.', kata: ['jurnal', 'buku besar', 'neraca', 'akuntansi'] },
  'gerai:accountingSettingsTab': { bisa: 'Pengaturan akun pembukuan dan aturan jurnal otomatis.', kata: ['akun', 'aturan jurnal', 'coa', 'setting akuntansi'] },
  'gerai:sharedaccounts': { bisa: 'Rekening bank & e-wallet toko (Rekening Bersama) dan saldonya.', kata: ['rekening', 'bank', 'ewallet', 'saldo'] },
  'gerai:hutangpiutang': { bisa: 'Hutang ke supplier/pihak lain, piutang, dan pembayarannya.', kata: ['hutang', 'piutang', 'bayar hutang', 'cicil'] },
  'gerai:beaops': { una: 'catat sewa lapak 500rb ke Pak RT', bisa: 'Catat biaya operasional (gaji, sewa lapak, listrik, lain-lain) di luar laci.', kata: ['biaya', 'pengeluaran', 'bea', 'operasional'] },
  'gerai:customers': { bisa: 'Data pelanggan langganan dan poinnya.', kata: ['pelanggan', 'member', 'poin'] },
  'gerai:customer-feedback': { bisa: 'Kotak saran: masukan dan keluhan dari pembeli.', kata: ['saran', 'keluhan', 'masukan', 'feedback'] },
  'gerai:vouchers': { bisa: 'Atur voucher dan potongan harga untuk pembeli.', kata: ['voucher', 'diskon', 'promo'] },
  'entity:stores': { bisa: 'Daftar semua gerai di bawah usaha ini.', kata: ['gerai', 'cabang', 'outlet'] },
  'entity:drawerstatus': { bisa: 'Status laci semua gerai: mana yang buka/tutup dan selisihnya.', kata: ['laci', 'status laci', 'kas'] },
  'entity:reports': { bisa: 'Laporan gabungan seluruh usaha (semua gerai).', kata: ['laporan usaha', 'gabungan', 'semua gerai'] },
  'entity:storereport': { bisa: 'Bandingkan laporan antar gerai.', kata: ['per gerai', 'banding', 'perbandingan'] },
  'entity:productmasters': { bisa: 'Daftar barang tingkat usaha (Kode Barang dan foto); harga tetap diatur per gerai.', kata: ['kode barang', 'master barang', 'foto'] },
  'entity:entityrecipes': { bisa: 'Resep standar tingkat usaha yang bisa dipakai gerai.', kata: ['resep', 'standar resep'] },
  'entity:entitystock': { bisa: 'Stok semua gerai dalam satu tabel.', kata: ['stok', 'stok gerai'] },
  'entity:employees': { bisa: 'Data semua karyawan usaha, lintas gerai, dan riwayat gajinya.', kata: ['karyawan', 'riwayat gaji'] },
  'entity:ledger': { bisa: 'Buku usaha (jurnal tingkat entity).', kata: ['jurnal', 'buku usaha', 'entity'] },
  'entity:sharedaccounts': { bisa: 'Rekening Bersama semua gerai dan saldo totalnya.', kata: ['rekening', 'saldo'] },
  'entity:setorancs': { bisa: 'Setoran CS semua gerai yang menunggu ACC.', kata: ['setoran', 'setor'] },
  'entity:customers': { bisa: 'Pelanggan seluruh usaha.', kata: ['pelanggan', 'member'] }
});

const KUNCI = (p) => `${p.halaman}:${p.tab}`;

const INDEKS = PETA_UNA.map((p) => {
  const jelas = PENJELASAN[KUNCI(p)] ?? { bisa: p.hint || '', kata: [] };
  return {
    ...p,
    bisa: jelas.bisa,
    una: jelas.una ?? null,
    kataLabel: kataInti(`${p.label} ${(jelas.kata ?? []).join(' ')}`),
    kataLain: kataInti(`${p.grup} ${p.hint} ${jelas.bisa}`)
  };
});

/**
 * Menu yang paling cocok untuk sebuah pertanyaan. Kata yang ada di label/kata kunci
 * bernilai 2, yang hanya ada di penjelasan bernilai 1. `halaman` (gerai/entity)
 * mengutamakan menu di halaman yang sedang dibuka.
 * @returns {{ menu: object, skor: number } | null}
 */
export function cariMenu(teks, { halaman = 'gerai' } = {}) {
  const kata = kataInti(teks);
  if (!kata.size) return null;
  let terbaik = null;
  for (const m of INDEKS) {
    let skor = 0;
    for (const k of kata) skor += m.kataLabel.has(k) ? 2 : (m.kataLain.has(k) ? 1 : 0);
    if (m.halaman === halaman) skor += 0.5;
    if (!terbaik || skor > terbaik.skor) terbaik = { menu: m, skor };
  }
  return terbaik && terbaik.skor >= 2.5 ? terbaik : null;
}

/** Kalimat jawaban: di mana menunya dan di sana bisa apa. */
export function jawabanMenu(menu) {
  return [
    `Itu ada di ${NAMA_HALAMAN[menu.halaman]} → ${menu.grup} → ${menu.label}.`,
    menu.bisa ? `Di sana Bos bisa: ${menu.bisa}` : '',
    menu.una ? `Atau suruh Una langsung, mis. "${menu.una}".` : '',
    'Kalau langkah persisnya belum jelas, tanya Una lebih spesifik ya — mis. sebut nama karyawan/barangnya.'
  ].filter(Boolean).join('\n');
}

export { PETA_UNA };
