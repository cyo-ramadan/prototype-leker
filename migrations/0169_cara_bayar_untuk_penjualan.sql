-- Cara bayar per jenis transaksi (Bos Cyo, 2026-10-18): "untuk sekarang non aktifkan pembayaran penjualan
-- memakai rekber di semua gerai (hanya penjualan saja)". CS memakai Rekening Bersama untuk pembeli QRIS,
-- sehingga uang QRIS tidak pernah tertaut. allow_sale = 0: cara bayar tidak muncul & ditolak di penjualan,
-- tetapi tetap bisa dipakai untuk pembelian/pengeluaran. Penjualan lama tidak diubah.
ALTER TABLE payment_methods ADD COLUMN allow_sale INTEGER NOT NULL DEFAULT 1 CHECK (allow_sale IN (0, 1));
UPDATE payment_methods SET allow_sale = 0 WHERE code = 'REKBER';
