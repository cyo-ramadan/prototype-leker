PRAGMA foreign_keys = OFF;

ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'customer' CHECK (source IN ('customer', 'cashier'));
ALTER TABLE orders ADD COLUMN drawer_session_id TEXT;
ALTER TABLE sales ADD COLUMN order_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_store_drawer_source_created_at
  ON orders(store_id, drawer_session_id, source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_store_order_id
  ON sales(store_id, order_id);

ALTER TABLE order_items RENAME TO order_items_legacy_0012;

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  note TEXT NOT NULL DEFAULT '',
  line_total INTEGER NOT NULL CHECK (line_total >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

INSERT INTO order_items (
  id, store_id, order_id, product_id, product_name, unit_price,
  quantity, note, line_total, created_at
)
SELECT
  id, store_id, order_id, product_id, product_name, unit_price,
  quantity, note, line_total, created_at
FROM order_items_legacy_0012;

DROP TABLE order_items_legacy_0012;

CREATE INDEX IF NOT EXISTS idx_order_items_store_order_id
  ON order_items(store_id, order_id);

PRAGMA foreign_keys = ON;
