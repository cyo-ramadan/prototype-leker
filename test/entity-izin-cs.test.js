import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-10-12: "kasih tombol acc dari permit yang diminta cs di entity admin." Tab Izin CS
// memakai route per-gerai yang sama dengan Admin Gerai (?store=KODE); Entity Admin hanya boleh
// memutuskan izin di gerai milik entity-nya.

const migrationDir = new URL('../migrations/', import.meta.url);
const read = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

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
  batch(statements) {
    this.db.exec('BEGIN');
    try { const out = statements.map(s => s.run()); this.db.exec('COMMIT'); return out; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  const store = db.prepare(`SELECT id, code, entity_id FROM stores WHERE id = 'store_pendem'`).get();
  const outside = db.prepare(`SELECT code FROM stores WHERE entity_id <> ? AND is_active = 1 LIMIT 1`).get(store.entity_id);
  db.prepare(`INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active) VALUES ('ea_izin', ?, 'ea.izin', 'x', 'EA Izin', 1)`).run(store.entity_id);
  db.prepare(`INSERT INTO entity_admin_sessions (token_hash, entity_admin_id, created_at, expires_at) VALUES (?, 'ea_izin', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('ea-izin'));
  db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES ('kasir_izin', 'izin.cs', 'x', 'CS Izin', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(store.id);
  const checkIn = new Date(Date.now() - 2 * 3600_000).toISOString();
  const requested = new Date(Date.now() - 3 * 3600_000).toISOString();
  db.prepare(`INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status) VALUES ('att_izin', 'kasir_izin', ?, 'in', x'00', 'image/jpeg', ?, 'OPEN')`).run(store.id, checkIn);
  db.prepare(`INSERT INTO attendance_correction_permits (id, store_id, attendance_id, requested_by_cashier_id, original_check_in_at, requested_check_in_at, reason) VALUES ('acp_izin', ?, 'att_izin', 'kasir_izin', ?, ?, 'Lupa presensi waktu datang')`).run(store.id, checkIn, requested);
  return { db, env: { DB: new D1Database(db) }, store, outside };
}

const call = (env, method, path, body) => worker.fetch(new Request(`https://example.test${path}`, {
  method,
  headers: { Authorization: 'Bearer ea-izin', 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined
}), env);

test('Izin CS: Entity Admin melihat dan ACC izin gerai entity-nya, gerai entity lain ditolak', async () => {
  const { db, env, store, outside } = await setup();
  try {
    const list = await (await call(env, 'GET', `/api/admin/attendance-correction-permits?status=PENDING&store=${store.code}`)).json();
    assert.deepEqual(list.permits.map(permit => permit.id), ['acp_izin']);
    assert.equal((await call(env, 'GET', `/api/admin/attendance-correction-permits?status=PENDING&store=${outside.code}`)).status, 403);

    const acc = await call(env, 'PATCH', `/api/admin/attendance-correction-permits/acp_izin?store=${store.code}`, { decision: 'ACC', note: '' });
    assert.equal(acc.status, 200);
    const row = db.prepare(`SELECT status, decided_by_role FROM attendance_correction_permits WHERE id = 'acp_izin'`).get();
    assert.equal(row.status, 'APPROVED');
    assert.equal(row.decided_by_role, 'ENTITY_ADMIN');
  } finally { db.close(); }
});

test('Izin CS: tab, skrip, dan empat jenis izin terpasang di Entity Admin', () => {
  const html = read('entity-admin.html');
  assert.match(html, /data-entity-tab="izincs"/);
  assert.match(html, /id="entityTab-izincs"/);
  assert.match(html, /<script src="\/entity-izin-cs\.js/);
  const js = read('entity-izin-cs.js');
  for (const route of ['/api/admin/attendance-correction-permits', '/api/admin/attendance-gps-permits', '/api/admin/drawer/close-permits', '/api/management/transaction-void-permits']) {
    assert.ok(js.includes(route), route);
  }
  assert.match(js, /store=\$\{encodeURIComponent/);
  assert.match(read('entity-admin.js'), /name === 'izincs'\) return window\.loadEntityIzinCs/);
  assert.match(read('nav-groups.js'), /'setorancs', 'izincs'/);
});
