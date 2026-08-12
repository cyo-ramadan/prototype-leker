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

CREATE TRIGGER IF NOT EXISTS trg_stores_seed_manufacturing_defaults
AFTER INSERT ON stores
BEGIN
  INSERT OR IGNORE INTO item_types (id, store_id, code, name, can_sell, can_purchase, can_produce, can_consume, track_stock, is_active)
  VALUES ('item_type_' || NEW.id || '_finished', NEW.id, 'FINISHED_GOOD', 'Barang Jadi', 1, 1, 1, 1, 1, 1);
  INSERT OR IGNORE INTO item_types (id, store_id, code, name, can_sell, can_purchase, can_produce, can_consume, track_stock, is_active)
  VALUES ('item_type_' || NEW.id || '_raw', NEW.id, 'RAW_MATERIAL', 'Bahan', 0, 1, 0, 1, 1, 1);
  INSERT OR IGNORE INTO item_types (id, store_id, code, name, can_sell, can_purchase, can_produce, can_consume, track_stock, is_active)
  VALUES ('item_type_' || NEW.id || '_semi', NEW.id, 'SEMI_FINISHED', 'Bahan Setengah Jadi', 0, 1, 1, 1, 1, 1);
  INSERT OR IGNORE INTO units (id, store_id, code, name, symbol, decimal_scale, is_active)
  VALUES ('unit_' || NEW.id || '_pcs', NEW.id, 'PCS', 'Pcs', 'pcs', 0, 1);
  INSERT OR IGNORE INTO units (id, store_id, code, name, symbol, decimal_scale, is_active)
  VALUES ('unit_' || NEW.id || '_gram', NEW.id, 'GRAM', 'Gram', 'g', 3, 1);
  INSERT OR IGNORE INTO units (id, store_id, code, name, symbol, decimal_scale, is_active)
  VALUES ('unit_' || NEW.id || '_kg', NEW.id, 'KG', 'Kilogram', 'kg', 3, 1);
  INSERT OR IGNORE INTO units (id, store_id, code, name, symbol, decimal_scale, is_active)
  VALUES ('unit_' || NEW.id || '_ml', NEW.id, 'ML', 'Mililiter', 'ml', 3, 1);
  INSERT OR IGNORE INTO units (id, store_id, code, name, symbol, decimal_scale, is_active)
  VALUES ('unit_' || NEW.id || '_liter', NEW.id, 'LITER', 'Liter', 'L', 3, 1);
END;

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

CREATE TRIGGER IF NOT EXISTS trg_products_default_manufacturing_metadata
AFTER INSERT ON products
WHEN NEW.item_type_id IS NULL OR NEW.base_unit_id IS NULL
BEGIN
  UPDATE products
  SET item_type_id = COALESCE(
        NEW.item_type_id,
        (SELECT id FROM item_types WHERE store_id = NEW.store_id AND code = 'FINISHED_GOOD' LIMIT 1)
      ),
      base_unit_id = COALESCE(
        NEW.base_unit_id,
        (SELECT id FROM units WHERE store_id = NEW.store_id AND code = 'PCS' LIMIT 1)
      )
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_products_manufacturing_scope_insert
BEFORE INSERT ON products
WHEN (NEW.item_type_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM item_types WHERE id = NEW.item_type_id AND store_id = NEW.store_id
      ))
   OR (NEW.base_unit_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM units WHERE id = NEW.base_unit_id AND store_id = NEW.store_id
      ))
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_MASTER_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_products_manufacturing_scope_update
BEFORE UPDATE OF store_id, item_type_id, base_unit_id ON products
WHEN (NEW.item_type_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM item_types WHERE id = NEW.item_type_id AND store_id = NEW.store_id
      ))
   OR (NEW.base_unit_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM units WHERE id = NEW.base_unit_id AND store_id = NEW.store_id
      ))
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_MASTER_SCOPE_MISMATCH');
END;

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

CREATE TRIGGER IF NOT EXISTS trg_manufacturing_recipe_scope
BEFORE INSERT ON manufacturing_recipes
WHEN NOT EXISTS (
       SELECT 1 FROM products p
       WHERE p.id = NEW.output_product_id
         AND p.store_id = NEW.store_id
         AND p.base_unit_id = NEW.output_unit_id
     )
   OR NOT EXISTS (
       SELECT 1 FROM units u
       WHERE u.id = NEW.output_unit_id AND u.store_id = NEW.store_id
     )
BEGIN
  SELECT RAISE(ABORT, 'RECIPE_OUTPUT_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_manufacturing_component_scope
BEFORE INSERT ON manufacturing_recipe_components
WHEN NOT EXISTS (
       SELECT 1 FROM manufacturing_recipes r
       WHERE r.id = NEW.recipe_id AND r.store_id = NEW.store_id
     )
   OR NOT EXISTS (
       SELECT 1 FROM products p
       WHERE p.id = NEW.component_product_id
         AND p.store_id = NEW.store_id
         AND p.base_unit_id = NEW.component_unit_id
     )
   OR NOT EXISTS (
       SELECT 1 FROM units u
       WHERE u.id = NEW.component_unit_id AND u.store_id = NEW.store_id
     )
BEGIN
  SELECT RAISE(ABORT, 'RECIPE_COMPONENT_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_sale_items_requires_sellable_product
BEFORE INSERT ON sale_items
WHEN EXISTS (
  SELECT 1
  FROM products p
  JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
  WHERE p.id = NEW.product_id AND p.store_id = NEW.store_id AND t.can_sell = 0
)
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_NOT_SELLABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_order_items_requires_sellable_product
BEFORE INSERT ON order_items
WHEN EXISTS (
  SELECT 1
  FROM products p
  JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
  WHERE p.id = NEW.product_id AND p.store_id = NEW.store_id AND t.can_sell = 0
)
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_NOT_SELLABLE');
END;
