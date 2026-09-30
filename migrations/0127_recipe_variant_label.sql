-- Beberapa resep aktif untuk satu barang hasil (mis. Es Teh: resep larutan tawar
-- + larutan gula, atau resep larutan manis). Tiap varian punya label; label ''
-- = resep tunggal seperti sebelumnya, jadi semua resep yang sudah ada tidak
-- berubah dan TIDAK ADA backfill (ALTER ADD COLUMN dengan DEFAULT konstan tidak
-- menulis ulang baris). Tabel resep kecil, membangun ulang index-nya murah.
--
-- UNIQUE (store_id, output_product_id, revision) di tabel sengaja tidak disentuh
-- (mengubahnya butuh rebuild tabel). Varian baru mengambil nomor revision
-- berikutnya seperti biasa; revision hanya penghitung urutan.
ALTER TABLE manufacturing_recipes ADD COLUMN variant_label TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS idx_manufacturing_recipe_one_active_output;

CREATE UNIQUE INDEX IF NOT EXISTS idx_manufacturing_recipe_one_active_per_variant
  ON manufacturing_recipes(store_id, output_product_id, variant_label)
  WHERE status = 'ACTIVE';
