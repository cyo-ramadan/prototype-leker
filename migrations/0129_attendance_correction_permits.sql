-- Permit koreksi jam presensi masuk (Bos Cyo, 2026-10-01): karyawan yang
-- presensi masuknya terlambat karena alasan sah (mis. web error) mengajukan
-- pengubahan jam masuk ke jam yang seharusnya; Admin memutuskan ACC/Tolak.
-- Saat ACC, jam masuk di staff_attendance diganti dan alasan perubahannya
-- tercatat permanen di baris presensi itu.
--
-- Hanya boleh diajukan selagi sesi presensi masih berjalan (OPEN): gaji sesi
-- baru dicatat ke buku gaji dan jurnal Akuntansi saat presensi pulang, jadi
-- koreksi di tahap ini tidak menyentuh data yang sudah posted. Kalau sesi
-- selesai sebelum Admin memutuskan, permit berstatus EXPIRED dan koreksi
-- ditempuh lewat Penyesuaian Gaji.
--
-- Kolom baru di staff_attendance semuanya nullable tanpa backfill: baris lama
-- tidak berubah dan tidak ada UPDATE massal (ALTER ADD COLUMN tidak menulis
-- ulang baris). created_at tetap dipakai semua pembaca sebagai jam masuk; jam
-- aslinya disimpan di original_created_at.
ALTER TABLE staff_attendance ADD COLUMN original_created_at TEXT;
ALTER TABLE staff_attendance ADD COLUMN correction_permit_id TEXT;
ALTER TABLE staff_attendance ADD COLUMN correction_reason TEXT;
ALTER TABLE staff_attendance ADD COLUMN correction_decision_note TEXT;

CREATE TABLE IF NOT EXISTS attendance_correction_permits (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  attendance_id TEXT NOT NULL REFERENCES staff_attendance(id),
  requested_by_cashier_id TEXT NOT NULL REFERENCES cashiers(id),
  original_check_in_at TEXT NOT NULL,
  requested_check_in_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  decision_note TEXT NOT NULL DEFAULT '',
  decided_by_role TEXT,
  decided_by_id TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (requested_check_in_at < original_check_in_at)
);

CREATE INDEX IF NOT EXISTS idx_attendance_correction_permits_store_status
  ON attendance_correction_permits(store_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_correction_permits_requester
  ON attendance_correction_permits(requested_by_cashier_id, created_at DESC);

-- Satu sesi presensi hanya boleh punya satu pengajuan yang menunggu.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_correction_permits_pending
  ON attendance_correction_permits(attendance_id) WHERE status = 'PENDING';
