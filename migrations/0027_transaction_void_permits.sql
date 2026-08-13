PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS approval_permits (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  permit_type TEXT NOT NULL CHECK (permit_type IN ('TRANSACTION_VOID')),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('SALE','PURCHASE','EXPENSE')),
  subject_id TEXT NOT NULL,
  subject_snapshot_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (approval_status IN ('pending_approval','approved','rejected')),
  execution_status TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED' CHECK (execution_status IN ('NOT_ATTEMPTED','HOLD','EXECUTED','FAILED')),
  execution_code TEXT NOT NULL DEFAULT '',
  execution_detail TEXT NOT NULL DEFAULT '',
  accounting_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (accounting_status IN ('NOT_REQUIRED','REVERSED','FAILED')),
  original_journal_id TEXT,
  reversal_journal_id TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  approved_by_role TEXT,
  approved_by_id TEXT,
  requested_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_at TEXT,
  executed_at TEXT,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (drawer_session_id) REFERENCES cash_drawer_sessions(id),
  FOREIGN KEY (cashier_id) REFERENCES cashiers(id),
  FOREIGN KEY (original_journal_id) REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT,
  FOREIGN KEY (reversal_journal_id) REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_approval_permits_store_status_requested
  ON approval_permits(store_id, approval_status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_permits_cashier_requested
  ON approval_permits(cashier_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_permits_subject
  ON approval_permits(store_id, subject_type, subject_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_permits_one_pending_void
  ON approval_permits(store_id, permit_type, subject_type, subject_id)
  WHERE approval_status = 'pending_approval';

ALTER TABLE sales ADD COLUMN voided_at TEXT;
ALTER TABLE sales ADD COLUMN voided_by_role TEXT;
ALTER TABLE sales ADD COLUMN voided_by_id TEXT;
ALTER TABLE sales ADD COLUMN void_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE sales ADD COLUMN void_permit_id TEXT REFERENCES approval_permits(id) ON DELETE RESTRICT;

ALTER TABLE purchases ADD COLUMN voided_at TEXT;
ALTER TABLE purchases ADD COLUMN voided_by_role TEXT;
ALTER TABLE purchases ADD COLUMN voided_by_id TEXT;
ALTER TABLE purchases ADD COLUMN void_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE purchases ADD COLUMN void_permit_id TEXT REFERENCES approval_permits(id) ON DELETE RESTRICT;

ALTER TABLE expenses ADD COLUMN voided_at TEXT;
ALTER TABLE expenses ADD COLUMN voided_by_role TEXT;
ALTER TABLE expenses ADD COLUMN voided_by_id TEXT;
ALTER TABLE expenses ADD COLUMN void_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE expenses ADD COLUMN void_permit_id TEXT REFERENCES approval_permits(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_sales_store_void_created
  ON sales(store_id, voided_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_store_void_created
  ON purchases(store_id, voided_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_store_void_created
  ON expenses(store_id, voided_at, created_at DESC);
