PRAGMA foreign_keys = ON;

-- 2026-09-04, Bos Cyo: Detail Laci sudah menampilkan keterangan tutup laci
-- (closing_note) tapi belum ada tempat buat keterangan BUKA laci -- kasir
-- yang buka laci sekarang bisa isi catatan opsional (mis. kondisi awal shift)
-- yang tersimpan di baris laci yang sama, sejajar dengan closing_note.
ALTER TABLE cash_drawer_sessions ADD COLUMN opening_note TEXT NOT NULL DEFAULT '';
