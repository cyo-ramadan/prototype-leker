PRAGMA foreign_keys = ON;

-- Akun Entity Admin khusus buat agen (Hana/Claude Code, dst) -- Bos Cyo,
-- 2026-09-16: "mending bikin jalur sendiri, pake admin hana gitu lo, jadi
-- itu jalur kusus untuk agent edit2 aplikasi". Sebelumnya agen yang mau
-- nulis lewat /api/admin/* (bukan cuma baca D1) harus pinjam PIN Admin
-- Gerai manusia -- sekarang ada kredensial sendiri, scoped ke ENT-KPM
-- (entity yang sama dengan migration 0090/0092, menaungi 10 gerai termasuk
-- Dermo) supaya tidak numpang akun siapa pun.
--
-- Beda dari precedent migration 0064/0090 (yang mencatat password plaintext
-- di komentar): password_hash di bawah adalah SHA-256 (pola hashCredential()
-- di src/owner-auth.js) TANPA plaintext-nya ditulis di file ini sama
-- sekali. Password aslinya disampaikan ke Bos Cyo langsung lewat chat saat
-- akun ini dibuat, bukan disimpan di repo -- sengaja begitu, bukan lupa.
--
-- Additive murni. Tidak menyentuh entity_admin lain yang sudah ada.
-- Bergantung pada migration 0063 (tabel entity_admins) dan 0064 (ENT-KPM)
-- sudah applied duluan.

INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active)
SELECT 'entity_admin_hana_kpm', 'ENT-KPM', 'entityadmin_hana',
       'aaca33b24bc4c5a9ef45f06856930e00a1377772ac5a94e2190c9b42b647bc45',
       'Hana (Agent)', 1
WHERE NOT EXISTS (SELECT 1 FROM entity_admins WHERE username = 'entityadmin_hana' COLLATE NOCASE);
