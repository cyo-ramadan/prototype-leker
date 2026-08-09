PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS trg_orders_status_history;

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  store_name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  logo_data TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO stores (id, code, store_name, address, logo_data, is_active)
SELECT 'store_001', 'G001', COALESCE(NULLIF(store_name, ''), 'MAXI LEKER'), '', COALESCE(logo_data, ''), 1
FROM store_settings
WHERE id = 1;

INSERT OR IGNORE INTO stores (id, code, store_name, address, logo_data, is_active)
VALUES ('store_001', 'G001', 'MAXI LEKER', '', '', 1);

ALTER TABLE order_items RENAME TO order_items_legacy;
ALTER TABLE order_status_history RENAME TO order_status_history_legacy;
ALTER TABLE orders RENAME TO orders_legacy;
ALTER TABLE products RENAME TO products_legacy;
ALTER TABLE categories RENAME TO categories_legacy;
ALTER TABLE contacts RENAME TO contacts_legacy;

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  purchase_price INTEGER NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  price INTEGER NOT NULL CHECK (price >= 0),
  category TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  image_data TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (store_id, name)
);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
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
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (store_id, business_date, order_no)
);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  note TEXT NOT NULL DEFAULT '',
  line_total INTEGER NOT NULL CHECK (line_total >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

INSERT INTO products (
  id, store_id, name, purchase_price, price, category, emoji, image_data,
  display_order, is_active, created_at, updated_at
)
SELECT id, 'store_001', name, purchase_price, price, category, emoji, image_data,
       display_order, is_active, created_at, updated_at
FROM products_legacy;

INSERT INTO categories (
  id, store_id, name, display_order, is_active, created_at, updated_at
)
SELECT id, 'store_001', name, display_order, is_active, created_at, updated_at
FROM categories_legacy;

INSERT INTO contacts (
  id, store_id, name, phone, email, notes, created_at, updated_at
)
SELECT id, 'store_001', name, phone, email, notes, created_at, updated_at
FROM contacts_legacy;

INSERT INTO orders (
  id, store_id, business_date, order_no, customer_name, table_label, general_note,
  total_amount, status, created_at, updated_at, ready_at, completed_at, cancelled_at
)
SELECT id, 'store_001', business_date, order_no, customer_name, table_label, general_note,
       total_amount, status, created_at, updated_at, ready_at, completed_at, cancelled_at
FROM orders_legacy;

INSERT INTO order_items (
  id, store_id, order_id, product_id, product_name, unit_price,
  quantity, note, line_total, created_at
)
SELECT id, 'store_001', order_id, product_id, product_name, unit_price,
       quantity, note, line_total, created_at
FROM order_items_legacy;

INSERT INTO order_status_history (
  id, store_id, order_id, from_status, to_status, changed_at
)
SELECT id, 'store_001', order_id, from_status, to_status, changed_at
FROM order_status_history_legacy;

DROP TABLE order_items_legacy;
DROP TABLE order_status_history_legacy;
DROP TABLE orders_legacy;
DROP TABLE products_legacy;
DROP TABLE categories_legacy;
DROP TABLE contacts_legacy;

CREATE INDEX idx_products_store_active_order
  ON products(store_id, is_active, display_order, id);
CREATE INDEX idx_categories_store_active_order
  ON categories(store_id, is_active, display_order, id);
CREATE INDEX idx_contacts_store_name
  ON contacts(store_id, name COLLATE NOCASE);
CREATE INDEX idx_orders_store_status_created_at
  ON orders(store_id, status, created_at DESC);
CREATE INDEX idx_orders_store_business_date
  ON orders(store_id, business_date, order_no);
CREATE INDEX idx_order_items_store_order_id
  ON order_items(store_id, order_id);
CREATE INDEX idx_order_status_history_store_order_id
  ON order_status_history(store_id, order_id, changed_at DESC);

CREATE TRIGGER trg_orders_status_history
AFTER UPDATE OF status ON orders
WHEN OLD.status <> NEW.status
BEGIN
  INSERT INTO order_status_history (store_id, order_id, from_status, to_status, changed_at)
  VALUES (NEW.store_id, NEW.id, OLD.status, NEW.status, NEW.updated_at);
END;

PRAGMA foreign_keys = ON;
