-- Dikerjakan oleh: hana1.1 — arsitektur, MAXI agent roster
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

-- What each agent family is allowed to pick up. Agents differ in access and in
-- what they are good at, so routing is by kind rather than by whoever is idle.
CREATE TABLE IF NOT EXISTS agent_roles (
  family TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('DEBUG', 'FEATURE', 'MIGRATION', 'AUDIT', 'DOCS', 'ARCHITECTURE')),
  PRIMARY KEY (family, kind)
);

-- The standing rules for a family, served with the task itself.
--
-- An agent cannot be relied on to have read a document before starting: a fresh
-- session has read nothing. So the rules travel with the work instead of being a
-- prerequisite to it. Documents remain the place for judgement; anything that
-- must not be violated is a constraint below, not a paragraph here.
CREATE TABLE IF NOT EXISTS agent_sops (
  family TEXT PRIMARY KEY,
  rules TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'FEATURE'
    CHECK (kind IN ('DEBUG', 'FEATURE', 'MIGRATION', 'AUDIT', 'DOCS', 'ARCHITECTURE')),
  module TEXT NOT NULL,                   -- must exist in MODULE_OWNERSHIP.md
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  inputs TEXT NOT NULL DEFAULT '',        -- files, tables, endpoints to read first
  contract TEXT NOT NULL DEFAULT '',      -- ids that must line up, invariants to hold
  done_when TEXT NOT NULL,                -- checkable conditions, not intentions
  -- Reversible work whose done_when a machine can check does not wait for a
  -- verdict. Constitution: reviewer approval is advisory and may not block
  -- completing or merging. Only irreversible work needs a human decision, and
  -- that decision belongs to Bos Cyo rather than to any agent.
  self_closing INTEGER NOT NULL DEFAULT 0 CHECK (self_closing IN (0, 1)),
  -- Production data mutation always needs Bos Cyo's explicit authority, so it
  -- can never be self-closing regardless of how good the evidence looks.
  mutates_production INTEGER NOT NULL DEFAULT 0 CHECK (mutates_production IN (0, 1)),
  -- Probes are how a candidate agent earns its kinds. Every candidate gets the
  -- same ones so the results compare, and the evidence decides rather than an
  -- impression formed in conversation.
  is_probe INTEGER NOT NULL DEFAULT 0 CHECK (is_probe IN (0, 1)),
  -- Where the change lives, from issue #93. A shared module serves every tenant,
  -- so the blast radius of an edit differs by scope even when the diff looks the
  -- same size.
  system_scope TEXT NOT NULL DEFAULT 'APPLICATION'
    CHECK (system_scope IN ('SHARED_MODULE', 'APPLICATION', 'TENANT_CONFIG', 'PLATFORM_INFRA')),
  tenant_scope TEXT NOT NULL DEFAULT 'NONE',
  -- Whether the task touches a canonical object — chart_of_accounts, a posted
  -- journal, a contract, a migration already applied. Declared rather than
  -- discovered, so review effort goes where it is warranted.
  canonical_touch INTEGER NOT NULL DEFAULT 0 CHECK (canonical_touch IN (0, 1)),
  forbidden TEXT NOT NULL DEFAULT '',     -- what this task must not touch
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'CLAIMED', 'REPORTED', 'BLOCKED', 'DONE')),
  written_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (written_by) REFERENCES agent_sessions(id),
  CHECK (NOT (self_closing = 1 AND mutates_production = 1))
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
 AND NOT EXISTS (
      SELECT 1 FROM agent_task_takeovers k
      WHERE k.task_id = NEW.task_id AND k.to_session_id = NEW.session_id
    )
BEGIN
  SELECT RAISE(ABORT, 'HANDOFF_OR_TAKEOVER_REQUIRED');
END;

-- An agent may only claim the kinds of work its family is registered for. Luna
-- takes DEBUG; Karen takes operasional FEATURE work. Routing is enforced here
-- rather than trusted to each agent recognising which tasks are "theirs",
-- because a fresh session has no way to know that on its own.
CREATE TRIGGER IF NOT EXISTS trg_agent_claim_matches_role
BEFORE INSERT ON agent_task_claims
WHEN NOT EXISTS (
  SELECT 1
  FROM agent_sessions s
  JOIN agent_tasks t ON t.id = NEW.task_id
  JOIN agent_roles r ON r.family = s.family AND r.kind = t.kind
  WHERE s.id = NEW.session_id
)
BEGIN
  SELECT RAISE(ABORT, 'ROLE_NOT_PERMITTED_FOR_TASK_KIND');
END;

-- Which paths a task owns while it is held.
--
-- Slots stop two agents claiming the same task. They do not stop two different
-- tasks editing the same file, which is the collision that actually hurt: five
-- Karen tabs running at once, one holding because another had not deployed a
-- shared variable yet. Task-level isolation is not file-level isolation, and
-- only the second one prevents a git conflict.
CREATE TABLE IF NOT EXISTS agent_task_paths (
  task_id TEXT NOT NULL,
  path_prefix TEXT NOT NULL,
  PRIMARY KEY (task_id, path_prefix),
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id)
);

-- Refuse a claim whose paths overlap paths already held. Overlap is prefix
-- containment in either direction, so declaring a directory reserves everything
-- under it. Five agents may run at once precisely when their path sets are
-- disjoint — and now that is enforced rather than hoped for.
CREATE TRIGGER IF NOT EXISTS trg_agent_claim_path_conflict
BEFORE INSERT ON agent_task_claims
WHEN EXISTS (
  SELECT 1
  FROM agent_task_paths mine
  JOIN agent_task_paths theirs ON theirs.task_id <> mine.task_id
  JOIN agent_task_claims held ON held.task_id = theirs.task_id AND held.released_at IS NULL
  WHERE mine.task_id = NEW.task_id
    AND (mine.path_prefix LIKE theirs.path_prefix || '%'
      OR theirs.path_prefix LIKE mine.path_prefix || '%')
)
BEGIN
  SELECT RAISE(ABORT, 'PATH_HELD_BY_ANOTHER_CLAIM');
END;

-- A session can die without warning: the tab is closed, the container is
-- reclaimed, the quota ends mid-sentence. The handoff rule alone would strand
-- that task forever, because the session that owed the handoff is gone and
-- cannot write one. Issue #93 caught this; the first version of this schema
-- deadlocked on it.
--
-- A takeover is deliberately not a handoff. Nobody may fabricate what the dead
-- session knew, so the replacement states what it reconstructed and from which
-- evidence, and that difference stays visible in the trail forever.
CREATE TABLE IF NOT EXISTS agent_task_takeovers (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  from_session_id TEXT NOT NULL,
  to_session_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('UNEXPECTED_TERMINATION', 'OWNER_REASSIGNMENT')),
  reconstructed_from TEXT NOT NULL,   -- commits, PRs, board rows the state was rebuilt from
  reconstructed_state TEXT NOT NULL,  -- what the new session believes is true, and why
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES agent_tasks(id),
  FOREIGN KEY (from_session_id) REFERENCES agent_sessions(id),
  FOREIGN KEY (to_session_id) REFERENCES agent_sessions(id),
  CHECK (from_session_id <> to_session_id),
  CHECK (length(trim(reconstructed_from)) > 0),
  CHECK (length(trim(reconstructed_state)) > 0)
);

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

-- Seed the roster. Families are registered explicitly; an unregistered family
-- can claim nothing, which is the safe default when a new agent appears.
INSERT OR IGNORE INTO agent_roles (family, kind) VALUES
  ('hana','ARCHITECTURE'), ('hana','AUDIT'), ('hana','DOCS'), ('hana','MIGRATION'),
  ('karen','FEATURE'), ('karen','MIGRATION'), ('karen','DOCS'),
  ('elle','FEATURE'), ('elle','DOCS'),
  ('luna','DEBUG');

INSERT OR IGNORE INTO agent_sops (family, rules) VALUES
  ('luna', 'Kerjakan hanya task kind=DEBUG. Reproduksi dulu sebelum memperbaiki; "flaky" bukan diagnosis. Jangan menonaktifkan atau melewati tes untuk membuat hijau. Jangan mengubah kebijakan Accounting/Inventory — gagal-tertutup dan lapor. Report wajib memuat perintah yang dijalankan beserta outputnya.'),
  ('karen', 'Modul operasional. POS hanya mengirim business fact; jangan menentukan akun atau baris jurnal. Fitur yang berpotensi transaksi wajib terdaftar di transaction_categories + journal_rules sebelum task ditutup. Jangan menyentuh tabel milik modul lain.'),
  ('elle', 'Modul produksi. Recipe adalah revisi immutable; jangan menghitung HPP dari harga bahan terbaru. Snapshot biaya diambil saat posting. Uang dan biaya selalu scaled INTEGER, dilarang REAL/FLOAT.'),
  ('hana', 'Arsitektur, audit, dan verifikasi. Tulis task berisi intent dan contract, bukan source code. Verifikasi report; audit kerjaan hanya bila report dan kenyataan tidak cocok. Jangan memutuskan kebijakan akuntansi/persediaan sendiri.');
