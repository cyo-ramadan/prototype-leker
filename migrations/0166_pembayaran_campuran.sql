-- Pembayaran campuran (Bos Cyo, 2026-10-17): "kadang ada yang beli 12 ribu, qris 5000 cash 7000".
-- Penjualan campuran menyimpan sales.payment_method = 'CAMPURAN' dan rinciannya di tabel ini (satu baris
-- per cara bayar, jumlahnya = total penjualan). Penjualan lama/biasa TIDAK punya baris di sini dan tetap
-- dibaca dari sales.payment_method seperti sebelumnya -- tidak ada data lama yang diubah.
-- Pembaca rincian: jurnal (debit dipecah per akun cara bayar, src/accounting-pos-bridge.js), Rekening
-- Bersama (hanya bagian cara bayar yang bertanda Rekening Bersama), laci (hanya bagian CASH yang masuk
-- uang laci, src/drawer-report.js), dan QRIS (yang ditautkan bagian QRIS-nya).
CREATE TABLE IF NOT EXISTS sale_payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  payment_method_code TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (sale_id) REFERENCES sales(id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (sale_id, payment_method_code)
);

CREATE INDEX IF NOT EXISTS idx_sale_payments_store_method ON sale_payments(store_id, payment_method_code, sale_id);
