import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { jamJadwal, peringatanAkun } from '../src/akun-gerai.js';

// Entity Admin -> Karyawan -> Kelola akun + peta akun per gerai (Bos Cyo, 2026-10-23).

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
  batch(statements) {
    this.db.exec('BEGIN');
    try { const out = statements.map(s => s.run()); this.db.exec('COMMIT'); return out; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

const STORE = 'store_pendem';
const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

async function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  const entityId = sqlite.prepare('SELECT entity_id FROM stores WHERE id = ?').get(STORE).entity_id;
  sqlite.prepare('UPDATE cashiers SET is_active = 0').run();
  const cashier = (id, active = 1) => sqlite.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, is_entity_backup, created_at) VALUES (?, ?, 'x', ?, ?, ?, 0, '2026-10-01 00:00:00')`).run(id, id, id, STORE, active);
  cashier('sugionok1s1');
  cashier('sugionok2s2');
  cashier('zahra_tes');
  const shift = (id, day, start, end) => sqlite.prepare(`INSERT INTO account_shift_schedule (account_type, account_id, day_of_week, is_day_off, shift_start, shift_end) VALUES ('CASHIER', ?, ?, 0, ?, ?)`).run(id, day, start, end);
  shift('sugionok1s1', 1, '08:00', '17:00');
  shift('sugionok2s2', 1, '16:00', '22:00');
  sqlite.prepare(`INSERT INTO employees (id, entity_id, home_store_id, full_name, status) VALUES ('emp_indah', ?, ?, 'Indah', 'INACTIVE')`).run(entityId, STORE);
  sqlite.prepare(`INSERT INTO employee_account_links (id, employee_id, entity_id, store_id, account_type, account_id, effective_from) VALUES ('lnk_indah', 'emp_indah', ?, ?, 'CASHIER', 'sugionok2s2', '2026-01-01T00:00:00.000Z')`).run(entityId, STORE);
  const presensi = (id, user, at, status) => sqlite.prepare(`INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status, check_out_at) VALUES (?, ?, ?, 'in', x'00', 'image/jpeg', ?, ?, ?)`)
    .run(id, user, STORE, at, status, status === 'OPEN' ? null : at);
  presensi('att_1', 'sugionok1s1', recent, 'CLOSED');
  presensi('att_2', 'sugionok2s2', recent, 'CLOSED');
  presensi('att_basi', 'zahra_tes', '2026-09-13T02:00:00.000Z', 'OPEN');
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES ('tok_zahra', 'zahra_tes', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run();
  sqlite.prepare(`INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active) VALUES ('ea_akun', ?, 'ea_akun', 'x', 'EA', 1)`).run(entityId);
  sqlite.prepare(`INSERT INTO entity_admin_sessions (token_hash, entity_admin_id, created_at, expires_at) VALUES (?, 'ea_akun', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('ea-akun'));
  return { sqlite, env: { DB: new D1Database(sqlite) } };
}

const call = (env, path, body) => worker.fetch(new Request(`https://example.test${path}`, {
  method: body ? 'POST' : 'GET',
  headers: { Authorization: 'Bearer ea-akun', ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined
}), env);

test('jamJadwal: slot jam yang tersentuh shift, lewat tengah malam membungkus', () => {
  assert.deepEqual(jamJadwal({ shiftStart: '09:00', shiftEnd: '12:00' }), [9, 10, 11]);
  assert.deepEqual(jamJadwal({ shiftStart: '17:30', shiftEnd: '19:15' }), [17, 18, 19]);
  assert.deepEqual(jamJadwal({ shiftStart: '22:00', shiftEnd: '02:00' }), [0, 1, 22, 23]);
  assert.deepEqual(jamJadwal({ isDayOff: true, shiftStart: '09:00', shiftEnd: '12:00' }), []);
});

test('peringatanAkun: presensi basi tetap dilaporkan walau akun nonaktif', () => {
  const nowMs = Date.parse('2026-10-23T00:00:00Z');
  const kode = account => peringatanAkun({ schedule: [], status: 'ASLI', ...account }, { nowMs }).map(item => item.kode);
  assert.deepEqual(kode({ isActive: false, openSince: '2026-09-13T02:00:00.000Z' }), ['PRESENSI_BASI']);
  assert.deepEqual(kode({ isActive: true, employee: { name: 'X', status: 'ACTIVE' }, lastAttendanceAt: '2026-10-22T00:00:00Z', openSince: '2026-10-22T20:00:00Z' }), ['TANPA_JADWAL']);
});

test('GET akun-gerai: akun per gerai, jadwal, karyawan resign, presensi basi', async () => {
  const { env } = await setup();
  const res = await call(env, '/api/entity-admin/akun-gerai');
  assert.equal(res.status, 200);
  const data = await res.json();
  const store = data.stores.find(item => item.storeId === STORE);
  assert.ok(store);
  const byId = new Map(store.accounts.map(account => [account.id, account]));
  assert.deepEqual(byId.get('sugionok1s1').schedule, [{ dayOfWeek: 1, isDayOff: false, shiftStart: '08:00', shiftEnd: '17:00' }]);
  assert.deepEqual(byId.get('sugionok1s1').peringatan.map(item => item.kode), ['TANPA_KARYAWAN']);
  assert.ok(byId.get('sugionok2s2').peringatan.some(item => item.kode === 'KARYAWAN_NONAKTIF'));
  const zahra = byId.get('zahra_tes');
  assert.equal(zahra.openSince, '2026-09-13T02:00:00.000Z');
  assert.ok(zahra.peringatan.some(item => item.kode === 'PRESENSI_BASI'));
  assert.ok(zahra.peringatan.some(item => item.kode === 'TANPA_JADWAL'));
});

test('POST akun-gerai/aktif: nonaktifkan akun memutus sesi login; akun entity lain ditolak', async () => {
  const { sqlite, env } = await setup();
  const res = await call(env, '/api/entity-admin/akun-gerai/aktif', { accountId: 'zahra_tes', isActive: false });
  assert.equal(res.status, 200);
  assert.equal(sqlite.prepare('SELECT is_active FROM cashiers WHERE id = ?').get('zahra_tes').is_active, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cashier_sessions WHERE cashier_id = ?').get('zahra_tes').n, 0);
  const back = await call(env, '/api/entity-admin/akun-gerai/aktif', { accountId: 'zahra_tes', isActive: true });
  assert.equal(back.status, 200);
  assert.equal(sqlite.prepare('SELECT is_active FROM cashiers WHERE id = ?').get('zahra_tes').is_active, 1);
  const outside = await call(env, '/api/entity-admin/akun-gerai/aktif', { accountId: 'tidak_ada', isActive: false });
  assert.equal(outside.status, 403);
  const anon = await worker.fetch(new Request('https://example.test/api/entity-admin/akun-gerai'), env);
  assert.equal(anon.status, 401);
});
