PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-19: "settingan gaji itu ditambahin juga ya jenis
-- pembayarannya bisa per sesi bisa per jam jadi nanti dibuat model dropdown".
-- Menempel ke account_job_details (migration 0104) -- gaji tetap sifat
-- jabatan/akun, bukan sifat orang, jadi jenis pembayarannya juga di sana.
--
-- 'JAM' (default): hourly_wage_scaled adalah tarif per jam, dikalikan durasi
-- kerja (check_out_at - created_at) saat menghitung Riwayat Gaji.
-- 'SESI': hourly_wage_scaled dipakai sebagai nominal FLAT per sesi presensi
-- yang selesai (CLOSED), berapa pun lama kerjanya. Nama kolomnya tetap
-- hourly_wage_scaled (tidak di-rename) supaya tidak mengubah kontrak PATCH
-- yang sudah ada dari migration 0104 -- UI Master Kasir yang mengubah label
-- tampilannya sesuai dropdown ini.
ALTER TABLE account_job_details ADD COLUMN payment_type TEXT NOT NULL DEFAULT 'JAM' CHECK (payment_type IN ('JAM', 'SESI'));
