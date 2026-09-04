PRAGMA foreign_keys = ON;

-- 2026-09-04, Bos Cyo: presensi masuk/keluar sekarang bisa menyertakan lokasi
-- GPS saat foto diambil, sebagai bukti tambahan di samping foto itu sendiri.
-- Nullable -- kalau kasir menolak izin lokasi atau browser tidak mendukung,
-- presensi tetap boleh jalan tanpa koordinat (foto tetap wajib).
ALTER TABLE staff_attendance ADD COLUMN latitude REAL;
ALTER TABLE staff_attendance ADD COLUMN longitude REAL;
ALTER TABLE staff_attendance ADD COLUMN location_accuracy_meters REAL;
