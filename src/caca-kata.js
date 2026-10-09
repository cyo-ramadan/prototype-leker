// Pengenal kata untuk pencarian panduan Una (kamus + peta menu). Bos Cyo 2026-10-10:
// "usahakan perbaikannya bukan cuma bisa jawab spesifik itu, tapi case yang setype".
// Orang menulis "nambahin pegawai", "absen", "honor" — panduannya ditulis "tambah
// karyawan", "presensi", "gaji". Dua alat sederhana tanpa mesin AI:
//   1. pemotong imbuhan kasar (me-/di-/ber-/pe-…, -kan/-an/-in/-nya);
//   2. sinonim ke satu kata baku.
// Sengaja sederhana dan bisa ditebak; cukup untuk mencocokkan, bukan untuk tata bahasa.

import { normalkan } from './caca-aksi-dasar.js';

const SINONIM = Object.freeze({
  pegawai: 'karyawan', staf: 'karyawan', staff: 'karyawan', pekerja: 'karyawan', crew: 'karyawan', kru: 'karyawan',
  absen: 'presensi', absensi: 'presensi', kehadiran: 'presensi', hadir: 'presensi', ceklok: 'presensi', checkin: 'presensi',
  honor: 'gaji', upah: 'gaji', bayaran: 'gaji', salary: 'gaji', gajian: 'gaji',
  denda: 'potong', pinalti: 'potong', sanksi: 'potong',
  telat: 'lambat', molor: 'lambat',
  bolos: 'masuk', mangkir: 'masuk', izin: 'masuk',
  jadwal: 'jadwal', shift: 'jadwal', sif: 'jadwal',
  login: 'akun', user: 'akun', username: 'akun', password: 'akun', sandi: 'akun',
  barang: 'barang', produk: 'barang', menu: 'barang', item: 'barang',
  modal: 'hpp', pokok: 'hpp',
  laba: 'untung', profit: 'untung', rugi: 'untung', omzet: 'jual', omset: 'jual', penjualan: 'jual',
  utang: 'hutang', ngutang: 'hutang', kasbon: 'hutang',
  rekening: 'rekening', bank: 'rekening', ewallet: 'rekening', qris: 'rekening',
  struk: 'transaksi', nota: 'transaksi',
  gudang: 'gudang', inventori: 'stok', persediaan: 'stok',
  diskon: 'voucher', promo: 'voucher', kupon: 'voucher',
  pelanggan: 'pelanggan', customer: 'pelanggan', pembeli: 'pelanggan', member: 'pelanggan',
  cabang: 'gerai', outlet: 'gerai', toko: 'gerai',
  resep: 'resep', racikan: 'resep', bom: 'resep',
  backup: 'cadang', cadangan: 'cadang', serep: 'cadang',
  // bentuk lisan yang huruf awalnya luluh
  nambah: 'tambah', nulis: 'tulis', nyatet: 'catat', nyatat: 'catat', ngecek: 'cek', ngubah: 'ubah',
  motong: 'potong', ngasih: 'kasih', masukin: 'masuk', ngaktif: 'aktif', nyetor: 'setor', nyetorin: 'setor'
});

const AWALAN = /^(meng|meny|mem|men|me|peng|peny|pem|pen|pe|ber|ter|di|ke|nge|ng)/;
const AKHIRAN = /(nya|kan|lah|an|in|i)$/;

/** Kata dasar kasar: "nambahin" → "tambah", "diaktifkan" → "aktif", "potongan" → "potong". */
export function kataDasar(kata) {
  let k = String(kata ?? '').toLowerCase();
  if (SINONIM[k]) return SINONIM[k];
  if (k.length > 5) k = k.replace(AKHIRAN, '');
  if (SINONIM[k]) return SINONIM[k];
  if (k.length > 5) {
    const tanpa = k.replace(AWALAN, '');
    if (tanpa.length >= 4) k = tanpa;
  }
  return SINONIM[k] ?? k;
}

const KATA_UMUM = new Set(['bagaimana', 'gimana', 'gmn', 'cara', 'caranya', 'jika', 'kalau', 'kalo', 'yang', 'untuk', 'atas', 'nama',
  'dengan', 'dari', 'pada', 'sampai', 'bisa', 'harus', 'harusnya', 'tapi', 'malah', 'atau', 'misal', 'apa', 'itu', 'ini', 'dan',
  'tahu', 'tau', 'masih', 'sudah', 'udah', 'belum', 'tidak', 'nggak', 'gak', 'ga', 'saya', 'aku', 'kita', 'kami', 'mau', 'ingin',
  'tolong', 'una', 'bos', 'sehingga', 'tertentu', 'hari', 'tanggal', 'dimana', 'mana', 'ada', 'buat', 'bikin', 'lihat', 'liat',
  'cek', 'tempat', 'menu', 'tombol', 'fitur', 'aplikasi', 'admin', 'nya', 'dong', 'sih', 'deh', 'kok', 'aja', 'juga', 'lagi']);

/**
 * Kata bermakna dari kalimat (unik). Tiap kata dimasukkan dalam bentuk aslinya
 * (lewat sinonim) DAN bentuk dasarnya: pemotong imbuhan kadang kebablasan
 * ("karyawan" → "karyaw"), jadi dua-duanya ikut dicocokkan.
 */
export function kataInti(teks) {
  const hasil = new Set();
  for (const k of normalkan(teks).split(' ')) {
    if (k.length < 2 || KATA_UMUM.has(k)) continue;
    for (const bentuk of [SINONIM[k] ?? k, kataDasar(k)]) {
      if (bentuk.length >= 2 && !KATA_UMUM.has(bentuk)) hasil.add(bentuk);
    }
  }
  return hasil;
}
