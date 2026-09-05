PRAGMA foreign_keys = ON;

-- 2026-09-04, Bos Cyo: satu baris presensi sekarang menjelaskan satu sesi
-- kerja penuh (masuk + pulang), bukan dua baris event terpisah -- supaya ada
-- satu tempat yang bisa ditambah detail lain nanti (jumlah task dikerjakan,
-- jam kerja, gaji per jam, dst). Kolom lama (photo_blob/photo_type/
-- created_at/latitude/longitude/location_accuracy_meters) sekarang berarti
-- fakta presensi MASUK; kolom check_out_* baru di bawah ini berarti fakta
-- presensi PULANG pada baris yang sama.
--
-- status: 'OPEN' = sudah presensi masuk, belum presensi pulang.
--         'CLOSED' = sudah presensi pulang, baris selesai.
--         NULL = baris lama dari sebelum migration ini (event-log lama,
--         satu baris per aksi) -- dibiarkan apa adanya untuk histori, TIDAK
--         dihapus, lalu dibackfill di bawah supaya ikut format status yang
--         sama (backfill per baris independen -- data lama tidak punya
--         pasangan masuk/pulang yang jelas untuk dipasangkan otomatis).
ALTER TABLE staff_attendance ADD COLUMN status TEXT;
ALTER TABLE staff_attendance ADD COLUMN check_out_at TEXT;
ALTER TABLE staff_attendance ADD COLUMN check_out_photo_blob BLOB;
ALTER TABLE staff_attendance ADD COLUMN check_out_photo_type TEXT;
ALTER TABLE staff_attendance ADD COLUMN check_out_latitude REAL;
ALTER TABLE staff_attendance ADD COLUMN check_out_longitude REAL;
ALTER TABLE staff_attendance ADD COLUMN check_out_location_accuracy_meters REAL;

UPDATE staff_attendance
SET status = CASE WHEN attendance_type = 'in' THEN 'OPEN' ELSE 'CLOSED' END
WHERE status IS NULL;
