PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS product_average_cost_history (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  previous_average_cost_scaled INTEGER NOT NULL CHECK (previous_average_cost_scaled >= 0),
  new_average_cost_scaled INTEGER NOT NULL CHECK (new_average_cost_scaled >= 0),
  change_reason TEXT NOT NULL CHECK (change_reason IN ('PURCHASE', 'PRODUCTION', 'CORRECTION')),
  reference_type TEXT NOT NULL CHECK (length(trim(reference_type)) > 0),
  reference_id TEXT NOT NULL CHECK (length(trim(reference_id)) > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  UNIQUE (store_id, product_id, change_reason, reference_type, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_product_average_cost_history_store_product_created
  ON product_average_cost_history(store_id, product_id, created_at DESC, id DESC);
