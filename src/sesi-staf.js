// Masa berlaku sesi login karyawan (Kasir, Owner, Admin Gerai, Entity Admin).
//
// Bos Cyo, 2026-10-11: "pastikan apabila user itu tadi buka 2 tab baru ke halaman kita dia masih
// kondisi login, walaupun new tab new tab tetap login sampai dia logout." Dulu sesi mati PASTI 12
// jam sejak login, sepakai apa pun -- CS yang login pagi lalu membuka tab baru malam hari atau
// keesokan harinya langsung dilempar ke halaman login, dan di HP calon pembeli itu terlihat
// seperti aplikasi rusak.
//
// Sekarang sesi BERGESER: setiap kali token dipakai, masa berlakunya diperpanjang lagi
// SESI_STAF_JAM dari saat itu. Sesi hanya berakhir karena (a) tombol Keluar, (b) akun atau gerai
// dinonaktifkan, atau (c) tidak dipakai sama sekali selama SESI_STAF_JAM. UPDATE hanya ditulis
// paling sering sekali per JEDA_PERPANJANG_MS per token, supaya tidak menambah tulisan database
// di setiap permintaan.

export const SESI_STAF_JAM = 30 * 24;
const SESI_STAF_MS = SESI_STAF_JAM * 60 * 60 * 1000;
const JEDA_PERPANJANG_MS = 60 * 60 * 1000;

const TABEL_SESI = new Set(['cashier_sessions', 'owner_sessions', 'store_admin_sessions', 'entity_admin_sessions']);

export function kedaluwarsaSesiStaf(now = new Date()) {
  return new Date(now.getTime() + SESI_STAF_MS).toISOString();
}

// Dipanggil sesudah token terbukti sah. Gagal memperpanjang tidak boleh membatalkan permintaan:
// sesinya masih berlaku, paling-paling diperpanjang di permintaan berikutnya.
export async function perpanjangSesiStaf(db, tabel, tokenHash, expiresAt, now = new Date()) {
  if (!TABEL_SESI.has(tabel) || !tokenHash) return;
  const sisaMs = Date.parse(expiresAt || '') - now.getTime();
  if (Number.isFinite(sisaMs) && sisaMs > SESI_STAF_MS - JEDA_PERPANJANG_MS) return;
  try {
    await db.prepare(`UPDATE ${tabel} SET expires_at = ? WHERE token_hash = ? AND expires_at > ?`)
      .bind(kedaluwarsaSesiStaf(now), tokenHash, now.toISOString()).run();
  } catch {
    // sengaja diabaikan, lihat komentar di atas
  }
}
