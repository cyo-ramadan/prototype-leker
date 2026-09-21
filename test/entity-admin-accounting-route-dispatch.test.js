import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';

// 2026-09-17, Bos Cyo: Panel Entity Admin sendiri (tab "Buku Entity") sudah
// lama menampilkan pesan "Route Entity Admin tidak ditemukan" tiap kali
// halaman itu dimuat. src/entity-accounting.js sudah lengkap mengimplementasi
// /api/entity-admin/accounts dan /api/entity-admin/journals (dipanggil
// public/entity-admin.js loadEntityLedger() di setiap login) -- tapi
// src/index.js memeriksa handleEntityAdminApi() LEBIH DULU, dan guard-nya
// (`if (!pathname.startsWith('/api/entity-admin/')) return null;`) meng-klaim
// SEMUA path /api/entity-admin/*, lalu jatuh ke 404 generik-nya sendiri
// ("Route Entity Admin tidak ditemukan") karena tidak satu pun cabang di
// dalamnya cocok dengan /accounts atau /journals -- handleEntityAccountingApi
// tidak pernah kebagian giliran sama sekali. Ini murni soal urutan dispatch
// di index.js; kedua handler-nya sendiri benar.
//
// Tes ini SENGAJA lewat worker.fetch() penuh (bukan memanggil
// handleEntityAccountingApi langsung) -- memanggilnya langsung tidak akan
// pernah menangkap bug ini, karena bug-nya justru ada di urutan pemeriksaan
// di index.js, bukan di isi handler-nya.

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
  }
}

class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) { return statements.map(statement => statement.run()); }
}

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

async function seedEntityAdmin(db, { id = 'entity_admin_route_test', entityId = 'ENT-GALEH', username = 'entityadmin.routetest', password = 'rahasia123' } = {}) {
  const passwordHash = await hashCredential(password);
  db.prepare(`
    INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active)
    VALUES (?, ?, ?, ?, 'Entity Admin Route Test', 1)
  `).run(id, entityId, username, passwordHash);
  return { id, entityId, username, password };
}

function request(pathname, { method = 'GET', token, body } = {}) {
  return new Request(`https://example.test${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

test('GET /api/entity-admin/accounts is reachable through the full worker dispatch, not shadowed by handleEntityAdminApi', async () => {
  const db = migratedDatabase();
  try {
    const seed = await seedEntityAdmin(db);
    const env = { DB: new D1Database(db) };

    const loginResponse = await worker.fetch(
      request('/api/entity-admin/login', { method: 'POST', body: { username: seed.username, password: seed.password } }),
      env
    );
    assert.equal(loginResponse.status, 200);
    const { token } = await loginResponse.json();

    const accountsResponse = await worker.fetch(request('/api/entity-admin/accounts', { token }), env);
    assert.equal(accountsResponse.status, 200, 'must not fall through to the generic ENTITY_ADMIN 404');
    const accountsBody = await accountsResponse.json();
    assert.deepEqual(accountsBody.accounts, []);
    assert.notEqual(accountsBody.error, 'Route Entity Admin tidak ditemukan.');

    const journalsResponse = await worker.fetch(request('/api/entity-admin/journals', { token }), env);
    assert.equal(journalsResponse.status, 200);
    const journalsBody = await journalsResponse.json();
    assert.deepEqual(journalsBody.journals, []);
  } finally {
    db.close();
  }
});

test('routes handleEntityAdminApi genuinely owns (/login, /me, /logout, /stores) are untouched by the reorder', async () => {
  const db = migratedDatabase();
  try {
    const seed = await seedEntityAdmin(db);
    const env = { DB: new D1Database(db) };

    const loginResponse = await worker.fetch(
      request('/api/entity-admin/login', { method: 'POST', body: { username: seed.username, password: seed.password } }),
      env
    );
    assert.equal(loginResponse.status, 200);
    const { token } = await loginResponse.json();

    const meResponse = await worker.fetch(request('/api/entity-admin/me', { token }), env);
    assert.equal(meResponse.status, 200);

    const storesResponse = await worker.fetch(request('/api/entity-admin/stores', { token }), env);
    assert.equal(storesResponse.status, 200);

    const unknownRouteResponse = await worker.fetch(request('/api/entity-admin/something-that-does-not-exist', { token }), env);
    assert.equal(unknownRouteResponse.status, 404);
    const unknownBody = await unknownRouteResponse.json();
    assert.equal(unknownBody.error, 'Route Entity Admin tidak ditemukan.');
  } finally {
    db.close();
  }
});

test('index.js checks handleEntityAccountingApi before handleEntityAdminApi (source-level guard against the shadow regressing)', async () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const accountingIndex = source.indexOf('handleEntityAccountingApi(request, env, pathname)');
  const adminIndex = source.indexOf('handleEntityAdminApi(request, env, pathname)');
  assert.ok(accountingIndex > -1 && adminIndex > -1, 'both dispatch calls must exist');
  assert.ok(accountingIndex < adminIndex, 'handleEntityAccountingApi must be checked first, or its routes are shadowed by handleEntityAdminApi\'s catch-all 404');
});
