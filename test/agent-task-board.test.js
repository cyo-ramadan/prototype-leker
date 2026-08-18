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
