PRAGMA foreign_keys = ON;

-- Seed through the same canonical fields written by the Product Master UI.
-- IDs are allocated from the live table so this remains safe when another store
-- already owns numeric product IDs that do not exist in a fresh database.
WITH seed(ord, name, emoji, unit_code) AS (
  VALUES
    (1, 'Tepung Terigu', '🌾', 'GRAM'),
    (2, 'Gula Pasir', '🍚', 'GRAM'),
    (3, 'Telur Ayam', '🥚', 'PCS'),
    (4, 'Margarin', '🧈', 'GRAM'),
    (5, 'Susu Cair', '🥛', 'ML'),
    (6, 'Air Mineral', '💧', 'ML'),
    (7, 'Garam', '🧂', 'GRAM'),
    (8, 'Minyak Goreng', '🫗', 'ML'),
    (9, 'Cokelat Bubuk', '🍫', 'GRAM'),
    (10, 'Keju', '🧀', 'GRAM')
), base(next_id, next_order) AS (
  SELECT
    COALESCE(MAX(id), 0),
    COALESCE(MAX(CASE WHEN store_id = 'store_001' THEN display_order END), 0)
  FROM products
)
INSERT INTO products (
  id, store_id, name, purchase_price, price, category, emoji, image_data,
  display_order, is_active, item_type_id, product_kind_id, base_unit_id,
  points_per_unit, recipe_link_enabled, linked_recipe_id, stock_tracking_enabled
)
SELECT
  base.next_id + seed.ord,
  'store_001', seed.name, 0, 0, 'Bahan Baku', seed.emoji, '',
  base.next_order + seed.ord,
  1,
  (SELECT id FROM item_types WHERE store_id = 'store_001' AND code = 'RAW_MATERIAL' AND is_active = 1 LIMIT 1),
  (SELECT id FROM product_kinds WHERE store_id = 'store_001' AND code = 'RAW_MATERIAL' AND is_active = 1 LIMIT 1),
  (SELECT id FROM units WHERE store_id = 'store_001' AND code = seed.unit_code AND is_active = 1 LIMIT 1),
  0, 0, NULL, 1
FROM seed CROSS JOIN base
WHERE NOT EXISTS (
  SELECT 1 FROM products p WHERE p.store_id = 'store_001' AND p.name = seed.name
);

INSERT OR IGNORE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
SELECT 'store_001', p.id, 0, CURRENT_TIMESTAMP
FROM products p
JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
WHERE p.store_id = 'store_001'
  AND t.code = 'RAW_MATERIAL'
  AND p.stock_tracking_enabled = 1;
