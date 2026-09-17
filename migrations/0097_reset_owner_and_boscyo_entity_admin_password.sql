PRAGMA foreign_keys = ON;

-- Reset password akun Owner (username: owner) dan Entity Admin Bos Cyo
-- (entityadmin_cyo, migration 0090, dirotasi sekali di migration 0092) --
-- Bos Cyo, 2026-09-17: "aku lupa akun2 dan passwordnya" -> "ok reset
-- password", cakupan dikonfirmasi cuma dua akun milik Bos Cyo sendiri ini,
-- BUKAN akun staf lain (Rika/Alfina/Admin Gerai) yang masih aktif dipakai
-- harian dan tidak diberi tahu soal reset.
--
-- Hanya SHA-256 hash yang dicatat di sini (pola hashCredential() di
-- src/owner-auth.js), TANPA plaintext -- password baru dikirim ke Bos Cyo
-- langsung lewat chat, tidak lewat repo. Sama seperti pola migration 0092.
--
-- Additive-safe: UPDATE ini idempotent (menjalankannya berkali-kali hasil
-- akhirnya sama), tidak menyentuh baris entity_admins/owner_accounts lain.

UPDATE owner_accounts
SET password_hash = 'f3af93b208871c33cd53ed858b2458b8390931de998708c560a47c316f7e9e61',
    updated_at = CURRENT_TIMESTAMP
WHERE username = 'owner' COLLATE NOCASE;

UPDATE entity_admins
SET password_hash = 'cad0ca484bf0366713832aaf713c7d27a61fc1a34a154a064679054653c803a3',
    updated_at = CURRENT_TIMESTAMP
WHERE username = 'entityadmin_cyo' COLLATE NOCASE;

-- Sesi yang mungkin masih terbuka untuk dua akun ini dicabut supaya token
-- lama tidak bisa dipakai lagi setelah password-nya diganti.
DELETE FROM owner_sessions
WHERE owner_id IN (SELECT id FROM owner_accounts WHERE username = 'owner' COLLATE NOCASE);

DELETE FROM entity_admin_sessions
WHERE entity_admin_id IN (SELECT id FROM entity_admins WHERE username = 'entityadmin_cyo' COLLATE NOCASE);
