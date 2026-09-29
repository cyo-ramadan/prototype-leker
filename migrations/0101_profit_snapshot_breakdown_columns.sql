PRAGMA foreign_keys = ON;

-- Rincian Laporan Untung Rugi Admin Gerai -- Bos Cyo, 2026-09-17: format
-- ringkasan lama (satu angka "Modal", satu angka "Biaya & bea", satu angka
-- net Penyesuaian Stok) dianggap "ga jelas". Diminta pakai variabel yang
-- sudah dia sebutkan sendiri: Omset, Pendapatan Lain, HPP -> Untung Kotor,
-- lalu Penyesuaian Stok sebagai DUA kolom terpisah (+ dan -), dan Beban/Bea
-- dirinci per kategori (Gaji, Lapak, Lainnya) -- bukan dilebur jadi satu
-- angka "Biaya & bea yang dikeluarkan".
--
-- Kolom `expense` (sudah ada sejak 0099) SEKARANG BERUBAH ARTI: dulu berarti
-- "total Beban Operasional" (Pengeluaran Kasir + seluruh Bea Admin
-- dijumlah), sekarang berarti KHUSUS Pengeluaran Kasir (tabel `expenses`)
-- saja -- tiga kategori Bea Admin (migration 0100) sekarang punya kolomnya
-- sendiri-sendiri di bawah ini. Total Beban yang sesungguhnya dipakai
-- Net Profit tetap penjumlahan keempatnya, dihitung di src/net-profit-report.js,
-- bukan disimpan sebagai kolom terpisah.
--
-- Tabel ini murni CACHE/derived data (lihat 0099) -- aman ditulis ulang.
-- Karena arti kolom `expense` berubah, baris yang SUDAH kepalang ke-cache
-- sebelum migration ini akan salah dibaca (isinya gabungan lama, kolom Bea
-- baru bakal kebaca 0) kalau dibiarkan -- jadi TRUNCATE sekalian supaya
-- semua baris dihitung ulang dengan arti kolom yang baru dan benar,
-- bukan setengah-setengah. Aman: sumber kebenarannya tetap tabel
-- sales/sale_items/expenses/other_income/admin_operational_expenses/
-- approval_requests, tidak ada data yang hilang.
ALTER TABLE store_daily_profit_snapshot ADD COLUMN stock_adjustment_gain INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_daily_profit_snapshot ADD COLUMN stock_adjustment_loss INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_daily_profit_snapshot ADD COLUMN bea_gaji INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_daily_profit_snapshot ADD COLUMN bea_lapak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_daily_profit_snapshot ADD COLUMN bea_lainnya INTEGER NOT NULL DEFAULT 0;

DELETE FROM store_daily_profit_snapshot;
