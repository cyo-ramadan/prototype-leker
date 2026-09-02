PRAGMA foreign_keys = ON;

-- Susulan migration 0056: Hana cuma menangkap 3 dari 19 resep yang sebenarnya
-- ada di RESEP_ES_TEH_POCI.xlsx (ID resep 8, 9, 10), sehingga 16 minuman jadi
-- lainnya sempat masuk sebagai barang polos tanpa resep. Ditemukan Bos Cyo
-- 2026-08-31, dibaca ulang penuh (343 baris, bukan cuma beberapa baris awal).
--
-- Dua bahan yang muncul di file resep ini tapi TIDAK ada di DATA_BARANG.xlsx
-- (pola yang sama seperti "Larutan Teh Poci Vanilla"/"Larutan Gula" di migration
-- 0056 -- cairan/bubuk olahan yang jelas dibutuhkan resep):
--   - "Bubuk Rasa Matcha" (dipakai resep ID 70, Es Teh Matcha Besar) -- Bahan
--     Baku pcs, konsisten sama 11 Bubuk Rasa lain.
--   - "Larutan Teh Poci Jasmine" (dipakai resep ID 28, Es Teh Poci Jasmine) --
--     Barang Setengah Jadi ml, larutan teh berbeda dari Larutan Teh Poci
--     Vanilla (dari Teh Jasmine, bukan Teh Vanilla).
--
-- Bergantung pada store_pendem dan barang migration 0056 sudah ada (migration
-- 0052, edition ACCOUNTING) -- migration ini cuma boleh direplay di database
-- yang keduanya sudah diprovisikan duluan.
--
-- Additive murni, idempotent lewat WHERE NOT EXISTS -- aman dijalankan ulang.

-- 1) Dua bahan baru yang ketinggalan.
INSERT INTO products (
  store_id, name, purchase_price, price, category, item_type_id, base_unit_id, product_kind_id,
  stock_tracking_enabled, is_active, created_at, updated_at
)
SELECT 'store_pendem', 'Bubuk Rasa Matcha', 0, 0, 'Bahan Baku',
  (SELECT id FROM item_types WHERE store_id = 'store_pendem' AND code = 'RAW_MATERIAL'),
  (SELECT id FROM units WHERE store_id = 'store_pendem' AND code = 'PCS'),
  (SELECT id FROM product_kinds WHERE store_id = 'store_pendem' AND code = 'RAW_MATERIAL'),
  0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE store_id = 'store_pendem' AND name = 'Bubuk Rasa Matcha');

INSERT INTO products (
  store_id, name, purchase_price, price, category, item_type_id, base_unit_id, product_kind_id,
  stock_tracking_enabled, is_active, created_at, updated_at
)
SELECT 'store_pendem', 'Larutan Teh Poci Jasmine', 0, 0, 'Barang setengah jadi',
  (SELECT id FROM item_types WHERE store_id = 'store_pendem' AND code = 'SEMI_FINISHED'),
  (SELECT id FROM units WHERE store_id = 'store_pendem' AND code = 'ML'),
  (SELECT id FROM product_kinds WHERE store_id = 'store_pendem' AND code = 'RAW_MATERIAL'),
  0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE store_id = 'store_pendem' AND name = 'Larutan Teh Poci Jasmine');

-- 2) 16 resep yang ketinggalan dari RESEP_ES_TEH_POCI.xlsx.
-- ID resep sumber: 11 -- Es Teh Orange Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_teh_orange_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 11) -- susulan migration 0056', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es Teh Orange Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_orange_larutan_teh_poci_vanilla', 'recipe_store_pendem_es_teh_orange_v1', 'store_pendem', p.id, p.base_unit_id, 237, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Vanilla'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_orange_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_orange_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_orange_bubuk_rasa_orange', 'recipe_store_pendem_es_teh_orange_v1', 'store_pendem', p.id, p.base_unit_id, 1, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Bubuk Rasa Orange'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_orange_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_orange_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_orange_cup_poci_160z', 'recipe_store_pendem_es_teh_orange_v1', 'store_pendem', p.id, p.base_unit_id, 1, 3
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Cup Poci 160z'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_orange_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_orange_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_orange_sedotan', 'recipe_store_pendem_es_teh_orange_v1', 'store_pendem', p.id, p.base_unit_id, 1, 4
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Sedotan'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_orange_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_orange_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_orange_lid_sealer', 'recipe_store_pendem_es_teh_orange_v1', 'store_pendem', p.id, p.base_unit_id, 1, 5
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Lid Sealer'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_orange_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_orange_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_orange_larutan_gula', 'recipe_store_pendem_es_teh_orange_v1', 'store_pendem', p.id, p.base_unit_id, 57, 6
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_orange_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_orange_v1' AND component_product_id = p.id);

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_teh_orange_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es Teh Orange Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_teh_orange_v1');

-- ID resep sumber: 12 -- Es Teh Black curent Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_teh_black_curent_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 12) -- susulan migration 0056', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es Teh Black curent Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_black_curent_larutan_teh_poci_vanilla', 'recipe_store_pendem_es_teh_black_curent_v1', 'store_pendem', p.id, p.base_unit_id, 237, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Vanilla'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_black_curent_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_black_curent_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_black_curent_bubuk_rasa_black_curent', 'recipe_store_pendem_es_teh_black_curent_v1', 'store_pendem', p.id, p.base_unit_id, 1, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Bubuk Rasa Black Curent'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_black_curent_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_black_curent_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_black_curent_cup_poci_160z', 'recipe_store_pendem_es_teh_black_curent_v1', 'store_pendem', p.id, p.base_unit_id, 1, 3
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Cup Poci 160z'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_black_curent_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_black_curent_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_black_curent_sedotan', 'recipe_store_pendem_es_teh_black_curent_v1', 'store_pendem', p.id, p.base_unit_id, 1, 4
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Sedotan'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_black_curent_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_black_curent_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_black_curent_lid_sealer', 'recipe_store_pendem_es_teh_black_curent_v1', 'store_pendem', p.id, p.base_unit_id, 1, 5
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Lid Sealer'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_black_curent_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_black_curent_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_black_curent_larutan_gula', 'recipe_store_pendem_es_teh_black_curent_v1', 'store_pendem', p.id, p.base_unit_id, 57, 6
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_black_curent_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_black_curent_v1' AND component_product_id = p.id);

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_teh_black_curent_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es Teh Black curent Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_teh_black_curent_v1');

-- ID resep sumber: 13 -- Es Teh Leci Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_teh_leci_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 13) -- susulan migration 0056', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es Teh Leci Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_leci_larutan_teh_poci_vanilla', 'recipe_store_pendem_es_teh_leci_v1', 'store_pendem', p.id, p.base_unit_id, 237, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Vanilla'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_leci_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_leci_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_leci_bubuk_rasa_leci', 'recipe_store_pendem_es_teh_leci_v1', 'store_pendem', p.id, p.base_unit_id, 1, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Bubuk Rasa Leci'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_leci_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_leci_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_leci_cup_poci_160z', 'recipe_store_pendem_es_teh_leci_v1', 'store_pendem', p.id, p.base_unit_id, 1, 3
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Cup Poci 160z'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_leci_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_leci_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_leci_sedotan', 'recipe_store_pendem_es_teh_leci_v1', 'store_pendem', p.id, p.base_unit_id, 1, 4
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Sedotan'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_leci_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_leci_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_leci_lid_sealer', 'recipe_store_pendem_es_teh_leci_v1', 'store_pendem', p.id, p.base_unit_id, 1, 5
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Lid Sealer'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_leci_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_leci_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_leci_larutan_gula', 'recipe_store_pendem_es_teh_leci_v1', 'store_pendem', p.id, p.base_unit_id, 57, 6
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_leci_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_leci_v1' AND component_product_id = p.id);

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_teh_leci_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es Teh Leci Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_teh_leci_v1');

-- ID resep sumber: 14 -- Es Teh Lemon Honey Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_teh_lemon_honey_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 14) -- susulan migration 0056', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es Teh Lemon Honey Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_lemon_honey_larutan_teh_poci_vanilla', 'recipe_store_pendem_es_teh_lemon_honey_v1', 'store_pendem', p.id, p.base_unit_id, 237, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Vanilla'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_lemon_honey_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_lemon_honey_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_lemon_honey_bubuk_rasa_lemon_honey', 'recipe_store_pendem_es_teh_lemon_honey_v1', 'store_pendem', p.id, p.base_unit_id, 1, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Bubuk Rasa Lemon Honey'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_lemon_honey_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_lemon_honey_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_lemon_honey_cup_poci_160z', 'recipe_store_pendem_es_teh_lemon_honey_v1', 'store_pendem', p.id, p.base_unit_id, 1, 3
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Cup Poci 160z'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_lemon_honey_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_lemon_honey_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_lemon_honey_sedotan', 'recipe_store_pendem_es_teh_lemon_honey_v1', 'store_pendem', p.id, p.base_unit_id, 1, 4
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Sedotan'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_lemon_honey_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_lemon_honey_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_lemon_honey_lid_sealer', 'recipe_store_pendem_es_teh_lemon_honey_v1', 'store_pendem', p.id, p.base_unit_id, 1, 5
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Lid Sealer'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_lemon_honey_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_lemon_honey_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_lemon_honey_larutan_gula', 'recipe_store_pendem_es_teh_lemon_honey_v1', 'store_pendem', p.id, p.base_unit_id, 57, 6
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_lemon_honey_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_lemon_honey_v1' AND component_product_id = p.id);

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_teh_lemon_honey_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es Teh Lemon Honey Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_teh_lemon_honey_v1');

-- ID resep sumber: 16 -- Es Teh Coklat Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_teh_coklat_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 16) -- susulan migration 0056', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es Teh Coklat Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_coklat_larutan_teh_poci_vanilla', 'recipe_store_pendem_es_teh_coklat_v1', 'store_pendem', p.id, p.base_unit_id, 237, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Vanilla'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_coklat_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_coklat_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_coklat_susu_kental_manis', 'recipe_store_pendem_es_teh_coklat_v1', 'store_pendem', p.id, p.base_unit_id, 1, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Susu Kental Manis'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_coklat_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_coklat_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_coklat_cup_poci_160z', 'recipe_store_pendem_es_teh_coklat_v1', 'store_pendem', p.id, p.base_unit_id, 1, 3
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Cup Poci 160z'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_coklat_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_coklat_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_coklat_bubuk_rasa_coklat', 'recipe_store_pendem_es_teh_coklat_v1', 'store_pendem', p.id, p.base_unit_id, 1, 4
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Bubuk Rasa Coklat'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_coklat_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_coklat_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_coklat_sedotan', 'recipe_store_pendem_es_teh_coklat_v1', 'store_pendem', p.id, p.base_unit_id, 1, 5
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Sedotan'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_coklat_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_coklat_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_coklat_lid_sealer', 'recipe_store_pendem_es_teh_coklat_v1', 'store_pendem', p.id, p.base_unit_id, 1, 6
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Lid Sealer'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_coklat_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_coklat_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_coklat_larutan_gula', 'recipe_store_pendem_es_teh_coklat_v1', 'store_pendem', p.id, p.base_unit_id, 57, 7
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_coklat_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_coklat_v1' AND component_product_id = p.id);

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_teh_coklat_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es Teh Coklat Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_teh_coklat_v1');

-- ID resep sumber: 17 -- Es Teh Capucino Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_teh_capucino_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 17) -- susulan migration 0056', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es Teh Capucino Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_capucino_larutan_teh_poci_vanilla', 'recipe_store_pendem_es_teh_capucino_v1', 'store_pendem', p.id, p.base_unit_id, 237, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Vanilla'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_capucino_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_capucino_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_capucino_bubuk_rasa_capucino', 'recipe_store_pendem_es_teh_capucino_v1', 'store_pendem', p.id, p.base_unit_id, 1, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Bubuk Rasa Capucino'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_capucino_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_capucino_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_capucino_susu_kental_manis', 'recipe_store_pendem_es_teh_capucino_v1', 'store_pendem', p.id, p.base_unit_id, 1, 3
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Susu Kental Manis'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_capucino_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_capucino_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_capucino_cup_poci_160z', 'recipe_store_pendem_es_teh_capucino_v1', 'store_pendem', p.id, p.base_unit_id, 1, 4
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Cup Poci 160z'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_capucino_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_capucino_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_capucino_sedotan', 'recipe_store_pendem_es_teh_capucino_v1', 'store_pendem', p.id, p.base_unit_id, 1, 5
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Sedotan'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_capucino_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_capucino_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_capucino_lid_sealer', 'recipe_store_pendem_es_teh_capucino_v1', 'store_pendem', p.id, p.base_unit_id, 1, 6
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Lid Sealer'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_capucino_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_capucino_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_capucino_larutan_gula', 'recipe_store_pendem_es_teh_capucino_v1', 'store_pendem', p.id, p.base_unit_id, 57, 7
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_capucino_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_capucino_v1' AND component_product_id = p.id);

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_teh_capucino_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es Teh Capucino Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_teh_capucino_v1');

-- ID resep sumber: 18 -- Es Teh Thaitea Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_teh_thaitea_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 18) -- susulan migration 0056', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es Teh Thaitea Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_thaitea_larutan_teh_poci_vanilla', 'recipe_store_pendem_es_teh_thaitea_v1', 'store_pendem', p.id, p.base_unit_id, 237, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Vanilla'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_thaitea_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_thaitea_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_thaitea_bubuk_rasa_thaitea', 'recipe_store_pendem_es_teh_thaitea_v1', 'store_pendem', p.id, p.base_unit_id, 1, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Bubuk Rasa Thaitea'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_thaitea_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_thaitea_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_thaitea_susu_kental_manis', 'recipe_store_pendem_es_teh_thaitea_v1', 'store_pendem', p.id, p.base_unit_id, 1, 3
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Susu Kental Manis'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_thaitea_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_thaitea_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_thaitea_cup_poci_160z', 'recipe_store_pendem_es_teh_thaitea_v1', 'store_pendem', p.id, p.base_unit_id, 1, 4
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Cup Poci 160z'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_thaitea_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_thaitea_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_thaitea_sedotan', 'recipe_store_pendem_es_teh_thaitea_v1', 'store_pendem', p.id, p.base_unit_id, 1, 5
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Sedotan'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_thaitea_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_thaitea_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_thaitea_lid_sealer', 'recipe_store_pendem_es_teh_thaitea_v1', 'store_pendem', p.id, p.base_unit_id, 1, 6
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Lid Sealer'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_thaitea_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_thaitea_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_thaitea_larutan_gula', 'recipe_store_pendem_es_teh_thaitea_v1', 'store_pendem', p.id, p.base_unit_id, 57, 7
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_thaitea_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_thaitea_v1' AND component_product_id = p.id);

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_teh_thaitea_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es Teh Thaitea Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_teh_thaitea_v1');

-- ID resep sumber: 19 -- Es teh MilkTea Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_teh_milktea_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 19) -- susulan migration 0056', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es teh MilkTea Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_milktea_larutan_teh_poci_vanilla', 'recipe_store_pendem_es_teh_milktea_v1', 'store_pendem', p.id, p.base_unit_id, 237, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Vanilla'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_milktea_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_milktea_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_milktea_bubuk_rasa_milktea', 'recipe_store_pendem_es_teh_milktea_v1', 'store_pendem', p.id, p.base_unit_id, 1, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Bubuk Rasa Milktea'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_milktea_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_milktea_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_milktea_cup_poci_160z', 'recipe_store_pendem_es_teh_milktea_v1', 'store_pendem', p.id, p.base_unit_id, 1, 3
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Cup Poci 160z'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_milktea_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_milktea_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_milktea_sedotan', 'recipe_store_pendem_es_teh_milktea_v1', 'store_pendem', p.id, p.base_unit_id, 1, 4
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Sedotan'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_milktea_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_milktea_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_milktea_lid_sealer', 'recipe_store_pendem_es_teh_milktea_v1', 'store_pendem', p.id, p.base_unit_id, 1, 5
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Lid Sealer'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_milktea_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_milktea_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_milktea_larutan_gula', 'recipe_store_pendem_es_teh_milktea_v1', 'store_pendem', p.id, p.base_unit_id, 57, 6
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_milktea_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_milktea_v1' AND component_product_id = p.id);

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_teh_milktea_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es teh MilkTea Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_teh_milktea_v1');

-- ID resep sumber: 21 -- Es MilkTea Mangga Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_milktea_mangga_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 21) -- susulan migration 0056', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es MilkTea Mangga Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_mangga_larutan_teh_poci_vanilla', 'recipe_store_pendem_es_milktea_mangga_v1', 'store_pendem', p.id, p.base_unit_id, 237, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Vanilla'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_mangga_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_mangga_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_mangga_bubuk_rasa_mangga', 'recipe_store_pendem_es_milktea_mangga_v1', 'store_pendem', p.id, p.base_unit_id, 1, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Bubuk Rasa Mangga'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_mangga_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_mangga_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_mangga_susu_kental_manis', 'recipe_store_pendem_es_milktea_mangga_v1', 'store_pendem', p.id, p.base_unit_id, 1, 3
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Susu Kental Manis'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_mangga_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_mangga_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_mangga_cup_poci_160z', 'recipe_store_pendem_es_milktea_mangga_v1', 'store_pendem', p.id, p.base_unit_id, 1, 4
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Cup Poci 160z'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_mangga_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_mangga_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_mangga_sedotan', 'recipe_store_pendem_es_milktea_mangga_v1', 'store_pendem', p.id, p.base_unit_id, 1, 5
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Sedotan'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_mangga_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_mangga_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_mangga_lid_sealer', 'recipe_store_pendem_es_milktea_mangga_v1', 'store_pendem', p.id, p.base_unit_id, 1, 6
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Lid Sealer'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_mangga_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_mangga_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_mangga_larutan_gula', 'recipe_store_pendem_es_milktea_mangga_v1', 'store_pendem', p.id, p.base_unit_id, 57, 7
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_mangga_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_mangga_v1' AND component_product_id = p.id);

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_milktea_mangga_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es MilkTea Mangga Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_milktea_mangga_v1');

-- ID resep sumber: 22 -- Es MilkTea Orange Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_milktea_orange_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 22) -- susulan migration 0056', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es MilkTea Orange Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_orange_larutan_teh_poci_vanilla', 'recipe_store_pendem_es_milktea_orange_v1', 'store_pendem', p.id, p.base_unit_id, 237, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Vanilla'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_orange_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_orange_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_orange_bubuk_rasa_orange', 'recipe_store_pendem_es_milktea_orange_v1', 'store_pendem', p.id, p.base_unit_id, 1, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Bubuk Rasa Orange'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_orange_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_orange_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_orange_susu_kental_manis', 'recipe_store_pendem_es_milktea_orange_v1', 'store_pendem', p.id, p.base_unit_id, 1, 3
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Susu Kental Manis'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_orange_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_orange_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_orange_cup_poci_160z', 'recipe_store_pendem_es_milktea_orange_v1', 'store_pendem', p.id, p.base_unit_id, 1, 4
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Cup Poci 160z'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_orange_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_orange_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_orange_sedotan', 'recipe_store_pendem_es_milktea_orange_v1', 'store_pendem', p.id, p.base_unit_id, 1, 5
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Sedotan'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_orange_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_orange_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_orange_lid_sealer', 'recipe_store_pendem_es_milktea_orange_v1', 'store_pendem', p.id, p.base_unit_id, 1, 6
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Lid Sealer'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_orange_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_orange_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_orange_larutan_gula', 'recipe_store_pendem_es_milktea_orange_v1', 'store_pendem', p.id, p.base_unit_id, 57, 7
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_orange_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_orange_v1' AND component_product_id = p.id);

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_milktea_orange_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es MilkTea Orange Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_milktea_orange_v1');

-- ID resep sumber: 23 -- Es MilkTea blackcurrant Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_milktea_blackcurrant_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 23) -- susulan migration 0056', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es MilkTea blackcurrant Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_blackcurrant_larutan_teh_poci_vanilla', 'recipe_store_pendem_es_milktea_blackcurrant_v1', 'store_pendem', p.id, p.base_unit_id, 237, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Vanilla'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_blackcurrant_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_blackcurrant_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_blackcurrant_bubuk_rasa_black_curent', 'recipe_store_pendem_es_milktea_blackcurrant_v1', 'store_pendem', p.id, p.base_unit_id, 1, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Bubuk Rasa Black Curent'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_blackcurrant_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_blackcurrant_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_blackcurrant_susu_kental_manis', 'recipe_store_pendem_es_milktea_blackcurrant_v1', 'store_pendem', p.id, p.base_unit_id, 1, 3
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Susu Kental Manis'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_blackcurrant_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_blackcurrant_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_blackcurrant_cup_poci_160z', 'recipe_store_pendem_es_milktea_blackcurrant_v1', 'store_pendem', p.id, p.base_unit_id, 1, 4
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Cup Poci 160z'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_blackcurrant_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_blackcurrant_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_blackcurrant_sedotan', 'recipe_store_pendem_es_milktea_blackcurrant_v1', 'store_pendem', p.id, p.base_unit_id, 1, 5
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Sedotan'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_blackcurrant_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_blackcurrant_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_blackcurrant_lid_sealer', 'recipe_store_pendem_es_milktea_blackcurrant_v1', 'store_pendem', p.id, p.base_unit_id, 1, 6
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Lid Sealer'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_blackcurrant_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_blackcurrant_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_blackcurrant_larutan_gula', 'recipe_store_pendem_es_milktea_blackcurrant_v1', 'store_pendem', p.id, p.base_unit_id, 57, 7
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_blackcurrant_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_blackcurrant_v1' AND component_product_id = p.id);

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_milktea_blackcurrant_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es MilkTea blackcurrant Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_milktea_blackcurrant_v1');

-- ID resep sumber: 24 -- Es MilkTea Apel Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_milktea_apel_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 24) -- susulan migration 0056', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es MilkTea Apel Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_apel_larutan_teh_poci_vanilla', 'recipe_store_pendem_es_milktea_apel_v1', 'store_pendem', p.id, p.base_unit_id, 237, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Vanilla'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_apel_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_apel_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_apel_bubuk_rasa_apel', 'recipe_store_pendem_es_milktea_apel_v1', 'store_pendem', p.id, p.base_unit_id, 1, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Bubuk Rasa Apel'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_apel_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_apel_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_apel_susu_kental_manis', 'recipe_store_pendem_es_milktea_apel_v1', 'store_pendem', p.id, p.base_unit_id, 1, 3
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Susu Kental Manis'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_apel_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_apel_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_apel_cup_poci_160z', 'recipe_store_pendem_es_milktea_apel_v1', 'store_pendem', p.id, p.base_unit_id, 1, 4
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Cup Poci 160z'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_apel_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_apel_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_apel_sedotan', 'recipe_store_pendem_es_milktea_apel_v1', 'store_pendem', p.id, p.base_unit_id, 1, 5
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Sedotan'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_apel_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_apel_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_apel_lid_sealer', 'recipe_store_pendem_es_milktea_apel_v1', 'store_pendem', p.id, p.base_unit_id, 1, 6
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Lid Sealer'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_apel_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_apel_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_apel_larutan_gula', 'recipe_store_pendem_es_milktea_apel_v1', 'store_pendem', p.id, p.base_unit_id, 57, 7
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_apel_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_apel_v1' AND component_product_id = p.id);

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_milktea_apel_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es MilkTea Apel Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_milktea_apel_v1');

-- ID resep sumber: 25 -- Es MilkTea Leci Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_milktea_leci_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 25) -- susulan migration 0056', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es MilkTea Leci Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_leci_larutan_teh_poci_vanilla', 'recipe_store_pendem_es_milktea_leci_v1', 'store_pendem', p.id, p.base_unit_id, 237, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Vanilla'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_leci_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_leci_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_leci_bubuk_rasa_leci', 'recipe_store_pendem_es_milktea_leci_v1', 'store_pendem', p.id, p.base_unit_id, 1, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Bubuk Rasa Leci'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_leci_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_leci_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_leci_susu_kental_manis', 'recipe_store_pendem_es_milktea_leci_v1', 'store_pendem', p.id, p.base_unit_id, 1, 3
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Susu Kental Manis'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_leci_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_leci_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_leci_cup_poci_160z', 'recipe_store_pendem_es_milktea_leci_v1', 'store_pendem', p.id, p.base_unit_id, 1, 4
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Cup Poci 160z'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_leci_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_leci_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_leci_sedotan', 'recipe_store_pendem_es_milktea_leci_v1', 'store_pendem', p.id, p.base_unit_id, 1, 5
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Sedotan'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_leci_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_leci_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_leci_lid_sealer', 'recipe_store_pendem_es_milktea_leci_v1', 'store_pendem', p.id, p.base_unit_id, 1, 6
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Lid Sealer'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_leci_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_leci_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_milktea_leci_larutan_gula', 'recipe_store_pendem_es_milktea_leci_v1', 'store_pendem', p.id, p.base_unit_id, 57, 7
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_milktea_leci_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_milktea_leci_v1' AND component_product_id = p.id);

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_milktea_leci_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es MilkTea Leci Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_milktea_leci_v1');

-- ID resep sumber: 28 -- Es Teh Poci Jasmine
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_teh_poci_jasmine_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 28) -- susulan migration 0056', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es Teh Poci Jasmine'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_poci_jasmine_larutan_teh_poci_jasmine', 'recipe_store_pendem_es_teh_poci_jasmine_v1', 'store_pendem', p.id, p.base_unit_id, 237, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Jasmine'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_poci_jasmine_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_poci_jasmine_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_poci_jasmine_cup_poci_160z', 'recipe_store_pendem_es_teh_poci_jasmine_v1', 'store_pendem', p.id, p.base_unit_id, 1, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Cup Poci 160z'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_poci_jasmine_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_poci_jasmine_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_poci_jasmine_sedotan', 'recipe_store_pendem_es_teh_poci_jasmine_v1', 'store_pendem', p.id, p.base_unit_id, 1, 3
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Sedotan'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_poci_jasmine_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_poci_jasmine_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_poci_jasmine_lid_sealer', 'recipe_store_pendem_es_teh_poci_jasmine_v1', 'store_pendem', p.id, p.base_unit_id, 1, 4
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Lid Sealer'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_poci_jasmine_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_poci_jasmine_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_poci_jasmine_larutan_gula', 'recipe_store_pendem_es_teh_poci_jasmine_v1', 'store_pendem', p.id, p.base_unit_id, 57, 5
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_poci_jasmine_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_poci_jasmine_v1' AND component_product_id = p.id);

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_teh_poci_jasmine_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es Teh Poci Jasmine'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_teh_poci_jasmine_v1');

-- ID resep sumber: 69 -- Es Teh Milktea Lemon Honey Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 69) -- susulan migration 0056', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es Teh Milktea Lemon Honey Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_milktea_lemon_honey_larutan_teh_poci_vanilla', 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1', 'store_pendem', p.id, p.base_unit_id, 237, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Vanilla'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_milktea_lemon_honey_cup_poci_160z', 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1', 'store_pendem', p.id, p.base_unit_id, 1, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Cup Poci 160z'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_milktea_lemon_honey_susu_kental_manis', 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1', 'store_pendem', p.id, p.base_unit_id, 1, 3
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Susu Kental Manis'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_milktea_lemon_honey_bubuk_rasa_lemon_honey', 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1', 'store_pendem', p.id, p.base_unit_id, 1, 4
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Bubuk Rasa Lemon Honey'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_milktea_lemon_honey_lid_sealer', 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1', 'store_pendem', p.id, p.base_unit_id, 1, 5
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Lid Sealer'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_milktea_lemon_honey_sedotan', 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1', 'store_pendem', p.id, p.base_unit_id, 1, 6
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Sedotan'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_milktea_lemon_honey_larutan_gula', 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1', 'store_pendem', p.id, p.base_unit_id, 57, 7
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1' AND component_product_id = p.id);

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es Teh Milktea Lemon Honey Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_teh_milktea_lemon_honey_v1');

-- ID resep sumber: 70 -- Es Teh Matcha Besar
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_es_teh_matcha_v1', 'store_pendem', p.id, p.base_unit_id, 1,
  1, 'ACTIVE', 'Import dari RESEP_ES_TEH_POCI.xlsx (ID resep sumber: 70) -- susulan migration 0056', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Es Teh Matcha Besar'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_matcha_larutan_teh_poci_vanilla', 'recipe_store_pendem_es_teh_matcha_v1', 'store_pendem', p.id, p.base_unit_id, 237, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Vanilla'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_matcha_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_matcha_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_matcha_bubuk_rasa_matcha', 'recipe_store_pendem_es_teh_matcha_v1', 'store_pendem', p.id, p.base_unit_id, 1, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Bubuk Rasa Matcha'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_matcha_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_matcha_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_matcha_susu_kental_manis', 'recipe_store_pendem_es_teh_matcha_v1', 'store_pendem', p.id, p.base_unit_id, 1, 3
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Susu Kental Manis'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_matcha_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_matcha_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_matcha_cup_poci_160z', 'recipe_store_pendem_es_teh_matcha_v1', 'store_pendem', p.id, p.base_unit_id, 1, 4
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Cup Poci 160z'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_matcha_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_matcha_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_matcha_sedotan', 'recipe_store_pendem_es_teh_matcha_v1', 'store_pendem', p.id, p.base_unit_id, 1, 5
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Sedotan'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_matcha_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_matcha_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_matcha_lid_sealer', 'recipe_store_pendem_es_teh_matcha_v1', 'store_pendem', p.id, p.base_unit_id, 1, 6
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Lid Sealer'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_matcha_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_matcha_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_store_pendem_es_teh_matcha_larutan_gula', 'recipe_store_pendem_es_teh_matcha_v1', 'store_pendem', p.id, p.base_unit_id, 57, 7
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_es_teh_matcha_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_es_teh_matcha_v1' AND component_product_id = p.id);

UPDATE products
SET recipe_link_enabled = 1,
    linked_recipe_id = 'recipe_store_pendem_es_teh_matcha_v1',
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem' AND name = 'Es Teh Matcha Besar'
  AND (linked_recipe_id IS NULL OR linked_recipe_id != 'recipe_store_pendem_es_teh_matcha_v1');

