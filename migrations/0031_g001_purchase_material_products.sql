PRAGMA foreign_keys = ON;

-- First Product Master write is intentionally one row. The live D1 schema has
-- already accepted the prerequisites from 0030; keeping this migration atomic
-- makes any remaining live-only constraint observable without a bulk insert.
INSERT INTO products (
  id, store_id, name, purchase_price, price, category, emoji, image_data,
  display_order, is_active, item_type_id, product_kind_id, base_unit_id,
  points_per_unit, recipe_link_enabled, linked_recipe_id, stock_tracking_enabled
)
SELECT
  (SELECT COALESCE(MAX(id), 0) + 1 FROM products),
  'store_001', 'Tepung Terigu', 0, 0, 'Bahan Baku', '🌾', '',
  (SELECT COALESCE(MAX(display_order), 0) + 1 FROM products WHERE store_id = 'store_001'),
  1,
  (SELECT id FROM item_types WHERE store_id = 'store_001' AND code = 'RAW_MATERIAL' AND is_active = 1 LIMIT 1),
  (SELECT id FROM product_kinds WHERE store_id = 'store_001' AND code = 'RAW_MATERIAL' AND is_active = 1 LIMIT 1),
  (SELECT id FROM units WHERE store_id = 'store_001' AND code = 'GRAM' AND is_active = 1 LIMIT 1),
  0, 0, NULL, 1
WHERE NOT EXISTS (
  SELECT 1 FROM products WHERE store_id = 'store_001' AND name = 'Tepung Terigu'
);

INSERT OR IGNORE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
SELECT 'store_001', id, 0, CURRENT_TIMESTAMP
FROM products
WHERE store_id = 'store_001' AND name = 'Tepung Terigu' AND stock_tracking_enabled = 1;
