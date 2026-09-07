import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import worker, {
  TOOLS,
  callTool,
  normalizeBoardPath,
  updateOpenTask
} from '../src/worker.js';

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const ENV = {
  MCP_AUTH_TOKEN: 'test-mcp-token-never-return',
  MCP_CALLER_FAMILY: 'karen',
  MCP_ALLOWED_PROJECTS: 'leker'
};

class D1StatementMock {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1StatementMock(this.sqlite, this.sql, bindings);
  }

  execute() {
    const statement = this.sqlite.prepare(this.sql);
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(this.sql)) {
      return { success: true, results: statement.all(...this.bindings), meta: { changes: 0 } };
    }
    const result = statement.run(...this.bindings);
    return { success: true, results: [], meta: { changes: Number(result.changes || 0) } };
  }

  async first() {
    return this.sqlite.prepare(this.sql).get(...this.bindings) || null;
  }

  async all() {
    return { success: true, results: this.sqlite.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    return this.execute();
  }
}

class D1DatabaseMock {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new D1StatementMock(this.sqlite, sql);
  }

  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => statement.execute());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

function bus() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(schema);
  sqlite.exec(`
    INSERT INTO agent_sessions (id, family, slot, session) VALUES
      ('karen1.1','karen',1,1), ('elle1.1','elle',1,1);
    INSERT INTO agent_roles (family, kind) VALUES
      ('karen','FEATURE'), ('karen','DOCS'), ('elle','FEATURE');
    INSERT INTO agent_sops (family, rules) VALUES
      ('karen','Stay inside task_paths.'), ('elle','Stay inside task_paths.');
  `);
  return { sqlite, db: new D1DatabaseMock(sqlite) };
}

function addTask(sqlite, {
  id,
  assignedTo = 'karen',
  project = 'leker',
  status = 'OPEN',
  kind = 'FEATURE',
  role = 'IMPLEMENTER',
  paths = []
}) {
  sqlite.prepare(`INSERT INTO tasks
    (task_id,assigned_to,issued_by,role,territory,protocol_version,title,brief,
     acceptance_criteria,status,kind,self_closing,mutates_production,forbidden,project)
    VALUES (?,?,?,?,?,'MAXI_AGENT_TASK_BOARD_V1','Old title','Old brief','Old criteria',?,?,0,0,'Old forbidden',?)`)
    .run(id, assignedTo, 'BOS_CYO', role, 'platform-core', status, kind, project);
  for (const path of paths) {
    sqlite.prepare('INSERT INTO task_paths (task_id,path_prefix) VALUES (?,?)').run(id, path);
  }
}

function claim(sqlite, taskId, sessionId, id = `${taskId}-claim`) {
  sqlite.prepare('INSERT INTO task_claims (id,task_id,session_id) VALUES (?,?,?)').run(id, taskId, sessionId);
}

function rawTask(sqlite, taskId) {
  return sqlite.prepare('SELECT * FROM tasks WHERE task_id=?').get(taskId);
}

function rawPaths(sqlite, taskId) {
  return sqlite.prepare('SELECT path_prefix FROM task_paths WHERE task_id=? ORDER BY path_prefix')
    .all(taskId).map(row => row.path_prefix);
}

test('V1 exposes board_update_open_task without removing existing tools', () => {
  const names = TOOLS.map(tool => tool.name);
  for (const existing of [
    'board_get_context', 'board_get_task', 'board_register_session', 'board_claim_task',
    'board_list_escalations', 'board_submit_report'
  ]) {
    assert.ok(names.includes(existing), `${existing} must remain exposed`);
  }
  assert.ok(names.includes('board_update_open_task'));
  assert.equal(new Set(names).size, names.length);
});

test('path normalization is deterministic and rejects traversal or broad roots', () => {
  assert.equal(normalizeBoardPath('./public\\agent-bus-status.js'), 'public/agent-bus-status.js');
  assert.throws(() => normalizeBoardPath('../secret'), /INVALID_TASK_PATH/);
  assert.throws(() => normalizeBoardPath('/etc/passwd'), /INVALID_TASK_PATH/);
  assert.throws(() => normalizeBoardPath('src/'), /TASK_PATH_TOO_BROAD/);
  assert.throws(() => normalizeBoardPath('x'.repeat(50)), /TASK_PATH_TOO_LONG/);
});

test('authorized caller atomically replaces paths and receives updated task state', async () => {
  const { sqlite, db } = bus();
  addTask(sqlite, { id: 'karen-AGENT-BUS-STATUS-PAGE', paths: ['public/old.js'] });

  const result = await updateOpenTask(db, {
    taskId: 'karen-AGENT-BUS-STATUS-PAGE',
    title: 'Agent Bus status page',
    paths: [
      'public\\staff.html',
      'public/agent-bus-status.html',
      'public/agent-bus-status.js',
      'src/agent-bus-status.js',
      'src/index.js',
      'wrangler.jsonc',
      'test/agent-bus-status.test.js',
      'package.json'
    ]
  }, ENV);

  assert.equal(result.title, 'Agent Bus status page');
  assert.equal(result.task_paths.length, 8);
  assert.deepEqual(result.task_paths, rawPaths(sqlite, result.task_id));
  assert.ok(!result.task_paths.includes('public/old.js'));
  assert.ok(result.task_paths.includes('public/staff.html'));
  assert.ok(result.updated_at);
  assert.ok(!JSON.stringify(result).includes(ENV.MCP_AUTH_TOKEN));
});

test('unauthorized family, project, kind, and ownership are rejected', async () => {
  const { sqlite, db } = bus();
  addTask(sqlite, { id: 'T-OWNED-BY-ELLE', assignedTo: 'elle' });
  addTask(sqlite, { id: 'T-OTHER-PROJECT', project: 'ikan' });
  addTask(sqlite, { id: 'T-OTHER-KIND', kind: 'MIGRATION' });

  await assert.rejects(
    () => updateOpenTask(db, { taskId: 'T-OWNED-BY-ELLE', title: 'x' }, ENV),
    /TASK_NOT_AUTHORIZED/
  );
  await assert.rejects(
    () => updateOpenTask(db, { taskId: 'T-OTHER-PROJECT', title: 'x' }, ENV),
    /PROJECT_NOT_AUTHORIZED/
  );
  await assert.rejects(
    () => updateOpenTask(db, { taskId: 'T-OTHER-KIND', title: 'x' }, ENV),
    /TASK_KIND_NOT_AUTHORIZED/
  );
});

test('non-OPEN and actively claimed tasks cannot be changed', async () => {
  const { sqlite, db } = bus();
  addTask(sqlite, { id: 'T-DONE', status: 'DONE' });
  addTask(sqlite, { id: 'T-CLAIMED' });
  claim(sqlite, 'T-CLAIMED', 'karen1.1');

  await assert.rejects(() => updateOpenTask(db, { taskId: 'T-DONE', title: 'x' }, ENV), /TASK_NOT_OPEN/);
  await assert.rejects(
    () => updateOpenTask(db, { taskId: 'T-CLAIMED', title: 'x' }, ENV),
    /TASK_HAS_ACTIVE_CLAIM/
  );
});

test('a fresh overlap check rejects paths held by another active claim', async () => {
  const { sqlite, db } = bus();
  addTask(sqlite, { id: 'T-TARGET' });
  addTask(sqlite, {
    id: 'T-HELD', assignedTo: 'elle', paths: ['public/agent-bus-status.js']
  });
  claim(sqlite, 'T-HELD', 'elle1.1');

  await assert.rejects(
    () => updateOpenTask(db, {
      taskId: 'T-TARGET', paths: ['public/agent-bus-status.js']
    }, ENV),
    /PATH_HELD_BY_ANOTHER_CLAIM: T-HELD:public\/agent-bus-status\.js/
  );
  assert.deepEqual(rawPaths(sqlite, 'T-TARGET'), []);
});

test('task metadata and all paths roll back if any path insert fails', async () => {
  const { sqlite, db } = bus();
  addTask(sqlite, { id: 'T-ATOMIC', paths: ['public/old.js'] });
  sqlite.exec(`CREATE TRIGGER test_abort_second_path
    BEFORE INSERT ON task_paths
    WHEN NEW.path_prefix='src/fail.js'
    BEGIN SELECT RAISE(ABORT, 'TEST_PATH_ABORT'); END;`);

  await assert.rejects(
    () => updateOpenTask(db, {
      taskId: 'T-ATOMIC', title: 'New title', paths: ['public/new.js', 'src/fail.js']
    }, ENV),
    /TEST_PATH_ABORT/
  );
  assert.equal(rawTask(sqlite, 'T-ATOMIC').title, 'Old title');
  assert.deepEqual(rawPaths(sqlite, 'T-ATOMIC'), ['public/old.js']);
});

test('D1 write intent rejects a claimed task without removing protocol self-service inserts', () => {
  const { sqlite } = bus();
  addTask(sqlite, { id: 'T-CLAIMED-GUARD', paths: ['src/held.js'] });
  claim(sqlite, 'T-CLAIMED-GUARD', 'karen1.1');

  assert.throws(
    () => sqlite.prepare(`INSERT INTO board_write_intents (operation_id,task_id)
      VALUES ('race-check','T-CLAIMED-GUARD')`).run(),
    /OPEN_UNCLAIMED_TASK_REQUIRED/
  );
  sqlite.prepare("INSERT INTO task_paths (task_id,path_prefix) VALUES ('T-CLAIMED-GUARD','test/held.test.js')").run();
  assert.deepEqual(rawPaths(sqlite, 'T-CLAIMED-GUARD'), ['src/held.js', 'test/held.test.js']);
});

test('implementation paths cannot be empty and ownership fields cannot be spoofed', async () => {
  const { sqlite, db } = bus();
  addTask(sqlite, { id: 'T-VALIDATION' });
  await assert.rejects(
    () => updateOpenTask(db, { taskId: 'T-VALIDATION', paths: [] }, ENV),
    /IMPLEMENTATION_TASK_PATHS_REQUIRED/
  );
  await assert.rejects(
    () => updateOpenTask(db, { taskId: 'T-VALIDATION', issued_by: 'BOS_CYO' }, ENV),
    /UNEXPECTED_FIELDS: issued_by/
  );
});

test('production-mutating task cannot be made self-closing through the tool', async () => {
  const { sqlite, db } = bus();
  addTask(sqlite, { id: 'T-PRODUCTION' });
  await assert.rejects(
    () => updateOpenTask(db, {
      taskId: 'T-PRODUCTION', mutatesProduction: true, selfClosing: true
    }, ENV),
    /PRODUCTION_TASK_CANNOT_SELF_CLOSE/
  );
});

test('existing board_get_task stays callable and adds an ordered task_paths array', async () => {
  const { sqlite, db } = bus();
  addTask(sqlite, { id: 'T-READ', paths: ['src/b.js', 'src/a.js'] });
  const result = await callTool(db, 'board_get_task', { taskId: 'T-READ' }, ENV);
  assert.equal(result.paths, 'src/a.js, src/b.js');
  assert.deepEqual(result.task_paths, ['src/a.js', 'src/b.js']);
});

test('HTTP tools/list requires authentication and never returns credentials', async () => {
  const { db } = bus();
  const payload = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  const unauthenticated = await worker.fetch(new Request('https://agent-bus.example/mcp', {
    method: 'POST', body: JSON.stringify(payload)
  }), { ...ENV, AGENT_BUS: db });
  assert.equal(unauthenticated.status, 401);

  const response = await worker.fetch(new Request('https://agent-bus.example/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${ENV.MCP_AUTH_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }), { ...ENV, AGENT_BUS: db });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /board_update_open_task/);
  assert.ok(!body.includes(ENV.MCP_AUTH_TOKEN));
});
