PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-24: "perkara ga ada bayaran gaji ketika diluar jam kerja
-- dan force close ini msukin ke settingan aja, bisa on, bisa off. defaultnya
-- on aja." Satu saklar per GERAI yang mengendalikan DUA perilaku sekaligus
-- (Bos Cyo bilang "ini" merujuk keduanya bersamaan, bukan dua saklar
-- terpisah):
--   1. Gaji dinolkan untuk presensi masuk di luar shift_start..shift_end
--      atau hari Libur (isWithinScheduledWindow, src/staff-attendance.js).
--   2. Force-close otomatis sesi yang lupa ditutup 1 jam setelah shift_end
--      (forceCloseOverdueSessions, src/staff-attendance.js).
-- Off = kembali ke perilaku lama sebelum kedua fitur ini ada (semua presensi
-- dihitung penuh, tidak ada force-close). Per-gerai (bukan per-akun/per-
-- entity) karena Admin Gerai yang paling tahu kalau gerainya memang belum
-- siap pakai jadwal ketat (mis. belum sempat mengisi jadwal shift semua
-- kasirnya).
ALTER TABLE stores ADD COLUMN attendance_schedule_gate_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (attendance_schedule_gate_enabled IN (0, 1));
