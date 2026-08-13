PRAGMA foreign_keys = ON;

-- Accounting-facing product classification. Values are user-defined; no business kind is invented here.
CREATE TABLE IF NOT EXISTS product_kinds (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (store_id, code),
  UNIQUE (store_id, name)
);

CREATE INDEX IF NOT EXISTS idx_product_kinds_store_active_name
  ON product_kinds(store_id, is_active, name COLLATE NOCASE);

ALTER TABLE products ADD COLUMN product_kind_id TEXT REFERENCES product_kinds(id);

-- Exact unit-cost scale: 1 rupiah = 1,000,000 cost units.
-- This preserves sub-rupiah HPP precision without SQLite REAL/FLOAT arithmetic.
ALTER TABLE products ADD COLUMN average_cost INTEGER NOT NULL DEFAULT 0 CHECK (average_cost >= 0);
ALTER TABLE products ADD COLUMN last_purchase_price INTEGER NOT NULL DEFAULT 0 CHECK (last_purchase_price >= 0);
ALTER TABLE products ADD COLUMN cost_updated_at TEXT;
ALTER TABLE products ADD COLUMN last_purchase_at TEXT;

-- Legacy bootstrap only. Old purchase_price was manually editable and is not evidence of an actual last purchase.
-- Use it only as the best known opening HPP estimate; last_purchase_* starts unknown until a new itemized purchase posts.
UPDATE products
SET average_cost = CASE WHEN purchase_price > 0 THEN purchase_price * 1000000 ELSE 0 END,
    cost_updated_at = CASE WHEN purchase_price > 0 THEN CURRENT_TIMESTAMP ELSE NULL END
WHERE average_cost = 0;

CREATE INDEX IF NOT EXISTS idx_products_store_kind
  ON products(store_id, product_kind_id, is_active, display_order);

CREATE TRIGGER IF NOT EXISTS trg_products_kind_scope_insert
BEFORE INSERT ON products
WHEN NEW.product_kind_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM product_kinds k
    WHERE k.id = NEW.product_kind_id AND k.store_id = NEW.store_id AND k.is_active = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_KIND_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_products_kind_scope_update
BEFORE UPDATE OF store_id, product_kind_id ON products
WHEN NEW.product_kind_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM product_kinds k
    WHERE k.id = NEW.product_kind_id AND k.store_id = NEW.store_id AND k.is_active = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_KIND_SCOPE_MISMATCH');
END;

-- Purchases become itemized so stock and costing are based on product + quantity + exact line amount.
CREATE TABLE IF NOT EXISTS purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  product_kind_id TEXT,
  product_kind_code TEXT NOT NULL DEFAULT '',
  product_kind_name TEXT NOT NULL DEFAULT '',
  unit_id TEXT NOT NULL,
  unit_symbol TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total INTEGER NOT NULL CHECK (line_total > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
  average_cost_before INTEGER NOT NULL CHECK (average_cost_before >= 0),
  average_cost_after INTEGER NOT NULL CHECK (average_cost_after >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (product_kind_id) REFERENCES product_kinds(id),
  FOREIGN KEY (unit_id) REFERENCES units(id),
  UNIQUE (purchase_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase
  ON purchase_items(purchase_id, product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_store_product_created
  ON purchase_items(store_id, product_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_purchase_item_scope
BEFORE INSERT ON purchase_items
WHEN NOT EXISTS (
       SELECT 1 FROM purchases p
       WHERE p.id = NEW.purchase_id AND p.store_id = NEW.store_id
     )
   OR NOT EXISTS (
       SELECT 1 FROM products p
       WHERE p.id = NEW.product_id
         AND p.store_id = NEW.store_id
         AND p.base_unit_id = NEW.unit_id
     )
   OR (NEW.product_kind_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM product_kinds k
       WHERE k.id = NEW.product_kind_id AND k.store_id = NEW.store_id
     ))
BEGIN
  SELECT RAISE(ABORT, 'PURCHASE_ITEM_SCOPE_MISMATCH');
END;

-- Historical HPP must not move when the master average changes later.
ALTER TABLE sale_items ADD COLUMN product_kind_id TEXT REFERENCES product_kinds(id);
ALTER TABLE sale_items ADD COLUMN product_kind_code TEXT NOT NULL DEFAULT '';
ALTER TABLE sale_items ADD COLUMN product_kind_name TEXT NOT NULL DEFAULT '';
ALTER TABLE sale_items ADD COLUMN unit_cost_snapshot INTEGER CHECK (unit_cost_snapshot IS NULL OR unit_cost_snapshot >= 0);
ALTER TABLE sale_items ADD COLUMN line_cogs INTEGER CHECK (line_cogs IS NULL OR line_cogs >= 0);

CREATE INDEX IF NOT EXISTS idx_sale_items_store_kind
  ON sale_items(store_id, product_kind_id, sale_id);
