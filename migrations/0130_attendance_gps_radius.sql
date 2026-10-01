-- Presensi berbasis radius GPS (Bos Cyo, 2026-10-01): presensi dinilai terhadap
-- titik acuan gerai (radius 75 m, ditetapkan di kode, tidak ditampilkan ke
-- karyawan). Presensi TIDAK PERNAH ditolak karena GPS; yang tanpa GPS atau di
-- luar radius tetap tersimpan dan diberi tanda merah di kartu presensi, lalu
-- terkumpul di laporan Admin. Karyawan bisa mengajukan perbaikan (permit);
-- bila di-ACC tandanya hilang dengan keterangan, bila ditolak tetap merah.
--
-- Semua kolom nullable tanpa backfill: presensi lama tidak dinilai (NULL) dan
-- tidak ikut ditandai merah; ALTER ADD COLUMN tidak menulis ulang baris.
--
-- stores.attendance_ref_*: titik acuan diisi Admin per gerai. Selama belum
-- diisi, presensi yang membawa GPS tidak dinilai (status NULL); presensi tanpa
-- GPS tetap ditandai NO_GPS.
ALTER TABLE stores ADD COLUMN attendance_ref_latitude REAL;
ALTER TABLE stores ADD COLUMN attendance_ref_longitude REAL;

-- gps_*_status: OK | NO_GPS | OUT_OF_RADIUS. gps_*_distance_m: jarak ke titik
-- acuan saat presensi (meter, bulat) -- hanya dikirim ke sisi Admin.
-- gps_*_resolved_permit_id + gps_*_resolution_note: diisi saat permit
-- perbaikan di-ACC; status asli tetap tersimpan sebagai jejak.
ALTER TABLE staff_attendance ADD COLUMN gps_in_status TEXT;
ALTER TABLE staff_attendance ADD COLUMN gps_in_distance_m INTEGER;
ALTER TABLE staff_attendance ADD COLUMN gps_in_resolved_permit_id TEXT;
ALTER TABLE staff_attendance ADD COLUMN gps_in_resolution_note TEXT;
ALTER TABLE staff_attendance ADD COLUMN gps_out_status TEXT;
ALTER TABLE staff_attendance ADD COLUMN gps_out_distance_m INTEGER;
ALTER TABLE staff_attendance ADD COLUMN gps_out_resolved_permit_id TEXT;
ALTER TABLE staff_attendance ADD COLUMN gps_out_resolution_note TEXT;

-- Permit perbaikan GPS. Tidak menyentuh uang, jadi boleh diajukan kapan pun
-- (sesi berjalan maupun selesai) dan tidak kadaluarsa. Satu pengajuan per
-- titik presensi seumur hidup (UNIQUE) supaya Admin tidak dibanjiri ulang;
-- ditolak berarti final.
CREATE TABLE IF NOT EXISTS attendance_gps_permits (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  attendance_id TEXT NOT NULL REFERENCES staff_attendance(id),
  which TEXT NOT NULL CHECK (which IN ('IN', 'OUT')),
  requested_by_cashier_id TEXT NOT NULL REFERENCES cashiers(id),
  original_status TEXT NOT NULL CHECK (original_status IN ('NO_GPS', 'OUT_OF_RADIUS')),
  original_distance_m INTEGER,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  decision_note TEXT NOT NULL DEFAULT '',
  decided_by_role TEXT,
  decided_by_id TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (attendance_id, which)
);

CREATE INDEX IF NOT EXISTS idx_attendance_gps_permits_store_status
  ON attendance_gps_permits(store_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_gps_permits_requester
  ON attendance_gps_permits(requested_by_cashier_id, created_at DESC);
