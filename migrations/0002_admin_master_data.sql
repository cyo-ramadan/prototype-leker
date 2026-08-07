PRAGMA foreign_keys = ON;

ALTER TABLE products ADD COLUMN purchase_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN image_data TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO categories (name, display_order)
SELECT category, MIN(display_order)
FROM products
GROUP BY category;

CREATE TABLE IF NOT EXISTS store_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  store_name TEXT NOT NULL DEFAULT 'MAXI LEKER',
  logo_data TEXT NOT NULL DEFAULT '',
  admin_pin_hash TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO store_settings (id, store_name, logo_data, admin_pin_hash)
VALUES (1, 'MAXI LEKER', '', '');

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_categories_active_order
  ON categories(is_active, display_order, id);
CREATE INDEX IF NOT EXISTS idx_contacts_name
  ON contacts(name COLLATE NOCASE);
