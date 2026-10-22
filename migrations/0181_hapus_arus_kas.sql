-- Hapus Arus Kas (Bos Cyo, 2026-10-22): soft delete + jurnal pembalik, src/cash-flow-void.js.
-- Baris tidak pernah dihapus; voided_at membuat uang laci (drawer-report.js) dan daftar transaksi
-- tidak lagi menghitungnya, dan sinkron Akuntansi tidak memposting ulang.
ALTER TABLE approval_requests ADD COLUMN voided_at TEXT;
ALTER TABLE approval_requests ADD COLUMN voided_by_role TEXT NOT NULL DEFAULT '';
ALTER TABLE approval_requests ADD COLUMN voided_by_id TEXT NOT NULL DEFAULT '';
ALTER TABLE approval_requests ADD COLUMN void_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE cash_ledger_entries ADD COLUMN voided_at TEXT;

-- Pengajuan hapus Arus Kas oleh CS (ACC/Tolak Admin). Terpisah dari approval_permits karena CHECK
-- subject_type tabel itu tidak bisa diperluas tanpa membangun ulang tabel yang dirujuk tabel lain.
CREATE TABLE IF NOT EXISTS cash_flow_void_permits (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  drawer_session_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  request_id TEXT NOT NULL REFERENCES approval_requests(id),
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (approval_status IN ('pending_approval', 'approved', 'rejected')),
  execution_status TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED' CHECK (execution_status IN ('NOT_ATTEMPTED', 'EXECUTED', 'FAILED')),
  execution_detail TEXT NOT NULL DEFAULT '',
  decision_note TEXT NOT NULL DEFAULT '',
  decided_by_role TEXT,
  decided_by_id TEXT,
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  executed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cash_flow_void_permits_store ON cash_flow_void_permits (store_id, approval_status, requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_flow_void_permits_one_pending ON cash_flow_void_permits (request_id) WHERE approval_status = 'pending_approval';
