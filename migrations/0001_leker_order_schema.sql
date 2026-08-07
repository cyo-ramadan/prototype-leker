PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  category TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  business_date TEXT NOT NULL,
  order_no TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  table_label TEXT NOT NULL,
  general_note TEXT NOT NULL DEFAULT '',
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('NEW', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ready_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  UNIQUE (business_date, order_no)
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  note TEXT NOT NULL DEFAULT '',
  line_total INTEGER NOT NULL CHECK (line_total >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orders_status_created_at
  ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_business_date
  ON orders(business_date, order_no);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id
  ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id
  ON order_status_history(order_id, changed_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_orders_status_history
AFTER UPDATE OF status ON orders
WHEN OLD.status <> NEW.status
BEGIN
  INSERT INTO order_status_history (order_id, from_status, to_status, changed_at)
  VALUES (NEW.id, OLD.status, NEW.status, NEW.updated_at);
END;

INSERT INTO products (id, name, price, category, emoji, display_order, is_active) VALUES
  (1, 'Leker Cokelat', 8000, 'Classic', '🍫', 1, 1),
  (2, 'Leker Keju', 9000, 'Classic', '🧀', 2, 1),
  (3, 'Leker Cokelat Keju', 11000, 'Classic', '🍫', 3, 1),
  (4, 'Leker Pisang Cokelat', 11000, 'Classic', '🍌', 4, 1),
  (5, 'Leker Pisang Keju', 12000, 'Classic', '🍌', 5, 1),
  (6, 'Leker Pisang Cokelat Keju', 14000, 'Premium', '🍌', 6, 1),
  (7, 'Leker Oreo', 11000, 'Premium', '🍪', 7, 1),
  (8, 'Leker Oreo Keju', 13000, 'Premium', '🍪', 8, 1),
  (9, 'Leker Milo', 10000, 'Premium', '🥛', 9, 1),
  (10, 'Leker Milo Keju', 12000, 'Premium', '🥛', 10, 1),
  (11, 'Leker Tiramisu', 12000, 'Premium', '☕', 11, 1),
  (12, 'Leker Matcha', 12000, 'Premium', '🍵', 12, 1),
  (13, 'Leker Strawberry', 10000, 'Fruity', '🍓', 13, 1),
  (14, 'Leker Blueberry', 10000, 'Fruity', '🫐', 14, 1),
  (15, 'Leker Kacang Cokelat', 11000, 'Classic', '🥜', 15, 1),
  (16, 'Leker Jagung Keju', 12000, 'Savory', '🌽', 16, 1),
  (17, 'Leker Sosis', 12000, 'Savory', '🌭', 17, 1),
  (18, 'Leker Sosis Keju', 14000, 'Savory', '🌭', 18, 1),
  (19, 'Leker Telur Mayo', 13000, 'Savory', '🥚', 19, 1),
  (20, 'Leker Special Maxi', 15000, 'Signature', '👑', 20, 1)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  price = excluded.price,
  category = excluded.category,
  emoji = excluded.emoji,
  display_order = excluded.display_order,
  is_active = excluded.is_active,
  updated_at = CURRENT_TIMESTAMP;
