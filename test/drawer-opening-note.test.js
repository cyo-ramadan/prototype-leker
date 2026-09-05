import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierDrawerApi } from '../src/cashier-drawer.js';
import { hashCredential } from '../src/owner-auth.js';

// 2026-09-04, Bos Cyo: Detail Laci sudah punya "Keterangan Pulang"
// (closing_note) tapi belum ada tempat buat catatan pas BUKA laci, dan
// daftar riwayat laci di kasir belum bernomor urut yang gampang disebut
// ("Laci 1, 2, 3, dst" -- sebelumnya cuma ID string panjang).

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  boundParams() { return this.params.map(value => (value instanceof ArrayBuffer ? new Uint8Array(value) : value)); }
  first() { return this.db.prepare(this.sql).get(...this.boundParams()) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.boundParams()) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.boundParams());
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

async function seedCashier(db, storeId, username, employeeName) {
  const id = `cashier_test_${username}`;
  db.prepare(`
    INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
    VALUES (?, ?, 'x', ?, ?, 1, '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')
  `).run(id, username, employeeName, storeId);
  const token = `token-${username}`;
  const tokenHash = await hashCredential(token);
  db.prepare(`
    INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at)
    VALUES (?, ?, '2026-09-04T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(tokenHash, id);
  return { id, token };
}

function markPresensiIn(db, cashierId, storeId, at = '2026-09-04T01:00:00.000Z') {
  db.prepare(`
    INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status)
    VALUES (?, ?, ?, 'in', x'00', 'image/jpeg', ?, 'OPEN')
  `).run(`att_${cashierId}_${at}`, cashierId, storeId, at);
}

function request(pathname, { token, method = 'GET', body } = {}) {
  return new Request(`https://example.test${pathname}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

test('opening a drawer stores an optional keterangan buka alongside the opening amount', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'store_001', 'bukalaci', 'Kasir Buka Laci');
    markPresensiIn(db, cashier.id, 'store_001');
    const env = { DB: new D1Database(db) };

    const openRes = await handleCashierDrawerApi(
      request('/api/cashier/drawer/open', { token: cashier.token, method: 'POST', body: { openingAmount: 150000, openingNote: 'Modal dari brankas gerai' } }),
      env, '/api/cashier/drawer/open'
    );
    assert.equal(openRes.status, 201);
    const openBody = await openRes.json();
    assert.equal(openBody.drawer.openingNote, 'Modal dari brankas gerai');

    const drawerRow = db.prepare('SELECT opening_note FROM cash_drawer_sessions WHERE id = ?').get(openBody.drawer.id);
    assert.equal(drawerRow.opening_note, 'Modal dari brankas gerai');

    const getRes = await handleCashierDrawerApi(request('/api/cashier/drawer', { token: cashier.token }), env, '/api/cashier/drawer');
    const getBody = await getRes.json();
    assert.equal(getBody.drawer.openingNote, 'Modal dari brankas gerai');
  } finally {
    db.close();
  }
});

test('opening note defaults to empty string when not provided, matching the existing closing_note pattern', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'store_001', 'bukalacikosong', 'Kasir Buka Laci Kosong');
    markPresensiIn(db, cashier.id, 'store_001');
    const env = { DB: new D1Database(db) };

    const openRes = await handleCashierDrawerApi(
      request('/api/cashier/drawer/open', { token: cashier.token, method: 'POST', body: { openingAmount: 50000 } }),
      env, '/api/cashier/drawer/open'
    );
    const openBody = await openRes.json();
    assert.equal(openBody.drawer.openingNote, '');
  } finally {
    db.close();
  }
});

test('migration adds opening_note with the same NOT NULL DEFAULT pattern as closing_note', () => {
  const migration = readFileSync(new URL('../migrations/0069_drawer_opening_note.sql', import.meta.url), 'utf8');
  assert.match(migration, /ALTER TABLE cash_drawer_sessions ADD COLUMN opening_note TEXT NOT NULL DEFAULT ''/);
});

test('drawer report UI renders Keterangan Buka alongside Keterangan Pulang', () => {
  const rendererSource = readFileSync(new URL('../public/drawer-report-ui.js', import.meta.url), 'utf8');
  assert.match(rendererSource, /Keterangan Buka/);
  assert.match(rendererSource, /drawer\.openingNote/);
});

test('cashier Detail Laci list shows sequential Laci #N numbering and note previews', () => {
  const enhancementSource = readFileSync(new URL('../public/cashier-enhancements.js', import.meta.url), 'utf8');
  assert.match(enhancementSource, /Laci #\$\{total - index\}/);
  assert.match(enhancementSource, /Keterangan buka: \$\{esc\(drawer\.openingNote\)\}/);
  assert.match(enhancementSource, /Keterangan pulang: \$\{esc\(drawer\.closingNote\)\}/);
});

test('open-drawer dialog collects an optional keterangan buka and sends it', () => {
  const cashierUi = readFileSync(new URL('../public/cashier.js', import.meta.url), 'utf8');
  assert.match(cashierUi, /id="dialogOpeningNote"/);
  assert.match(cashierUi, /openingNote: el\('dialogOpeningNote'\)\.value/);
});
