PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-24: "dibuat juga ya, ketika satu jam setelah waktu
-- presensi pulang dia belum absen maka langsung force close tanpa foto dan
-- gps, dan kartu presensi hari itu juga jadi warna kuning. di raport nanti
-- juga ada catatan tidak tutup presensi berapa kali gt." Dibedakan eksplisit
-- dari alur permit laci ("kalo laci gpp permit, karna memang akan dipakai cs
-- lain") -- presensi urusannya cuma dengan CS bersangkutan sendiri, jadi
-- LANGSUNG force-close, tanpa alur pengajuan/ACC apa pun.
--
-- auto_closed menandai baris yang ditutup SISTEM (bukan kasirnya sendiri
-- lewat tombol Presensi Pulang) -- dipakai UI buat kartu kuning dan Raport
-- buat menghitung berapa kali. 0/1, bukan timestamp terpisah, karena
-- check_out_at yang sudah ada sudah cukup buat tahu KAPAN ditutup.
ALTER TABLE staff_attendance ADD COLUMN auto_closed INTEGER NOT NULL DEFAULT 0 CHECK (auto_closed IN (0, 1));
