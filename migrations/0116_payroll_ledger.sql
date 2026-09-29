PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-24 (koreksi atas Penyesuaian Gaji/migration 0114): "harusnya
-- entry gaji cukup yang di operasional itu kan bisa, engga usa bikin yang
-- baru ... bikin semacam akun gaji, dan apabila menyentuh itu harus cek juga
-- employ dan nama karyawan itu ... (pastikan tanggungan gaji per gerai
-- walaupun memakai user bersama) ... riwayat gaji itu mending acuannya per
-- nama orang aja ... model akun gaji ini sebaiknya mengikuti konsep debet dan
-- kredit ... jangan lupa catat yang jadi beban gajinya, untuk perhitungan di
-- rugi laba nya." Lalu, waktu ditanya soal presensi harian: "kalo dalam
-- akuntansi ketika ada gaji harian itu jurnalnya debet beban gaji kredit
-- hutang gaji ... jadi harusnya nominal di sesi jam harian itu uda mencetak
-- beban dan hutang gaji."
--
-- payroll_ledger_entries adalah "Akun Gaji" itu -- ledger per KARYAWAN
-- (orang, employees.id), bukan per akun login, supaya akun backup yang
-- dipakai gantian orang tidak menukar gaji satu orang ke orang lain.
--
-- Dua kolom delta, SELALU dua-duanya diisi bersamaan untuk ACCRUAL/ADJUSTMENT
-- (satu peristiwa = "debet Beban Gaji, kredit Hutang Gaji" seperti Bos Cyo
-- jelaskan):
--   hutang_gaji_delta_scaled -- + menambah saldo Hutang Gaji orang itu,
--     - mengurangi (nanti dipakai juga waktu gaji ditransfer/dibayar).
--   beban_gaji_delta_scaled -- + menambah Beban Gaji hari itu di gerai itu
--     (masuk Laporan Rugi Laba), - mengoreksi/mengurangi.
-- PAYMENT (catatan "gaji sudah ditransfer") sengaja belum dibangun sesi ini
-- (Bos Cyo: "dikerjakan terpisah atau engga terserah kamu aja") tapi kolom
-- entry_type sudah menyediakan nilainya supaya nanti tidak perlu migration
-- baru lagi -- PAYMENT hanya akan mengisi hutang_gaji_delta_scaled negatif,
-- beban_gaji_delta_scaled tetap 0 (beban sudah diakui saat ACCRUAL, tidak
-- diakui ulang waktu dibayar).
--
-- Nilai discaled WAGE_SCALE (1 rupiah = 1.000.000 unit, sama seperti
-- account_job_details.hourly_wage_scaled di src/staff-attendance.js) --
-- invariant CLAUDE.md #1, karena ini sekarang ledger debit/kredit
-- sungguhan, bukan sekadar angka tampilan.
--
-- employee_id NULLABLE untuk ACCRUAL (presensi): kalau akun belum ditautkan
-- ke Master Karyawan di tanggal kejadian, baris TETAP tersimpan (uangnya
-- tidak boleh hilang begitu saja), employee_id kosong, ditandai "belum
-- ditautkan" di UI -- bukan diblokir dari presensi. Untuk ADJUSTMENT (entry
-- manual Bea Gaji dari Operasional) employee_id WAJIB diisi (CHECK di bawah)
-- -- ini "harus cek juga employ dan nama karyawan itu" yang diminta,
-- ditegakkan di level database, bukan cuma di API.
--
-- account_type/account_id NULLABLE: ACCRUAL selalu tertaut ke satu sesi
-- presensi (satu akun spesifik, CHECK di bawah mewajibkannya), tapi
-- ADJUSTMENT manual adalah "bayar/potong gaji ORANG ini", tidak harus
-- menunjuk akun tertentu (orang itu boleh sedang tidak pegang akun apa pun,
-- atau pegang lebih dari satu).
--
-- source_type + source_id + UNIQUE index: satu baris ACCRUAL per sesi
-- presensi (idempotent lewat INSERT OR IGNORE di recordAttendanceAccrual,
-- src/payroll-ledger.js -- checkout dobel tidak dobel Beban Gaji), satu
-- baris ADJUSTMENT per baris admin_operational_expenses (mirror, dibatalkan
-- bersamaan lewat voided_at, bukan DELETE -- pola append-only yang sama
-- dengan tabel ledger lain di repo ini).
CREATE TABLE IF NOT EXISTS payroll_ledger_entries (
  id TEXT PRIMARY KEY,
  employee_id TEXT REFERENCES employees(id),
  account_type TEXT CHECK (account_type IS NULL OR account_type IN ('CASHIER', 'STORE_ADMIN', 'ENTITY_ADMIN')),
  account_id TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id),
  business_date TEXT NOT NULL CHECK (business_date GLOB '????-??-??'),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('ACCRUAL', 'ADJUSTMENT', 'PAYMENT')),
  hutang_gaji_delta_scaled INTEGER NOT NULL,
  beban_gaji_delta_scaled INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('ATTENDANCE', 'BEA_OPERASIONAL')),
  source_id TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at TEXT,
  voided_by_role TEXT NOT NULL DEFAULT '',
  voided_by_id TEXT NOT NULL DEFAULT '',
  void_reason TEXT NOT NULL DEFAULT '',
  CHECK (entry_type <> 'ACCRUAL' OR (account_type IS NOT NULL AND account_id IS NOT NULL)),
  CHECK (entry_type <> 'ADJUSTMENT' OR employee_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_payroll_ledger_employee ON payroll_ledger_entries(employee_id, business_date);
CREATE INDEX IF NOT EXISTS idx_payroll_ledger_account ON payroll_ledger_entries(account_type, account_id, business_date);
CREATE INDEX IF NOT EXISTS idx_payroll_ledger_store_date ON payroll_ledger_entries(store_id, business_date, voided_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_ledger_source ON payroll_ledger_entries(source_type, source_id);

-- admin_operational_expenses (migration 0100) sudah applied -- SQLite tidak
-- bisa ALTER TABLE untuk melebarkan CHECK constraint, jadi tabelnya dibangun
-- ulang, pola persis migrations/0112_goods_flow_shared_account_source_type.sql.
-- Dua perubahan: (1) employee_id nullable baru, wajib diisi API-nya kalau
-- category = BEA_GAJI; (2) amount boleh negatif KHUSUS BEA_GAJI (potongan
-- gaji akibat pinalti/koreksi -- "penambahan dan pengurangan gaji akibat
-- pinalti ... entry manual admin"), BEA_LAPAK/BEA_LAINNYA tetap wajib > 0
-- seperti semula (itu murni biaya, bukan akun yang bisa dikoreksi negatif).
CREATE TABLE admin_operational_expenses_row_count_20260924 (n INTEGER NOT NULL);
INSERT INTO admin_operational_expenses_row_count_20260924 (n) SELECT COUNT(*) FROM admin_operational_expenses;

CREATE TABLE admin_operational_expenses_new (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('BEA_GAJI', 'BEA_LAPAK', 'BEA_LAINNYA')),
  employee_id TEXT REFERENCES employees(id),
  description TEXT NOT NULL,
  amount INTEGER NOT NULL,
  business_date TEXT NOT NULL CHECK (business_date GLOB '????-??-??'),
  note TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL DEFAULT '' CHECK (created_by_role IN ('', 'OWNER', 'ENTITY_ADMIN', 'ADMIN', 'LEGACY_PIN')),
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at TEXT,
  voided_by_role TEXT,
  voided_by_id TEXT,
  void_reason TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (store_id) REFERENCES stores(id),
  CHECK ((category = 'BEA_GAJI' AND amount <> 0) OR (category <> 'BEA_GAJI' AND amount > 0)),
  CHECK (category = 'BEA_GAJI' OR employee_id IS NULL)
);

INSERT INTO admin_operational_expenses_new (
  id, store_id, category, description, amount, business_date, note,
  created_by_role, created_by_id, created_at, voided_at, voided_by_role, voided_by_id, void_reason
)
SELECT
  id, store_id, category, description, amount, business_date, note,
  created_by_role, created_by_id, created_at, voided_at, voided_by_role, voided_by_id, void_reason
FROM admin_operational_expenses;

DROP TABLE admin_operational_expenses;
ALTER TABLE admin_operational_expenses_new RENAME TO admin_operational_expenses;

CREATE INDEX idx_admin_operational_expenses_store_date
  ON admin_operational_expenses(store_id, business_date DESC, created_at DESC);
CREATE INDEX idx_admin_operational_expenses_store_void
  ON admin_operational_expenses(store_id, voided_at, business_date);

CREATE TABLE admin_operational_expenses_guard_20260924 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO admin_operational_expenses_guard_20260924 (ok)
SELECT CASE WHEN (
  (SELECT COUNT(*) FROM admin_operational_expenses) = (SELECT n FROM admin_operational_expenses_row_count_20260924)
  AND (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'admin_operational_expenses'
       AND name IN ('idx_admin_operational_expenses_store_date', 'idx_admin_operational_expenses_store_void')) = 2
) THEN 1 ELSE 0 END;
DROP TABLE admin_operational_expenses_guard_20260924;
DROP TABLE admin_operational_expenses_row_count_20260924;
