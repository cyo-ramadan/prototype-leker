-- Tahap 2 varian resep: kasir memilih resep aktif saat Penjualan Dadakan.
--
-- has_recipe_variants: penanda kecil di barang supaya daftar menu kasir hanya
-- mencari varian untuk barang yang memang punya lebih dari satu resep aktif
-- (query varian jadi lookup ber-index, bukan scan semua resep tiap menu dibuka).
-- Default 0 = perilaku lama. Backfill hanya menyentuh barang yang SUDAH punya
-- lebih dari satu resep aktif (admin bisa saja sudah membuatnya sejak 0127).
ALTER TABLE products ADD COLUMN has_recipe_variants INTEGER NOT NULL DEFAULT 0;

UPDATE products
SET has_recipe_variants = 1
WHERE id IN (
  SELECT output_product_id
  FROM manufacturing_recipes
  WHERE status = 'ACTIVE'
  GROUP BY store_id, output_product_id
  HAVING COUNT(*) > 1
);

-- Jejak siapa mengganti resep aktif barang, kapan, dan dari Penjualan mana.
-- Bukan ledger keuangan; hanya fakta operasional gerai.
CREATE TABLE IF NOT EXISTS product_recipe_switch_log (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  from_recipe_id TEXT,
  to_recipe_id TEXT NOT NULL,
  actor_role TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL DEFAULT '',
  sale_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (to_recipe_id) REFERENCES manufacturing_recipes(id)
);

CREATE INDEX IF NOT EXISTS idx_product_recipe_switch_log_product
  ON product_recipe_switch_log(store_id, product_id, created_at DESC);
