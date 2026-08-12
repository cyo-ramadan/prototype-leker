PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS item_types (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  can_sell INTEGER NOT NULL DEFAULT 1 CHECK (can_sell IN (0, 1)),
  can_purchase INTEGER NOT NULL DEFAULT 1 CHECK (can_purchase IN (0, 1)),
  can_produce INTEGER NOT NULL DEFAULT 0 CHECK (can_produce IN (0, 1)),
  can_consume INTEGER NOT NULL DEFAULT 1 CHECK (can_consume IN (0, 1)),
  track_stock INTEGER NOT NULL DEFAULT 1 CHECK (track_stock IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (store_id, code),
  UNIQUE (store_id, name)
);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimal_scale INTEGER NOT NULL DEFAULT 0 CHECK (decimal_scale BETWEEN 0 AND 3),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (store_id, code),
  UNIQUE (store_id, name)
);

INSERT OR IGNORE INTO item_types (
  id, store_id, code, name, can_sell, can_purchase, can_produce, can_consume, track_stock, is_active
)
SELECT 'item_type_' || id || '_finished', id, 'FINISHED_GOOD', 'Barang Jadi', 1, 1, 1, 1, 1, 1
FROM stores;

INSERT OR IGNORE INTO item_types (
  id, store_id, code, name, can_sell, can_purchase, can_produce, can_consume, track_stock, is_active
)
SELECT 'item_type_' || id || '_raw', id, 'RAW_MATERIAL', 'Bahan', 0, 1, 0, 1, 1, 1
FROM stores;

INSERT OR IGNORE INTO item_types (
  id, store_id, code, name, can_sell, can_purchase, can_produce, can_consume, track_stock, is_active
)
SELECT 'item_type_' || id || '_semi', id, 'SEMI_FINISHED', 'Bahan Setengah Jadi', 0, 1, 1, 1, 1, 1
FROM stores;

INSERT OR IGNORE INTO units (id, store_id, code, name, symbol, decimal_scale, is_active)
SELECT 'unit_' || id || '_pcs', id, 'PCS', 'Pcs', 'pcs', 0, 1 FROM stores;
INSERT OR IGNORE INTO units (id, store_id, code, name, symbol, decimal_scale, is_active)
SELECT 'unit_' || id || '_gram', id, 'GRAM', 'Gram', 'g', 3, 1 FROM stores;
INSERT OR IGNORE INTO units (id, store_id, code, name, symbol, decimal_scale, is_active)
SELECT 'unit_' || id || '_kg', id, 'KG', 'Kilogram', 'kg', 3, 1 FROM stores;
INSERT OR IGNORE INTO units (id, store_id, code, name, symbol, decimal_scale, is_active)
SELECT 'unit_' || id || '_ml', id, 'ML', 'Mililiter', 'ml', 3, 1 FROM stores;
INSERT OR IGNORE INTO units (id, store_id, code, name, symbol, decimal_scale, is_active)
SELECT 'unit_' || id || '_liter', id, 'LITER', 'Liter', 'L', 3, 1 FROM stores;

ALTER TABLE products ADD COLUMN item_type_id TEXT REFERENCES item_types(id);
ALTER TABLE products ADD COLUMN base_unit_id TEXT REFERENCES units(id);

UPDATE products
SET item_type_id = (
  SELECT item_types.id
  FROM item_types
  WHERE item_types.store_id = products.store_id AND item_types.code = 'FINISHED_GOOD'
  LIMIT 1
)
WHERE item_type_id IS NULL;

UPDATE products
SET base_unit_id = (
  SELECT units.id
  FROM units
  WHERE units.store_id = products.store_id AND units.code = 'PCS'
  LIMIT 1
)
WHERE base_unit_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_store_item_type
  ON products(store_id, item_type_id, is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_products_store_base_unit
  ON products(store_id, base_unit_id);
CREATE INDEX IF NOT EXISTS idx_item_types_store_active_name
  ON item_types(store_id, is_active, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_units_store_active_name
  ON units(store_id, is_active, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS manufacturing_recipes (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  output_product_id INTEGER NOT NULL,
  output_unit_id TEXT NOT NULL,
  output_quantity_milli INTEGER NOT NULL CHECK (output_quantity_milli > 0),
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  notes TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (output_product_id) REFERENCES products(id),
  FOREIGN KEY (output_unit_id) REFERENCES units(id),
  UNIQUE (store_id, output_product_id, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_manufacturing_recipe_one_active_output
  ON manufacturing_recipes(store_id, output_product_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_manufacturing_recipes_store_status_output
  ON manufacturing_recipes(store_id, status, output_product_id, revision DESC);

CREATE TABLE IF NOT EXISTS manufacturing_recipe_components (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  component_product_id INTEGER NOT NULL,
  component_unit_id TEXT NOT NULL,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  display_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (recipe_id) REFERENCES manufacturing_recipes(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (component_product_id) REFERENCES products(id),
  FOREIGN KEY (component_unit_id) REFERENCES units(id),
  UNIQUE (recipe_id, component_product_id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturing_components_recipe_order
  ON manufacturing_recipe_components(recipe_id, display_order, component_product_id);
CREATE INDEX IF NOT EXISTS idx_manufacturing_components_store_product
  ON manufacturing_recipe_components(store_id, component_product_id);
