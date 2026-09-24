import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleStaffPortalApi } from '../src/staff-portal.js';
import { handleAdminCashierApi } from '../src/cashier-auth.js';
import { getCashierRaportFacts } from '../src/staff-raport.js';
import { getJakartaDayOfWeek, getJakartaTimeOfDay, jakartaWallClockToUtc, getJakartaBusinessDate } from '../src/time.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-24: "dibuat juga ya, ketika satu jam setelah waktu
// presensi pulang dia belum absen maka langsung force close tanpa foto dan
// gps, dan kartu presensi hari itu juga jadi warna kuning. di raport nanti
// juga ada catatan tidak tutup presensi berapa kali gt." Lalu: "kalo laci
// gpp permit, karna memang akan dipakai cs lain. kalo presensi langsung
// force close karna urusannya cuma dengan cs bersangkutan." Dan terakhir:
// "perkara ga ada bayaran gaji ketika diluar jam kerja dan force close ini
// msukin ke settingan aja, bisa on, bisa off. defaultnya on aja."

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

function storeRow(db, code) {
  return db.prepare('SELECT id, entity_id FROM stores WHERE code = ?').get(code);
}

async function seedCashier(db, storeId, username, employeeName) {
  const id = `cashier_fc_${username}`;
  db.prepare(`
    INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
    VALUES (?, ?, 'x', ?, ?, 1, '2026-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z')
  `).run(id, username, employeeName, storeId);
  const token = `token-${username}`;
  const tokenHash = await hashCredential(token);
  db.prepare(`
    INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at)
    VALUES (?, ?, '2026-09-24T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(tokenHash, id);
  return { id, token };
}

function seedSchedule(db, accountId, dayOfWeek, { isDayOff = false, shiftStart = '', shiftEnd = '' } = {}) {
  db.prepare(`
    INSERT INTO account_shift_schedule (account_type, account_id, day_of_week, is_day_off, shift_start, shift_end)
    VALUES ('CASHIER', ?, ?, ?, ?, ?)
  `).run(accountId, dayOfWeek, isDayOff ? 1 : 0, shiftStart, shiftEnd);
}

function seedJobDetail(db, cashierId, { hourlyWage = 50000, paymentType = 'SESI' } = {}) {
  db.prepare(`
    INSERT INTO account_job_details (account_type, account_id, hourly_wage_scaled, job_type, payment_type, updated_at)
    VALUES ('CASHIER', ?, ?, '', ?, CURRENT_TIMESTAMP)
  `).run(cashierId, Math.round(hourlyWage * 1_000_000), paymentType);
}

function insertOpenAttendance(db, cashierId, storeId, createdAtIso) {
  const id = `attendance_fc_${Math.random().toString(36).slice(2)}`;
  db.prepare(`
    INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status)
    VALUES (?, ?, ?, 'in', x'0102', 'image/jpeg', ?, 'OPEN')
  `).run(id, cashierId, storeId, createdAtIso);
  return id;
}

function portalRequest(token) {
  return new Request('https://example.test/api/staff/portal', { headers: { Authorization: `Bearer ${token}` } });
}

function attendanceRequest({ token, type }) {
  const form = new FormData();
  form.set('type', type);
  form.set('photo', new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' }), 'test.jpg');
  return new Request('https://example.test/api/staff/attendance', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

function adminRequest(pathname, { token, store, method = 'GET', body } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store) url.searchParams.set('store', store);
  return new Request(url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function seedAdminToken(db, adminId) {
  const token = `emp-admin-${adminId}`;
  db.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, '2026-06-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), adminId);
  return token;
}

// 2020-01-01T01:00:00.000Z = Jakarta 2020-01-01 08:00 -- historis, jauh di
// masa lalu relatif kapan pun test ini dijalankan, jadi deadline shift_end+1
// jam pasti sudah lewat tanpa test jadi flaky karena jam eksekusi.
const HISTORICAL_CHECK_IN = '2020-01-01T01:00:00.000Z';
const HISTORICAL_DAY_OF_WEEK = getJakartaDayOfWeek(new Date(HISTORICAL_CHECK_IN));

test('Sesi yang sudah lewat shift_end+1 jam otomatis force-close tanpa foto/gps, check_out_at = jam pulang jadwal', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const pendem = storeRow(db, 'PENDEM');
    const cashier = await seedCashier(db, pendem.id, 'fc1', 'CS Force Close Satu');
    seedSchedule(db, cashier.id, HISTORICAL_DAY_OF_WEEK, { shiftStart: '09:00', shiftEnd: '10:00' });
    const attendanceId = insertOpenAttendance(db, cashier.id, pendem.id, HISTORICAL_CHECK_IN);

    const portalRes = await handleStaffPortalApi(portalRequest(cashier.token), env, '/api/staff/portal');
    assert.equal(portalRes.status, 200);
    const portalPayload = await portalRes.json();

    const row = db.prepare('SELECT * FROM staff_attendance WHERE id = ?').get(attendanceId);
    assert.equal(row.status, 'CLOSED');
    assert.equal(row.auto_closed, 1);
    assert.equal(row.check_out_photo_blob, null);
    assert.equal(row.check_out_latitude, null);
    const expectedCheckOut = jakartaWallClockToUtc(getJakartaBusinessDate(new Date(HISTORICAL_CHECK_IN)), '10:00').toISOString();
    assert.equal(row.check_out_at, expectedCheckOut, 'check_out_at wajib jam PULANG JADWAL, bukan shift_end+1jam (bukan lembur)');

    const found = portalPayload.attendance.find(item => item.id === attendanceId);
    assert.ok(found);
    assert.equal(found.autoClosed, true);
    assert.equal(found.status, 'CLOSED');
  } finally { db.close(); }
});

test('Sesi yang belum lewat 1 jam sejak jam pulang jadwal TIDAK di-force-close', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const pendem = storeRow(db, 'PENDEM');
    const cashier = await seedCashier(db, pendem.id, 'fc2', 'CS Force Close Dua');
    const now = new Date();
    const dayOfWeek = getJakartaDayOfWeek(now);
    // Shift berakhir 2 jam LAGI dari sekarang -- deadline (shift_end+1jam)
    // masih 3 jam di depan, jelas belum lewat.
    const shiftEnd = getJakartaTimeOfDay(new Date(now.getTime() + 2 * 60 * 60 * 1000));
    seedSchedule(db, cashier.id, dayOfWeek, { shiftStart: '00:00', shiftEnd });
    const attendanceId = insertOpenAttendance(db, cashier.id, pendem.id, now.toISOString());

    await handleStaffPortalApi(portalRequest(cashier.token), env, '/api/staff/portal');

    const row = db.prepare('SELECT * FROM staff_attendance WHERE id = ?').get(attendanceId);
    assert.equal(row.status, 'OPEN', 'belum lewat 1 jam sejak jadwal pulang -- jangan di-force-close dulu');
    assert.equal(row.auto_closed, 0);
  } finally { db.close(); }
});

test('Hari yang jadwalnya belum diatur sama sekali -- tidak di-force-close walau presensinya sudah sangat lama', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const pendem = storeRow(db, 'PENDEM');
    const cashier = await seedCashier(db, pendem.id, 'fc3', 'CS Force Close Tiga');
    // Sengaja TIDAK seedSchedule -- tidak ada "jam pulang" buat dijadikan acuan.
    const attendanceId = insertOpenAttendance(db, cashier.id, pendem.id, HISTORICAL_CHECK_IN);

    await handleStaffPortalApi(portalRequest(cashier.token), env, '/api/staff/portal');

    const row = db.prepare('SELECT * FROM staff_attendance WHERE id = ?').get(attendanceId);
    assert.equal(row.status, 'OPEN');
  } finally { db.close(); }
});

test('Sesi kemarin yang kelupaan ditutup tidak menghalangi presensi masuk hari ini', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const pendem = storeRow(db, 'PENDEM');
    const cashier = await seedCashier(db, pendem.id, 'fc4', 'CS Force Close Empat');
    seedSchedule(db, cashier.id, HISTORICAL_DAY_OF_WEEK, { shiftStart: '09:00', shiftEnd: '10:00' });
    const oldAttendanceId = insertOpenAttendance(db, cashier.id, pendem.id, HISTORICAL_CHECK_IN);

    const checkInRes = await handleStaffPortalApi(attendanceRequest({ token: cashier.token, type: 'in' }), env, '/api/staff/attendance');
    assert.equal(checkInRes.status, 201, JSON.stringify(await checkInRes.clone().json()));

    const oldRow = db.prepare('SELECT status, auto_closed FROM staff_attendance WHERE id = ?').get(oldAttendanceId);
    assert.equal(oldRow.status, 'CLOSED');
    assert.equal(oldRow.auto_closed, 1);

    const openRows = db.prepare(`SELECT COUNT(*) AS n FROM staff_attendance WHERE user_id = ? AND status = 'OPEN'`).get(cashier.id);
    assert.equal(openRows.n, 1, 'sesi baru hari ini harus berhasil dibuat, bukan ketolak ALREADY_CHECKED_IN');
  } finally { db.close(); }
});

test('Raport menghitung berapa kali presensi tidak ditutup (force-closed)', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const pendem = storeRow(db, 'PENDEM');
    const cashier = await seedCashier(db, pendem.id, 'fc5', 'CS Force Close Lima');
    seedSchedule(db, cashier.id, HISTORICAL_DAY_OF_WEEK, { shiftStart: '09:00', shiftEnd: '10:00' });
    insertOpenAttendance(db, cashier.id, pendem.id, HISTORICAL_CHECK_IN);

    await handleStaffPortalApi(portalRequest(cashier.token), env, '/api/staff/portal');

    const facts = await getCashierRaportFacts(env.DB, pendem.id, cashier.id);
    assert.equal(facts.facts.attendance.autoClosed, 1);
  } finally { db.close(); }
});

test('Saklar OFF: presensi di luar jadwal tetap dihitung penuh dan sesi kelupaan TIDAK di-force-close', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const pendem = storeRow(db, 'PENDEM');
    db.prepare(`UPDATE stores SET attendance_schedule_gate_enabled = 0 WHERE id = ?`).run(pendem.id);
    const cashier = await seedCashier(db, pendem.id, 'fc6', 'CS Force Close Enam');
    seedJobDetail(db, cashier.id, { hourlyWage: 50000, paymentType: 'SESI' });
    seedSchedule(db, cashier.id, HISTORICAL_DAY_OF_WEEK, { shiftStart: '09:00', shiftEnd: '10:00' });
    const attendanceId = insertOpenAttendance(db, cashier.id, pendem.id, HISTORICAL_CHECK_IN);

    const portalRes = await handleStaffPortalApi(portalRequest(cashier.token), env, '/api/staff/portal');
    const portalPayload = await portalRes.json();

    const row = db.prepare('SELECT status FROM staff_attendance WHERE id = ?').get(attendanceId);
    assert.equal(row.status, 'OPEN', 'saklar off -- force-close tidak boleh jalan sama sekali');
    assert.equal(portalPayload.attendanceStatus, 'in');
  } finally { db.close(); }
});

test('PATCH /api/admin/cashiers/settings mengubah saklar dan tersimpan', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const adminToken = await seedAdminToken(db, 'admin_pendem_pilot');

    const off = await handleAdminCashierApi(adminRequest('/api/admin/cashiers/settings', {
      token: adminToken, store: 'PENDEM', method: 'PATCH', body: { attendanceScheduleGateEnabled: false }
    }), env, '/api/admin/cashiers/settings');
    assert.equal(off.status, 200);
    assert.equal((await off.json()).attendanceScheduleGateEnabled, false);

    const listAfterOff = await handleAdminCashierApi(adminRequest('/api/admin/cashiers', { token: adminToken, store: 'PENDEM' }), env, '/api/admin/cashiers');
    assert.equal((await listAfterOff.json()).store.attendanceScheduleGateEnabled, false);

    const on = await handleAdminCashierApi(adminRequest('/api/admin/cashiers/settings', {
      token: adminToken, store: 'PENDEM', method: 'PATCH', body: { attendanceScheduleGateEnabled: true }
    }), env, '/api/admin/cashiers/settings');
    assert.equal((await on.json()).attendanceScheduleGateEnabled, true);
  } finally { db.close(); }
});

test('Default saklar ON untuk gerai yang belum pernah diubah', async () => {
  const db = migratedDatabase();
  try {
    const row = db.prepare('SELECT attendance_schedule_gate_enabled FROM stores WHERE code = ?').get('PENDEM');
    assert.equal(row.attendance_schedule_gate_enabled, 1);
  } finally { db.close(); }
});
