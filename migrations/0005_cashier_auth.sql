PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cashiers (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  store_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE IF NOT EXISTS cashier_sessions (
  token_hash TEXT PRIMARY KEY,
  cashier_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (cashier_id) REFERENCES cashiers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cashiers_store_active
  ON cashiers(store_id, is_active, employee_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_cashier_sessions_expiry
  ON cashier_sessions(expires_at);

-- Seed a second gerai so the two prototype cashier accounts are isolated immediately.
INSERT OR IGNORE INTO stores (id, code, store_name, address, logo_data, is_active)
VALUES ('store_002', 'G002', 'MAXI LEKER G002', '', '', 1);

-- Give G002 an independent copy of the initial menu for immediate testing.
INSERT OR IGNORE INTO products (
  id, store_id, name, purchase_price, price, category, emoji, image_data,
  display_order, is_active, created_at, updated_at
)
SELECT id + 1000, 'store_002', name, purchase_price, price, category, emoji, image_data,
       display_order, is_active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM products
WHERE store_id = 'store_001';

INSERT OR IGNORE INTO categories (
  store_id, name, display_order, is_active, created_at, updated_at
)
SELECT 'store_002', name, display_order, is_active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM categories
WHERE store_id = 'store_001';

-- Prototype seed credentials only. Password hashes are SHA-256.
-- wowo / wowo123
INSERT OR REPLACE INTO cashiers (
  id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at
) VALUES (
  'cashier_wowo', 'wowo',
  '86178755314497e519ada00270e42945c9568193b1d1bebf99e233590de8d137',
  'Wowo', 'store_001', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- wiwi / wiwi123
INSERT OR REPLACE INTO cashiers (
  id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at
) VALUES (
  'cashier_wiwi', 'wiwi',
  '6fd4e984603bf7a24d721b244326f99ced4f0498cd0c95ead0f935bc38e718e3',
  'Wiwi', 'store_002', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);
