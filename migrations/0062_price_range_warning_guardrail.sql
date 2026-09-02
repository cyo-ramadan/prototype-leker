PRAGMA foreign_keys = ON;

ALTER TABLE stores ADD COLUMN purchase_price_warning_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (purchase_price_warning_enabled IN (0, 1));

ALTER TABLE products ADD COLUMN min_purchase_price_scaled INTEGER CHECK (min_purchase_price_scaled IS NULL OR min_purchase_price_scaled >= 0);
ALTER TABLE products ADD COLUMN max_purchase_price_scaled INTEGER CHECK (max_purchase_price_scaled IS NULL OR max_purchase_price_scaled >= 0);
ALTER TABLE products ADD COLUMN min_average_cost_scaled INTEGER CHECK (min_average_cost_scaled IS NULL OR min_average_cost_scaled >= 0);
ALTER TABLE products ADD COLUMN max_average_cost_scaled INTEGER CHECK (max_average_cost_scaled IS NULL OR max_average_cost_scaled >= 0);

CREATE TRIGGER IF NOT EXISTS trg_product_price_ranges_insert
BEFORE INSERT ON products
WHEN (NEW.min_purchase_price_scaled IS NOT NULL AND NEW.max_purchase_price_scaled IS NOT NULL AND NEW.min_purchase_price_scaled > NEW.max_purchase_price_scaled)
  OR (NEW.min_average_cost_scaled IS NOT NULL AND NEW.max_average_cost_scaled IS NOT NULL AND NEW.min_average_cost_scaled > NEW.max_average_cost_scaled)
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_PRICE_RANGE_INVALID');
END;

CREATE TRIGGER IF NOT EXISTS trg_product_price_ranges_update
BEFORE UPDATE OF min_purchase_price_scaled, max_purchase_price_scaled, min_average_cost_scaled, max_average_cost_scaled ON products
WHEN (NEW.min_purchase_price_scaled IS NOT NULL AND NEW.max_purchase_price_scaled IS NOT NULL AND NEW.min_purchase_price_scaled > NEW.max_purchase_price_scaled)
  OR (NEW.min_average_cost_scaled IS NOT NULL AND NEW.max_average_cost_scaled IS NOT NULL AND NEW.min_average_cost_scaled > NEW.max_average_cost_scaled)
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_PRICE_RANGE_INVALID');
END;

CREATE TABLE IF NOT EXISTS product_average_cost_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  average_cost_scaled INTEGER NOT NULL CHECK (average_cost_scaled >= 0),
  min_average_cost_scaled INTEGER,
  max_average_cost_scaled INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_product_average_cost_alerts_store_created
  ON product_average_cost_alerts(store_id, created_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS trg_product_average_cost_out_of_range_alert
AFTER UPDATE OF average_cost ON products
WHEN EXISTS (
       SELECT 1 FROM stores s
       WHERE s.id = NEW.store_id AND s.purchase_price_warning_enabled = 1
     )
 AND (
       (NEW.min_average_cost_scaled IS NOT NULL AND NEW.average_cost < NEW.min_average_cost_scaled)
    OR (NEW.max_average_cost_scaled IS NOT NULL AND NEW.average_cost > NEW.max_average_cost_scaled)
 )
BEGIN
  INSERT INTO product_average_cost_alerts (
    store_id, product_id, average_cost_scaled,
    min_average_cost_scaled, max_average_cost_scaled, created_at
  ) VALUES (
    NEW.store_id, NEW.id, NEW.average_cost,
    NEW.min_average_cost_scaled, NEW.max_average_cost_scaled, CURRENT_TIMESTAMP
  );
END;
