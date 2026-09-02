PRAGMA foreign_keys = ON;

-- Import katalog barang gerai Pendem dari dua file yang Bos Cyo kasih
-- (DATA_BARANG.xlsx, RESEP_ES_TEH_POCI.xlsx), 2026-08-29. Permintaan: barang
-- masuk sekaligus, ga usah admin input satu-satu, dan yang punya resep
-- ke-link ke barang hasilnya biar bahan otomatis kepake pas ada penjualan
-- (lewat manufacturing_recipes -- mekanisme yang sama dipakai src/stock-production.js
-- buat motong stok bahan baku saat sale).
--
-- Bergantung pada store_pendem sudah ada (migration 0052, edition ACCOUNTING)
-- -- migration ini cuma boleh direplay di database yang store_pendem-nya
-- sudah diprovisikan duluan.
--
-- Keputusan yang Hana ambil sendiri karena datanya ga lengkap (izin Bos Cyo:
-- "kalo format tabelnya ga sesuai, ambilin manual aja, kalo belum ada
-- satuannya bikin aja"):
--
-- 1. HARGA JUAL = 0 buat semua barang. Ga ada kolom harga di file manapun.
--    Barang Bahan Baku/Barang Setengah Jadi memang ga dijual langsung (aman
--    harga 0), tapi 19 minuman jadi (Barang Jadi/Milktea/Fruity/Original)
--    HARUS diisi harga jualnya lewat Admin sebelum boleh dijual -- migration
--    ini cuma nyiapin data & resepnya, bukan nge-live-kan harga jual.
--
-- 2. SATUAN yang ga eksplisit ditebak dari kebiasaan dapur: bubuk rasa/barang
--    setengah jadi dihitung per pcs (samain kayak yang ADA di resep, mis.
--    "Bubuk Rasa Mangga, pcs"), teh daun (Teh Jasmine/Teh Vanilla) ditimbang
--    (gram), cairan (Air Mineral, Susu Kental Manis) di-ml-kan. Satuan
--    "Lembar" ga ada di 5 satuan bawaan (pcs/gram/kg/ml/liter) -- Lid Sealer
--    itu dijual per lembar, jadi satuan baru dibikin di sini.
--
-- 3. DUA bahan di resep ("Larutan Teh Poci Vanilla", "Larutan Gula") GA ADA
--    di DATA_BARANG.xlsx sama sekali. Ini keliatan jelas cairan olahan
--    (teh yang udah diseduh, gula yang udah dilarutkan) -- Barang Setengah
--    Jadi yang dibikin staf sebelum diracik, bukan bahan mentah yang dibeli
--    langsung. Ditambahkan sebagai Barang Setengah Jadi satuan ml, bukan
--    ditebak jadi Bahan Baku.
--
-- 4. stock_tracking_enabled = 0 buat SEMUA barang baru ini -- persis pola
--    yang migration 0017 pakai buat barang lama ("predates reliable opening-
--    stock history, keep sellable until Admin initializes stock"). Tanpa ini,
--    resep akan langsung ditolak jual karena stok bahan baku memang 0 belum
--    pernah di-purchase/opname. Admin nyalain per-barang kapan pun stok
--    awalnya sudah benar dicatat.
--
-- 4b. product_kind_id SEMUA barang baru diarahkan ke satu-satunya Jenis
--    Barang yang dijamin ada dari migration (RAW_MATERIAL/"Bahan Baku",
--    dibikin migration 0040) -- persis keputusan Bos Cyo 2026-08-19: "semua
--    barang diwakili satu Jenis Barang" sampai dipisah manual lewat Setting
--    Akuntansi kalau perlu. product_kinds kode FINISHED_GOOD/SEMI_FINISHED
--    memang ada di database production gerai Pendem, tapi itu dibuat lewat
--    Admin (bukan migration manapun) jadi tidak boleh diasumsikan ada di
--    semua environment -- test/sale-posting-config.test.js menjaga invarian
--    ini (setiap barang wajib punya product_kind_id, kalau tidak sale gagal
--    posting dengan NEEDS_PRODUCT_KIND). Klasifikasi Jenis Barang/item_type
--    (RAW_MATERIAL/SEMI_FINISHED/FINISHED_GOOD di kolom item_type_id) tetap
--    dipisah per barang seperti mestinya -- yang disamakan cuma akun
--    akuntansinya (product_kind_id), bukan sifat operasionalnya.
--
-- 5. Cuma 3 dari 19 minuman jadi yang punya resep di file ini (varian
--    "Es Teh Poci"/Original Vanilla, Mangga, Apel) -- sisanya cuma masuk
--    sebagai barang polos tanpa resep dulu, sesuai isi RESEP_ES_TEH_POCI.xlsx.
--
-- Additive murni, idempotent lewat WHERE NOT EXISTS di setiap INSERT --
-- aman dijalankan ulang.

-- 1) Satuan tambahan: Lembar (Lid Sealer dijual per lembar, bukan pcs/gram/ml/kg/liter).
INSERT INTO units (id, store_id, code, name, symbol, decimal_scale, is_active, created_at, updated_at)
SELECT 'unit_store_pendem_lembar', 'store_pendem', 'LEMBAR', 'Lembar', 'lbr', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM units WHERE store_id = 'store_pendem' AND code = 'LEMBAR');

-- 2) Kategori tampilan menu, persis nama "Kategori" di DATA_BARANG.xlsx.
INSERT INTO categories (store_id, name, display_order, is_active, created_at, updated_at)
SELECT 'store_pendem', name, ord, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT 'Milktea' AS name, 10 AS ord
  UNION ALL SELECT 'Milktea Fruity', 20
  UNION ALL SELECT 'Original', 30
  UNION ALL SELECT 'Fruity', 40
  UNION ALL SELECT 'Barang Jadi', 50
  UNION ALL SELECT 'Bahan Baku', 60
  UNION ALL SELECT 'Barang setengah jadi', 70
) cat
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE store_id = 'store_pendem' AND categories.name = cat.name);

-- 3) Barang -- 37 dari DATA_BARANG.xlsx + 2 barang setengah jadi yang cuma
-- muncul di resep (lihat poin 3 di atas). Harga jual 0 (lihat poin 1),
-- stock_tracking_enabled 0 (lihat poin 4).

-- 3a. Minuman jadi (FINISHED_GOOD, satuan pcs) -- 19 barang, harga jual masih 0.
INSERT INTO products (
  store_id, name, purchase_price, price, category, item_type_id, base_unit_id, product_kind_id,
  stock_tracking_enabled, is_active, created_at, updated_at
)
SELECT 'store_pendem', item.name, 0, 0, item.category,
  (SELECT id FROM item_types WHERE store_id = 'store_pendem' AND code = 'FINISHED_GOOD'),
  (SELECT id FROM units WHERE store_id = 'store_pendem' AND code = 'PCS'),
  (SELECT id FROM product_kinds WHERE store_id = 'store_pendem' AND code = 'RAW_MATERIAL'),
  0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT 'Es Teh Matcha Besar' AS name, 'Milktea' AS category
  UNION ALL SELECT 'Es Teh Milktea Lemon Honey Besar', 'Milktea Fruity'
  UNION ALL SELECT 'Es Teh Poci Jasmine', 'Original'
  UNION ALL SELECT 'Es MilkTea Leci Besar', 'Milktea Fruity'
  UNION ALL SELECT 'Es MilkTea Apel Besar', 'Milktea Fruity'
  UNION ALL SELECT 'Es MilkTea blackcurrant Besar', 'Milktea Fruity'
  UNION ALL SELECT 'Es MilkTea Orange Besar', 'Milktea Fruity'
  UNION ALL SELECT 'Es MilkTea Mangga Besar', 'Milktea Fruity'
  UNION ALL SELECT 'Es teh MilkTea Besar', 'Barang Jadi'
  UNION ALL SELECT 'Es Teh Thaitea Besar', 'Milktea'
  UNION ALL SELECT 'Es Teh Capucino Besar', 'Milktea'
  UNION ALL SELECT 'Es Teh Coklat Besar', 'Milktea'
  UNION ALL SELECT 'Es Teh Leci Besar', 'Fruity'
  UNION ALL SELECT 'Es Teh Apel Besar', 'Fruity'
  UNION ALL SELECT 'Es Teh Lemon Honey Besar', 'Fruity'
  UNION ALL SELECT 'Es Teh Black curent Besar', 'Fruity'
  UNION ALL SELECT 'Es Teh Orange Besar', 'Fruity'
  UNION ALL SELECT 'Es Teh Mangga Besar', 'Fruity'
  UNION ALL SELECT 'Es Teh Poci Original Vanilla Besar', 'Original'
) item
WHERE NOT EXISTS (SELECT 1 FROM products WHERE store_id = 'store_pendem' AND products.name = item.name);

-- 3b. Bahan baku dihitung pcs (bubuk rasa) -- 11 barang.
INSERT INTO products (
  store_id, name, purchase_price, price, category, item_type_id, base_unit_id, product_kind_id,
  stock_tracking_enabled, is_active, created_at, updated_at
)
SELECT 'store_pendem', item.name, 0, 0, 'Bahan Baku',
  (SELECT id FROM item_types WHERE store_id = 'store_pendem' AND code = 'RAW_MATERIAL'),
  (SELECT id FROM units WHERE store_id = 'store_pendem' AND code = 'PCS'),
  (SELECT id FROM product_kinds WHERE store_id = 'store_pendem' AND code = 'RAW_MATERIAL'),
  0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT 'Bubuk Rasa Milktea' AS name
  UNION ALL SELECT 'Bubuk Rasa Thaitea'
  UNION ALL SELECT 'Bubuk Rasa Capucino'
  UNION ALL SELECT 'Bubuk Rasa Coklat'
  UNION ALL SELECT 'Bubuk Rasa Black Curent'
  UNION ALL SELECT 'Bubuk Rasa Lemon Honey'
  UNION ALL SELECT 'Bubuk Rasa Leci'
  UNION ALL SELECT 'Bubuk Rasa Guava'
  UNION ALL SELECT 'Bubuk Rasa Orange'
  UNION ALL SELECT 'Bubuk Rasa Apel'
  UNION ALL SELECT 'Bubuk Rasa Mangga'
) item
WHERE NOT EXISTS (SELECT 1 FROM products WHERE store_id = 'store_pendem' AND products.name = item.name);

-- 3c. Bahan baku ditimbang (gram) -- daun teh.
INSERT INTO products (
  store_id, name, purchase_price, price, category, item_type_id, base_unit_id, product_kind_id,
  stock_tracking_enabled, is_active, created_at, updated_at
)
SELECT 'store_pendem', item.name, 0, 0, 'Bahan Baku',
  (SELECT id FROM item_types WHERE store_id = 'store_pendem' AND code = 'RAW_MATERIAL'),
  (SELECT id FROM units WHERE store_id = 'store_pendem' AND code = 'GRAM'),
  (SELECT id FROM product_kinds WHERE store_id = 'store_pendem' AND code = 'RAW_MATERIAL'),
  0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT 'Teh Jasmine' AS name
  UNION ALL SELECT 'Teh Vanilla'
) item
WHERE NOT EXISTS (SELECT 1 FROM products WHERE store_id = 'store_pendem' AND products.name = item.name);

-- 3d. Bahan baku cair (ml).
INSERT INTO products (
  store_id, name, purchase_price, price, category, item_type_id, base_unit_id, product_kind_id,
  stock_tracking_enabled, is_active, created_at, updated_at
)
SELECT 'store_pendem', item.name, 0, 0, 'Bahan Baku',
  (SELECT id FROM item_types WHERE store_id = 'store_pendem' AND code = 'RAW_MATERIAL'),
  (SELECT id FROM units WHERE store_id = 'store_pendem' AND code = 'ML'),
  (SELECT id FROM product_kinds WHERE store_id = 'store_pendem' AND code = 'RAW_MATERIAL'),
  0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT 'Air Mineral' AS name
  UNION ALL SELECT 'Susu Kental Manis'
) item
WHERE NOT EXISTS (SELECT 1 FROM products WHERE store_id = 'store_pendem' AND products.name = item.name);

-- 3e. Barang setengah jadi pcs (kemasan) -- Cup Poci, Sedotan.
INSERT INTO products (
  store_id, name, purchase_price, price, category, item_type_id, base_unit_id, product_kind_id,
  stock_tracking_enabled, is_active, created_at, updated_at
)
SELECT 'store_pendem', item.name, 0, 0, 'Barang setengah jadi',
  (SELECT id FROM item_types WHERE store_id = 'store_pendem' AND code = 'SEMI_FINISHED'),
  (SELECT id FROM units WHERE store_id = 'store_pendem' AND code = 'PCS'),
  (SELECT id FROM product_kinds WHERE store_id = 'store_pendem' AND code = 'RAW_MATERIAL'),
  0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT 'Cup Poci 160z' AS name
  UNION ALL SELECT 'Sedotan'
) item
WHERE NOT EXISTS (SELECT 1 FROM products WHERE store_id = 'store_pendem' AND products.name = item.name);

-- 3f. Lid Sealer -- satuan Lembar, bukan pcs (lihat poin 2).
INSERT INTO products (
  store_id, name, purchase_price, price, category, item_type_id, base_unit_id, product_kind_id,
  stock_tracking_enabled, is_active, created_at, updated_at
)
SELECT 'store_pendem', 'Lid Sealer', 0, 0, 'Barang setengah jadi',
  (SELECT id FROM item_types WHERE store_id = 'store_pendem' AND code = 'SEMI_FINISHED'),
  (SELECT id FROM units WHERE store_id = 'store_pendem' AND code = 'LEMBAR'),
  (SELECT id FROM product_kinds WHERE store_id = 'store_pendem' AND code = 'RAW_MATERIAL'),
  0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE store_id = 'store_pendem' AND name = 'Lid Sealer');

-- 3g. Larutan yang cuma muncul di resep, ga ada di DATA_BARANG.xlsx (poin 3) --
-- barang setengah jadi cair, satuan ml.
INSERT INTO products (
  store_id, name, purchase_price, price, category, item_type_id, base_unit_id, product_kind_id,
  stock_tracking_enabled, is_active, created_at, updated_at
)
SELECT 'store_pendem', item.name, 0, 0, 'Barang setengah jadi',
  (SELECT id FROM item_types WHERE store_id = 'store_pendem' AND code = 'SEMI_FINISHED'),
  (SELECT id FROM units WHERE store_id = 'store_pendem' AND code = 'ML'),
  (SELECT id FROM product_kinds WHERE store_id = 'store_pendem' AND code = 'RAW_MATERIAL'),
  0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT 'Larutan Teh Poci Vanilla' AS name
  UNION ALL SELECT 'Larutan Gula'
) item
WHERE NOT EXISTS (SELECT 1 FROM products WHERE store_id = 'store_pendem' AND products.name = item.name);

-- 4) Resep -- 3 varian dari RESEP_ES_TEH_POCI.xlsx. Tiap resep: 1 baris
-- manufacturing_recipes (barang hasil, qty 1 pcs per batch) + baris
-- manufacturing_recipe_components (bahan-bahannya, qty sesuai file).
-- output_unit_id/component_unit_id WAJIB sama dengan base_unit_id barangnya
-- masing-masing (dijaga trg_manufacturing_recipe_scope/trg_manufacturing_component_scope),
-- makanya diambil dari products.base_unit_id langsung, bukan ditulis ulang.

-- 4a. Es Teh Poci Original Vanilla Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_teh_poci_original_vanilla_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 8)', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es Teh Poci Original Vanilla Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_poci_ov_' || REPLACE(LOWER(item.name), ' ', '_'),
  'recipe_store_pendem_es_teh_poci_original_vanilla_v1', 'store_pendem', p.id, p.base_unit_id, item.qty, item.ord
FROM (
  SELECT 'Larutan Teh Poci Vanilla' AS name, 237 AS qty, 1 AS ord
  UNION ALL SELECT 'Cup Poci 160z', 1, 2
  UNION ALL SELECT 'Sedotan', 1, 3
  UNION ALL SELECT 'Lid Sealer', 1, 4
  UNION ALL SELECT 'Larutan Gula', 57, 5
) item
JOIN products p ON p.store_id = 'store_pendem' AND p.name = item.name
WHERE EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_poci_original_vanilla_v1')
  AND NOT EXISTS (
    SELECT 1 FROM manufacturing_recipe_components
    WHERE recipe_id = 'recipe_store_pendem_es_teh_poci_original_vanilla_v1' AND component_product_id = p.id
  );

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_teh_poci_original_vanilla_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es Teh Poci Original Vanilla Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_teh_poci_original_vanilla_v1');

-- 4b. Es Teh Mangga Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_teh_mangga_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 9)', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es Teh Mangga Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_mangga_' || REPLACE(LOWER(item.name), ' ', '_'),
  'recipe_store_pendem_es_teh_mangga_v1', 'store_pendem', p.id, p.base_unit_id, item.qty, item.ord
FROM (
  SELECT 'Larutan Teh Poci Vanilla' AS name, 237 AS qty, 1 AS ord
  UNION ALL SELECT 'Cup Poci 160z', 1, 2
  UNION ALL SELECT 'Bubuk Rasa Mangga', 1, 3
  UNION ALL SELECT 'Sedotan', 1, 4
  UNION ALL SELECT 'Lid Sealer', 1, 5
  UNION ALL SELECT 'Larutan Gula', 57, 6
) item
JOIN products p ON p.store_id = 'store_pendem' AND p.name = item.name
WHERE EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_mangga_v1')
  AND NOT EXISTS (
    SELECT 1 FROM manufacturing_recipe_components
    WHERE recipe_id = 'recipe_store_pendem_es_teh_mangga_v1' AND component_product_id = p.id
  );

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_teh_mangga_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es Teh Mangga Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_teh_mangga_v1');

-- 4c. Es Teh Apel Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_teh_apel_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 10)', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es Teh Apel Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_apel_' || REPLACE(LOWER(item.name), ' ', '_'),
  'recipe_store_pendem_es_teh_apel_v1', 'store_pendem', p.id, p.base_unit_id, item.qty, item.ord
FROM (
  SELECT 'Larutan Teh Poci Vanilla' AS name, 237 AS qty, 1 AS ord
  UNION ALL SELECT 'Bubuk Rasa Apel', 1, 2
  UNION ALL SELECT 'Cup Poci 160z', 1, 3
  UNION ALL SELECT 'Sedotan', 1, 4
  UNION ALL SELECT 'Lid Sealer', 1, 5
  UNION ALL SELECT 'Larutan Gula', 57, 6
) item
JOIN products p ON p.store_id = 'store_pendem' AND p.name = item.name
WHERE EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_apel_v1')
  AND NOT EXISTS (
    SELECT 1 FROM manufacturing_recipe_components
    WHERE recipe_id = 'recipe_store_pendem_es_teh_apel_v1' AND component_product_id = p.id
  );

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_teh_apel_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es Teh Apel Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_teh_apel_v1');
