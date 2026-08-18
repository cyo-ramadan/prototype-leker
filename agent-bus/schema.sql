PRAGMA foreign_keys = ON;

-- MAXI Agent Task Board — MAXI_AGENT_TASK_BOARD_V1
--
-- Applies to D1 `maxi-agent-bus` (cbba8e7a-6bbf-45b9-9796-1dbce5dfa6b6), NOT to
-- prototype-leker-db. Agent coordination is tooling; putting it inside a product
-- database would place agent state inside a tenant's data once Leker is
-- multi-tenant, for no benefit.

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,                    -- e.g. karen1.2
  family TEXT NOT NULL,                   -- karen | elle | hana | zee
  slot INTEGER NOT NULL CHECK (slot >= 1),
  session INTEGER NOT NULL CHECK (session >= 1),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  UNIQUE (family, slot, session)
);

CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,                   -- must exist in MODULE_OWNERSHIP.md
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  inputs TEXT NOT NULL DEFAULT '',        -- files, tables, endpoints to read first
  contract TEXT NOT NULL DEFAULT '',      -- ids that must line up, invariants to hold
  done_when TEXT NOT NULL,                -- checkable conditions, not intentions
  forbidden TEXT NOT NULL DEFAULT '',     -- what this task must not touch
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'CLAIMED', 'REPORTED', 'BLOCKED', 'DONE')),
  written_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (written_by) REFERENCES agent_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_open ON agent_tasks (status, module, created_at);

-- Handoffs are written before the receiving session may claim, so the trigger
-- below can see them. A handoff is the knowledge transfer itself, not a receipt.
CREATE TABLE IF NOT EXISTS agent_task_handoffs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  from_session_id TEXT NOT NULL,
  to_session_id TEXT NOT NULL,
  done_so_far TEXT NOT NULL,
  not_done TEXT NOT NULL,
  learned TEXT NOT NULL DEFAULT '',       -- what is true but not visible in the code
  do_not_repeat TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id),
  FOREIGN KEY (from_session_id) REFERENCES agent_sessions(id),
  FOREIGN KEY (to_session_id) REFERENCES agent_sessions(id),
  CHECK (from_session_id <> to_session_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_handoffs_task ON agent_task_handoffs (task_id, created_at);

CREATE TABLE IF NOT EXISTS agent_task_claims (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TEXT,
  release_reason TEXT CHECK (release_reason IN ('REPORTED', 'HANDOFF', 'BLOCKED', 'ABANDONED')),
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id),
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id),
  CHECK (released_at IS NULL OR release_reason IS NOT NULL)
);

-- One task, one holder. Two agents editing the same module in parallel is the
-- collision the slot numbering exists to prevent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_claims_open
  ON agent_task_claims (task_id) WHERE released_at IS NULL;

-- A later session may not pick up another session's task unless a handoff names
-- it. This is a trigger and not a convention because the convention is exactly
-- what failed: sessions ended, their knowledge ended with them, and the next one
-- re-derived it wrongly.
CREATE TRIGGER IF NOT EXISTS trg_agent_claim_requires_handoff
BEFORE INSERT ON agent_task_claims
WHEN EXISTS (
      SELECT 1 FROM agent_task_claims c
      WHERE c.task_id = NEW.task_id AND c.session_id <> NEW.session_id
    )
 AND NOT EXISTS (
      SELECT 1 FROM agent_task_handoffs h
      WHERE h.task_id = NEW.task_id AND h.to_session_id = NEW.session_id
    )
BEGIN
  SELECT RAISE(ABORT, 'HANDOFF_REQUIRED');
END;

-- Reports carry evidence. A status claim with no evidence is not a report, and
-- only Hana closes a task, so no agent verifies its own work.
CREATE TABLE IF NOT EXISTS agent_task_reports (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  done_when_outcome TEXT NOT NULL,
  evidence TEXT NOT NULL,                 -- commands run, output, tests added
  open_risks TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id),
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id),
  CHECK (length(trim(evidence)) > 0)
);

CREATE TABLE IF NOT EXISTS agent_task_verdicts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('ACCEPTED', 'REJECTED', 'AUDITED')),
  reason TEXT NOT NULL DEFAULT '',
  decided_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id),
  FOREIGN KEY (report_id) REFERENCES agent_task_reports(id),
  FOREIGN KEY (decided_by) REFERENCES agent_sessions(id)
);
