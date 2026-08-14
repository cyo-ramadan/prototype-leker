PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO units (id, store_id, code, name, symbol, decimal_scale, is_active) VALUES
  ('unit_store_001_pcs', 'store_001', 'PCS', 'Pcs', 'pcs', 0, 1),
  ('unit_store_001_gram', 'store_001', 'GRAM', 'Gram', 'g', 0, 1),
  ('unit_store_001_ml', 'store_001', 'ML', 'Mililiter', 'ml', 0, 1);

INSERT OR IGNORE INTO item_types (id, store_id, code, name, can_sell, can_purchase, can_produce, can_consume, track_stock, is_active)
VALUES ('item_type_store_001_raw', 'store_001', 'RAW_MATERIAL', 'Bahan', 0, 1, 0, 1, 1, 1);

INSERT OR IGNORE INTO product_kinds (id, store_id, code, name, is_active)
VALUES ('product_kind_store_001_raw_material', 'store_001', 'RAW_MATERIAL', 'Bahan Baku', 1);

INSERT OR IGNORE INTO categories (store_id, name, display_order, is_active, created_at, updated_at)
VALUES ('store_001', 'Bahan Baku', 90, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO products (
  id, store_id, name, purchase_price, price, category, emoji, image_data,
  display_order, is_active, created_at, updated_at, item_type_id, base_unit_id,
  product_kind_id, points_per_unit, production_mode, recipe_link_enabled,
  stock_tracking_enabled, average_cost, last_purchase_price
) VALUES
  (101, 'store_001', 'Tepung Terigu', 0, 0, 'Bahan Baku', '🌾', '', 101, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, (SELECT id FROM item_types WHERE store_id='store_001' AND code='RAW_MATERIAL'), (SELECT id FROM units WHERE store_id='store_001' AND code='GRAM'), (SELECT id FROM product_kinds WHERE store_id='store_001' AND code='RAW_MATERIAL'), 0, 'STOCK', 0, 1, 0, 0),
  (102, 'store_001', 'Gula Pasir', 0, 0, 'Bahan Baku', '🍚', '', 102, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, (SELECT id FROM item_types WHERE store_id='store_001' AND code='RAW_MATERIAL'), (SELECT id FROM units WHERE store_id='store_001' AND code='GRAM'), (SELECT id FROM product_kinds WHERE store_id='store_001' AND code='RAW_MATERIAL'), 0, 'STOCK', 0, 1, 0, 0),
  (103, 'store_001', 'Telur Ayam', 0, 0, 'Bahan Baku', '🥚', '', 103, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, (SELECT id FROM item_types WHERE store_id='store_001' AND code='RAW_MATERIAL'), (SELECT id FROM units WHERE store_id='store_001' AND code='PCS'), (SELECT id FROM product_kinds WHERE store_id='store_001' AND code='RAW_MATERIAL'), 0, 'STOCK', 0, 1, 0, 0),
  (104, 'store_001', 'Margarin', 0, 0, 'Bahan Baku', '🧈', '', 104, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, (SELECT id FROM item_types WHERE store_id='store_001' AND code='RAW_MATERIAL'), (SELECT id FROM units WHERE store_id='store_001' AND code='GRAM'), (SELECT id FROM product_kinds WHERE store_id='store_001' AND code='RAW_MATERIAL'), 0, 'STOCK', 0, 1, 0, 0),
  (105, 'store_001', 'Susu Cair', 0, 0, 'Bahan Baku', '🥛', '', 105, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, (SELECT id FROM item_types WHERE store_id='store_001' AND code='RAW_MATERIAL'), (SELECT id FROM units WHERE store_id='store_001' AND code='ML'), (SELECT id FROM product_kinds WHERE store_id='store_001' AND code='RAW_MATERIAL'), 0, 'STOCK', 0, 1, 0, 0),
  (106, 'store_001', 'Air Mineral', 0, 0, 'Bahan Baku', '💧', '', 106, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, (SELECT id FROM item_types WHERE store_id='store_001' AND code='RAW_MATERIAL'), (SELECT id FROM units WHERE store_id='store_001' AND code='ML'), (SELECT id FROM product_kinds WHERE store_id='store_001' AND code='RAW_MATERIAL'), 0, 'STOCK', 0, 1, 0, 0),
  (107, 'store_001', 'Garam', 0, 0, 'Bahan Baku', '🧂', '', 107, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, (SELECT id FROM item_types WHERE store_id='store_001' AND code='RAW_MATERIAL'), (SELECT id FROM units WHERE store_id='store_001' AND code='GRAM'), (SELECT id FROM product_kinds WHERE store_id='store_001' AND code='RAW_MATERIAL'), 0, 'STOCK', 0, 1, 0, 0),
  (108, 'store_001', 'Minyak Goreng', 0, 0, 'Bahan Baku', '🫗', '', 108, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, (SELECT id FROM item_types WHERE store_id='store_001' AND code='RAW_MATERIAL'), (SELECT id FROM units WHERE store_id='store_001' AND code='ML'), (SELECT id FROM product_kinds WHERE store_id='store_001' AND code='RAW_MATERIAL'), 0, 'STOCK', 0, 1, 0, 0),
  (109, 'store_001', 'Cokelat Bubuk', 0, 0, 'Bahan Baku', '🍫', '', 109, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, (SELECT id FROM item_types WHERE store_id='store_001' AND code='RAW_MATERIAL'), (SELECT id FROM units WHERE store_id='store_001' AND code='GRAM'), (SELECT id FROM product_kinds WHERE store_id='store_001' AND code='RAW_MATERIAL'), 0, 'STOCK', 0, 1, 0, 0),
  (110, 'store_001', 'Keju', 0, 0, 'Bahan Baku', '🧀', '', 110, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, (SELECT id FROM item_types WHERE store_id='store_001' AND code='RAW_MATERIAL'), (SELECT id FROM units WHERE store_id='store_001' AND code='GRAM'), (SELECT id FROM product_kinds WHERE store_id='store_001' AND code='RAW_MATERIAL'), 0, 'STOCK', 0, 1, 0, 0);

INSERT OR IGNORE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
SELECT 'store_001', id, 0, CURRENT_TIMESTAMP FROM products
WHERE store_id = 'store_001' AND id BETWEEN 101 AND 110;
