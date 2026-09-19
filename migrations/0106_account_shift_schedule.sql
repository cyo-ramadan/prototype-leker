PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-19: "untuk ganti konsep ga jadi deh, bener yang udah
-- jalan sekarang, tapi akunnya dibikin lebih detil aja misal jam kerja dan
-- hari kerja. jadi misal hari senin jam 9-18 sampai hari jumat sama, terus
-- sabtu libur, minggu jam 9-22."
--
-- account_job_details.shift_start/shift_end (migration 0104) cuma satu
-- pasang jam yang berlaku SEMUA hari -- tidak bisa beda per hari atau
-- menandai hari libur. account_shift_schedule menggantikannya dengan 7 baris
-- per akun, satu per hari (day_of_week 0=Minggu .. 6=Sabtu, konvensi sama
-- dengan JS Date.getUTCDay() supaya konsisten dengan getJakartaDayOfWeek()
-- di src/time.js).
--
-- shift_start/shift_end di account_job_details SENGAJA TIDAK di-DROP (tidak
-- ada presedennya di repo ini) -- ditinggal menganggur, tidak dibaca lagi
-- oleh kode mulai migration ini.
CREATE TABLE IF NOT EXISTS account_shift_schedule (
  account_type TEXT NOT NULL CHECK (account_type IN ('CASHIER', 'STORE_ADMIN', 'ENTITY_ADMIN')),
  account_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_day_off INTEGER NOT NULL DEFAULT 0,
  shift_start TEXT NOT NULL DEFAULT '',
  shift_end TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (account_type, account_id, day_of_week)
);

-- Backfill: akun yang sudah sempat diisi shift_start/shift_end (flat, migration
-- 0104) sebelum migration ini -- dicek langsung ke produksi, cuma 1 akun
-- (cashier_87a5e0ee..., 18:00-22:00). Supaya jadwalnya tidak hilang begitu
-- kode berhenti membaca kolom lama, isi ke 7 hari dengan jam yang sama
-- persis seperti perilaku lama (berlaku semua hari, tidak ada yang libur) --
-- itu satu-satunya asumsi aman tanpa tahu hari kerja sungguhan yang
-- dimaksud Admin waktu itu.
--
-- Ditulis sebagai 7 statement INSERT...SELECT terpisah (bukan CROSS JOIN ke
-- satu subquery 7-term UNION ALL) -- versi UNION ALL sempat dicoba dan gagal
-- di D1 remote sungguhan (lolos di tes lokal node:sqlite, TIDAK lolos di API
-- D1 remote): "too many terms in compound SELECT: SQLITE_ERROR". Migration
-- ini belum pernah applied di lingkungan manapun saat kegagalan itu terjadi
-- (dicek ulang: tabel account_shift_schedule belum ada sama sekali di
-- produksi), jadi memperbaiki file ini langsung bukan pelanggaran invariant
-- "jangan menulis ulang migration yang sudah applied".
INSERT INTO account_shift_schedule (account_type, account_id, day_of_week, is_day_off, shift_start, shift_end)
SELECT account_type, account_id, 0, 0, shift_start, shift_end FROM account_job_details WHERE shift_start != '' OR shift_end != '';
INSERT INTO account_shift_schedule (account_type, account_id, day_of_week, is_day_off, shift_start, shift_end)
SELECT account_type, account_id, 1, 0, shift_start, shift_end FROM account_job_details WHERE shift_start != '' OR shift_end != '';
INSERT INTO account_shift_schedule (account_type, account_id, day_of_week, is_day_off, shift_start, shift_end)
SELECT account_type, account_id, 2, 0, shift_start, shift_end FROM account_job_details WHERE shift_start != '' OR shift_end != '';
INSERT INTO account_shift_schedule (account_type, account_id, day_of_week, is_day_off, shift_start, shift_end)
SELECT account_type, account_id, 3, 0, shift_start, shift_end FROM account_job_details WHERE shift_start != '' OR shift_end != '';
INSERT INTO account_shift_schedule (account_type, account_id, day_of_week, is_day_off, shift_start, shift_end)
SELECT account_type, account_id, 4, 0, shift_start, shift_end FROM account_job_details WHERE shift_start != '' OR shift_end != '';
INSERT INTO account_shift_schedule (account_type, account_id, day_of_week, is_day_off, shift_start, shift_end)
SELECT account_type, account_id, 5, 0, shift_start, shift_end FROM account_job_details WHERE shift_start != '' OR shift_end != '';
INSERT INTO account_shift_schedule (account_type, account_id, day_of_week, is_day_off, shift_start, shift_end)
SELECT account_type, account_id, 6, 0, shift_start, shift_end FROM account_job_details WHERE shift_start != '' OR shift_end != '';
