PRAGMA foreign_keys = ON;

-- Panel Produksi Pendem: Larutan Teh Poci Vanilla, Larutan Teh Poci Jasmine, dan
-- Larutan Gula (migration 0056/0057) dibuat sebagai Barang Setengah Jadi dengan
-- stock_tracking_enabled = 0 -- artinya tidak pernah muncul sebagai target
-- produksi yang bisa dijalankan (src/warehouse-production.js activeOutputProduct
-- mewajibkan stock_tracking_enabled = 1 di kedua sisi -- hasil maupun bahan --
-- begitu Warehouse aktif untuk gerai itu, dan Pendem warehouseEnabled = true).
-- Ditemukan Karen 2026-08-31 waktu coba jalankan Panel Produksi lewat API publik:
-- GET /api/cashier/production/options mengembalikan array kosong untuk Pendem.
--
-- Bos Cyo (2026-08-31): dua Larutan itu memang HARUS lewat Panel Produksi dulu
-- (bukan langsung ke Sale) -- tidak dijual langsung ke customer, jadi wajib ada
-- baris manufacturing_recipes-nya sendiri, terpisah dari resep minuman jadi yang
-- sudah ada di migration 0056/0057.
--
-- TAKARAN DI MIGRATION INI PLACEHOLDER, BUKAN RESEP DAPUR SUNGGUHAN. Bos Cyo
-- eksplisit bilang takaran asli boleh menyusul belakangan ("nanti aja") -- yang
-- penting Panel Produksi bisa dijalankan sekarang (skenario ikut resep = qty
-- hasil/bahan actual sama persis dengan baris ini; skenario tidak ikut resep =
-- kasir override outputQuantity/components saat submit, ditandai
-- production_runs.template_modified = 1 otomatis oleh src/warehouse-production.js).
-- JANGAN pakai takaran di sini untuk HPP/costing final -- ganti begitu Bos Cyo
-- kasih angka aslinya (migration susulan, revision baru, jangan timpa baris ini).
--
-- Bergantung pada store_pendem sudah ada (migration 0052, edition ACCOUNTING) dan
-- barang-barang migration 0056/0057 (Larutan, Teh Vanilla, Teh Jasmine, Air
-- Mineral) sudah ada -- migration ini cuma boleh direplay di database yang
-- keduanya sudah diprovisikan duluan.
--
-- Additive murni, idempotent lewat WHERE NOT EXISTS -- aman dijalankan ulang.

-- 1) Bahan baku baru yang belum ada: Gula (gula pasir mentah), dipakai Larutan
-- Gula. Tidak ada di DATA_BARANG.xlsx maupun RESEP_ES_TEH_POCI.xlsx sama sekali
-- (file resep cuma menyebut "Larutan Gula" yang sudah jadi, bukan gula mentahnya).
INSERT INTO products (
  store_id, name, purchase_price, price, category, item_type_id, base_unit_id, product_kind_id,
  stock_tracking_enabled, is_active, created_at, updated_at
)
SELECT 'store_pendem', 'Gula', 0, 0, 'Bahan Baku',
  (SELECT id FROM item_types WHERE store_id = 'store_pendem' AND code = 'RAW_MATERIAL'),
  (SELECT id FROM units WHERE store_id = 'store_pendem' AND code = 'GRAM'),
  (SELECT id FROM product_kinds WHERE store_id = 'store_pendem' AND code = 'RAW_MATERIAL'),
  1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM products WHERE store_id = 'store_pendem' AND name = 'Gula');

-- 2) Nyalakan stock_tracking untuk barang yang ikut alur produksi Larutan --
-- Panel Produksi menolak hasil maupun bahan yang stock_tracking-nya mati selama
-- Warehouse aktif. Teh Vanilla sudah 1 dari sebelum migration 0056 (barang lama),
-- tidak disentuh lagi di sini.
UPDATE products SET stock_tracking_enabled = 1, updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_pendem'
  AND name IN ('Larutan Teh Poci Vanilla', 'Larutan Teh Poci Jasmine', 'Larutan Gula', 'Teh Jasmine', 'Air Mineral')
  AND stock_tracking_enabled = 0;

-- 3) Resep produksi Larutan Teh Poci Vanilla (Teh Vanilla + Air Mineral).
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_produksi_larutan_teh_poci_vanilla_v1', 'store_pendem', p.id, p.base_unit_id, 1000,
  1, 'ACTIVE', 'PLACEHOLDER -- takaran sementara (5 Teh Vanilla + 1000ml Air Mineral -> 1000ml Larutan), tunggu resep dapur asli dari Bos Cyo. Jangan pakai untuk costing final.', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Vanilla'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id AND status = 'ACTIVE');

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_produksi_larutan_vanilla_teh_vanilla', 'recipe_store_pendem_produksi_larutan_teh_poci_vanilla_v1', 'store_pendem', p.id, p.base_unit_id, 5, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Teh Vanilla'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_produksi_larutan_teh_poci_vanilla_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_produksi_larutan_teh_poci_vanilla_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_produksi_larutan_vanilla_air_mineral', 'recipe_store_pendem_produksi_larutan_teh_poci_vanilla_v1', 'store_pendem', p.id, p.base_unit_id, 1000, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Air Mineral'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_produksi_larutan_teh_poci_vanilla_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_produksi_larutan_teh_poci_vanilla_v1' AND component_product_id = p.id);

-- 4) Resep produksi Larutan Teh Poci Jasmine (Teh Jasmine + Air Mineral).
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_produksi_larutan_teh_poci_jasmine_v1', 'store_pendem', p.id, p.base_unit_id, 1000,
  1, 'ACTIVE', 'PLACEHOLDER -- takaran sementara (20g Teh Jasmine + 1000ml Air Mineral -> 1000ml Larutan), tunggu resep dapur asli dari Bos Cyo. Jangan pakai untuk costing final.', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Teh Poci Jasmine'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id AND status = 'ACTIVE');

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_produksi_larutan_jasmine_teh_jasmine', 'recipe_store_pendem_produksi_larutan_teh_poci_jasmine_v1', 'store_pendem', p.id, p.base_unit_id, 20, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Teh Jasmine'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_produksi_larutan_teh_poci_jasmine_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_produksi_larutan_teh_poci_jasmine_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_produksi_larutan_jasmine_air_mineral', 'recipe_store_pendem_produksi_larutan_teh_poci_jasmine_v1', 'store_pendem', p.id, p.base_unit_id, 1000, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Air Mineral'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_produksi_larutan_teh_poci_jasmine_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_produksi_larutan_teh_poci_jasmine_v1' AND component_product_id = p.id);

-- 5) Resep produksi Larutan Gula (Gula + Air Mineral).
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT 'recipe_store_pendem_produksi_larutan_gula_v1', 'store_pendem', p.id, p.base_unit_id, 1000,
  1, 'ACTIVE', 'PLACEHOLDER -- takaran sementara (500g Gula + 600ml Air Mineral -> 1000ml Larutan), tunggu resep dapur asli dari Bos Cyo. Jangan pakai untuk costing final.', 'HANA', 'usr_hana_import', CURRENT_TIMESTAMP, NULL
FROM products p
WHERE p.store_id = 'store_pendem' AND p.name = 'Larutan Gula'
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND output_product_id = p.id AND status = 'ACTIVE');

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_produksi_larutan_gula_gula', 'recipe_store_pendem_produksi_larutan_gula_v1', 'store_pendem', p.id, p.base_unit_id, 500, 1
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Gula'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_produksi_larutan_gula_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_produksi_larutan_gula_v1' AND component_product_id = p.id);

INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
SELECT 'recipe_component_produksi_larutan_gula_air_mineral', 'recipe_store_pendem_produksi_larutan_gula_v1', 'store_pendem', p.id, p.base_unit_id, 600, 2
FROM products p WHERE p.store_id = 'store_pendem' AND p.name = 'Air Mineral'
  AND EXISTS (SELECT 1 FROM manufacturing_recipes WHERE id = 'recipe_store_pendem_produksi_larutan_gula_v1')
  AND NOT EXISTS (SELECT 1 FROM manufacturing_recipe_components WHERE recipe_id = 'recipe_store_pendem_produksi_larutan_gula_v1' AND component_product_id = p.id);
