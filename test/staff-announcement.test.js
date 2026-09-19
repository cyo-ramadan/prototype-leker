import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleStaffAnnouncementApi } from '../src/staff-announcement.js';
import { handleAdminCashierApi } from '../src/cashier-auth.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-19: "tambahkan juga tombol anoncement" -- papan
// pengumuman SEARAH, lingkup "sama seperti manual book yang aku jelasin":
// entity-wide (Owner/Entity Admin) + per-gerai (Admin Gerai).

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

async function entityAdminToken(sqlite, entityAdminId = 'entity_admin_rika_pilot') {
  const token = `entityadmin-${entityAdminId}`;
  sqlite.prepare(`INSERT INTO entity_admin_sessions (token_hash, entity_admin_id, created_at, expires_at) VALUES (?, ?, '2026-09-19T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), entityAdminId);
  return token;
}

async function cashierToken(sqlite, cashierId) {
  const token = `cashier-${cashierId}`;
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, '2026-09-19T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), cashierId);
  return token;
}

const call = (env, pathname, options) => handleStaffAnnouncementApi(request(pathname, options), env, pathname);

async function makeCashier(env, adminToken, storeCode, username) {
  const response = await handleAdminCashierApi(request('/api/admin/cashiers', {
    token: adminToken, store: storeCode, method: 'POST', body: { username, password: 'rahasia1', employeeName: username }
  }), env, '/api/admin/cashiers');
  return response.json();
}

test('Admin Gerai bikin pengumuman khusus gerainya -- ditolak kalau minta entityWide', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const pendemToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    const rejected = await call(env, '/api/admin/announcements', {
      token: pendemToken, store: 'PENDEM', method: 'POST', body: { title: 'Coba semua gerai', entityWide: true }
    });
    assert.equal(rejected.status, 403);
    assert.equal((await rejected.json()).code, 'ENTITY_LEVEL_ONLY');

    const ok = await call(env, '/api/admin/announcements', {
      token: pendemToken, store: 'PENDEM', method: 'POST', body: { title: 'Libur nasional gerai Pendem', body: 'Tutup jam 3 sore' }
    });
    assert.equal(ok.status, 201);
  } finally { sqlite.close(); }
});

test('Entity Admin bikin pengumuman entity-wide -- tampil di semua gerai entity itu', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const entityToken = await entityAdminToken(sqlite);
    const pendemAdmin = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const mandalaAdmin = await storeAdminToken(sqlite, 'admin_mandala_pilot');

    await call(env, '/api/admin/announcements', {
      token: entityToken, store: 'PENDEM', method: 'POST', body: { title: 'Pengumuman semua gerai', entityWide: true }
    });
    await call(env, '/api/admin/announcements', {
      token: pendemAdmin, store: 'PENDEM', method: 'POST', body: { title: 'Khusus Pendem saja' }
    });

    const pendemCashier = await makeCashier(env, pendemAdmin, 'PENDEM', 'kasir_pendem_announce');
    const mandalaCashier = await makeCashier(env, mandalaAdmin, 'MANDALA', 'kasir_mandala_announce');
    const pendemToken = await cashierToken(sqlite, pendemCashier.id);
    const mandalaToken = await cashierToken(sqlite, mandalaCashier.id);

    const pendemView = await (await call(env, '/api/staff/announcements', { token: pendemToken })).json();
    const titlesPendem = pendemView.announcements.map(item => item.title);
    assert.ok(titlesPendem.includes('Pengumuman semua gerai'));
    assert.ok(titlesPendem.includes('Khusus Pendem saja'));

    const mandalaView = await (await call(env, '/api/staff/announcements', { token: mandalaToken })).json();
    const titlesMandala = mandalaView.announcements.map(item => item.title);
    assert.ok(titlesMandala.includes('Pengumuman semua gerai'), 'entity-wide harus tampil di gerai lain juga');
    assert.ok(!titlesMandala.includes('Khusus Pendem saja'), 'pengumuman khusus Pendem tidak boleh bocor ke Mandala');
  } finally { sqlite.close(); }
});

test('Nonaktifkan pengumuman -- tidak muncul lagi di daftar staf, tidak ada jalur edit isi', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const pendemAdmin = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const created = await (await call(env, '/api/admin/announcements', {
      token: pendemAdmin, store: 'PENDEM', method: 'POST', body: { title: 'Salah ketik', body: 'xxx' }
    })).json();

    const cashier = await makeCashier(env, pendemAdmin, 'PENDEM', 'kasir_pendem_deact');
    const kasirToken = await cashierToken(sqlite, cashier.id);

    let view = await (await call(env, '/api/staff/announcements', { token: kasirToken })).json();
    assert.ok(view.announcements.some(item => item.title === 'Salah ketik'));

    const deactivated = await call(env, `/api/admin/announcements/${created.id}`, { token: pendemAdmin, store: 'PENDEM', method: 'PATCH' });
    assert.equal(deactivated.status, 200);

    view = await (await call(env, '/api/staff/announcements', { token: kasirToken })).json();
    assert.ok(!view.announcements.some(item => item.title === 'Salah ketik'), 'yang dinonaktifkan tidak boleh muncul lagi');
  } finally { sqlite.close(); }
});

test('Kasir ditolak POST/PATCH pengumuman -- cuma boleh GET', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const pendemAdmin = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const cashier = await makeCashier(env, pendemAdmin, 'PENDEM', 'kasir_pendem_forbid');
    const kasirToken = await cashierToken(sqlite, cashier.id);

    const attempt = await call(env, '/api/admin/announcements', { token: kasirToken, store: 'PENDEM', method: 'POST', body: { title: 'coba' } });
    assert.equal(attempt.status, 401);
  } finally { sqlite.close(); }
});

test('UI Portal Staf punya tombol Pengumuman', () => {
  const staffJs = readFileSync(new URL('../public/staff.js', import.meta.url), 'utf8');
  const staffHtml = readFileSync(new URL('../public/staff.html', import.meta.url), 'utf8');
  assert.match(staffHtml, /data-staff-tab="announcement"/);
  assert.match(staffJs, /loadAnnouncements/);
});
