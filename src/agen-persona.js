// Registry persona: Una, Rika (akuntan), Fina (HR). Satu mesin, tiga persona
// (contracts/agen-rika-fina-v1.md §2, contracts/fina-hr-paket-v1.md H0).
//
// Mesin (src/caca-agen.js) membaca persona dari sini. Tidak ada percabangan
// "kalau agen = rika" yang tersebar di mesin: yang berbeda antar persona hanya
// data di objek ini (nama, peran, gaya, alat, izin).
//
// Una tetap persona bawaan dan perilakunya PERSIS seperti sebelum registry ada:
// `alat: null` berarti semua alat lama, dan percakapan tanpa `agen` = Una.
// Saklar & nama per tenant disimpan di tenant_policy_settings (pola una_nama_asisten).
// Aturan Bos: mekanisme unik = opsi tenant, bawaan AKTIF.

import { AKSI_FINA } from './caca-aksi.js';

export const AGEN_BAWAAN = 'una';

// Alat mesin yang selalu ada untuk semua persona: menutup putaran dan menolak jujur.
export const ALAT_SELALU = Object.freeze(['selesai', 'tidak_ada']);

const GAYA_RIKA = [
  'Gaya bicara: teliti dan tenang seperti akuntan yang sabar. Sebut buktinya (tanggal, nomor jurnal, gerai)',
  'setiap kali menyimpulkan. Salah input disebut sebagai langkah yang keliru, bukan kesalahan orangnya; jangan menuduh.',
  'Kalau input sudah benar tapi hasil sistem salah, bilang itu dugaan bug dan akan diteruskan ke tim program.',
  'Aturan angka di atas tetap nomor satu.'
].join('\n');

const GAYA_FINA = [
  'Gaya bicara: sopan, singkat, hangat. Panggil karyawan dengan namanya.',
  'Jangan menjanjikan uang (gaji, bonus, potongan, denda) atau keputusan (SP, terima/tolak pelamar, pindah gerai):',
  'katakan keputusannya ada di Bos/admin, kamu hanya menyiapkan datanya atau drafnya.',
  'Aturan angka di atas tetap nomor satu.'
].join('\n');

// Alat Rika = alat akuntan yang SUDAH ada (contracts/una-akuntan-tools-v1.md, dipakai ulang
// menurut agen-rika-fina-v1 §6.1). Alat baru Rika (telusur_asal_angka, cari_entri_dobel, ...)
// ditambahkan paket Rika ke daftar ini.
const ALAT_RIKA = Object.freeze([
  'laba_periode', 'stok_sisa', 'baca_api', 'rencana',
  'cek_barang', 'cek_harga_janggal', 'cek_rekening_bersama',
  'buat_jurnal', 'hitung_ulang_hpp', 'koreksi_hpp_banyak', 'betulkan_klasifikasi_barang', 'atur_rentang_harga_beli',
  'sinkron_akuntansi', 'samakan_aturan_jurnal', 'atur_cara_bayar', 'pindah_saldo_akun',
  'jelaskan'
]);

// Alat Fina = alat HR lama yang tidak menyangkut uang (jadwal, akun karyawan) + panduan
// + semua alat dari AKSI_FINA (H2 baca, H3 tulis; didaftarkan di src/caca-aksi.js).
// Sengaja TANPA baca_api: Fina hanya melihat alat HR (H0 "Selesai bila").
const ALAT_FINA = Object.freeze([
  'atur_jadwal_kasir', 'buat_karyawan', 'jelaskan',
  ...AKSI_FINA.map((aksi) => aksi.nama)
]);

export const PERSONA = Object.freeze({
  una: Object.freeze({
    id: 'una', namaBawaan: 'Una', kunciNama: 'una_nama_asisten', kunciAktif: null,
    peran: 'asisten toko', gaya: null, alat: null /* = semua seperti sekarang */,
    izin: Object.freeze(['OWNER', 'ENTITY_ADMIN', 'ADMIN'])
  }),
  rika: Object.freeze({
    id: 'rika', namaBawaan: 'Rika', kunciNama: 'rika_nama_asisten', kunciAktif: 'agen_rika_aktif',
    peran: 'akuntan', gaya: GAYA_RIKA, alat: ALAT_RIKA,
    tugas: 'menelusuri angka yang janggal sampai ketemu langkah input yang salah, lalu menyiapkan koreksinya sebagai draft',
    izin: Object.freeze(['OWNER', 'ENTITY_ADMIN'])
  }),
  fina: Object.freeze({
    id: 'fina', namaBawaan: 'Fina', kunciNama: 'fina_nama_asisten', kunciAktif: 'agen_fina_aktif',
    peran: 'HR', gaya: GAYA_FINA, alat: ALAT_FINA,
    tugas: 'mengurus CS harian: jadwal, kekosongan gerai dan backup, masalah CS, pengumuman, dan draft surat',
    izin: Object.freeze(['OWNER', 'ENTITY_ADMIN', 'ADMIN'])
  })
});

export const DAFTAR_AGEN = Object.freeze(Object.keys(PERSONA));

/** Semua kunci tenant_policy_settings milik persona (nama + saklar). */
export const KUNCI_PERSONA = Object.freeze(DAFTAR_AGEN.flatMap((id) => [PERSONA[id].kunciNama, PERSONA[id].kunciAktif]).filter(Boolean));

/** Id persona dari kiriman browser; kosong/tidak dikirim = Una. Tidak dikenal = null. */
export function agenDari(masuk) {
  if (masuk === undefined || masuk === null || masuk === '') return AGEN_BAWAAN;
  const id = String(masuk).trim().toLowerCase();
  return Object.hasOwn(PERSONA, id) ? id : null;
}

/** Saklar tenant: hanya '0' yang mematikan; tanpa baris = bawaan aktif. */
export function saklarAktif(nilai) {
  return String(nilai ?? '1').trim() !== '0';
}

/**
 * Pengaturan persona satu tenant dalam SATU kueri.
 * @param {(v:string)=>string|null} namaValid pembersih nama (namaAsistenValid)
 * @returns {{ [id]: { nama: string, aktif: boolean } }}
 */
export async function bacaPengaturanPersona(db, tenantId, namaValid) {
  const nilai = {};
  if (tenantId) {
    const tanda = KUNCI_PERSONA.map(() => '?').join(',');
    const hasil = await db.prepare(`SELECT setting_key, setting_value FROM tenant_policy_settings WHERE tenant_id = ? AND setting_key IN (${tanda})`)
      .bind(tenantId, ...KUNCI_PERSONA).all();
    for (const row of hasil?.results ?? []) nilai[row.setting_key] = row.setting_value;
  }
  return pengaturanPersonaDari(nilai, namaValid);
}

/** Peta { setting_key: setting_value } → pengaturan per persona (dipakai juga oleh kueri konteks). */
export function pengaturanPersonaDari(nilai = {}, namaValid = null) {
  return Object.fromEntries(DAFTAR_AGEN.map((id) => {
    const p = PERSONA[id];
    return [id, {
      nama: (namaValid ? namaValid(nilai[p.kunciNama]) : null) || p.namaBawaan,
      aktif: p.kunciAktif ? saklarAktif(nilai[p.kunciAktif]) : true
    }];
  }));
}

/**
 * Persona yang boleh dipakai penyuruh ini.
 * @returns {{ok:true, persona, nama}|{ok:false, status:403|404, error, code}}
 *   404 = persona tidak dikenal; 403 = tidak diizinkan untuk peran ini / dimatikan tenant.
 *   Tidak pernah diam-diam jatuh ke Una.
 */
export function personaUntuk(id, { role, pengaturan } = {}) {
  const agen = agenDari(id);
  if (!agen) return { ok: false, status: 404, error: 'Asisten itu tidak dikenal.', code: 'AGEN_TIDAK_DIKENAL' };
  const persona = PERSONA[agen];
  const atur = pengaturan?.[agen];
  const nama = atur?.nama || persona.namaBawaan;
  if (!persona.izin.includes(role)) {
    return { ok: false, status: 403, error: `${nama} belum bisa diajak ngobrol dari akun ini.`, code: 'AGEN_TIDAK_DIIZINKAN' };
  }
  if (persona.kunciAktif && atur && atur.aktif === false) {
    return { ok: false, status: 403, error: `${nama} sedang dimatikan untuk usaha ini. Nyalakan di Pengaturan → Asisten.`, code: 'AGEN_DIMATIKAN' };
  }
  return { ok: true, persona, nama };
}

/** Persona yang tampil di pemilih: hanya yang diizinkan dan aktif. */
export function daftarPersona({ role, pengaturan } = {}) {
  return DAFTAR_AGEN
    .map((id) => ({ id, hasil: personaUntuk(id, { role, pengaturan }) }))
    .filter(({ hasil }) => hasil.ok)
    .map(({ id, hasil }) => ({ id, nama: hasil.nama, peran: PERSONA[id].peran }));
}

/** Boleh tidaknya persona memakai alat bernama `nama`. Una: semua. */
export function bolehAlat(persona, nama) {
  if (!persona || persona.alat === null) return true;
  return ALAT_SELALU.includes(nama) || persona.alat.includes(nama);
}

/**
 * Hanya alat persona itu. `semuaAlat` = daftar objek `{ nama }` atau nama alat.
 * Una (alat null) mendapat semuanya apa adanya.
 */
export function alatPersona(persona, semuaAlat) {
  const daftar = Array.isArray(semuaAlat) ? semuaAlat : [];
  if (!persona || persona.alat === null) return daftar;
  return daftar.filter((alat) => bolehAlat(persona, typeof alat === 'string' ? alat : alat?.nama));
}

/** Pembuka prompt persona selain Una (Una memakai pembukanya sendiri di caca-agen.js). */
export function pembukaPersona(persona, nama) {
  return `Kamu ${nama}, asisten ${persona.peran} di aplikasi OwnerTenang. Sebut dirimu "${nama}", bukan "saya" atau "aku". `
    + `Peranmu: ${persona.tugas}.`;
}
