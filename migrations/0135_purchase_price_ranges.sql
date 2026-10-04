-- Rentang harga beli wajar per barang (Bos Cyo, 2026-10-04): "buatkan juga agar dia
-- mengentry range harga beli yang diperbolehkan, untuk barang2 sekarang ambil nilai
-- benernya lalu berikan nilai 25% selisihnya."
--
-- Pembelian kasir yang harga per satuannya (total baris / qty) di luar rentang ditolak
-- dengan pesan jelas -- penyebab HPP kacau selama ini adalah salah ketik qty/harga
-- (1 pcs untuk 1 kg gula, titik/koma tertukar). Barang tanpa baris di sini tidak dibatasi.
--
-- Angka uang = integer skala 1.000.000 per satuan dasar barang (invariant #1).
-- Tabel baru (bukan kolom di products) supaya pembelian tetap jalan seandainya tabel
-- ini belum ada: pembacanya menganggap "tanpa rentang".
CREATE TABLE IF NOT EXISTS product_purchase_price_ranges (
  store_id TEXT NOT NULL REFERENCES stores(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  min_unit_cost_scaled INTEGER NOT NULL CHECK (min_unit_cost_scaled > 0),
  max_unit_cost_scaled INTEGER NOT NULL CHECK (max_unit_cost_scaled >= min_unit_cost_scaled),
  basis_unit_cost_scaled INTEGER CHECK (basis_unit_cost_scaled IS NULL OR basis_unit_cost_scaled > 0),
  updated_by_role TEXT NOT NULL DEFAULT '',
  updated_by_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (store_id, product_id)
);
