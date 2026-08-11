PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  customer_code TEXT NOT NULL,
  username TEXT COLLATE NOCASE,
  password_hash TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (store_id, customer_code),
  UNIQUE (store_id, username)
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customers_store_active_name
  ON customers(store_id, is_active, customer_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_expiry
  ON customer_sessions(expires_at);

-- Preserve existing branch contacts as customer masters. Existing contacts do
-- not receive login credentials automatically; Owner may add them later.
INSERT OR IGNORE INTO customers (
  id, store_id, customer_code, username, password_hash, customer_name,
  phone, email, notes, is_active, created_at, updated_at
)
SELECT
  c.id,
  c.store_id,
  'CUST-' || s.code || '-' || UPPER(REPLACE(REPLACE(c.id, 'contact_', ''), '-', '')),
  NULL,
  '',
  c.name,
  c.phone,
  c.email,
  c.notes,
  1,
  c.created_at,
  c.updated_at
FROM contacts c
JOIN stores s ON s.id = c.store_id;

ALTER TABLE orders ADD COLUMN customer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_store_customer_created_at
  ON orders(store_id, customer_id, created_at DESC);
