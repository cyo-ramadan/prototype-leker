PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('CASH_FLOW', 'GOODS_FLOW', 'ASSET')),
  approval_status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (approval_status IN ('pending_approval', 'approved', 'rejected')),
  posting_status TEXT NOT NULL DEFAULT 'unposted' CHECK (posting_status IN ('unposted', 'blocked', 'posted')),
  payload_json TEXT NOT NULL,
  decision_note TEXT NOT NULL DEFAULT '',
  posting_block_reason TEXT NOT NULL DEFAULT '',
  approved_by_role TEXT,
  approved_by_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  rejected_at TEXT,
  posted_at TEXT,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (drawer_session_id) REFERENCES cash_drawer_sessions(id),
  FOREIGN KEY (cashier_id) REFERENCES cashiers(id)
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_store_status_created
  ON approval_requests(store_id, approval_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_approval_requests_drawer_created
  ON approval_requests(drawer_session_id, created_at DESC);
