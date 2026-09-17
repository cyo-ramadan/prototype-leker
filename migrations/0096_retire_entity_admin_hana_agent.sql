PRAGMA foreign_keys = ON;

-- Menonaktifkan akun `entityadmin_hana` dari migration 0095 -- Bos Cyo,
-- 2026-09-16, menolak pendekatan itu: "itu akun biasa dibuka lewat ui atau
-- seperti credential, buat jalurmu nhoperasikan lewat backend? yang aku
-- inginkan jalur kusus untuk agent edit ya, bukan jalur manusia". Akun
-- Entity Admin tetap login lewat endpoint dan tabel session yang sama
-- dengan Entity Admin manusia (src/owner-auth.js), jadi bukan jalur
-- terpisah walau cuma agen yang pakai.
--
-- Diganti mekanisme bertype Bearer-token-vs-secret env Worker, meniru
-- persis requireDebugger/DEBUG_SUPERADMIN_TOKEN di
-- src/debugger-control-plane.js -- lihat AGENT_ADMIN_IDENTITY dan
-- agentAdminFromRequest di src/owner-auth.js. Tidak ada baris tabel,
-- tidak ada endpoint login, tidak ada session -- benar-benar bukan
-- "jalur manusia".
--
-- Migration 0095 TIDAK ditulis ulang (invariant: jangan menulis ulang
-- migration yang sudah applied) -- baris akunnya cukup dimatikan lewat
-- UPDATE additif di sini. is_active = 0 juga otomatis menolak login lama
-- kalau plaintext-nya bocor entah bagaimana.

UPDATE entity_admins
SET is_active = 0, updated_at = CURRENT_TIMESTAMP
WHERE username = 'entityadmin_hana' COLLATE NOCASE;

-- Sesi yang mungkin masih terbuka untuk akun ini ikut dicabut supaya
-- token lama tidak berguna lagi walau sesinya belum expire.
DELETE FROM entity_admin_sessions
WHERE entity_admin_id IN (
  SELECT id FROM entity_admins WHERE username = 'entityadmin_hana' COLLATE NOCASE
);
