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

-- Product rows are applied separately after these prerequisites are proven on remote D1.
