-- Akun Entity Admin untuk tenant Harilibur (Bos Cyo, 2026-10-06: "bikin id user pasword adminentity
-- untuk tenant harilibur").
--
-- Tenant TEN-HARILIBUR = entity ENT-G001 ("leker.hari.malang"), satu gerai G001. Entity ini belum
-- punya Entity Admin sama sekali. Akun dibuat lewat migration (jalur yang sama dengan Toko Parfum,
-- migration 0140) -- hanya HASH SHA-256 password yang disimpan di repo; password asli diserahkan ke
-- Bos Cyo di luar repo. Idempotent: tidak membuat ulang kalau username sudah ada, dan tidak pernah
-- menimpa password akun yang sudah ada. Bos Cyo bisa mengganti password setelah login pertama.
INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active)
SELECT 'entity_admin_harilibur', 'ENT-G001', 'entityadmin_harilibur',
       'a09701ea196836e23dcd281b2e9c6a50789bc9759788c0107b9ea4c41a839b8a',
       'Admin Entity Harilibur', 1
WHERE EXISTS (SELECT 1 FROM entities WHERE id = 'ENT-G001')
  AND NOT EXISTS (SELECT 1 FROM entity_admins WHERE username = 'entityadmin_harilibur' COLLATE NOCASE);
