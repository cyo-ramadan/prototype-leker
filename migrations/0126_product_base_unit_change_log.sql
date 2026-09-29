PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-28: "Larutan Teh Poci Vanilla" di Mandala kepasang satuan
-- pcs padahal seharusnya ml, dan barangnya sudah punya stok/histori --
-- src/product-master.js validateBaseUnitChange() menahan ganti satuan begitu
-- barang punya resep/stok movement/saldo != 0 (biar HPP dan saldo tidak
-- ditafsir ulang diam-diam), tapi sampai sekarang tidak ada jalan resmi
-- buat Admin membenarkannya sendiri -- cuma pesan yang menunjuk ke "proses
-- terpisah" yang belum pernah dibangun.
--
-- Keputusan Bos Cyo: kasus salah-pasang-satuan itu murni salah label --
-- angka yang sudah kepencet (qty stok, harga pokok, takaran resep) memang
-- dimaksudkan dalam satuan yang benar sejak awal, jadi tidak ada rasio
-- konversi yang perlu dihitung. Perbaikannya cukup ganti label satuannya;
-- semua angka existing dibiarkan apa adanya. UX-nya: begitu Admin coba ganti
-- satuan barang yang sudah punya histori, sekali warning muncul menjelaskan
-- konsekuensinya, klik lanjut sekali lagi, selesai -- tanpa input rasio atau
-- form tambahan (lihat saveProductMaster/admin-product-policy.js).
--
-- Tabel ini murni jejak audit (bukan sumber saldo apa pun) supaya kalau ada
-- yang tanya belakangan "kok satuan barang ini beda dari histori awal",
-- ketahuan persis kapan dan siapa yang mengonfirmasi perubahannya -- pola
-- yang sama alasannya dengan kenapa posted journal tidak boleh ditimpa diam-
-- diam (invariant #2), diterapkan ke sisi Inventory/Master Barang.

CREATE TABLE product_base_unit_change_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id          TEXT NOT NULL,
  product_id        INTEGER NOT NULL,
  product_name      TEXT NOT NULL,
  from_unit_id      TEXT NOT NULL,
  to_unit_id        TEXT NOT NULL,
  had_recipe        INTEGER NOT NULL DEFAULT 0 CHECK (had_recipe IN (0, 1)),
  had_movement      INTEGER NOT NULL DEFAULT 0 CHECK (had_movement IN (0, 1)),
  stock_quantity_at_change INTEGER NOT NULL DEFAULT 0,
  changed_by_role   TEXT NOT NULL,
  changed_by_id     TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX idx_product_base_unit_change_log_product ON product_base_unit_change_log(store_id, product_id);
