import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleStaffDailyTaskApi } from '../src/staff-daily-task.js';
import { handleAdminCashierApi } from '../src/cashier-auth.js';
import { hashCredential } from '../src/owner-auth.js';

const staffJs = readFileSync(new URL('../public/staff.js', import.meta.url), 'utf8');
const staffHtml = readFileSync(new URL('../public/staff.html', import.meta.url), 'utf8');
const adminDailyTaskUi = readFileSync(new URL('../public/admin-daily-task.js', import.meta.url), 'utf8');

// Bos Cyo, 2026-09-19: "portal staf kasih tombol daily task ya, nanti
// isi2nya aku mau kasih seperti pakai appron, bersih2, tes rasa2 ...
// pengaturan task juga di set up oleh admin dari panel nya."

const migrationDir = new URL('../migrations/', import.meta.url);

function d1(sqlite) {
  function prepared(sql) {
    const statement = sqlite.prepare(sql);
    return {
      _statement: statement,
      _args: [],
      async first() { return statement.get() || null; },
      async all() { return { results: statement.all() }; },
      async run() { const result = statement.run(); return { success: true, meta: { changes: result.changes } }; },
      bind(...args) {
        return {
          _statement: statement,
          _args: args,
          async first() { return statement.get(...args) || null; },
          async all() { return { results: statement.all(...args) }; },
          async run() { const result = statement.run(...args); return { success: true, meta: { changes: result.changes } }; }
        };
      }
    };
  }
  return {
    prepare: prepared,
    async batch(boundStatements) {
      sqlite.exec('BEGIN');
      try {
        const results = boundStatements.map(item => item._statement.run(...item._args));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function request(pathname, { token, method = 'GET', body, store } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store) url.searchParams.set('store', store);
  return new Request(url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function storeAdminToken(sqlite, adminId) {
  const token = `admin-${adminId}`;
  sqlite.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, '2026-09-19T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), adminId);
  return token;
}

async function cashierToken(sqlite, cashierId) {
  const token = `cashier-${cashierId}`;
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, '2026-09-19T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), cashierId);
  return token;
}

const call = (env, pathname, options) => handleStaffDailyTaskApi(request(pathname, options), env, pathname);

async function makeCashier(env, adminToken, storeCode, username) {
  const response = await handleAdminCashierApi(request('/api/admin/cashiers', {
    token: adminToken, store: storeCode, method: 'POST', body: { username, password: 'rahasia1', employeeName: username }
  }), env, '/api/admin/cashiers');
  return response.json();
}

test('Admin bikin template tugas harian, tampil di checklist kasir gerai yang sama', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const pendemAdmin = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const createdResponse = await call(env, '/api/admin/daily-task-templates', {
      token: pendemAdmin, store: 'PENDEM', method: 'POST', body: { title: 'Pakai apron', description: 'Sebelum mulai shift' }
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.ok(created.id);

    const cashier = await makeCashier(env, pendemAdmin, 'PENDEM', 'kasir_pendem_task');
    const kasirToken = await cashierToken(sqlite, cashier.id);

    const checklist = await (await call(env, '/api/staff/daily-tasks', { token: kasirToken })).json();
    assert.equal(checklist.tasks.length, 1);
    assert.equal(checklist.tasks[0].title, 'Pakai apron');
    assert.equal(checklist.tasks[0].completed, false);
  } finally { sqlite.close(); }
});

test('Template gerai lain tidak bocor ke checklist gerai ini', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const pendemAdmin = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const mandalaAdmin = await storeAdminToken(sqlite, 'admin_mandala_pilot');
    await call(env, '/api/admin/daily-task-templates', { token: pendemAdmin, store: 'PENDEM', method: 'POST', body: { title: 'Tugas Pendem' } });
    await call(env, '/api/admin/daily-task-templates', { token: mandalaAdmin, store: 'MANDALA', method: 'POST', body: { title: 'Tugas Mandala' } });

    const cashier = await makeCashier(env, pendemAdmin, 'PENDEM', 'kasir_pendem_isolate');
    const kasirToken = await cashierToken(sqlite, cashier.id);
    const checklist = await (await call(env, '/api/staff/daily-tasks', { token: kasirToken })).json();
    assert.deepEqual(checklist.tasks.map(t => t.title), ['Tugas Pendem']);
  } finally { sqlite.close(); }
});

test('Tandai selesai idempotent -- klik dua kali tidak bikin 2 baris, catatan ikut ter-update', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const pendemAdmin = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const template = await (await call(env, '/api/admin/daily-task-templates', {
      token: pendemAdmin, store: 'PENDEM', method: 'POST', body: { title: 'Bersih-bersih' }
    })).json();
    const cashier = await makeCashier(env, pendemAdmin, 'PENDEM', 'kasir_pendem_idem');
    const kasirToken = await cashierToken(sqlite, cashier.id);

    await call(env, '/api/staff/daily-tasks/complete', { token: kasirToken, method: 'POST', body: { templateId: template.id, note: 'sudah' } });
    await call(env, '/api/staff/daily-tasks/complete', { token: kasirToken, method: 'POST', body: { templateId: template.id, note: 'sudah, dicek ulang' } });

    const count = sqlite.prepare('SELECT COUNT(*) AS n FROM daily_task_completions').get();
    assert.equal(count.n, 1, 'klik dua kali tidak boleh bikin 2 baris completion');

    const checklist = await (await call(env, '/api/staff/daily-tasks', { token: kasirToken })).json();
    assert.equal(checklist.tasks[0].completed, true);
    assert.equal(checklist.tasks[0].note, 'sudah, dicek ulang', 'catatan harus ter-update ke yang terbaru');
  } finally { sqlite.close(); }
});

test('Checklist tanggal bisnis berbeda tidak saling memengaruhi', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const pendemAdmin = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const template = await (await call(env, '/api/admin/daily-task-templates', {
      token: pendemAdmin, store: 'PENDEM', method: 'POST', body: { title: 'Tes rasa' }
    })).json();
    const cashier = await makeCashier(env, pendemAdmin, 'PENDEM', 'kasir_pendem_multiday');

    // Selesai untuk business_date "kemarin" ditulis langsung ke DB (tanpa
    // lewat endpoint, supaya bisa mengontrol tanggalnya) -- membuktikan
    // checklist HARI INI tidak ikut tercentang.
    sqlite.prepare(`
      INSERT INTO daily_task_completions (id, template_id, cashier_id, store_id, business_date, note, completed_at)
      VALUES ('done_kemarin', ?, ?, 'store_pendem', '2020-01-01', '', CURRENT_TIMESTAMP)
    `).run(template.id, cashier.id);

    const kasirToken = await cashierToken(sqlite, cashier.id);
    const checklist = await (await call(env, '/api/staff/daily-tasks', { token: kasirToken })).json();
    assert.equal(checklist.tasks[0].completed, false, 'completion tanggal lain tidak boleh dianggap selesai hari ini');
  } finally { sqlite.close(); }
});

test('Nonaktifkan template -- hilang dari checklist baru, tapi completion lama tidak hilang dari histori', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const pendemAdmin = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const template = await (await call(env, '/api/admin/daily-task-templates', {
      token: pendemAdmin, store: 'PENDEM', method: 'POST', body: { title: 'Tugas lama' }
    })).json();
    const cashier = await makeCashier(env, pendemAdmin, 'PENDEM', 'kasir_pendem_deactivate');
    const kasirToken = await cashierToken(sqlite, cashier.id);
    await call(env, '/api/staff/daily-tasks/complete', { token: kasirToken, method: 'POST', body: { templateId: template.id } });

    await call(env, `/api/admin/daily-task-templates/${template.id}`, { token: pendemAdmin, store: 'PENDEM', method: 'PATCH', body: { isActive: false } });

    const checklist = await (await call(env, '/api/staff/daily-tasks', { token: kasirToken })).json();
    assert.equal(checklist.tasks.length, 0, 'template nonaktif tidak boleh muncul lagi di checklist');

    const historyCount = sqlite.prepare('SELECT COUNT(*) AS n FROM daily_task_completions WHERE template_id = ?').get(template.id);
    assert.equal(historyCount.n, 1, 'completion lama tidak boleh ikut terhapus');
  } finally { sqlite.close(); }
});

test('UI Portal Staf punya tombol Daily Task, dan Admin punya panel pengaturan template', () => {
  assert.match(staffHtml, /data-staff-tab="dailytask"/);
  assert.match(staffJs, /loadDailyTasks/);
  assert.match(staffJs, /\/api\/staff\/daily-tasks\/complete/);
  assert.match(adminDailyTaskUi, /daily-task-templates/);
});
