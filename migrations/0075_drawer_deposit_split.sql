PRAGMA foreign_keys = ON;

-- 2026-09-06, Bos Cyo: saat tutup laci, CS pisahkan berapa yang DITITIPKAN ke
-- laci (lanjut jadi modal buka laci shift berikutnya, PERSIS seperti
-- closing_amount hari ini) dari sisanya yang jadi SETORAN. Kolom baru ini
-- cuma menyimpan porsi setoran; opening_amount shift berikutnya dihitung di
-- src/cashier-drawer.js sebagai (closing_amount - deposit_amount), bukan lagi
-- closing_amount penuh.
--
-- Fakta piutangnya sendiri TIDAK disimpan di sini -- itu masuk ke
-- operational_receivables_payables (migration 0074, source_type
-- EMPLOYEE_DEPOSIT) yang memang sudah schema-ready untuk kasus ini, supaya
-- tidak ada tabel piutang kedua yang paralel.
ALTER TABLE cash_drawer_sessions ADD COLUMN deposit_amount INTEGER NOT NULL DEFAULT 0;
