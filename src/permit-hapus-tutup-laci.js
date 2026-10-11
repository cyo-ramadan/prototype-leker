// Izin hapus transaksi yang belum diputuskan saat laci ditutup -> otomatis GAGAL.
//
// Bos Cyo, 2026-10-11: "ketika cs permit hapus sebelum tutup laci, dan belum di acc sampai dia
// sudah tutup laci, maka permit nya itu semuanya digagalin otomatis ya. untuk penyesuaiannya
// nanti biar lewat adminnya aja." Alasannya: begitu laci ditutup, saldo akhir dan setoran sudah
// dihitung dan dilaporkan. Menghapus transaksi di laci yang sudah tutup sesudahnya diam-diam
// mengubah angka yang sudah diserahkan CS. Koreksi setelah tutup laci jadi urusan Admin.
//
// Hanya izin yang masih MENUNGGU (pending_approval). Izin yang sudah di-ACC (termasuk ACC
// otomatis) tidak disentuh. Dipanggil oleh SEMUA jalur tutup laci (tutup sendiri di kasir dan
// tutup lewat izin Admin) -- test/permit-hapus-tutup-laci.test.js menjaga daftarnya.

export const CATATAN_GAGAL_TUTUP_LACI = 'Otomatis gagal: laci sudah ditutup sebelum izin ini diputuskan. Penyesuaian lewat Admin.';

export async function gagalkanPermitHapusSaatTutupLaci(db, drawerSessionId, now = new Date().toISOString()) {
  if (!drawerSessionId) return 0;
  const result = await db.prepare(`
    UPDATE approval_permits
    SET approval_status = 'rejected', decision_note = ?, approved_by_role = 'SYSTEM_DRAWER_CLOSED',
        approved_by_id = NULL, decided_at = ?, updated_at = ?
    WHERE drawer_session_id = ? AND permit_type = 'TRANSACTION_VOID' AND approval_status = 'pending_approval'
  `).bind(CATATAN_GAGAL_TUTUP_LACI, now, now, drawerSessionId).run();
  return Number(result?.meta?.changes ?? 0);
}
