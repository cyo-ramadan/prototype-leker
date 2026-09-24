PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-24: "untuk konsep username ini kan ada kerjaan sebagai
-- kasir atau sidak dsb. kalo kerjaannya itu misal kasir backup atau cs
-- freelance gimana ... intinya hal ini untuk menghindari di hari dan jam
-- normal cs ini presensi memakai user backup, karna user backup itu gaji
-- per jam nya lebih gede." Lalu: "untuk akun backup mending ikut entity
-- aja, jadi bikin akunnya cuma 1 aja."
--
-- Dua kebutuhan yang ternyata SATU mekanisme: (1) satu akun backup dipakai
-- lintas gerai dalam entity yang sama, tidak usah duplikat per gerai, dan
-- (2) akun itu tidak boleh bisa presensi begitu saja di hari/gerai
-- sembarangan -- HARUS diaktifkan Admin dulu untuk hari itu, di gerai
-- tertentu. Kalau Admin "mengaktifkan" akun ini untuk gerainya hari ini,
-- itu SEKALIGUS menjawab "boleh presensi apa tidak" dan "kalau boleh, di
-- gerai mana" -- bukan dua fitur terpisah.
--
-- Desain (v1, sengaja disederhanakan -- lihat catatan di bawah):
-- cashiers.store_id TETAP NOT NULL (auth/session/menu/laci semuanya sudah
-- menganggap satu kasir = satu gerai lewat kolom ini, mengubahnya jadi
-- nullable berarti membongkar requireCashier dkk yang dipakai SETIAP
-- endpoint kasir -- risiko jauh lebih besar dari manfaatnya untuk v1 ini).
-- Sebagai gantinya: store_id sebuah akun backup BOLEH dipindah Admin kapan
-- pun (lihat activateEntityBackupCashier di src/entity-backup-cashiers.js),
-- dan pemindahan itu otomatis berlaku untuk sesi yang sedang aktif juga
-- (requireCashier selalu JOIN ke stores fresh tiap request, tidak pernah
-- cache store lama).
--
-- Keterbatasan yang sengaja diterima: aktivasi cuma untuk HARI INI, bukan
-- menjadwalkan jauh-jauh hari (mis. "aktifkan tanggal 26 minggu depan").
-- Alasannya: memindahkan store_id lebih awal dari tanggal aktivasi berarti
-- akun itu salah gerai di hari-hari SEBELUM tanggal aktivasi -- dan sistem
-- ini sengaja tidak punya cron/scheduled job (CLAUDE.md invariant #6,
-- "tanpa polling periodik") yang bisa memindahkannya TEPAT di tengah malam
-- tanggal aktivasi. Kalau nanti benar-benar dibutuhkan, itu perubahan
-- terpisah (perlu Cron Trigger Cloudflare), bukan bagian dari v1 ini.
ALTER TABLE cashiers ADD COLUMN is_entity_backup INTEGER NOT NULL DEFAULT 0 CHECK (is_entity_backup IN (0, 1));

-- Append-only, satu baris per (akun, tanggal) -- jejak audit "siapa
-- mengaktifkan akun ini, untuk gerai mana, kapan" yang tidak bisa ditimpa.
-- UNIQUE (account_id, business_date) sengaja mencegah dua aktivasi beda
-- gerai di tanggal yang sama untuk akun yang sama -- satu backup cuma bisa
-- di SATU gerai per hari, sesuai kenyataan fisiknya (orangnya cuma satu).
CREATE TABLE IF NOT EXISTS account_daily_activations (
  id TEXT PRIMARY KEY,
  account_type TEXT NOT NULL DEFAULT 'CASHIER' CHECK (account_type IN ('CASHIER')),
  account_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  store_id TEXT NOT NULL REFERENCES stores(id),
  activated_by_role TEXT NOT NULL,
  activated_by_id TEXT NOT NULL,
  activated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (account_type, account_id, business_date)
);

CREATE INDEX IF NOT EXISTS idx_account_daily_activations_lookup
  ON account_daily_activations(account_type, account_id, business_date);
