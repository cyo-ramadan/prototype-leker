PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS una_workspace_tasks (
 id TEXT PRIMARY KEY, principal_key TEXT NOT NULL, entity_id TEXT NOT NULL REFERENCES entities(id),
 store_id TEXT REFERENCES stores(id), scope_kind TEXT NOT NULL CHECK(scope_kind IN('entity','gerai')),
 title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('DRAFT','NEEDS_INPUT','RUNNING','PARTIAL','COMPLETED','CANCELLED','INDETERMINATE')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor>=0),
 total INTEGER NOT NULL DEFAULT 0 CHECK(total>=0), draft_json TEXT, pending_json TEXT,
 execution_key TEXT, locked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_una_workspace_principal_scope ON una_workspace_tasks(principal_key,entity_id,store_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS una_workspace_steps (
 task_id TEXT NOT NULL REFERENCES una_workspace_tasks(id), revision INTEGER NOT NULL, step_index INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN('COMPLETED','INDETERMINATE')), result_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(task_id,revision,step_index)
);
-- Only workspace metadata. No business facts, ledger, accounting triggers, or installed jobs.
