import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleUnifiedLoginApi } from '../src/unified-login.js';
import { hashCredential } from '../src/owner-auth.js';

// 2026-09-17, Bos Cyo: "loginnya kusus ya, apa ga bisa loginnya disatukan
// dengan gerai?" -> "ok gabungkan untuk login". Sebelum ini Entity Admin
// cuma bisa login lewat /api/entity-admin/login (halaman /entity-admin
// sendiri) -- form login gabungan yang sudah lebih dulu menyatukan
// Owner/Admin Gerai/Kasir (staffMatches() di src/unified-login.js) belum
// pernah mengenali kredensial Entity Admin. Tes ini membuktikan jalur
// gabungan itu sekarang juga mengenali Entity Admin, tanpa mengubah jalur
// login khusus /api/entity-admin/login yang lama (tetap ada, tidak dihapus).

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
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

async function seedEntityAdmin(db, { id = 'entity_admin_unified_test', entityId = 'ENT-GALEH', username = 'entityadmin.unified', password = 'rahasia123' } = {}) {
  const passwordHash = await hashCredential(password);
  db.prepare(`
    INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active)
    VALUES (?, ?, ?, ?, 'Entity Admin Unified Test', 1)
  `).run(id, entityId, username, passwordHash);
  return { id, entityId, username, password };
}

function request(pathname, { method = 'POST', body } = {}) {
  return new Request(`https://example.test${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
}

test('/api/auth/staff-login recognizes Entity Admin credentials and redirects to /entity-admin', async () => {
  const db = migratedDatabase();
  try {
    const seed = await seedEntityAdmin(db);
    const env = { DB: new D1Database(db) };

    const response = await handleUnifiedLoginApi(
      request('/api/auth/staff-login', { body: { username: seed.username, password: seed.password } }),
      env, '/api/auth/staff-login'
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.role, 'ENTITY_ADMIN');
    assert.equal(body.redirect, '/entity-admin');
    assert.equal(body.entityAdmin.entityId, 'ENT-GALEH');
    assert.equal(body.entityAdmin.username, seed.username);
    assert.ok(body.token);

    const sessionRow = db.prepare('SELECT entity_admin_id FROM entity_admin_sessions WHERE token_hash = ?')
      .get(await hashCredential(body.token));
    assert.equal(sessionRow?.entity_admin_id, seed.id);
  } finally {
    db.close();
  }
});

test('wrong password for an Entity Admin username via the unified staff login is rejected, not silently matched to another role', async () => {
  const db = migratedDatabase();
  try {
    const seed = await seedEntityAdmin(db);
    const env = { DB: new D1Database(db) };

    const response = await handleUnifiedLoginApi(
      request('/api/auth/staff-login', { body: { username: seed.username, password: 'salah-password' } }),
      env, '/api/auth/staff-login'
    );
    assert.equal(response.status, 401);
  } finally {
    db.close();
  }
});

// KOREKSI 2026-09-18 (Bos Cyo: "mau login juga kadang risih ada permintaan,
// mau pakai sesi ini, padahal terakhir masih login. user udah mulai risih").
// Test ini DULU menuntut kebalikannya: login kedua wajib ditolak 409
// STAFF_SESSION_ACTIVE sampai user menekan "Ambil alih sesi". Aturan itu
// dicabut, bukan dilonggarkan diam-diam -- prompt-nya paling sering mengenai
// ORANG YANG SAMA di BROWSER YANG SAMA (token browser hilang, sesi server
// masih hidup 12 jam), dan tidak menambah keamanan apa pun karena tombol
// takeover bebas ditekan siapa pun yang sudah lolos password.
//
// Aman karena tiap sesi berdiri sendiri: validasi dan logout dua-duanya per
// `token_hash` (src/owner-auth.js), bukan per akun -- logout di satu tempat
// tidak mematikan sesi di tempat lain. Yang menjaga "jangan pindah user di
// satu browser" sekarang guard sisi klien (public/staff-tab-lock.js), bukan
// penolakan login di server.
test('satu akun boleh punya beberapa sesi aktif sekaligus -- login kedua tidak lagi ditolak atau minta "ambil alih"', async () => {
  const db = migratedDatabase();
  try {
    const seed = await seedEntityAdmin(db);
    const env = { DB: new D1Database(db) };

    const first = await handleUnifiedLoginApi(
      request('/api/auth/staff-login', { body: { username: seed.username, password: seed.password } }),
      env, '/api/auth/staff-login'
    );
    assert.equal(first.status, 200);

    const second = await handleUnifiedLoginApi(
      request('/api/auth/staff-login', { body: { username: seed.username, password: seed.password } }),
      env, '/api/auth/staff-login'
    );
    assert.equal(second.status, 200, 'login kedua untuk akun yang sama harus langsung sukses, tanpa 409');
    const secondBody = await second.json();
    assert.equal(secondBody.role, 'ENTITY_ADMIN');
    assert.ok(secondBody.token, 'sesi kedua dapat token sendiri');

    const firstBody = await first.json();
    assert.notEqual(secondBody.token, firstBody.token, 'tiap sesi punya token sendiri, bukan berbagi satu token');

    const sessionCount = db.prepare('SELECT COUNT(*) AS n FROM entity_admin_sessions WHERE entity_admin_id = ?').get(seed.id);
    assert.equal(sessionCount.n, 2, 'dua sesi hidup berdampingan -- sesi lama TIDAK dicabut diam-diam oleh login baru');
  } finally {
    db.close();
  }
});

test('the old dedicated /api/entity-admin/login endpoint is untouched -- unification is additive, not a replacement', async () => {
  const source = await readFile(new URL('../src/owner-auth.js', import.meta.url), 'utf8');
  assert.match(source, /pathname === '\/api\/entity-admin\/login'/);
});

test('front-end unified login form recognizes ENTITY_ADMIN role and stores its token under the same key entity-admin.js reads', async () => {
  const [ui, entityAdminJs] = await Promise.all([
    readFile(new URL('../public/auth-entry-split.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/entity-admin.js', import.meta.url), 'utf8')
  ]);
  assert.match(ui, /payload\.role === 'ENTITY_ADMIN'/);
  assert.match(ui, /'lekerEntityAdminToken'/);
  assert.match(entityAdminJs, /localStorage\.getItem\('lekerEntityAdminToken'\)/);
});
