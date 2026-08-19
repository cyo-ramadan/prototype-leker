-- Dikerjakan oleh: hana1.1 — arsitektur, MAXI agent roster
-- MAXI Agent Bus — reproduces D1 `maxi-agent-bus`
-- (cbba8e7a-6bbf-45b9-9796-1dbce5dfa6b6), account Daily Napkin.
--
-- The base tables here were designed by Zee and already existed. Hana checked
-- before building and found them: tasks, reports, escalations,
-- core_change_requests, territory, handshake. Adding a second parallel board
-- would have been the duplicate architecture this project keeps paying for, so
-- what follows extends Zee's board rather than replacing it.
--
-- Zee's design contributed the richer report shape, the escalation path, core
-- change requests, and territory-by-path. Hana's overlay adds what it lacked:
-- session identity, handoff and takeover enforced by trigger, and role routing.

-- ---------------------------------------------------------------- Zee's base
CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  assigned_to TEXT NOT NULL,
  issued_by TEXT NOT NULL DEFAULT 'ZEE',
  role TEXT NOT NULL DEFAULT 'IMPLEMENTER',
  territory TEXT NOT NULL,
  migration_range TEXT,
  protocol_version TEXT NOT NULL,
  title TEXT NOT NULL,
  brief TEXT NOT NULL,
  acceptance_criteria TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  -- Hana's additions, applied by ALTER on the live bus.
  kind TEXT NOT NULL DEFAULT 'FEATURE',
  self_closing INTEGER NOT NULL DEFAULT 0,
  mutates_production INTEGER NOT NULL DEFAULT 0,
  is_probe INTEGER NOT NULL DEFAULT 0,
  system_scope TEXT NOT NULL DEFAULT 'APPLICATION',
  tenant_scope TEXT NOT NULL DEFAULT 'NONE',
  canonical_touch INTEGER NOT NULL DEFAULT 0,
  forbidden TEXT NOT NULL DEFAULT '',
  -- Constitution §5: production mutation is Bos Cyo's authority alone, so a task
  -- that mutates production can never also be self-closing. Until this line the
  -- pairing was convention only — enforced by discipline when Hana was the only
  -- one writing rows. Self-issued tasks (agent-task-board-v1 §"Self-issued tasks")
  -- widen who can write a row, so the pairing needs a real constraint, not a habit.
  CHECK (mutates_production = 0 OR self_closing = 0)
);

CREATE TABLE IF NOT EXISTS reports (
  report_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, agent TEXT NOT NULL,
  role TEXT NOT NULL, territory TEXT, protocol_version_read TEXT,
  migration_range_used TEXT, summary TEXT NOT NULL, files_changed TEXT,
  contracts_changed TEXT, migrations TEXT, tests_and_results TEXT,
  compatibility TEXT, doc_impact TEXT, deployment_notes TEXT, rollback TEXT,
  files_read_outside_territory TEXT, transactions_registered TEXT,
  known_issues TEXT, open_risks TEXT, final_status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS escalations (
  escalation_id TEXT PRIMARY KEY, raised_by TEXT NOT NULL, task_id TEXT,
  blocking_item TEXT NOT NULL, ambiguity TEXT NOT NULL, sources_consulted TEXT,
  options_considered TEXT, impact TEXT, decision_required TEXT NOT NULL,
  routed_to TEXT NOT NULL DEFAULT 'ZEE', resolution TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS core_change_requests (
  ccr_id TEXT PRIMARY KEY, raised_by TEXT NOT NULL, task_id TEXT,
  requesting_module TEXT NOT NULL, requested_change TEXT NOT NULL,
  business_reason TEXT NOT NULL, affected_surface TEXT NOT NULL,
  contract_impact TEXT NOT NULL, affected_consumers TEXT,
  proposed_compatibility TEXT, verdict TEXT, verdict_reason TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), decided_at TEXT
);

CREATE TABLE IF NOT EXISTS territory (
  path_prefix TEXT PRIMARY KEY, owner TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'FROZEN', notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS handshake (
  ping_id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL,
  message TEXT NOT NULL, can_read_tasks TEXT, can_write_reports TEXT,
  github_access TEXT, drive_access TEXT, cloudflare_account TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------- Hana's enforcement
-- A session is one context window. `karen1.2` shares no memory with `karen1.1`.
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY, family TEXT NOT NULL,
  slot INTEGER NOT NULL, session INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT,
  UNIQUE (family, slot, session)
);

CREATE TABLE IF NOT EXISTS agent_roles (
  family TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (family, kind)
);

-- Rules travel with the work: a fresh session has read nothing, so requiring it
-- to have read a document first is a rule broken by construction.
CREATE TABLE IF NOT EXISTS agent_sops (
  family TEXT PRIMARY KEY, rules TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_claims (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, session_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
  released_at TEXT, release_reason TEXT,
  CHECK (released_at IS NULL OR release_reason IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_claims_open
  ON task_claims (task_id) WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS task_handoffs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL,
  from_session_id TEXT NOT NULL, to_session_id TEXT NOT NULL,
  done_so_far TEXT NOT NULL, not_done TEXT NOT NULL,
  learned TEXT NOT NULL DEFAULT '', do_not_repeat TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (from_session_id <> to_session_id)
);

-- A session can die without warning. The handoff rule alone would strand its
-- task forever. A takeover is not a handoff: nobody may fabricate what the dead
-- session knew, so the replacement states what it rebuilt and from what.
CREATE TABLE IF NOT EXISTS task_takeovers (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL,
  from_session_id TEXT NOT NULL, to_session_id TEXT NOT NULL,
  reason TEXT NOT NULL, reconstructed_from TEXT NOT NULL,
  reconstructed_state TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (from_session_id <> to_session_id),
  CHECK (length(trim(reconstructed_from)) > 0),
  CHECK (length(trim(reconstructed_state)) > 0)
);

-- Two tasks editing one file is the collision that actually hurt: a tab holding
-- because another had not deployed a shared variable yet.
CREATE TABLE IF NOT EXISTS task_paths (
  task_id TEXT NOT NULL, path_prefix TEXT NOT NULL,
  PRIMARY KEY (task_id, path_prefix)
);

CREATE TRIGGER IF NOT EXISTS trg_claim_requires_handoff
BEFORE INSERT ON task_claims
WHEN EXISTS (SELECT 1 FROM task_claims c WHERE c.task_id = NEW.task_id AND c.session_id <> NEW.session_id)
 AND NOT EXISTS (SELECT 1 FROM task_handoffs h WHERE h.task_id = NEW.task_id AND h.to_session_id = NEW.session_id)
 AND NOT EXISTS (SELECT 1 FROM task_takeovers k WHERE k.task_id = NEW.task_id AND k.to_session_id = NEW.session_id)
BEGIN SELECT RAISE(ABORT, 'HANDOFF_OR_TAKEOVER_REQUIRED'); END;

CREATE TRIGGER IF NOT EXISTS trg_claim_matches_role
BEFORE INSERT ON task_claims
WHEN NOT EXISTS (
  SELECT 1 FROM agent_sessions s JOIN tasks t ON t.task_id = NEW.task_id
  JOIN agent_roles r ON r.family = s.family AND r.kind = t.kind
  WHERE s.id = NEW.session_id)
BEGIN SELECT RAISE(ABORT, 'ROLE_NOT_PERMITTED_FOR_TASK_KIND'); END;

CREATE TRIGGER IF NOT EXISTS trg_claim_path_conflict
BEFORE INSERT ON task_claims
WHEN EXISTS (
  SELECT 1 FROM task_paths mine
  JOIN task_paths theirs ON theirs.task_id <> mine.task_id
  JOIN task_claims held ON held.task_id = theirs.task_id AND held.released_at IS NULL
  WHERE mine.task_id = NEW.task_id
    AND (mine.path_prefix LIKE theirs.path_prefix || '%'
      OR theirs.path_prefix LIKE mine.path_prefix || '%'))
BEGIN SELECT RAISE(ABORT, 'PATH_HELD_BY_ANOTHER_CLAIM'); END;
