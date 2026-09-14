PRAGMA foreign_keys = ON;

-- Rotasi password akun Entity Admin Bos Cyo (entityadmin_cyo, migration
-- 0090) -- migration 0090 sempat menaruh password plaintext-nya di
-- komentar SQL sebelum sadar itu permanen ke riwayat git begitu di-push.
-- Password lama dianggap bocor sejak saat itu; migration ini menggantinya
-- dengan yang baru. Cuma hash SHA-256 yang dicatat di sini (pola
-- hashCredential() di src/owner-auth.js) -- password baru dikirim ke
-- Bos Cyo langsung lewat chat, tidak lewat repo. Jangan diulang polanya
-- untuk akun berikutnya.
--
-- Additive-safe: UPDATE ini idempotent (menjalankannya berkali-kali hasil
-- akhirnya sama), tidak menyentuh entity_admin lain. Bergantung pada
-- migration 0090 (baris entityadmin_cyo) sudah applied duluan.

UPDATE entity_admins
SET password_hash = '6b4b980ecdba9ab75e1a4d03fe1d15244ba30eb47ecbebfc8bc6c11633061fe8',
    updated_at = CURRENT_TIMESTAMP
WHERE username = 'entityadmin_cyo' COLLATE NOCASE;
