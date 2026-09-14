PRAGMA foreign_keys = ON;

-- Akun Entity Admin milik Bos Cyo sendiri -- permintaan 2026-09-14, biar
-- tidak pakai kredensial pilot Rika/Alfina (migration 0064) yang memang
-- dinamai untuk staf tertentu. Entity ENT-KPM ("Kantor Pendem Mandala")
-- sekarang menaungi 10 gerai (KANTOR/PENDEM/MANDALA dari pilot awal, plus
-- SUGIONO/GENENGAN/NGIJO/BEJI/TLEKUNG/DERMO/KALIURANG yang menyusul) --
-- login Entity Admin ini otomatis berwenang di Admin Gerai (branch-admin)
-- untuk kesepuluhnya sekaligus panel Entity Admin sendiri, karena otorisasi
-- di src/owner-auth.js (entityAdminStoreAuthorized) mencocokkan
-- store.entity_id ke entity_id akun ini, bukan daftar gerai yang di-hardcode.
--
-- Kasir TIDAK termasuk di sini -- kasir selalu terikat 1 gerai (username
-- global UNIQUE di tabel cashiers, lihat migration 0005) dan tidak ada
-- konsep "kasir lintas-entity", sama seperti dicatat di migration 0065.
-- Kalau Bos Cyo juga mau akun kasir, itu perlu baris terpisah per gerai.
--
-- Password plaintext (SHA-256, pola sama seperti hashCredential() di
-- src/owner-auth.js dan precedent migration 0064): dicatat di sini sebagai
-- referensi migrasi, sama seperti precedent sebelumnya.
--
-- Bos Cyo (Entity Admin ENT-KPM): entityadmin_cyo / Kpm-RwYdYxGU
--
-- Additive murni. Tidak menyentuh entity_admin lain yang sudah ada.
-- Bergantung pada migration 0063 (tabel entity_admins) dan 0064 (ENT-KPM)
-- sudah applied duluan.

INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active)
SELECT 'entity_admin_boscyo_kpm', 'ENT-KPM', 'entityadmin_cyo',
       '8c3a76f6d6dda1da2e0d674965592c6e0fdb309e6e6a5c9a21ba8729d88d1df1',
       'Bos Cyo', 1
WHERE NOT EXISTS (SELECT 1 FROM entity_admins WHERE username = 'entityadmin_cyo' COLLATE NOCASE);
