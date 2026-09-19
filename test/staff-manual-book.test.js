import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleStaffManualBookApi } from '../src/staff-manual-book.js';
import { handleAdminCashierApi } from '../src/cashier-auth.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-19: "tambahkan juga di portal staff tombol manual book"
// -- dikonfirmasi lewat tanya balik Hana: halaman baru, Admin isi sendiri,
// dua lapis -- "diisi dari entity saja untuk info entity, tapi admin store
// tetap bisa nambahin untuk info khusus store itu."

const migrationDir = new URL('../migrations/', import.meta.url);

function d1(sqlite) {
  function prepared(sql) {
    const statement = sqlite.prepare(sql);
    // D1 asli boleh dipanggil .first()/.all()/.run() langsung tanpa .bind()
    // dulu kalau statement-nya tidak butuh parameter -- owner-auth.js
    // memakai pola ini (fallback LEGACY_PIN), jadi wrapper tes ini ikut
    // menyediakannya, bukan cuma lewat .bind().
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

const call = (env, pathname, options) => handleStaffManualBookApi(request(pathname, options), env, pathname);

test('Entity Admin bisa isi Info Entity, Admin Gerai ditolak isi Info Entity', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const entityToken = await entityAdminToken(sqlite);
    const storeToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    const rejected = await call(env, '/api/admin/manual-book/entity', {
      token: storeToken, store: 'PENDEM', method: 'PATCH', body: { content: 'Coba dari Admin Gerai' }
    });
    assert.equal(rejected.status, 403);
    assert.equal((await rejected.json()).code, 'ENTITY_LEVEL_ONLY');

    const ok = await call(env, '/api/admin/manual-book/entity', {
      token: entityToken, store: 'PENDEM', method: 'PATCH', body: { content: 'SOP seluruh entity KPM' }
    });
    assert.equal(ok.status, 200);

    const row = sqlite.prepare(`SELECT content FROM entity_manual_book WHERE entity_id = 'ENT-KPM'`).get();
    assert.equal(row.content, 'SOP seluruh entity KPM');
  } finally { sqlite.close(); }
});

test('Admin Gerai bisa isi Info Gerai sendiri, tidak memengaruhi gerai lain', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const pendemToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    const ok = await call(env, '/api/admin/manual-book/store', {
      token: pendemToken, store: 'PENDEM', method: 'PATCH', body: { content: 'Info khusus gerai Pendem' }
    });
    assert.equal(ok.status, 200);

    const pendemRow = sqlite.prepare(`SELECT content FROM store_manual_book WHERE store_id = 'store_pendem'`).get();
    assert.equal(pendemRow.content, 'Info khusus gerai Pendem');
    const mandalaRow = sqlite.prepare(`SELECT content FROM store_manual_book WHERE store_id = 'store_mandala'`).get();
    assert.equal(mandalaRow, undefined, 'gerai lain tidak ikut terisi');
  } finally { sqlite.close(); }
});

test('Portal Staf (kasir) melihat gabungan Info Entity + Info Gerai, dan tidak bisa menulis', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const entityToken = await entityAdminToken(sqlite);
    const storeToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    await call(env, '/api/admin/manual-book/entity', { token: entityToken, store: 'PENDEM', method: 'PATCH', body: { content: 'SOP entity' } });
    await call(env, '/api/admin/manual-book/store', { token: storeToken, store: 'PENDEM', method: 'PATCH', body: { content: 'SOP gerai Pendem' } });

    const created = await (await handleAdminCashierApi(request('/api/admin/cashiers', {
      token: storeToken, store: 'PENDEM', method: 'POST', body: { username: 'kasir_manual', password: 'rahasia1', employeeName: 'Kasir Manual' }
    }), env, '/api/admin/cashiers')).json();
    const kasirToken = await cashierToken(sqlite, created.id);

    const staffView = await (await call(env, '/api/staff/manual-book', { token: kasirToken })).json();
    assert.equal(staffView.entityContent, 'SOP entity');
    assert.equal(staffView.storeContent, 'SOP gerai Pendem');

    // Kasir tidak punya sesi Owner/Admin/EntityAdmin -- endpoint tulis wajib gagal.
    const writeAttempt = await call(env, '/api/admin/manual-book/store', { token: kasirToken, store: 'PENDEM', method: 'PATCH', body: { content: 'coba nulis' } });
    assert.equal(writeAttempt.status, 401);
  } finally { sqlite.close(); }
});

test('belum diisi Admin sama sekali -- Portal Staf dapat string kosong, bukan error', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const storeToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const created = await (await handleAdminCashierApi(request('/api/admin/cashiers', {
      token: storeToken, store: 'PENDEM', method: 'POST', body: { username: 'kasir_polos', password: 'rahasia1', employeeName: 'Kasir Polos' }
    }), env, '/api/admin/cashiers')).json();
    const kasirToken = await cashierToken(sqlite, created.id);

    const staffView = await (await call(env, '/api/staff/manual-book', { token: kasirToken })).json();
    assert.equal(staffView.entityContent, '');
    assert.equal(staffView.storeContent, '');
  } finally { sqlite.close(); }
});

test('UI Portal Staf punya tombol Manual Book', () => {
  const staffJs = readFileSync(new URL('../public/staff.js', import.meta.url), 'utf8');
  const staffHtml = readFileSync(new URL('../public/staff.html', import.meta.url), 'utf8');
  assert.match(staffHtml, /data-staff-tab="manualbook"/);
  assert.match(staffJs, /loadManualBook/);
});
