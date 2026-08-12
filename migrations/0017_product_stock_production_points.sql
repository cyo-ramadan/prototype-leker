PRAGMA foreign_keys = ON;

-- Product-level operational policy. Physical quantities remain integer; costing/HPP may use decimals.
ALTER TABLE products ADD COLUMN points_per_unit INTEGER NOT NULL DEFAULT 0 CHECK (points_per_unit >= 0);
ALTER TABLE products ADD COLUMN production_mode TEXT NOT NULL DEFAULT 'STOCK' CHECK (production_mode IN ('STOCK', 'DADAKAN'));
ALTER TABLE products ADD COLUMN recipe_link_enabled INTEGER NOT NULL DEFAULT 0 CHECK (recipe_link_enabled IN (0, 1));

ALTER TABLE sales ADD COLUMN customer_id TEXT REFERENCES customers(id);
ALTER TABLE sales ADD COLUMN total_points INTEGER NOT NULL DEFAULT 0 CHECK (total_points >= 0);

CREATE TABLE IF NOT EXISTS production_runs (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  drawer_session_id TEXT,
  sale_id TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('AUTO_DADAKAN', 'MANUAL')),
  output_product_id INTEGER NOT NULL,
  output_product_name TEXT NOT NULL,
  output_unit_id TEXT NOT NULL,
  output_unit_symbol TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  recipe_revision INTEGER NOT NULL CHECK (recipe_revision > 0),
  batches INTEGER NOT NULL CHECK (batches > 0),
  output_quantity_per_batch INTEGER NOT NULL CHECK (output_quantity_per_batch > 0),
  total_output_quantity INTEGER NOT NULL CHECK (total_output_quantity > 0),
  requested_sale_quantity INTEGER CHECK (requested_sale_quantity IS NULL OR requested_sale_quantity > 0),
  hpp_total REAL CHECK (hpp_total IS NULL OR hpp_total >= 0),
  hpp_per_unit REAL CHECK (hpp_per_unit IS NULL OR hpp_per_unit >= 0),
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'CANCELLED')),
  created_by_role TEXT NOT NULL,
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (drawer_session_id) REFERENCES cash_drawer_sessions(id),
  FOREIGN KEY (sale_id) REFERENCES sales(id),
  FOREIGN KEY (output_product_id) REFERENCES products(id),
  FOREIGN KEY (output_unit_id) REFERENCES units(id),
  FOREIGN KEY (recipe_id) REFERENCES manufacturing_recipes(id),
  UNIQUE (sale_id, output_product_id)
);

CREATE TABLE IF NOT EXISTS production_run_components (
  id TEXT PRIMARY KEY,
  production_run_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  component_product_id INTEGER NOT NULL,
  component_product_name TEXT NOT NULL,
  component_unit_id TEXT NOT NULL,
  component_unit_symbol TEXT NOT NULL,
  quantity_per_batch INTEGER NOT NULL CHECK (quantity_per_batch > 0),
  total_quantity INTEGER NOT NULL CHECK (total_quantity > 0),
  unit_cost_snapshot REAL CHECK (unit_cost_snapshot IS NULL OR unit_cost_snapshot >= 0),
  total_cost_snapshot REAL CHECK (total_cost_snapshot IS NULL OR total_cost_snapshot >= 0),
  FOREIGN KEY (production_run_id) REFERENCES production_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (component_product_id) REFERENCES products(id),
  FOREIGN KEY (component_unit_id) REFERENCES units(id),
  UNIQUE (production_run_id, component_product_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  unit_symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  drawer_session_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT 'SYSTEM',
  actor_id TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (unit_id) REFERENCES units(id),
  FOREIGN KEY (drawer_session_id) REFERENCES cash_drawer_sessions(id)
);

ALTER TABLE sale_items ADD COLUMN points_per_unit INTEGER NOT NULL DEFAULT 0 CHECK (points_per_unit >= 0);
ALTER TABLE sale_items ADD COLUMN line_points INTEGER NOT NULL DEFAULT 0 CHECK (line_points >= 0);
ALTER TABLE sale_items ADD COLUMN recipe_id TEXT REFERENCES manufacturing_recipes(id);
ALTER TABLE sale_items ADD COLUMN production_run_id TEXT REFERENCES production_runs(id);

CREATE INDEX IF NOT EXISTS idx_products_store_production_policy
  ON products(store_id, production_mode, recipe_link_enabled, is_active);
CREATE INDEX IF NOT EXISTS idx_sales_store_customer_created
  ON sales(store_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_production_runs_store_created
  ON production_runs(store_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_production_runs_recipe
  ON production_runs(store_id, recipe_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_production_components_run
  ON production_run_components(production_run_id, component_product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_store_product_time
  ON stock_movements(store_id, product_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_store_source
  ON stock_movements(store_id, source_type, source_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_points_sale_earn_once
  ON customer_point_ledger(customer_id, reference_type, reference_id, activity_type)
  WHERE reference_type = 'SALE' AND activity_type = 'EARN';

-- Existing approved goods-flow history becomes visible in the canonical stock movement read model.
INSERT OR IGNORE INTO stock_movements (
  id, source_key, store_id, product_id, product_name, unit_id, unit_symbol,
  direction, quantity, source_type, source_id, drawer_session_id, note,
  actor_role, actor_id, occurred_at
)
SELECT
  'stock_backfill_' || l.id,
  'GOODS_FLOW:' || l.approval_request_id,
  l.store_id,
  l.product_id,
  l.product_name,
  p.base_unit_id,
  COALESCE(u.symbol, ''),
  l.direction,
  l.quantity,
  'GOODS_FLOW',
  l.approval_request_id,
  l.drawer_session_id,
  l.note,
  l.approved_by_role,
  l.approved_by_id,
  l.posted_at
FROM inventory_ledger_entries l
JOIN products p ON p.id = l.product_id AND p.store_id = l.store_id
LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
WHERE p.base_unit_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_stock_movement_scope
BEFORE INSERT ON stock_movements
WHEN NOT EXISTS (
  SELECT 1
  FROM products p
  JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
  WHERE p.id = NEW.product_id
    AND p.store_id = NEW.store_id
    AND p.base_unit_id = NEW.unit_id
)
BEGIN
  SELECT RAISE(ABORT, 'STOCK_MOVEMENT_SCOPE_MISMATCH');
END;
