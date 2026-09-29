import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleEntityAdminApi, hashCredential } from '../src/owner-auth.js';
import { handleCacaApi } from '../src/caca-chat.js';

// Bug yang lolos dari tes sebelumnya: panel memanggil /api/caca/status tanpa
// menyebut gerai, jadi sistem memakai gerai bawaan (G001) — dan G001 bukan
// bagian dari entity Entity Admin mana pun selain miliknya. Hasilnya 403,
// prosesnya berhenti sebelum daftar gerai dimuat, kotak Gerai kosong dan
// tombol Tanya mati. Tes lama tidak menangkapnya karena memalsukan jawaban
// status; tes ini memakai login dan pemeriksaan wewenang yang asli.

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
  batch(statements) { return statements.map((statement) => statement.run()); }
}

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

function request(pathname, { token, method = 'GET', body } = {}) {
  return new Request(`https://example.test${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

// Entity ENT-GALEH punya gerai IKAN01. G001 ada di luar entity itu.
async function loginEntityAdmin(db) {
  const password = 'rahasia123';
  db.prepare(`
    INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active)
    VALUES ('entity_admin_caca', 'ENT-GALEH', 'entityadmin.caca', ?, 'Entity Admin Caca', 1)
  `).run(await hashCredential(password));

  const env = { DB: new D1Database(db) };
  const login = await handleEntityAdminApi(
    request('/api/entity-admin/login', { method: 'POST', body: { username: 'entityadmin.caca', password } }),
    env,
    '/api/entity-admin/login'
  );
  const { token } = await login.json();
  return { env, token };
}

test('status Caca bisa dibuka Entity Admin tanpa menyebut gerai', async () => {
  const db = migratedDatabase();
  try {
    const { env, token } = await loginEntityAdmin(db);

    const response = await handleCacaApi(request('/api/caca/status', { token }), env, '/api/caca/status');

    assert.equal(response.status, 200, 'sebelum diperbaiki: 403 karena jatuh ke gerai bawaan G001');
    const body = await response.json();
    assert.equal(body.siap, false, 'kunci belum terpasang di lingkungan uji');
    assert.equal(body.bisaMenyimpan, false);
  } finally {
    db.close();
  }
});

test('status Caca tetap menolak yang tidak login', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const response = await handleCacaApi(request('/api/caca/status'), env, '/api/caca/status');
    assert.ok([401, 403].includes(response.status));
  } finally {
    db.close();
  }
});

test('status Caca melaporkan siap begitu kunci terpasang', async () => {
  const db = migratedDatabase();
  try {
    const { env, token } = await loginEntityAdmin(db);
    env.GEMINI_API_KEY = 'kunci-uji';

    const response = await handleCacaApi(request('/api/caca/status', { token }), env, '/api/caca/status');
    const body = await response.json();

    assert.equal(body.siap, true);
    assert.equal(body.model, 'gemini-3.1-flash-lite');
  } finally {
    db.close();
  }
});

// Memperbaiki status TIDAK boleh melonggarkan pintu lain: bertanya tentang
// gerai di luar entity harus tetap ditolak oleh pemeriksaan wewenang aslinya.
test('bertanya tentang gerai di luar entity tetap ditolak', async () => {
  const db = migratedDatabase();
  try {
    const { env, token } = await loginEntityAdmin(db);
    env.GEMINI_API_KEY = 'kunci-uji';

    const response = await handleCacaApi(
      request('/api/caca/tanya?store=G001', { token, method: 'POST', body: { pertanyaan: 'untung hari ini?' } }),
      env,
      '/api/caca/tanya'
    );

    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, 'ENTITY_ADMIN_STORE_SCOPE_MISMATCH');
  } finally {
    db.close();
  }
});

test('mencatat pengeluaran di gerai luar entity juga tetap ditolak', async () => {
  const db = migratedDatabase();
  try {
    const { env, token } = await loginEntityAdmin(db);

    const response = await handleCacaApi(
      request('/api/caca/catat?store=G001', {
        token,
        method: 'POST',
        body: { draft: { keterangan: 'beli gas', nominal: 22000, pihak: 'Pak Slamet', tanggal: '2026-09-29' } }
      }),
      env,
      '/api/caca/catat'
    );

    assert.equal(response.status, 403);
  } finally {
    db.close();
  }
});

test('gerai di dalam entity lolos otorisasi dan baru berhenti di mesin AI yang belum tersambung', async () => {
  const db = migratedDatabase();
  try {
    const { env, token } = await loginEntityAdmin(db);

    const response = await handleCacaApi(
      request('/api/caca/tanya?store=IKAN01', { token, method: 'POST', body: { pertanyaan: 'untung hari ini?' } }),
      env,
      '/api/caca/tanya'
    );

    assert.equal(response.status, 503, 'lolos wewenang, berhenti karena kunci belum ada');
    const body = await response.json();
    assert.match(body.error, /belum tersambung/i);
  } finally {
    db.close();
  }
});
