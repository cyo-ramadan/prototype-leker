PRAGMA foreign_keys = ON;

-- Satu akun kasir percontohan buat debug -- permintaan Bos Cyo 2026-09-04.
-- CATATAN: sistem ini tidak punya konsep "super kasir" yang beda dari kasir
-- biasa -- setiap kasir sudah otomatis dapat akses penuh ke laci, penjualan,
-- pembelian, dan pengeluaran operasional gerainya sendiri (src/cashier-*.js).
-- Tidak ada tingkatan "lebih tinggi" di atas kasir biasa, dan kasir memang
-- selalu terikat 1 gerai (drawer/laci fisik ada di 1 lokasi) -- beda dari
-- Entity Admin (migration 0063) yang lintas-gerai di level admin, bukan
-- kasir. Ditaruh di gerai KANTOR (bukan G001) supaya nyambung sama Entity
-- Admin percontohan Rika/Alfina (migration 0064, entity ENT-KPM yang
-- menaungi Kantor/Pendem/Mandala) yang lagi dicoba Bos Cyo -- Kantor dipilih
-- karena belum ada histori transaksi sama sekali, jadi bersih buat debug.
-- Dinamai "Super Kasir" cuma di display_name-nya supaya gampang dibedain
-- dari kasir lain saat debug, bukan role baru.
--
-- Password plaintext (SHA-256, pola sama seperti hashCredential() di
-- src/owner-auth.js dan precedent migration 0009/0054): dicatat di sini
-- sebagai referensi migrasi. Ganti sebelum dipakai staf sungguhan.
--
-- Super Kasir (Kantor): superkasir / superkasir123
--
-- Additive murni. Tidak menyentuh kasir lain yang sudah ada. Bergantung pada
-- migration 0052 (gerai Kantor) sudah applied duluan.

INSERT INTO cashiers (
  id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at
)
SELECT 'cashier_super_debug', 'superkasir',
       '24e759ccdb0b09e59184d8975a008891ed170fb936077aa135875a1dd1bdd647',
       'Super Kasir (Debug)', 'store_kantor', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM cashiers WHERE username = 'superkasir' COLLATE NOCASE);
