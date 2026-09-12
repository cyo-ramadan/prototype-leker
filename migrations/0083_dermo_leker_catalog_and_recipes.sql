PRAGMA foreign_keys = ON;

-- BOS_CYO 2026-09-12: onboard Leker catalog + Dadakan recipes for Dermo only.
-- Source: RESEP LEKER.xlsx (73 recipes). Source nominal dots are thousand
-- separators; parser-normalized recipe amount is therefore multiplied by 1000.
-- Bos Cyo decision: catalog Harga Jual = Harga Beli for these Leker products.
-- products.price and products.purchase_price are exact scaled master prices
-- (1 rupiah = 1,000,000 units after migrations 0059/0060).
-- Recipe component quantity stays whole rupiah (e.g. 1.5 source -> 1500).
--
-- Configuration-only migration. No stock, purchase, sale, production run,
-- journal, HPP history, average-cost history, or runtime transaction is created.
-- DOC-IMPACT: NOT_REQUIRED — store-scoped master-data onboarding only; no contract, API, schema shape, or runtime behavior changes.

CREATE TABLE dermo_leker_source_0083 (
  source_recipe_id INTEGER PRIMARY KEY,
  product_name TEXT NOT NULL UNIQUE,
  adonan_rupiah INTEGER NOT NULL CHECK (adonan_rupiah > 0)
);

INSERT INTO dermo_leker_source_0083 (source_recipe_id, product_name, adonan_rupiah) VALUES
  (98, 'Leker Susu Coklat', 2000),
  (99, 'Leker Susu Vanila', 2000),
  (100, 'Leker Meses', 2000),
  (101, 'Leker Keju', 2000),
  (102, 'Leker Blueberry', 2000),
  (103, 'Leker Strawberry', 2000),
  (104, 'Leker Blue Band', 2000),
  (105, 'Leker Blueberry + Meses', 4000),
  (106, 'Leker Gula Aren', 2000),
  (107, 'Leker Oreo', 3000),
  (108, 'Leker Blueberry + Gula', 4000),
  (109, 'Leker Choco Chips', 3000),
  (110, 'Leker Strawberry + Meses', 4000),
  (111, 'Leker Strawberry + Gula', 4000),
  (112, 'Leker Green Tea', 3000),
  (113, 'Leker BlueBand + Keju', 4000),
  (114, 'Leker Cappucino', 3000),
  (115, 'Leker BlueBand + Meses', 4000),
  (118, 'Leker Marsmellow', 3000),
  (119, 'Leker Tiramisu', 3000),
  (120, 'Leker Keju + Susu', 4000),
  (121, 'Leker Pisang', 3000),
  (122, 'Leker Oreo + Keju', 5000),
  (123, 'Leker Choco Crunch', 5000),
  (124, 'Leker Meses + Keju', 5000),
  (125, 'Leker Chocomaltine', 5000),
  (126, 'Leker Beng Beng', 5000),
  (127, 'Leker Kacang + Keju', 5000),
  (128, 'Leker Tiramisu + Keju', 5000),
  (129, 'Leker Ovomaltine', 8000),
  (130, 'Leker Nutella', 8000),
  (131, 'Leker Greentea + Keju', 5000),
  (132, 'Leker Mozarella', 8000),
  (133, 'Leker Blueberry + Keju', 5000),
  (134, 'Leker Telor', 15000),
  (135, 'Leker Strawberry + Keju', 5000),
  (136, 'Leker Kornet Sapi', 20000),
  (137, 'Leker Oreo + Choco Chips', 5000),
  (138, 'Leker Nutella + Keju', 10000),
  (139, 'Leker Kacang + Meses', 5000),
  (140, 'Leker Nutella + Pisang', 10000),
  (141, 'Leker Ovomaltine + Keju', 10000),
  (142, 'Leker Ovomaltine + Pisang', 10000),
  (143, 'Leker Chocomaltine + Pisang + Keju', 10000),
  (144, 'Leker Choco Crunch + Pisang + Keju', 10000),
  (145, 'Leker Chocomaltine + Kacang + Keju', 10000),
  (146, 'Leker Chocomaltine + Oreo', 8000),
  (147, 'Leker Chocomaltine + Pisang', 8000),
  (148, 'Leker Chocomaltine + Keju', 8000),
  (149, 'Leker Chocomaltine + Kacang', 8000),
  (150, 'Leker Choco Crunch + Oreo', 8000),
  (151, 'Leker Choco Crunch + Pisang', 8000),
  (152, 'Leker Choco Crunch + Keju', 8000),
  (153, 'Leker Choco Crunch + Kacang', 8000),
  (154, 'Leker Pisang + Meses + Keju', 8000),
  (155, 'Leker Pisang + Oreo + Keju', 8000),
  (156, 'Leker Greentea + Oreo + Keju', 8000),
  (157, 'Leker Choco Chips Oreo + Keju', 8000),
  (158, 'Leker Pisang + Keju', 5000),
  (159, 'Leker Pisang + Meses', 5000),
  (160, 'Leker Pisang + Kacang', 5000),
  (161, 'Leker Pisang + Oreo', 5000),
  (162, 'Leker Pisang + Choco Chips', 5000),
  (163, 'Leker Pisang + Greentea', 5000),
  (164, 'Leker Nuttela + Mozarella', 20000),
  (165, 'Leker Ovomaltine Mozarella', 20000),
  (166, 'Leker Telor + Kornet', 25000),
  (167, 'Leker Kornet + Mozarella', 25000),
  (168, 'Leker Telor + Mozarella', 25000),
  (169, 'Leker Telor + Kornet + Mozarella', 40000),
  (170, 'Leker Ovomaltine + Kacang + Keju', 10000),
  (171, 'Leker Mozarella + Pisang', 10000),
  (172, 'Leker Original', 1500);

-- Fail closed unless Dermo and canonical master capabilities exist.
CREATE TABLE dermo_leker_guard_0083 (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO dermo_leker_guard_0083 (ok)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM stores WHERE id = 'store_dermo' AND is_active = 1)
  AND EXISTS (SELECT 1 FROM item_types WHERE store_id = 'store_dermo' AND code = 'FINISHED_GOOD' AND is_active = 1)
  AND EXISTS (SELECT 1 FROM item_types WHERE store_id = 'store_dermo' AND code = 'RAW_MATERIAL' AND is_active = 1)
  AND EXISTS (SELECT 1 FROM units WHERE store_id = 'store_dermo' AND code = 'PCS' AND is_active = 1)
  AND EXISTS (SELECT 1 FROM product_kinds WHERE store_id = 'store_dermo' AND code = 'RAW_MATERIAL' AND is_active = 1)
THEN 1 ELSE 0 END;
DROP TABLE dermo_leker_guard_0083;

-- Source recipe explicitly uses unit "rupiah". Dermo does not have a canonical
-- repository RUPIAH unit yet, so add the store-scoped unit if absent.
INSERT INTO units (
  id, store_id, code, name, symbol, decimal_scale, is_active, created_at, updated_at
)
SELECT
  'unit_store_dermo_rupiah', 'store_dermo', 'RUPIAH', 'Rupiah', 'Rp', 0, 1,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM units WHERE store_id = 'store_dermo' AND code = 'RUPIAH'
);

INSERT INTO categories (store_id, name, display_order, is_active, created_at, updated_at)
SELECT 'store_dermo', 'Leker', 80, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM categories WHERE store_id = 'store_dermo' AND name = 'Leker'
);

-- One virtual recipe component: 1 unit "Adonan Leker" represents Rp1 of the
-- source's recipe allocation. Master reference price is therefore Rp1/unit.
-- Average cost / last purchase remain zero because no verified transaction exists.
INSERT INTO products (
  store_id, name, purchase_price, price, category, emoji, display_order, is_active,
  created_at, updated_at, item_type_id, base_unit_id, points_per_unit,
  production_mode, recipe_link_enabled, stock_tracking_enabled, linked_recipe_id,
  product_kind_id, average_cost, last_purchase_price, cost_updated_at, last_purchase_at
)
SELECT
  'store_dermo', 'Adonan Leker',
  1000000, 1000000, 'Bahan Baku', '', 0, 1,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
  (SELECT id FROM item_types WHERE store_id = 'store_dermo' AND code = 'RAW_MATERIAL' LIMIT 1),
  (SELECT id FROM units WHERE store_id = 'store_dermo' AND code = 'RUPIAH' LIMIT 1),
  0, 'STOCK', 0, 1, NULL,
  (SELECT id FROM product_kinds WHERE store_id = 'store_dermo' AND code = 'RAW_MATERIAL' LIMIT 1),
  0, 0, NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM products WHERE store_id = 'store_dermo' AND name = 'Adonan Leker'
);

-- Add every source Leker menu. Both master prices equal the normalized source
-- nominal and are stored in the repository's 1e6 scale.
INSERT INTO products (
  store_id, name, purchase_price, price, category, emoji, display_order, is_active,
  created_at, updated_at, item_type_id, base_unit_id, points_per_unit,
  production_mode, recipe_link_enabled, stock_tracking_enabled, linked_recipe_id,
  product_kind_id, average_cost, last_purchase_price, cost_updated_at, last_purchase_at
)
SELECT
  'store_dermo', s.product_name,
  s.adonan_rupiah * 1000000,
  s.adonan_rupiah * 1000000,
  'Leker', '', s.source_recipe_id, 1,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
  (SELECT id FROM item_types WHERE store_id = 'store_dermo' AND code = 'FINISHED_GOOD' LIMIT 1),
  (SELECT id FROM units WHERE store_id = 'store_dermo' AND code = 'PCS' LIMIT 1),
  0, 'DADAKAN', 1, 1, NULL,
  (SELECT id FROM product_kinds WHERE store_id = 'store_dermo' AND code = 'RAW_MATERIAL' LIMIT 1),
  0, 0, NULL, NULL
FROM dermo_leker_source_0083 s
WHERE NOT EXISTS (
  SELECT 1 FROM products p
  WHERE p.store_id = 'store_dermo' AND p.name = s.product_name
);

-- If a same-name source product already existed, align only the catalog/config
-- fields required by this explicit Dermo onboarding decision.
UPDATE products
SET
  purchase_price = (
    SELECT s.adonan_rupiah * 1000000 FROM dermo_leker_source_0083 s
    WHERE s.product_name = products.name
  ),
  price = (
    SELECT s.adonan_rupiah * 1000000 FROM dermo_leker_source_0083 s
    WHERE s.product_name = products.name
  ),
  category = 'Leker',
  item_type_id = (SELECT id FROM item_types WHERE store_id = 'store_dermo' AND code = 'FINISHED_GOOD' LIMIT 1),
  base_unit_id = (SELECT id FROM units WHERE store_id = 'store_dermo' AND code = 'PCS' LIMIT 1),
  production_mode = 'DADAKAN',
  recipe_link_enabled = 1,
  stock_tracking_enabled = 1,
  product_kind_id = (SELECT id FROM product_kinds WHERE store_id = 'store_dermo' AND code = 'RAW_MATERIAL' LIMIT 1),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_dermo'
  AND EXISTS (
    SELECT 1 FROM dermo_leker_source_0083 s WHERE s.product_name = products.name
  );

-- One ACTIVE recipe per source output. IDs derive from the source recipe IDs,
-- so reruns stay deterministic. Output unit comes from output product base unit.
INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT
  'dermo_leker_recipe_' || s.source_recipe_id,
  'store_dermo',
  p.id,
  p.base_unit_id,
  1,
  1,
  'ACTIVE',
  'RESEP LEKER.xlsx · normalized nominal ×1000 · Dermo onboarding 2026-09-12',
  'SYSTEM',
  'migration_0083',
  CURRENT_TIMESTAMP,
  NULL
FROM dermo_leker_source_0083 s
JOIN products p
  ON p.store_id = 'store_dermo' AND p.name = s.product_name
WHERE NOT EXISTS (
  SELECT 1
  FROM manufacturing_recipes r
  WHERE r.store_id = 'store_dermo'
    AND r.output_product_id = p.id
    AND r.status = 'ACTIVE'
);

-- The component unit is resolved from Adonan Leker.base_unit_id, never copied
-- from a foreign/source store, preserving RECIPE_COMPONENT_SCOPE_MISMATCH guard.
INSERT INTO manufacturing_recipe_components (
  id, recipe_id, store_id, component_product_id, component_unit_id,
  quantity, display_order
)
SELECT
  'dermo_leker_component_' || s.source_recipe_id,
  r.id,
  'store_dermo',
  a.id,
  a.base_unit_id,
  s.adonan_rupiah,
  1
FROM dermo_leker_source_0083 s
JOIN products p
  ON p.store_id = 'store_dermo' AND p.name = s.product_name
JOIN manufacturing_recipes r
  ON r.store_id = 'store_dermo' AND r.output_product_id = p.id AND r.status = 'ACTIVE'
JOIN products a
  ON a.store_id = 'store_dermo' AND a.name = 'Adonan Leker'
WHERE NOT EXISTS (
  SELECT 1 FROM manufacturing_recipe_components c
  WHERE c.recipe_id = r.id AND c.component_product_id = a.id
);

UPDATE products
SET
  linked_recipe_id = (
    SELECT r.id
    FROM manufacturing_recipes r
    WHERE r.store_id = 'store_dermo'
      AND r.output_product_id = products.id
      AND r.status = 'ACTIVE'
    ORDER BY r.revision DESC
    LIMIT 1
  ),
  recipe_link_enabled = 1,
  production_mode = 'DADAKAN',
  updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_dermo'
  AND EXISTS (
    SELECT 1 FROM dermo_leker_source_0083 s WHERE s.product_name = products.name
  );

-- Fail closed on the acceptance invariants before discarding source staging.
CREATE TABLE dermo_leker_verify_0083 (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO dermo_leker_verify_0083 (ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM dermo_leker_source_0083) = 73
  AND (
    SELECT COUNT(*)
    FROM dermo_leker_source_0083 s
    JOIN products p ON p.store_id = 'store_dermo' AND p.name = s.product_name
    WHERE p.price = s.adonan_rupiah * 1000000
      AND p.purchase_price = s.adonan_rupiah * 1000000
      AND p.price = p.purchase_price
      AND p.production_mode = 'DADAKAN'
      AND p.recipe_link_enabled = 1
      AND p.linked_recipe_id IS NOT NULL
  ) = 73
  AND (
    SELECT COUNT(*)
    FROM dermo_leker_source_0083 s
    JOIN products p ON p.store_id = 'store_dermo' AND p.name = s.product_name
    JOIN manufacturing_recipes r
      ON r.id = p.linked_recipe_id
     AND r.store_id = 'store_dermo'
     AND r.output_product_id = p.id
     AND r.status = 'ACTIVE'
     AND r.output_quantity >= 1
    JOIN manufacturing_recipe_components c
      ON c.recipe_id = r.id
     AND c.store_id = 'store_dermo'
     AND c.quantity = s.adonan_rupiah
    JOIN products a
      ON a.id = c.component_product_id
     AND a.store_id = 'store_dermo'
     AND a.name = 'Adonan Leker'
     AND c.component_unit_id = a.base_unit_id
  ) = 73
THEN 1 ELSE 0 END;
DROP TABLE dermo_leker_verify_0083;
DROP TABLE dermo_leker_source_0083;
