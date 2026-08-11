PRAGMA foreign_keys = ON;

-- Drawer reporting fields. Existing drawer rows remain valid with safe defaults.
ALTER TABLE cash_drawer_sessions ADD COLUMN shift_label TEXT NOT NULL DEFAULT '';
ALTER TABLE cash_drawer_sessions ADD COLUMN closing_note TEXT NOT NULL DEFAULT '';
ALTER TABLE cash_drawer_sessions ADD COLUMN incentive_amount INTEGER NOT NULL DEFAULT 0;

-- Payment channel is required to separate cash and non-cash drawer reports.
-- Existing transactions are treated as CASH for backward compatibility.
ALTER TABLE sales ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'CASH';
ALTER TABLE purchases ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'CASH';
ALTER TABLE expenses ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'CASH';

-- Optional labels only. These are not accounting mappings or journal accounts.
ALTER TABLE other_income ADD COLUMN cash_account_label TEXT NOT NULL DEFAULT '';
ALTER TABLE other_income ADD COLUMN income_account_label TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS customer_share_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_share_group_stores (
  group_id TEXT NOT NULL,
  store_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, store_id),
  FOREIGN KEY (group_id) REFERENCES customer_share_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
);

-- Point ledger foundation only. No earning/redeem conversion is invented here.
CREATE TABLE IF NOT EXISTS customer_point_ledger (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  share_group_id TEXT,
  source_store_id TEXT NOT NULL,
  points_delta INTEGER NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('EARN', 'REDEEM', 'ADJUSTMENT')),
  reference_type TEXT NOT NULL DEFAULT '',
  reference_id TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (share_group_id) REFERENCES customer_share_groups(id),
  FOREIGN KEY (source_store_id) REFERENCES stores(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_share_members_group
  ON customer_share_group_stores(group_id, store_id);
CREATE INDEX IF NOT EXISTS idx_customer_points_customer_created
  ON customer_point_ledger(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drawer_store_opened
  ON cash_drawer_sessions(store_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_drawer_payment
  ON sales(drawer_session_id, payment_method, created_at);
CREATE INDEX IF NOT EXISTS idx_purchases_drawer_payment
  ON purchases(drawer_session_id, payment_method, created_at);
CREATE INDEX IF NOT EXISTS idx_expenses_drawer_payment
  ON expenses(drawer_session_id, payment_method, created_at);
