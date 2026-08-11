PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customer_registration_requests (
  id TEXT PRIMARY KEY,
  request_code TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  rejection_reason TEXT NOT NULL DEFAULT '',
  customer_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_registration_pending_store_username
  ON customer_registration_requests(store_id, username COLLATE NOCASE)
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_customer_registration_store_status_created
  ON customer_registration_requests(store_id, status, created_at DESC);

-- G002 was originally seeded as an exact copy of G001 only for early multi-store testing.
-- Retire only clone rows that are still identical to their G001 source, preserving any rows
-- already edited manually in G002.
UPDATE products
SET is_active = 0, updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_002'
  AND id BETWEEN 1001 AND 1020
  AND EXISTS (
    SELECT 1 FROM products source
    WHERE source.store_id = 'store_001'
      AND source.id = products.id - 1000
      AND source.name = products.name
      AND source.price = products.price
  );

UPDATE categories
SET is_active = 0, updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_002'
  AND EXISTS (
    SELECT 1 FROM categories source
    WHERE source.store_id = 'store_001'
      AND source.name = categories.name
  );

INSERT OR IGNORE INTO categories (store_id, name, display_order, is_active, created_at, updated_at) VALUES
  ('store_002', 'Signature G002', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('store_002', 'Sweet G002', 2, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('store_002', 'Savory G002', 3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO products (
  id, store_id, name, purchase_price, price, category, emoji, image_data,
  display_order, is_active, created_at, updated_at
) VALUES
  (2001, 'store_002', 'Leker Dubai Crunch', 0, 16000, 'Signature G002', '🥞', '', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (2002, 'store_002', 'Leker Matcha Cheese', 0, 14000, 'Signature G002', '🍵', '', 2, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (2003, 'store_002', 'Leker Salted Caramel', 0, 13000, 'Sweet G002', '🍮', '', 3, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (2004, 'store_002', 'Leker Red Velvet', 0, 12000, 'Sweet G002', '❤️', '', 4, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (2005, 'store_002', 'Leker Coffee Cream', 0, 11000, 'Sweet G002', '☕', '', 5, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (2006, 'store_002', 'Leker Corn Cheese Spicy', 0, 14000, 'Savory G002', '🌽', '', 6, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
