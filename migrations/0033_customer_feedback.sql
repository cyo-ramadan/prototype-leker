PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customer_feedback_reports (
  id TEXT PRIMARY KEY,
  feedback_code TEXT NOT NULL UNIQUE,
  store_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('PRODUCT_QUALITY', 'SERVICE', 'CLEANLINESS')),
  manual_note TEXT NOT NULL DEFAULT '',
  business_month TEXT NOT NULL,
  entitlement_type TEXT NOT NULL CHECK (entitlement_type IN ('MONTHLY', 'QUALIFYING_SALE')),
  entitlement_key TEXT NOT NULL UNIQUE,
  qualifying_sale_id TEXT,
  reward_points INTEGER NOT NULL DEFAULT 500 CHECK (reward_points >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  FOREIGN KEY (qualifying_sale_id) REFERENCES sales(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS customer_feedback_report_issues (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  issue_code TEXT NOT NULL,
  issue_label_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (report_id, issue_code),
  FOREIGN KEY (report_id) REFERENCES customer_feedback_reports(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_feedback_store_created
  ON customer_feedback_reports(store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_feedback_customer_created
  ON customer_feedback_reports(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_feedback_customer_month
  ON customer_feedback_reports(customer_id, business_month, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_feedback_qualifying_sale
  ON customer_feedback_reports(qualifying_sale_id)
  WHERE qualifying_sale_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_feedback_issue_report
  ON customer_feedback_report_issues(report_id, created_at);
