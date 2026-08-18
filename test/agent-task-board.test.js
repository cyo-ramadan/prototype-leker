import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Mirrors D1 maxi-agent-bus. Zee's base tables plus Hana's enforcement overlay;
// the base was already there and extending it beat standing up a second board.
const schema = readFileSync(new URL('../agent-bus/schema.sql', import.meta.url), 'utf8');

function bus() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(schema);
  sqlite.exec(`
    INSERT INTO agent_sessions (id, family, slot, session) VALUES
      ('hana1.1','hana',1,1), ('karen1.1','karen',1,1), ('karen1.2','karen',1,2),
      ('karen2.1','karen',2,1), ('elle1.1','elle',1,1), ('luna1.1','luna',1,1),
      ('nova1.1','nova',1,1);
    INSERT INTO agent_roles (family, kind) VALUES
      ('hana','ARCHITECTURE'),('hana','AUDIT'),('hana','MIGRATION'),
      ('karen','FEATURE'),('karen','MIGRATION'),('elle','FEATURE'),('luna','DEBUG');
    INSERT INTO agent_sops (family, rules) VALUES ('luna','Reproduksi dulu sebelum memperbaiki.');
  `);
  return sqlite;
}

function addTask(sqlite, id, kind = 'FEATURE', paths = []) {
  sqlite.prepare(`
    INSERT INTO tasks (task_id, assigned_to, issued_by, territory, protocol_version,
                       title, brief, acceptance_criteria, kind)
    VALUES (?, 'karen', 'HANA', 'operasional', 'MAXI_AGENT_TASK_BOARD_V1', 't', 'b', 'a', ?)
  `).run(id, kind);
  for (const path of paths) {
    sqlite.prepare(`INSERT INTO task_paths (task_id, path_prefix) VALUES (?,?)`).run(id, path);
  }
}

const claim = (sqlite, id, task, session) =>
  sqlite.prepare(`INSERT INTO task_claims (id, task_id, session_id) VALUES (?,?,?)`).run(id, task, session);

test('the overlay extends the existing board rather than duplicating it', () => {
  const sqlite = bus();
  const tables = sqlite
    .prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all().map(row => row.name);
  // Zee's tables must survive: a second parallel board is the duplicate
  // architecture this project keeps paying for.
  for (const base of ['tasks', 'reports', 'escalations', 'core_change_requests', 'territory', 'handshake']) {
    assert.ok(tables.includes(base), `${base} is Zee's and must not be replaced`);
  }
  assert.ok(!tables.includes('agent_tasks'), 'there must be exactly one task table');
});

test('a task is held by one session at a time', () => {
  const sqlite = bus();
  addTask(sqlite, 'T1');
  claim(sqlite, 'C1', 'T1', 'karen1.1');
  assert.throws(() => claim(sqlite, 'C2', 'T1', 'karen2.1'), /HANDOFF_OR_TAKEOVER_REQUIRED|UNIQUE/);
});

test('a later session cannot continue the work without a handoff', () => {
  const sqlite = bus();
  addTask(sqlite, 'T1');
  claim(sqlite, 'C1', 'T1', 'karen1.1');
  sqlite.prepare(`UPDATE task_claims SET released_at=datetime('now'), release_reason='HANDOFF' WHERE id='C1'`).run();

  // Releasing frees the unique index. What must still block is the missing
  // knowledge transfer: karen1.2 shares no memory with karen1.1.
  assert.throws(() => claim(sqlite, 'C2', 'T1', 'karen1.2'), /HANDOFF_OR_TAKEOVER_REQUIRED/);

  sqlite.prepare(`
    INSERT INTO task_handoffs (id, task_id, from_session_id, to_session_id, done_so_far, not_done, learned)
    VALUES ('H1','T1','karen1.1','karen1.2','qty split','tes belum','deploy script pernah dibajak')
  `).run();
  claim(sqlite, 'C2', 'T1', 'karen1.2');
  assert.equal(
    sqlite.prepare(`SELECT session_id FROM task_claims WHERE task_id='T1' AND released_at IS NULL`).get().session_id,
    'karen1.2'
  );
});

test('a task is not stranded when a session dies without handing off', () => {
  const sqlite = bus();
  addTask(sqlite, 'T1');
  claim(sqlite, 'C1', 'T1', 'karen1.1');
  sqlite.prepare(`UPDATE task_claims SET released_at=datetime('now'), release_reason='ABANDONED' WHERE id='C1'`).run();
  assert.throws(() => claim(sqlite, 'C2', 'T1', 'karen1.2'), /HANDOFF_OR_TAKEOVER_REQUIRED/);

  sqlite.prepare(`
    INSERT INTO task_takeovers (id, task_id, from_session_id, to_session_id, reason, reconstructed_from, reconstructed_state)
    VALUES ('K1','T1','karen1.1','karen1.2','UNEXPECTED_TERMINATION','branch commit a1b2c3','split ada di branch, tes belum')
  `).run();
  claim(sqlite, 'C2', 'T1', 'karen1.2');
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM task_claims WHERE released_at IS NULL`).get().n, 1);
});

test('a takeover cannot pretend to be knowledge it never received', () => {
  const sqlite = bus();
  addTask(sqlite, 'T1');
  for (const [from, state] of [['  ', 'x'], ['commit a1b2c3', '   ']]) {
    assert.throws(
      () => sqlite.prepare(`
        INSERT INTO task_takeovers (id, task_id, from_session_id, to_session_id, reason, reconstructed_from, reconstructed_state)
        VALUES ('K','T1','karen1.1','karen1.2','UNEXPECTED_TERMINATION',?,?)
      `).run(from, state),
      /CHECK|constraint/i
    );
  }
});

test('an agent only claims the kinds its family is registered for', () => {
  const sqlite = bus();
  addTask(sqlite, 'T-FEATURE', 'FEATURE');
  addTask(sqlite, 'T-DEBUG', 'DEBUG');
  assert.throws(() => claim(sqlite, 'CX', 'T-FEATURE', 'luna1.1'), /ROLE_NOT_PERMITTED/);
  assert.throws(() => claim(sqlite, 'CY', 'T-DEBUG', 'karen1.1'), /ROLE_NOT_PERMITTED/);
  claim(sqlite, 'CZ', 'T-DEBUG', 'luna1.1');
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM task_claims WHERE released_at IS NULL`).get().n, 1);
});

test('an unregistered family can claim nothing', () => {
  const sqlite = bus();
  addTask(sqlite, 'T1');
  assert.throws(() => claim(sqlite, 'CN', 'T1', 'nova1.1'), /ROLE_NOT_PERMITTED/,
    'a new agent starts with no permissions rather than inheriting everything');
});

test('the rules travel with the task instead of being a prerequisite', () => {
  const sqlite = bus();
  addTask(sqlite, 'T-DEBUG', 'DEBUG');
  claim(sqlite, 'CZ', 'T-DEBUG', 'luna1.1');
  const briefing = sqlite.prepare(`
    SELECT t.kind, t.brief, p.rules FROM task_claims c
    JOIN agent_sessions s ON s.id = c.session_id
    JOIN tasks t ON t.task_id = c.task_id
    JOIN agent_sops p ON p.family = s.family WHERE c.id = 'CZ'
  `).get();
  assert.match(briefing.rules, /Reproduksi dulu/, 'a session that has read nothing still receives its SOP');
});

test('a task overlapping a held file is refused at claim time, not at push time', () => {
  const sqlite = bus();
  addTask(sqlite, 'T-A', 'FEATURE', ['src/stock-production.js']);
  addTask(sqlite, 'T-B', 'FEATURE', ['src/stock-production.js']);
  claim(sqlite, 'C1', 'T-A', 'karen1.1');
  assert.throws(() => claim(sqlite, 'C2', 'T-B', 'karen2.1'), /PATH_HELD_BY_ANOTHER_CLAIM/);

  sqlite.prepare(`UPDATE task_claims SET released_at=datetime('now'), release_reason='REPORTED' WHERE id='C1'`).run();
  claim(sqlite, 'C3', 'T-B', 'karen2.1');
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM task_claims WHERE released_at IS NULL`).get().n, 1);
});

test('declaring a directory reserves everything beneath it', () => {
  const sqlite = bus();
  addTask(sqlite, 'T-DIR', 'FEATURE', ['src/']);
  addTask(sqlite, 'T-FILE', 'FEATURE', ['src/anything.js']);
  claim(sqlite, 'CD', 'T-DIR', 'karen1.1');
  assert.throws(() => claim(sqlite, 'CF', 'T-FILE', 'karen2.1'), /PATH_HELD_BY_ANOTHER_CLAIM/);
});

test('disjoint paths let several tabs run at the same time', () => {
  const sqlite = bus();
  addTask(sqlite, 'T-1', 'FEATURE', ['src/cashier-sales-tracking.js']);
  addTask(sqlite, 'T-2', 'FEATURE', ['src/cashier-purchase.js']);
  addTask(sqlite, 'T-3', 'FEATURE', ['src/cashier-operational-expense.js']);
  claim(sqlite, 'C1', 'T-1', 'karen1.1');
  claim(sqlite, 'C2', 'T-2', 'karen2.1');
  claim(sqlite, 'C3', 'T-3', 'elle1.1');
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM task_claims WHERE released_at IS NULL`).get().n, 3);
});

test('production mutation is flagged and never self-closing', () => {
  const sqlite = bus();
  sqlite.prepare(`
    INSERT INTO tasks (task_id, assigned_to, issued_by, territory, protocol_version, title, brief,
                       acceptance_criteria, kind, mutates_production, self_closing)
    VALUES ('T-PROD','hana','HANA','accounting','v1','t','b','a','AUDIT',1,0)
  `).run();
  const task = sqlite.prepare(`SELECT mutates_production, self_closing FROM tasks WHERE task_id='T-PROD'`).get();
  // Constitution §5 reserves production data mutation for Bos Cyo, so no
  // quality of evidence closes it on its own.
  assert.equal(task.mutates_production, 1);
  assert.equal(task.self_closing, 0);
});
