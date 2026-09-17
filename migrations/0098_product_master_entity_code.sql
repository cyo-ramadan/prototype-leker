PRAGMA foreign_keys = ON;

-- Master Barang Entity (Kode Barang) -- ADR-043, keputusan final Bos Cyo
-- 2026-09-17: "yang punya entity itu kode barang aja, kalo nama barang
-- boleh diganti tiap store" -- perbandingan itu khusus antara Kode Barang
-- vs Nama (Kode = Entity, Nama = Store). Foto TETAP Entity (diklarifikasi
-- Bos Cyo langsung setelahnya): "oh engga, foto tetap entity ... itu entity
-- punya kodenya, sedangkan store [punya nama] barang."
--
-- product_masters -- satu baris per Kode Barang, milik Entity: kode + foto
-- + label nama internal (buat identifikasi manusia/agen saja, mis. saat
-- upload banyak foto sekaligus -- BUKAN nama yang tampil ke pelanggan/kasir,
-- itu selalu products.name milik gerai masing-masing, bebas beda-beda).
-- Harga, status, promo, average_cost/HPP TETAP murni milik Store di tabel
-- products yang sudah ada -- tabel ini sengaja TIDAK punya kolom price sama
-- sekali, supaya tidak ada yang tergoda menganggap field itu ikut di-share.
--
-- product_master_recipe_components -- resep ACUAN/referensi yang nempel
-- ke Kode Barang. Sengaja TIDAK di-FK ke item lokal gerai mana pun
-- (item_types/units/manufacturing_recipes tetap store-scoped, keputusan
-- eksplisit ADR-043 fase ini) -- ini cuma panduan teks bebas ("bahan apa,
-- takaran berapa"), bukan struktur yang dieksekusi. Resep yang benar-benar
-- motong stok tetap manufacturing_recipes + products.linked_recipe_id
-- milik masing-masing gerai, tidak disentuh migration ini. Karena acuan
-- ini murni referensi (bukan pengikat produksi/keuangan), mengedit isinya
-- aman di-UPDATE in-place -- tidak ada gerai yang produksinya berubah
-- gara-gara acuan direvisi, jadi tidak perlu mekanisme fork/versi seperti
-- draft ADR-043 sebelumnya.
CREATE TABLE IF NOT EXISTS product_masters (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  code TEXT NOT NULL,
  -- Label internal buat IDENTIFIKASI SAJA (Bos Cyo: mis. supaya agen yang
  -- upload banyak foto sekaligus bisa mencocokkan barang lewat nama, bukan
  -- kode yang opaque). BUKAN nama yang tampil ke pelanggan/kasir -- itu
  -- selalu products.name milik masing-masing gerai, bebas beda-beda.
  name TEXT NOT NULL DEFAULT '',
  image_data TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL DEFAULT '' CHECK (created_by_role IN ('', 'OWNER', 'ENTITY_ADMIN', 'ADMIN', 'LEGACY_PIN')),
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  UNIQUE (entity_id, code)
);

CREATE INDEX IF NOT EXISTS idx_product_masters_entity ON product_masters(entity_id, code);

CREATE TABLE IF NOT EXISTS product_master_recipe_components (
  id TEXT PRIMARY KEY,
  product_master_id TEXT NOT NULL,
  ingredient_label TEXT NOT NULL,
  quantity_label TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_master_id) REFERENCES product_masters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_master_recipe_components_master
  ON product_master_recipe_components(product_master_id, sort_order);

-- products dapat jangkar ke Kode Barang miliknya. Nullable dan additive,
-- pola persis stores.entity_id di migration 0039 -- tidak ada baris
-- products yang sudah ada berubah makna sama sekali.
ALTER TABLE products ADD COLUMN product_master_id TEXT REFERENCES product_masters(id);

CREATE INDEX IF NOT EXISTS idx_products_product_master ON products(product_master_id);

-- Sengaja TIDAK ada backfill Kode Barang untuk produk yang sudah ada.
-- Kode Barang cuma relevan begitu ada gerai lain yang benar-benar mau
-- pakai barang yang sama -- men-generate kode+baris product_masters untuk
-- ratusan produk existing yang belum tentu diminta siapa pun cuma bikin
-- katalog Entity penuh entri yang tidak berguna. product_master_id tetap
-- NULL untuk semua produk lama; Kode Barang dibuat sesuai kebutuhan lewat
-- endpoint aplikasi (Admin Gerai yang sadar memilih "bagikan barang ini"),
-- bukan oleh migration ini.
