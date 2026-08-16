PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS debugger_audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL CHECK (actor_id = 'debugger'),
  request_id TEXT NOT NULL UNIQUE,
  request_method TEXT NOT NULL,
  request_path TEXT NOT NULL,
  module_code TEXT NOT NULL DEFAULT 'DEBUGGER',
  store_code TEXT NOT NULL DEFAULT '',
  result_status INTEGER NOT NULL,
  result_code TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_debugger_audit_occurred
  ON debugger_audit_log(occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_debugger_audit_module_store
  ON debugger_audit_log(module_code, store_code, occurred_at DESC);
