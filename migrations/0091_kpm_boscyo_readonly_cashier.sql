PRAGMA foreign_keys = ON;

-- Akun kasir "lihat saja" milik Bos Cyo -- permintaan 2026-09-14, lanjutan
-- migration 0090 (Entity Admin ENT-KPM). Ditaruh di gerai KANTOR karena
-- belum ada histori transaksi sama sekali (precedent sama seperti
-- "Super Kasir" debug di migration 0065), jadi aman dipakai untuk
-- eksplorasi tanpa risiko nyampur data real.
--
-- PENTING soal "read only": sistem ini TIDAK punya flag "kasir read-only"
-- di skema -- setiap akun kasir aktif secara teknis BISA menulis transaksi.
-- Yang membuat akun ini praktis read-only adalah invariant yang sudah ada
-- di requireDrawerOwner() (src/cashier-drawer.js, dikunci 2026-09-04):
-- kasir mana pun yang login boleh presensi dan melihat dashboard, TAPI
-- tidak boleh menulis transaksi apa pun sampai dia sendiri yang membuka
-- laci gerai itu. Selama akun ini TIDAK PERNAH dipakai untuk klik
-- "Buka Laci", dia otomatis mode lihat -- begitu laci dibuka pakai akun
-- ini, sesi itu jadi kasir penuh seperti akun lain. Ini bukan kuncian
-- teknis yang tidak bisa ditembus, cuma disiplin pemakaian; kalau
-- Bos Cyo mau read-only yang benar-benar dikunci di kode (menolak
-- buka laci sama sekali untuk akun ini), itu fitur terpisah yang
-- belum digarap.
--
-- BEDA dari precedent migration 0064/0065/0090: password TIDAK dicatat
-- plaintext di sini -- cuma hash SHA-256-nya (pola hashCredential() di
-- src/owner-auth.js). Password asli dikirim ke Bos Cyo langsung lewat
-- chat, bukan lewat repo. Koreksi 2026-09-14: precedent lama menaruh
-- password plaintext di komentar migration, tapi itu berarti permanen
-- ada di riwayat git begitu di-push -- jangan diulang lagi ke depannya.
--
-- Username: boscyo_lihat_kantor (password sudah dikirim terpisah)
--
-- Additive murni. Tidak menyentuh kasir lain yang sudah ada. Bergantung
-- pada migration 0052 (gerai Kantor) sudah applied duluan.

INSERT INTO cashiers (
  id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at
)
SELECT 'cashier_boscyo_readonly_kantor', 'boscyo_lihat_kantor',
       'd2531dc6141826166221acc882c22c1eb3959a4abdba21aa3e05eaed4689e796',
       'Bos Cyo (lihat saja)', 'store_kantor', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM cashiers WHERE username = 'boscyo_lihat_kantor' COLLATE NOCASE);
