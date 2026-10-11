import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';

// Exercise the deployed entry point, not a replacement posting callback.
// Its Workspace -> catat -> product editor chain must retain real scoped auth.
class Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { success: true, results: this.db.prepare(this.sql).all(...this.params), meta: { changes: 0 } }; }
  run() { const result = this.db.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: Number(result.changes) } }; }
  execute() { return this.db.prepare(this.sql).columns().length ? this.all() : this.run(); }
}
async function fixture(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  const migrations = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(migrations).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
  const env = { DB: {
    prepare(sql) { return new Statement(sqlite, sql); },
    batch(statements) {
      sqlite.exec('BEGIN');
      try { const result = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  } };
  sqlite.exec(`INSERT INTO entity_admins (id,entity_id,username,password_hash,display_name) VALUES
    ('integration-e1','ENT-G001','integration-e1','unused','Integration One'),
    ('integration-e2','ENT-G002','integration-e2','unused','Integration Two');`);
  for (const [token, id] of [['integration-token-one', 'integration-e1'], ['integration-token-two', 'integration-e2']]) sqlite.prepare('INSERT INTO entity_admin_sessions (token_hash,entity_admin_id,created_at,expires_at) VALUES (?,?,?,?)').run(await hashCredential(token), id, '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z');
  return { sqlite, env };
}
async function api(env, path, { method = 'GET', body, token = 'integration-token-one' } = {}) {
  const request = new Request('https://workspace.test' + path, {
    method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const response = await worker.fetch(request, env);
  return { status: response.status, body: await response.json() };
}
const root = '/api/caca/workspace';
const productDraft = name => ({ aksi: 'buat_barang', tangkapan: { barang_nama: name, barang_harga_jual: '5000', barang_harga_beli: '2000' } });

test('persisted Workspace product uses full canonical router, concurrent approval creates once, GET reload preserves cursor', async t => {
  const { env, sqlite } = await fixture(t);
  t.mock.method(globalThis, 'fetch', () => assert.fail('Workspace prepare/approval must not call external providers'));
  const name = 'Workspace canonical concurrent product';
  const created = await api(env, root + '?store=G001', { method: 'POST', body: { draft: productDraft(name) } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const task = created.body.workspace;
  assert.equal(task.status, 'DRAFT'); assert.equal(task.scope.storeId, 'store_001');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM products WHERE name=?').get(name).n, 0);
  const pathname = root + '/' + task.id;
  const approvals = await Promise.all([1, 2].map(() => api(env, pathname + '/catat?store=G002', { method: 'POST', body: { revision: task.revision, expectedCursor: 0 } })));
  assert.ok(approvals.some(result => result.status === 200), JSON.stringify(approvals));
  for (const result of approvals) assert.ok(result.status === 200 || result.status === 409, JSON.stringify(result));
  const products = sqlite.prepare('SELECT name,store_id,price,purchase_price FROM products WHERE name=?').all(name);
  assert.equal(products.length, 1);
  assert.equal(products[0].store_id, 'store_001');
  assert.equal(products[0].price, 5000 * 1_000_000);
  assert.equal(products[0].purchase_price, 2000 * 1_000_000);
  const reload = await api(env, pathname);
  assert.equal(reload.status, 200); assert.equal(reload.body.workspace.cursor, 1);
  assert.equal(reload.body.workspace.status, 'COMPLETED'); assert.equal(reload.body.workspace.results.length, 1);
  const replay = await api(env, pathname + '/catat', { method: 'POST', body: { revision: task.revision, expectedCursor: 0 } });
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM products WHERE name=?').get(name).n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM una_workspace_steps WHERE task_id=?').get(task.id).n, 1);
});

test('full router denies foreign EntityAdmin and reparented store before canonical Workspace product write', async t => {
  const { env, sqlite } = await fixture(t);
  const name = 'Workspace forbidden foreign product';
  const denied = await api(env, root + '?store=G001', { method: 'POST', token: 'integration-token-two', body: { draft: productDraft(name) } });
  assert.equal(denied.status, 403, JSON.stringify(denied.body));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM una_workspace_tasks').get().n, 0);
  const created = await api(env, root + '?store=G001', { method: 'POST', body: { draft: productDraft(name) } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const task = created.body.workspace, pathname = root + '/' + task.id;
  const foreign = await api(env, pathname + '/catat', { method: 'POST', token: 'integration-token-two', body: { revision: task.revision, expectedCursor: 0 } });
  assert.equal(foreign.status, 404);
  sqlite.exec("UPDATE stores SET entity_id='ENT-G002' WHERE id='store_001'");
  const reparented = await api(env, pathname + '/catat', { method: 'POST', body: { revision: task.revision, expectedCursor: 0 } });
  assert.equal(reparented.status, 403, JSON.stringify(reparented.body));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM products WHERE name=?').get(name).n, 0);
  assert.equal(sqlite.prepare('SELECT cursor FROM una_workspace_tasks WHERE id=?').get(task.id).cursor, 0);
});

test('legacy expense Workspace goes through the canonical Accounting wrapper and replay creates no second debt or journal', async t => {
  const { env, sqlite } = await fixture(t);
  const description = 'Workspace canonical accounting expense';
  const countJournals = () => sqlite.prepare("SELECT COUNT(*) AS n FROM accounting_journal_headers WHERE store_id='store_001' AND source_system='LEKER_ADMIN'").get().n;
  const before = countJournals();
  const created = await api(env, root + '?store=G001', { method: 'POST', body: { draft: { jenis: 'BEA_LAINNYA', keterangan: description, nominal: 5000, pihak: 'Integration Supplier', tanggal: '2026-10-01' } } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const task = created.body.workspace;
  const pathname = root + '/' + task.id + '/catat';
  const approved = await api(env, pathname, { method: 'POST', body: { revision: task.revision, expectedCursor: 0 } });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_operational_expenses WHERE store_id=? AND description=?').get('store_001', description).n, 1);
  assert.equal(countJournals(), before + 1, 'real Accounting wrapper must post the new operational expense');
  const replay = await api(env, pathname, { method: 'POST', body: { revision: task.revision, expectedCursor: 0 } });
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_operational_expenses WHERE store_id=? AND description=?').get('store_001', description).n, 1);
  assert.equal(countJournals(), before + 1);
});
