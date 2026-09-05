PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stock_adjustment_forms (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (store_id, name)
);

CREATE TABLE IF NOT EXISTS stock_adjustment_form_items (
  form_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  FOREIGN KEY (form_id) REFERENCES stock_adjustment_forms(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  PRIMARY KEY (form_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_adjustment_forms_store_active_name
  ON stock_adjustment_forms(store_id, is_active, name COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_stock_adjustment_form_items_store_form_order
  ON stock_adjustment_form_items(store_id, form_id, display_order, product_id);

CREATE TRIGGER IF NOT EXISTS trg_stock_adjustment_form_item_scope_insert
BEFORE INSERT ON stock_adjustment_form_items
WHEN NOT EXISTS (
       SELECT 1 FROM stock_adjustment_forms f
       WHERE f.id = NEW.form_id AND f.store_id = NEW.store_id
     )
   OR NOT EXISTS (
       SELECT 1 FROM products p
       WHERE p.id = NEW.product_id AND p.store_id = NEW.store_id
     )
BEGIN
  SELECT RAISE(ABORT, 'STOCK_ADJUSTMENT_FORM_ITEM_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_adjustment_form_item_scope_update
BEFORE UPDATE OF form_id, store_id, product_id ON stock_adjustment_form_items
WHEN NOT EXISTS (
       SELECT 1 FROM stock_adjustment_forms f
       WHERE f.id = NEW.form_id AND f.store_id = NEW.store_id
     )
   OR NOT EXISTS (
       SELECT 1 FROM products p
       WHERE p.id = NEW.product_id AND p.store_id = NEW.store_id
     )
BEGIN
  SELECT RAISE(ABORT, 'STOCK_ADJUSTMENT_FORM_ITEM_SCOPE_MISMATCH');
END;
