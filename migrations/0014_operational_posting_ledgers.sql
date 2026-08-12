PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cash_ledger_entries (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL,
  approval_request_id TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  posted_at TEXT NOT NULL,
  approved_by_role TEXT NOT NULL,
  approved_by_id TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (drawer_session_id) REFERENCES cash_drawer_sessions(id),
  FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id)
);

CREATE TABLE IF NOT EXISTS inventory_stock_balances (
  store_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (store_id, product_id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS inventory_ledger_entries (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL,
  approval_request_id TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  note TEXT NOT NULL DEFAULT '',
  posted_at TEXT NOT NULL,
  approved_by_role TEXT NOT NULL,
  approved_by_id TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (drawer_session_id) REFERENCES cash_drawer_sessions(id),
  FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS asset_value_balances (
  store_id TEXT PRIMARY KEY,
  total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE IF NOT EXISTS asset_ledger_entries (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL,
  approval_request_id TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('INCREASE', 'DECREASE')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  posted_at TEXT NOT NULL,
  approved_by_role TEXT NOT NULL,
  approved_by_id TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (drawer_session_id) REFERENCES cash_drawer_sessions(id),
  FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id)
);

CREATE INDEX IF NOT EXISTS idx_cash_ledger_store_drawer_posted
  ON cash_ledger_entries(store_id, drawer_session_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_store_product_posted
  ON inventory_ledger_entries(store_id, product_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_ledger_store_posted
  ON asset_ledger_entries(store_id, posted_at DESC);
