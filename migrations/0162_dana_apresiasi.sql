-- Dana Apresiasi Backup & Denda Ketidakhadiran CS (Bos Cyo, 2026-10-15, ADR-058).
-- CS normal dibayar tarif dasar. Untuk tiap jam shift CS asli yang tidak dia jaga, CS asli membayar
-- "dana apresiasi" per jam: jam yang dijaga backup -> uangnya ke backup lewat akun penampung
-- 2105 Dana Apresiasi Backup (saldo harus 0); jam yang kosong -> Pendapatan Lain-lain. Shift yang
-- kosong (tanpa siapa pun) kena denda: kosong penuh / kosong sebagian. Perusahaan hanya terbeban
-- tarif dasar. Alasan syar'i = Entity Admin membuat penyesuaian (bawaan: membalik penuh).
-- Semua tabel baru membawa entity_id (ADR-030). Tidak ada tabel lama yang diubah.

-- Saklar & angka. store_id '' = bawaan entity; baris per gerai = override (NULL = ikut bawaan).
-- Tidak ada baris = ON dengan angka bawaan (opsi mekanisme default aktif, CLAUDE.md).
CREATE TABLE IF NOT EXISTS apresiasi_settings (
  entity_id TEXT NOT NULL,
  store_id TEXT NOT NULL DEFAULT '',
  enabled INTEGER CHECK (enabled IS NULL OR enabled IN (0, 1)),
  rate_per_hour_rupiah INTEGER CHECK (rate_per_hour_rupiah IS NULL OR rate_per_hour_rupiah >= 0),
  denda_penuh_rupiah INTEGER CHECK (denda_penuh_rupiah IS NULL OR denda_penuh_rupiah >= 0),
  denda_sebagian_rupiah INTEGER CHECK (denda_sebagian_rupiah IS NULL OR denda_sebagian_rupiah >= 0),
  jam_buka TEXT NOT NULL DEFAULT '',
  jam_tutup TEXT NOT NULL DEFAULT '',
  -- Tanggal (WIB) saklar terakhir dinyalakan: shift sebelum tanggal ini tidak dihitung.
  enabled_since TEXT,
  -- "Mulai dihitung" pilihan Entity Admin (NULL = ikut bawaan entity / bawaan aplikasi). Supaya jadwal &
  -- status akun sempat dibetulkan sebelum potongan pertama (Bos Cyo, 2026-10-15).
  mulai_tanggal TEXT CHECK (mulai_tanggal IS NULL OR mulai_tanggal GLOB '????-??-??'),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_role TEXT NOT NULL DEFAULT '',
  updated_by_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (entity_id, store_id)
);

-- Status akun kasir. Tidak ada baris = akun backup entity (is_entity_backup) dianggap FREELANCE,
-- selainnya CS ASLI. Denda & potongan hanya untuk CS ASLI.
CREATE TABLE IF NOT EXISTS cashier_cs_status (
  account_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('ASLI', 'FREELANCE')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_role TEXT NOT NULL DEFAULT '',
  updated_by_id TEXT NOT NULL DEFAULT ''
);

-- "Menggantikan siapa" untuk satu sesi presensi. Tidak ada baris = otomatis dari jadwal CS asli
-- yang bolong. replaces_account_id '' = tidak menggantikan siapa pun (mengisi jam bolong).
CREATE TABLE IF NOT EXISTS apresiasi_pengganti (
  attendance_id TEXT PRIMARY KEY,
  replaces_account_id TEXT NOT NULL DEFAULT '',
  set_by_role TEXT NOT NULL DEFAULT '',
  set_by_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Satu baris per shift CS asli yang sudah dinilai (lazy, sesudah jam pulang + 1 jam).
-- revision naik tiap kali dinilai ulang (koreksi pengganti); baris apresiasi_entries revisi lama dibatalkan.
CREATE TABLE IF NOT EXISTS apresiasi_evaluations (
  id TEXT PRIMARY KEY,
  ref_code TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  store_id TEXT NOT NULL REFERENCES stores(id),
  account_id TEXT NOT NULL,
  business_date TEXT NOT NULL CHECK (business_date GLOB '????-??-??'),
  shift_start TEXT NOT NULL,
  shift_end TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  shift_minutes INTEGER NOT NULL DEFAULT 0,
  own_minutes INTEGER NOT NULL DEFAULT 0,
  backup_minutes INTEGER NOT NULL DEFAULT 0,
  kosong_minutes INTEGER NOT NULL DEFAULT 0,
  denda_kind TEXT NOT NULL DEFAULT '' CHECK (denda_kind IN ('', 'PENUH', 'SEBAGIAN')),
  evaluated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (store_id, account_id, business_date)
);
CREATE INDEX IF NOT EXISTS idx_apresiasi_eval_store_date ON apresiasi_evaluations(store_id, business_date);

-- Mutasi Hutang Gaji dari mekanisme ini (sumber operasional, dicerminkan ke jurnal LEKER_ADMIN
-- fakta APRESIASI). amount_scaled = perubahan Hutang Gaji pemilik baris (scaled x1.000.000):
--   POTONG_BACKUP (-, CS asli, jam dijaga backup) <-> FEE_BACKUP (+, backup), lewat penampung 2105
--   POTONG_KOSONG (-, jam kosong) dan DENDA (-) -> Pendapatan Lain-lain
--   PENYESUAIAN (+/-, Entity Admin, mis. alasan syar'i) atas satu baris lain (adjusts_entry_id)
CREATE TABLE IF NOT EXISTS apresiasi_entries (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES apresiasi_evaluations(id),
  revision INTEGER NOT NULL DEFAULT 1,
  entity_id TEXT NOT NULL,
  store_id TEXT NOT NULL REFERENCES stores(id),
  business_date TEXT NOT NULL CHECK (business_date GLOB '????-??-??'),
  account_id TEXT NOT NULL,
  employee_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('POTONG_BACKUP', 'POTONG_KOSONG', 'DENDA', 'FEE_BACKUP', 'PENYESUAIAN')),
  counter_account_id TEXT NOT NULL DEFAULT '',
  minutes INTEGER NOT NULL DEFAULT 0,
  rate_rupiah INTEGER NOT NULL DEFAULT 0,
  amount_scaled INTEGER NOT NULL,
  adjusts_entry_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_role TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  voided_at TEXT,
  voided_by_role TEXT NOT NULL DEFAULT '',
  voided_by_id TEXT NOT NULL DEFAULT '',
  void_reason TEXT NOT NULL DEFAULT '',
  CHECK (kind <> 'PENYESUAIAN' OR adjusts_entry_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_apresiasi_entries_once
  ON apresiasi_entries(evaluation_id, revision, kind, counter_account_id) WHERE kind <> 'PENYESUAIAN';
CREATE INDEX IF NOT EXISTS idx_apresiasi_entries_account ON apresiasi_entries(account_id, business_date);
CREATE INDEX IF NOT EXISTS idx_apresiasi_entries_store_date ON apresiasi_entries(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_apresiasi_entries_employee ON apresiasi_entries(employee_id);

-- Revisi jam presensi oleh CS (Bos Cyo, 2026-10-17): CS mengajukan revisi jam masuk/pulang sesi yang
-- tercatat -- termasuk sesi yang sudah selesai dan sudah dijurnal -- atau sesi baru bila lupa presensi
-- sama sekali. Owner/Admin: ACC apa adanya, edit lalu ACC, atau tolak. ACC = jam presensi diganti,
-- gaji sesi dibatalkan + jurnalnya dibalik, gaji baru dicatat + dijurnal, dana apresiasi dinilai ulang.
-- Menggantikan permit koreksi jam masuk lama (0129, hanya saat sesi berjalan) untuk pengajuan baru.
ALTER TABLE staff_attendance ADD COLUMN original_check_out_at TEXT;
ALTER TABLE staff_attendance ADD COLUMN revision_permit_id TEXT;

CREATE TABLE IF NOT EXISTS attendance_revision_permits (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  store_id TEXT NOT NULL REFERENCES stores(id),
  account_id TEXT NOT NULL REFERENCES cashiers(id),
  -- NULL = lupa presensi sama sekali; ACC membuat sesi baru.
  attendance_id TEXT REFERENCES staff_attendance(id),
  business_date TEXT NOT NULL CHECK (business_date GLOB '????-??-??'),
  original_check_in_at TEXT,
  original_check_out_at TEXT,
  requested_check_in_at TEXT NOT NULL,
  requested_check_out_at TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  approved_check_in_at TEXT,
  approved_check_out_at TEXT,
  edited_by_approver INTEGER NOT NULL DEFAULT 0 CHECK (edited_by_approver IN (0, 1)),
  decision_note TEXT NOT NULL DEFAULT '',
  decided_by_role TEXT,
  decided_by_id TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (requested_check_out_at IS NULL OR requested_check_in_at < requested_check_out_at)
);
CREATE INDEX IF NOT EXISTS idx_attendance_revision_store_status ON attendance_revision_permits(store_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_revision_account ON attendance_revision_permits(account_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_revision_one_pending
  ON attendance_revision_permits(account_id, business_date, COALESCE(attendance_id, '')) WHERE status = 'PENDING';
