PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS owner_accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS owner_sessions (
  token_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES owner_accounts(id) ON DELETE CASCADE
);

-- Temporary prototype Owner account. Password: 123456
INSERT OR REPLACE INTO owner_accounts (
  id, username, password_hash, display_name, is_active, created_at, updated_at
) VALUES (
  'owner_primary',
  'owner',
  '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92',
  'Owner MAXI Leker',
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (store_id, name)
);

CREATE TABLE IF NOT EXISTS cash_drawer_sessions (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  opening_amount INTEGER NOT NULL DEFAULT 0 CHECK (opening_amount >= 0),
  closing_amount INTEGER CHECK (closing_amount IS NULL OR closing_amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (cashier_id) REFERENCES cashiers(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_drawer_one_open_per_store
  ON cash_drawer_sessions(store_id)
  WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS idx_cash_drawer_cashier_status
  ON cash_drawer_sessions(cashier_id, status, opened_at DESC);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (drawer_session_id) REFERENCES cash_drawer_sessions(id),
  FOREIGN KEY (cashier_id) REFERENCES cashiers(id)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  line_total INTEGER NOT NULL CHECK (line_total >= 0),
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  supplier_id TEXT,
  description TEXT NOT NULL,
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (drawer_session_id) REFERENCES cash_drawer_sessions(id),
  FOREIGN KEY (cashier_id) REFERENCES cashiers(id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (drawer_session_id) REFERENCES cash_drawer_sessions(id),
  FOREIGN KEY (cashier_id) REFERENCES cashiers(id)
);

CREATE TABLE IF NOT EXISTS other_income (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (drawer_session_id) REFERENCES cash_drawer_sessions(id),
  FOREIGN KEY (cashier_id) REFERENCES cashiers(id)
);

CREATE INDEX IF NOT EXISTS idx_suppliers_store_active_name
  ON suppliers(store_id, is_active, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_sales_store_created_at
  ON sales(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id
  ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_purchases_store_created_at
  ON purchases(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_store_created_at
  ON expenses(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_other_income_store_created_at
  ON other_income(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_owner_sessions_expiry
  ON owner_sessions(expires_at);
