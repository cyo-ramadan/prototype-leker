const SERVER = { name: 'maxi-agent-bus-bridge', version: '1.1.0' };
const MAX_PATH_LENGTH = 49;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id'
};

export const TOOLS = [
  {
    name: 'board_get_context',
    description: 'Read agent sessions, roles, SOP, open tasks, task paths, and active claims for one agent family and project.',
    inputSchema: {
      type: 'object',
      properties: { family: { type: 'string' }, project: { type: 'string' } },
      required: ['family', 'project'], additionalProperties: false
    }
  },
  {
    name: 'board_get_task',
    description: 'Read one task, its reserved paths, and current claim.',
    inputSchema: {
      type: 'object', properties: { taskId: { type: 'string' } },
      required: ['taskId'], additionalProperties: false
    }
  },
  {
    name: 'board_register_session',
    description: 'Register an implementer session after choosing an unused family slot according to CLAIM-PROMPT.md.',
    inputSchema: {
      type: 'object',
      properties: {
        family: { type: 'string' }, slot: { type: 'integer', minimum: 1 }, session: { type: 'integer', minimum: 1 }
      },
      required: ['family', 'slot', 'session'], additionalProperties: false
    }
  },
  {
    name: 'board_claim_task',
    description: 'Claim one task. Database role, handoff, duplicate, and path-collision triggers remain authoritative.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, sessionId: { type: 'string' } },
      required: ['taskId', 'sessionId'], additionalProperties: false
    }
  },
  {
    name: 'board_list_escalations',
    description: 'Read open escalations, optionally limited to one task.',
    inputSchema: {
      type: 'object', properties: { taskId: { type: 'string' } }, additionalProperties: false
    }
  },
  {
    name: 'board_submit_report',
    description: 'Write an implementation report and release the active claim as REPORTED. Does not verify or close the task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' }, sessionId: { type: 'string' }, territory: { type: 'string' },
        summary: { type: 'string' }, filesChanged: { type: 'string' }, testsAndResults: { type: 'string' },
        openRisks: { type: 'string' }, docImpact: { type: 'string' }, finalStatus: { enum: ['PASS', 'FAIL', 'BLOCKED'] }
      },
      required: ['taskId', 'sessionId', 'territory', 'summary', 'filesChanged', 'testsAndResults', 'finalStatus'],
      additionalProperties: false
    }
  },
  {
    name: 'board_update_open_task',
    description: 'Replace editable fields or the complete path set of one OPEN, unclaimed task authorized for this connector.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        title: { type: 'string' },
        brief: { type: 'string' },
        acceptanceCriteria: { type: 'string' },
        forbidden: { type: 'string' },
        paths: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        mutatesProduction: { type: 'boolean' },
        selfClosing: { type: 'boolean' }
      },
      required: ['taskId'], additionalProperties: false
    }
  }
];

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...headers }
  });
}

function safeText(value, name, max = 10000) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`${name} wajib diisi dan maksimal ${max} karakter`);
  return text;
}

function safeFamily(value) {
  const family = safeText(value, 'family', 32).toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(family)) throw new Error('family tidak valid');
  return family;
}

function safeProject(value) {
  const project = safeText(value, 'project', 40).toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(project)) throw new Error('project tidak valid');
  return project;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function assertExactKeys(args, allowed) {
  const unexpected = Object.keys(args || {}).filter(key => !allowed.has(key));
  if (unexpected.length) throw new Error(`UNEXPECTED_FIELDS: ${unexpected.join(', ')}`);
}

function optionalBoolean(args, key) {
  if (!hasOwn(args, key)) return undefined;
  if (typeof args[key] !== 'boolean') throw new Error(`${key} harus boolean`);
  return args[key] ? 1 : 0;
}

export function normalizeBoardPath(value) {
  const input = safeText(value, 'path', 240);
  if (/^[a-zA-Z]:[\\/]/.test(input) || input.startsWith('/') || input.includes('\0')) {
    throw new Error('INVALID_TASK_PATH');
  }

  const slashPath = input.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const hadTrailingSlash = slashPath.endsWith('/');
  const segments = slashPath.split('/').filter(segment => segment && segment !== '.');
  if (!segments.length || segments.some(segment => segment === '..')) throw new Error('INVALID_TASK_PATH');

  const normalized = segments.join('/') + (hadTrailingSlash ? '/' : '');
  if (normalized.length > MAX_PATH_LENGTH) throw new Error('TASK_PATH_TOO_LONG');
  if (segments.length === 1 && hadTrailingSlash) throw new Error('TASK_PATH_TOO_BROAD');
  if (['.', '.git', '.github', 'src', 'public', 'test', 'tests', 'migrations', 'agent-bus', 'agent-bridge']
    .includes(normalized)) {
    throw new Error('TASK_PATH_TOO_BROAD');
  }
  return normalized;
}

function normalizePaths(paths) {
  if (!Array.isArray(paths)) throw new Error('paths harus array');
  const normalized = paths.map(normalizeBoardPath);
  if (new Set(normalized).size !== normalized.length) throw new Error('DUPLICATE_TASK_PATH');
  return normalized.sort((left, right) => left.localeCompare(right));
}

function configuredCaller(env) {
  const family = safeFamily(env?.MCP_CALLER_FAMILY);
  const projects = new Set(String(env?.MCP_ALLOWED_PROJECTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  if (!projects.size) throw new Error('CALLER_PROJECT_AUTHORITY_NOT_CONFIGURED');
  for (const project of projects) safeProject(project);
  return { family, projects };
}

function tokenFrom(request, url) {
  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  const parts = url.pathname.split('/').filter(Boolean);
  return parts[0] === 'mcp' && parts.length > 1 ? parts[parts.length - 1] : '';
}

function secretsMatch(candidate, expected) {
  const a = String(candidate || '');
  const b = String(expected || '');
  if (!b) return false;
  let mismatch = a.length === b.length ? 0 : 1;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= a.charCodeAt(index % (a.length || 1)) ^ b.charCodeAt(index % (b.length || 1));
  }
  return mismatch === 0;
}

async function getContext(db, args) {
  const family = safeFamily(args.family);
  const project = safeProject(args.project);
  const [sessions, roles, sop, tasks, claims] = await db.batch([
    db.prepare('SELECT id, family, slot, session, started_at, ended_at FROM agent_sessions WHERE family=? ORDER BY slot, session').bind(family),
    db.prepare('SELECT kind FROM agent_roles WHERE family=? ORDER BY kind').bind(family),
    db.prepare('SELECT rules, updated_at FROM agent_sops WHERE family=?').bind(family),
    db.prepare(`SELECT t.task_id, t.kind, t.project, t.territory, t.title, t.brief,
      t.acceptance_criteria, t.forbidden, t.mutates_production, t.self_closing,
      (SELECT group_concat(path_prefix, ', ') FROM task_paths p WHERE p.task_id=t.task_id) paths
      FROM tasks t JOIN agent_roles r ON r.kind=t.kind AND r.family=?
      WHERE t.status='OPEN' AND t.project=?
      AND NOT EXISTS (SELECT 1 FROM task_claims c WHERE c.task_id=t.task_id AND c.released_at IS NULL)
      ORDER BY t.created_at`).bind(family, project),
    db.prepare(`SELECT c.task_id, c.session_id, c.claimed_at,
      (SELECT group_concat(path_prefix, ', ') FROM task_paths p WHERE p.task_id=c.task_id) paths
      FROM task_claims c JOIN agent_sessions s ON s.id=c.session_id
      WHERE s.family=? AND c.released_at IS NULL ORDER BY c.claimed_at`).bind(family)
  ]);
  return {
    family, project, sessions: sessions.results, roles: roles.results,
    sop: sop.results[0] || null, openTasks: tasks.results, activeClaims: claims.results
  };
}

export async function getTask(db, args) {
  const taskId = safeText(args.taskId, 'taskId', 160);
  const task = await db.prepare(`SELECT t.*,
    (SELECT group_concat(path_prefix, ', ') FROM task_paths p WHERE p.task_id=t.task_id) paths,
    (SELECT session_id FROM task_claims c WHERE c.task_id=t.task_id AND c.released_at IS NULL LIMIT 1) claimed_by
    FROM tasks t WHERE t.task_id=?`).bind(taskId).first();
  if (!task) throw new Error('TASK_NOT_FOUND');
  const taskPaths = await db.prepare('SELECT path_prefix FROM task_paths WHERE task_id=? ORDER BY path_prefix').bind(taskId).all();
  return { ...task, task_paths: taskPaths.results.map(row => row.path_prefix) };
}

async function registerSession(db, args) {
  const family = safeFamily(args.family);
  const slot = Number(args.slot);
  const session = Number(args.session);
  if (!Number.isInteger(slot) || slot < 1 || !Number.isInteger(session) || session < 1) throw new Error('slot/session tidak valid');
  const id = `${family}${slot}.${session}`;
  await db.prepare('INSERT OR IGNORE INTO agent_sessions (id,family,slot,session) VALUES (?,?,?,?)')
    .bind(id, family, slot, session).run();
  return { registered: true, sessionId: id };
}

async function claimTask(db, args) {
  const taskId = safeText(args.taskId, 'taskId', 160);
  const sessionId = safeText(args.sessionId, 'sessionId', 80);
  const claimId = `${sessionId}-${crypto.randomUUID()}`;
  await db.prepare('INSERT INTO task_claims (id,task_id,session_id) VALUES (?,?,?)')
    .bind(claimId, taskId, sessionId).run();
  return { claimed: true, claimId, taskId, sessionId };
}

async function listEscalations(db, args) {
  const taskId = String(args?.taskId || '').trim();
  const statement = taskId
    ? db.prepare("SELECT * FROM escalations WHERE status='OPEN' AND task_id=? ORDER BY created_at").bind(taskId)
    : db.prepare("SELECT * FROM escalations WHERE status='OPEN' ORDER BY created_at");
  return (await statement.all()).results;
}

async function submitReport(db, args) {
  const taskId = safeText(args.taskId, 'taskId', 160);
  const sessionId = safeText(args.sessionId, 'sessionId', 80);
  const territory = safeText(args.territory, 'territory', 80);
  const summary = safeText(args.summary, 'summary');
  const filesChanged = safeText(args.filesChanged, 'filesChanged');
  const testsAndResults = safeText(args.testsAndResults, 'testsAndResults');
  const finalStatus = safeText(args.finalStatus, 'finalStatus', 16);
  if (!['PASS', 'FAIL', 'BLOCKED'].includes(finalStatus)) throw new Error('finalStatus tidak valid');
  const reportId = `${sessionId}-REPORT-${crypto.randomUUID()}`;
  const claim = await db.prepare('SELECT id FROM task_claims WHERE task_id=? AND session_id=? AND released_at IS NULL')
    .bind(taskId, sessionId).first();
  if (!claim) throw new Error('ACTIVE_CLAIM_NOT_FOUND');
  await db.batch([
    db.prepare(`INSERT INTO reports
      (report_id,task_id,agent,role,territory,summary,files_changed,tests_and_results,open_risks,doc_impact,final_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
        reportId, taskId, sessionId, 'IMPLEMENTER', territory, summary, filesChanged,
        testsAndResults, String(args.openRisks || ''), String(args.docImpact || ''), finalStatus
      ),
    db.prepare("UPDATE task_claims SET released_at=datetime('now'),release_reason='REPORTED' WHERE id=?").bind(claim.id)
  ]);
  return { reported: true, reportId, taskId, claimReleased: true };
}

async function assertTaskAuthority(db, task, caller) {
  if (!caller.projects.has(String(task.project || '').toLowerCase())) throw new Error('PROJECT_NOT_AUTHORIZED');
  if (String(task.assigned_to || '').toLowerCase() !== caller.family) throw new Error('TASK_NOT_AUTHORIZED');
  const role = await db.prepare('SELECT 1 permitted FROM agent_roles WHERE family=? AND kind=?')
    .bind(caller.family, task.kind).first();
  if (!role) throw new Error('TASK_KIND_NOT_AUTHORIZED');
}

async function findPathConflict(db, taskId, paths) {
  if (!paths.length) return null;
  const checks = paths.map(path => db.prepare(`SELECT tp.task_id, tp.path_prefix
    FROM task_paths tp
    JOIN task_claims c ON c.task_id=tp.task_id AND c.released_at IS NULL
    WHERE tp.task_id<>?
      AND (instr(?, tp.path_prefix)=1 OR instr(tp.path_prefix, ?)=1)
    LIMIT 1`).bind(taskId, path, path));
  const results = await db.batch(checks);
  return results.map(result => result.results[0]).find(Boolean) || null;
}

export async function updateOpenTask(db, args, env) {
  const allowed = new Set([
    'taskId', 'title', 'brief', 'acceptanceCriteria', 'forbidden', 'paths', 'mutatesProduction', 'selfClosing'
  ]);
  assertExactKeys(args, allowed);
  const taskId = safeText(args.taskId, 'taskId', 160);
  const changedKeys = [...allowed].filter(key => key !== 'taskId' && hasOwn(args, key));
  if (!changedKeys.length) throw new Error('NO_TASK_UPDATE_FIELDS');

  const caller = configuredCaller(env);
  const current = await getTask(db, { taskId });
  if (current.status !== 'OPEN') throw new Error('TASK_NOT_OPEN');
  if (current.claimed_by) throw new Error('TASK_HAS_ACTIVE_CLAIM');
  await assertTaskAuthority(db, current, caller);

  const updates = [];
  const values = [];
  const textFields = [
    ['title', 'title', 500],
    ['brief', 'brief', 10000],
    ['acceptanceCriteria', 'acceptance_criteria', 10000],
    ['forbidden', 'forbidden', 10000]
  ];
  for (const [input, column, max] of textFields) {
    if (!hasOwn(args, input)) continue;
    updates.push(`${column}=?`);
    values.push(safeText(args[input], input, max));
  }

  const mutatesProduction = optionalBoolean(args, 'mutatesProduction');
  const selfClosing = optionalBoolean(args, 'selfClosing');
  if (mutatesProduction !== undefined) {
    updates.push('mutates_production=?');
    values.push(mutatesProduction);
  }
  if (selfClosing !== undefined) {
    updates.push('self_closing=?');
    values.push(selfClosing);
  }
  const nextMutatesProduction = mutatesProduction ?? Number(current.mutates_production);
  const nextSelfClosing = selfClosing ?? Number(current.self_closing);
  if (nextMutatesProduction === 1 && nextSelfClosing === 1) throw new Error('PRODUCTION_TASK_CANNOT_SELF_CLOSE');

  let paths;
  if (hasOwn(args, 'paths')) {
    paths = normalizePaths(args.paths);
    if (String(current.role || '').toUpperCase() === 'IMPLEMENTER' && !paths.length) {
      throw new Error('IMPLEMENTATION_TASK_PATHS_REQUIRED');
    }
    const conflict = await findPathConflict(db, taskId, paths);
    if (conflict) throw new Error(`PATH_HELD_BY_ANOTHER_CLAIM: ${conflict.task_id}:${conflict.path_prefix}`);
  }

  updates.push("updated_at=datetime('now')");
  const operationId = `open-task-update-${crypto.randomUUID()}`;
  const statements = [
    db.prepare('INSERT INTO board_write_intents (operation_id,task_id) VALUES (?,?)')
      .bind(operationId, taskId),
    db.prepare(`UPDATE tasks SET ${updates.join(', ')}
      WHERE task_id=? AND status='OPEN'
      AND NOT EXISTS (SELECT 1 FROM task_claims c WHERE c.task_id=tasks.task_id AND c.released_at IS NULL)`)
      .bind(...values, taskId)
  ];
  if (paths) {
    statements.push(db.prepare('DELETE FROM task_paths WHERE task_id=?').bind(taskId));
    for (const path of paths) {
      statements.push(db.prepare('INSERT INTO task_paths (task_id,path_prefix) VALUES (?,?)').bind(taskId, path));
    }
  }
  statements.push(db.prepare('DELETE FROM board_write_intents WHERE operation_id=?').bind(operationId));

  const results = await db.batch(statements);
  if (Number(results[1]?.meta?.changes ?? 0) !== 1) throw new Error('TASK_STATE_CHANGED');
  return getTask(db, { taskId });
}

export async function callTool(db, name, args = {}, env = {}) {
  switch (name) {
    case 'board_get_context': return getContext(db, args);
    case 'board_get_task': return getTask(db, args);
    case 'board_register_session': return registerSession(db, args);
    case 'board_claim_task': return claimTask(db, args);
    case 'board_list_escalations': return listEscalations(db, args);
    case 'board_submit_report': return submitReport(db, args);
    case 'board_update_open_task': return updateOpenTask(db, args, env);
    default: throw new Error(`UNKNOWN_TOOL: ${name}`);
  }
}

function rpcOk(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcFail(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

export async function handleRpc(message, db, env = {}) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcFail(message?.id ?? null, -32600, 'Invalid JSON-RPC request');
  }
  if (message.id == null || message.method.startsWith('notifications/')) return null;
  if (message.method === 'initialize') return rpcOk(message.id, {
    protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: SERVER,
    instructions: 'MAXI Agent Bus tools. Read CLAIM-PROMPT.md before registering, claiming, updating, or reporting. Database triggers are authoritative.'
  });
  if (message.method === 'ping') return rpcOk(message.id, {});
  if (message.method === 'tools/list') return rpcOk(message.id, { tools: TOOLS });
  if (message.method === 'tools/call') {
    try {
      const result = await callTool(db, message.params?.name, message.params?.arguments || {}, env);
      return rpcOk(message.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false });
    } catch (error) {
      return rpcOk(message.id, { content: [{ type: 'text', text: error.message }], isError: true });
    }
  }
  return rpcFail(message.id, -32601, `Unknown method: ${message.method}`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/health') return json({ ok: true, server: SERVER.name, version: SERVER.version });
    if (url.pathname === '/' && request.method === 'GET') return json({
      server: SERVER, endpoint: 'POST /mcp', transport: 'streamable-http', authenticated: true
    });
    if (!url.pathname.startsWith('/mcp')) return json({ error: 'Not found' }, 404);
    if (!env.AGENT_BUS) return json({ error: 'AGENT_BUS binding missing' }, 500);
    if (!env.MCP_AUTH_TOKEN) return json({ error: 'MCP_AUTH_TOKEN secret missing' }, 500);
    if (!secretsMatch(tokenFrom(request, url), env.MCP_AUTH_TOKEN)) {
      return json({ error: 'Unauthorized' }, 401, { 'www-authenticate': 'Bearer' });
    }
    if (request.method !== 'POST') return json({ error: 'MCP requires POST' }, 405);
    let payload;
    try { payload = await request.json(); }
    catch { return json(rpcFail(null, -32700, 'Invalid JSON'), 400); }
    const messages = Array.isArray(payload) ? payload : [payload];
    const responses = [];
    for (const message of messages) {
      const response = await handleRpc(message, env.AGENT_BUS, env);
      if (response) responses.push(response);
    }
    if (!responses.length) return new Response(null, { status: 202, headers: CORS });
    return json(Array.isArray(payload) ? responses : responses[0]);
  }
};
