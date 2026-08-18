import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const schema = readFileSync(new URL('../agent-bus/schema.sql', import.meta.url), 'utf8');

function board() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(schema);
  sqlite.exec(`
    INSERT INTO agent_sessions (id, family, slot, session) VALUES
      ('hana.1','hana',1,1),
      ('karen1.1','karen',1,1),
      ('karen1.2','karen',1,2),
      ('elle1.1','elle',1,1);
    INSERT INTO agent_tasks (id, module, title, objective, done_when, written_by)
    VALUES ('T-001','operasional','Beli Bahan qty','Pisahkan qty operasional dari stock movement',
            'npm test hijau; qty tidak menulis stock_movements','hana.1');
  `);
  return sqlite;
}

const claim = (sqlite, id, task, session) =>
  sqlite.prepare(`INSERT INTO agent_task_claims (id, task_id, session_id) VALUES (?,?,?)`).run(id, task, session);

test('a task is held by one session at a time', () => {
  const sqlite = board();
  claim(sqlite, 'C1', 'T-001', 'karen1.1');
  assert.throws(
    () => claim(sqlite, 'C2', 'T-001', 'elle1.1'),
    /HANDOFF_REQUIRED|UNIQUE/,
    'a second agent must not be able to take a held task'
  );
});

test('a later session cannot pick up the work without a handoff', () => {
  const sqlite = board();
  claim(sqlite, 'C1', 'T-001', 'karen1.1');
  sqlite.prepare(`UPDATE agent_task_claims SET released_at = CURRENT_TIMESTAMP, release_reason = 'HANDOFF' WHERE id = 'C1'`).run();

  // The claim is released, so the unique index no longer blocks. What must block
  // is the missing knowledge transfer: karen1.2 shares no memory with karen1.1.
  assert.throws(
    () => claim(sqlite, 'C2', 'T-001', 'karen1.2'),
    /HANDOFF_REQUIRED/,
    'releasing a claim must not by itself make the task re-claimable by a new session'
  );
});

test('a handoff naming the next session lets the work continue', () => {
  const sqlite = board();
  claim(sqlite, 'C1', 'T-001', 'karen1.1');
  sqlite.prepare(`UPDATE agent_task_claims SET released_at = CURRENT_TIMESTAMP, release_reason = 'HANDOFF' WHERE id = 'C1'`).run();
  sqlite.prepare(`
    INSERT INTO agent_task_handoffs (id, task_id, from_session_id, to_session_id, done_so_far, not_done, learned, do_not_repeat)
    VALUES ('H1','T-001','karen1.1','karen1.2','qty split done','journal rule belum','qty tidak pernah jadi stock movement','jangan sentuh journal_rules')
  `).run();

  claim(sqlite, 'C2', 'T-001', 'karen1.2');
  const holder = sqlite.prepare(`SELECT session_id FROM agent_task_claims WHERE task_id='T-001' AND released_at IS NULL`).get();
  assert.equal(holder.session_id, 'karen1.2');
});

test('a handoff cannot name its own session as the recipient', () => {
  const sqlite = board();
  assert.throws(
    () => sqlite.prepare(`
      INSERT INTO agent_task_handoffs (id, task_id, from_session_id, to_session_id, done_so_far, not_done)
      VALUES ('H1','T-001','karen1.1','karen1.1','x','y')
    `).run(),
    /CHECK|constraint/i
  );
});

test('a report without evidence is not a report', () => {
  const sqlite = board();
  claim(sqlite, 'C1', 'T-001', 'karen1.1');
  assert.throws(
    () => sqlite.prepare(`
      INSERT INTO agent_task_reports (id, task_id, session_id, done_when_outcome, evidence)
      VALUES ('R1','T-001','karen1.1','sudah beres','   ')
    `).run(),
    /CHECK|constraint/i,
    'a status claim with no evidence must be rejected'
  );
});

test('the trail survives the handoff so nothing has to be re-derived', () => {
  const sqlite = board();
  claim(sqlite, 'C1', 'T-001', 'karen1.1');
  sqlite.prepare(`UPDATE agent_task_claims SET released_at = CURRENT_TIMESTAMP, release_reason='HANDOFF' WHERE id='C1'`).run();
  sqlite.prepare(`
    INSERT INTO agent_task_handoffs (id, task_id, from_session_id, to_session_id, done_so_far, not_done, learned)
    VALUES ('H1','T-001','karen1.1','karen1.2','a','b','deploy script sempat dibajak, jangan diulang')
  `).run();
  claim(sqlite, 'C2', 'T-001', 'karen1.2');

  const trail = sqlite.prepare(`
    SELECT session_id FROM agent_task_claims WHERE task_id='T-001' ORDER BY claimed_at, id
  `).all().map(row => row.session_id);
  assert.deepEqual(trail, ['karen1.1', 'karen1.2'], 'every holder stays on the record');

  const learned = sqlite.prepare(`SELECT learned FROM agent_task_handoffs WHERE task_id='T-001'`).get();
  assert.match(learned.learned, /dibajak/, 'what was learned must reach the next session');
});

const openTask = (sqlite, id, kind) =>
  sqlite.prepare(`INSERT INTO agent_tasks (id, kind, module, title, objective, done_when, written_by)
                  VALUES (?,?,'operasional','t','o','d','hana.1')`).run(id, kind);

test('an agent can only claim the kinds of work its family is registered for', () => {
  const sqlite = board();
  sqlite.exec(`INSERT INTO agent_sessions (id, family, slot, session) VALUES ('luna1.1','luna',1,1);`);
  openTask(sqlite, 'T-DEBUG', 'DEBUG');

  // Luna takes debugging. A feature task is not hers, and Karen does not take
  // debugging — routing cannot depend on each agent recognising which tasks are
  // "theirs", because a fresh session has no way to know that.
  assert.throws(() => claim(sqlite, 'CX', 'T-001', 'luna1.1'), /ROLE_NOT_PERMITTED/);
  assert.throws(() => claim(sqlite, 'CY', 'T-DEBUG', 'karen1.1'), /ROLE_NOT_PERMITTED/);

  claim(sqlite, 'CZ', 'T-DEBUG', 'luna1.1');
  const holder = sqlite.prepare(`SELECT session_id FROM agent_task_claims WHERE task_id='T-DEBUG' AND released_at IS NULL`).get();
  assert.equal(holder.session_id, 'luna1.1');
});

test('an unregistered family can claim nothing', () => {
  const sqlite = board();
  sqlite.exec(`INSERT INTO agent_sessions (id, family, slot, session) VALUES ('nova1.1','nova',1,1);`);
  assert.throws(() => claim(sqlite, 'CN', 'T-001', 'nova1.1'), /ROLE_NOT_PERMITTED/,
    'a new agent starts with no permissions rather than inheriting everything');
});

test('the rules travel with the task instead of being a prerequisite', () => {
  const sqlite = board();
  sqlite.exec(`INSERT INTO agent_sessions (id, family, slot, session) VALUES ('luna1.1','luna',1,1);`);
  openTask(sqlite, 'T-DEBUG', 'DEBUG');
  claim(sqlite, 'CZ', 'T-DEBUG', 'luna1.1');

  const briefing = sqlite.prepare(`
    SELECT t.kind, t.objective, t.done_when, p.rules
    FROM agent_task_claims c
    JOIN agent_sessions s ON s.id = c.session_id
    JOIN agent_tasks t ON t.id = c.task_id
    JOIN agent_sops p ON p.family = s.family
    WHERE c.id = 'CZ'
  `).get();
  assert.equal(briefing.kind, 'DEBUG');
  assert.match(briefing.rules, /Reproduksi dulu/, 'a session that has read nothing still receives its SOP');
});

test('reversible work does not wait for an architect to be awake', () => {
  const sqlite = board();
  sqlite.prepare(`
    INSERT INTO agent_tasks (id, kind, module, title, objective, done_when, written_by, self_closing)
    VALUES ('T-SELF','FEATURE','operasional','t','o','npm test hijau','hana.1',1)
  `).run();
  const task = sqlite.prepare(`SELECT self_closing, mutates_production FROM agent_tasks WHERE id='T-SELF'`).get();
  assert.equal(task.self_closing, 1);
  assert.equal(task.mutates_production, 0);
});

test('production mutation can never close on its own evidence', () => {
  const sqlite = board();
  // Constitution §5 reserves production data mutation for Bos Cyo. No quality of
  // evidence substitutes for that, so the two flags are mutually exclusive by
  // constraint rather than by anyone remembering the rule.
  assert.throws(
    () => sqlite.prepare(`
      INSERT INTO agent_tasks (id, kind, module, title, objective, done_when, written_by, self_closing, mutates_production)
      VALUES ('T-BAD','MIGRATION','accounting','t','o','d','hana.1',1,1)
    `).run(),
    /CHECK|constraint/i
  );
});

test('any architecture-permitted family can write tasks, not only one agent', () => {
  const sqlite = board();
  // written_by is a session reference, not a privilege check: a board that only
  // one agent can fill stops when that agent stops.
  sqlite.prepare(`
    INSERT INTO agent_tasks (id, kind, module, title, objective, done_when, written_by)
    VALUES ('T-X','DEBUG','operasional','t','o','d','karen1.1')
  `).run();
  assert.equal(sqlite.prepare(`SELECT written_by FROM agent_tasks WHERE id='T-X'`).get().written_by, 'karen1.1');
});

test('the queue keeps moving when Hana is gone', () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(schema);
  sqlite.exec(readFileSync(new URL('../agent-bus/seed-tasks.sql', import.meta.url), 'utf8'));

  // Whatever remains claimable by someone other than hana is what survives her
  // running out of context. If that set were empty the board would be a queue
  // with one possible worker, which is the dependency it exists to remove.
  const claimableWithoutHana = sqlite.prepare(`
    SELECT COUNT(DISTINCT t.id) AS n
    FROM agent_tasks t
    JOIN agent_roles r ON r.kind = t.kind
    WHERE t.status = 'OPEN' AND r.family <> 'hana'
  `).get().n;
  const total = sqlite.prepare(`SELECT COUNT(*) AS n FROM agent_tasks`).get().n;

  assert.ok(total >= 5, 'the queue is written ahead, not one task at a time');
  assert.ok(claimableWithoutHana >= total - 1, 'nearly every queued task must be claimable without Hana');

  // The one that is not is the one that mutates production, and it waits for
  // Bos Cyo rather than for any agent.
  const stuck = sqlite.prepare(`
    SELECT id, mutates_production, self_closing FROM agent_tasks
    WHERE NOT EXISTS (SELECT 1 FROM agent_roles r WHERE r.kind = agent_tasks.kind AND r.family <> 'hana')
  `).all();
  for (const task of stuck) {
    assert.equal(task.mutates_production, 1, `${task.id} blocks on Hana without needing to`);
    assert.equal(task.self_closing, 0);
  }
});

test('a probe never carries production access', () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(schema);
  sqlite.exec(readFileSync(new URL('../agent-bus/probe-tasks.sql', import.meta.url), 'utf8'));

  const probes = sqlite.prepare(`SELECT id, mutates_production, forbidden FROM agent_tasks WHERE is_probe = 1`).all();
  assert.ok(probes.length >= 3, 'every candidate is measured on the same probe set');
  for (const probe of probes) {
    // A candidate's judgement is unknown by definition. Letting an unknown agent
    // near the production ledger to find out is the wrong order.
    assert.equal(probe.mutates_production, 0, `${probe.id} must not touch production`);
    assert.ok(probe.forbidden.trim().length > 0, `${probe.id} must state its limits`);
  }
});

test('the stop-probe asks for a change that must be refused', () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(schema);
  sqlite.exec(readFileSync(new URL('../agent-bus/probe-tasks.sql', import.meta.url), 'utf8'));

  const p2 = sqlite.prepare(`SELECT objective, done_when, forbidden FROM agent_tasks WHERE id = 'P2-STOP'`).get();
  // The objective says "fix it" and passing means declining. That gap is the
  // measurement: the costliest failures here came from confident action where
  // stopping was correct.
  assert.match(p2.objective, /perbaiki/i);
  assert.match(p2.done_when, /menyerahkan keputusan/i);
  assert.match(p2.forbidden, /Jangan menambah journal_rules/i);
});

function boardWithModules() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(schema);
  sqlite.exec(readFileSync(new URL('../agent-bus/module-tasks.sql', import.meta.url), 'utf8'));
  for (let slot = 1; slot <= 6; slot += 1) {
    sqlite.exec(`INSERT INTO agent_sessions (id, family, slot, session) VALUES ('karen${slot}.1','karen',${slot},1)`);
  }
  return sqlite;
}

test('five module tasks can be held at the same time', () => {
  const sqlite = boardWithModules();
  const ids = ['M-PENJUALAN', 'M-PEMBELIAN', 'M-OPERASIONAL', 'M-PRODUKSI', 'M-PENYESUAIAN'];
  ids.forEach((task, index) => claim(sqlite, `C${index}`, task, `karen${index + 1}.1`));
  assert.equal(
    sqlite.prepare(`SELECT COUNT(*) AS n FROM agent_task_claims WHERE released_at IS NULL`).get().n,
    5,
    'the five tabs Bos Cyo actually runs must work concurrently'
  );
});

test('a task overlapping a held file is refused at claim time, not at push time', () => {
  const sqlite = boardWithModules();
  claim(sqlite, 'C0', 'M-PRODUKSI', 'karen1.1');

  sqlite.exec(`
    INSERT INTO agent_tasks (id, kind, module, title, objective, done_when, written_by)
    VALUES ('M-CLASH','FEATURE','produksi','t','o','d','hana1.1');
    INSERT INTO agent_task_paths (task_id, path_prefix) VALUES ('M-CLASH','src/stock-production.js');
  `);

  // This is the collision that used to surface as one Karen holding while
  // another deployed. Catching it when the work is picked up costs a sentence;
  // catching it at push costs a stalled tab.
  assert.throws(() => claim(sqlite, 'C1', 'M-CLASH', 'karen2.1'), /PATH_HELD_BY_ANOTHER_CLAIM/);

  sqlite.prepare(`UPDATE agent_task_claims SET released_at = CURRENT_TIMESTAMP, release_reason='REPORTED' WHERE id='C0'`).run();
  claim(sqlite, 'C2', 'M-CLASH', 'karen2.1');
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM agent_task_claims WHERE released_at IS NULL`).get().n, 1);
});

test('declaring a directory reserves everything beneath it', () => {
  const sqlite = boardWithModules();
  sqlite.exec(`
    INSERT INTO agent_tasks (id, kind, module, title, objective, done_when, written_by)
    VALUES ('M-DIR','FEATURE','platform','t','o','d','hana1.1'),
           ('M-FILE','FEATURE','platform','t','o','d','hana1.1');
    INSERT INTO agent_task_paths (task_id, path_prefix) VALUES
      ('M-DIR','src/'), ('M-FILE','src/anything.js');
  `);
  claim(sqlite, 'CD', 'M-DIR', 'karen1.1');
  assert.throws(() => claim(sqlite, 'CF', 'M-FILE', 'karen2.1'), /PATH_HELD_BY_ANOTHER_CLAIM/);
});

test('no two open module tasks declare the same path', () => {
  const sqlite = boardWithModules();
  const clashes = sqlite.prepare(`
    SELECT a.task_id AS a, b.task_id AS b, a.path_prefix AS p
    FROM agent_task_paths a JOIN agent_task_paths b ON a.task_id < b.task_id
    WHERE a.path_prefix LIKE b.path_prefix || '%' OR b.path_prefix LIKE a.path_prefix || '%'
  `).all();
  assert.deepEqual(clashes, [], `module tasks must be disjoint by construction: ${JSON.stringify(clashes)}`);
});
