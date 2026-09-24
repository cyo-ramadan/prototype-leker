import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminCashierApi } from '../src/cashier-auth.js';
import { handleStaffPortalApi } from '../src/staff-portal.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-24: "presensi cs kok ngga muncul di web baru... yang ngga
// ada di webnya admin, jadi ini saya sama mba rika juga bingung mau cek
// presensi dan hitung honornya, harus buka web lama." Riwayat Presensi +
// Riwayat Gaji cuma pernah dibangun untuk karyawan melihat dirinya sendiri
// (GET /api/staff/portal) -- tidak ada jalur Admin melihat riwayat karyawan
// LAIN. GET /api/admin/cashiers/:id/attendance mengisi celah itu, memakai
// modul perhitungan yang sama (src/staff-attendance.js) supaya angkanya
// konsisten antara sisi Admin dan sisi karyawan sendiri.

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
  const token = `emp-admin-${adminId}`;
  sqlite.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, '2026-09-24T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), adminId);
  return token;
}

async function createCashier(env, adminToken, store, body) {
  const path = '/api/admin/cashiers';
  const response = await handleAdminCashierApi(request(path, { token: adminToken, store, method: 'POST', body }), env, path);
  assert.equal(response.status, 201, `gagal bikin kasir: ${JSON.stringify(await response.clone().json())}`);
  return response.json();
}

async function cashierToken(sqlite, cashierId) {
  const token = `cashier-token-${cashierId}`;
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, '2026-09-24T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), cashierId);
  return token;
}

function insertClosedSession(sqlite, cashierId, storeId, checkInAtUtc, checkOutAtUtc) {
  const id = `attn_${cashierId}_${checkInAtUtc}`;
  sqlite.prepare(`
    INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status, check_out_at, check_out_photo_blob, check_out_photo_type)
    VALUES (?, ?, ?, 'in', x'0102', 'image/jpeg', ?, 'CLOSED', ?, x'0304', 'image/jpeg')
  `).run(id, cashierId, storeId, checkInAtUtc, checkOutAtUtc);
  return id;
}

async function getAdminAttendance(env, adminToken, store, cashierId) {
  const path = `/api/admin/cashiers/${encodeURIComponent(cashierId)}/attendance`;
  return handleAdminCashierApi(request(path, { token: adminToken, store }), env, path);
}

test('Admin melihat Riwayat Presensi + Riwayat Gaji karyawan lain -- sebelumnya tidak ada jalur ini sama sekali', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const cashier = await createCashier(env, adminToken, 'PENDEM', {
      username: 'kasir_cs_1', password: 'rahasia1', employeeName: 'CS Satu', paymentType: 'JAM', hourlyWage: 20000,
      schedule: [{ dayOfWeek: 4, shiftStart: '08:00', shiftEnd: '16:00' }]
    });
    // Jakarta 08:07 Kamis (day_of_week 4) -- telat 7 menit; 2.5 jam kerja.
    insertClosedSession(sqlite, cashier.id, 'store_pendem', '2026-09-24T01:07:00.000Z', '2026-09-24T03:37:00.000Z');

    const response = await getAdminAttendance(env, adminToken, 'PENDEM', cashier.id);
    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(payload.cashier.employeeName, 'CS Satu');
    assert.equal(payload.attendance.length, 1);
    assert.equal(payload.attendance[0].checkIn.lateMinutes, 7, 'lateness admin wajib sama dengan yang dihitung untuk karyawan sendiri');
    assert.equal(payload.payroll.length, 1);
    assert.equal(payload.payroll[0].paymentType, 'JAM');
    assert.equal(payload.payroll[0].hoursWorked, 2.5);
    assert.equal(payload.payroll[0].earningRupiah, 50000);
  } finally { sqlite.close(); }
});

test('Angka yang dilihat Admin identik dengan yang dilihat karyawan sendiri lewat Portal Staf -- satu sumber perhitungan', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const cashier = await createCashier(env, adminToken, 'PENDEM', {
      username: 'kasir_cs_2', password: 'rahasia1', employeeName: 'CS Dua', paymentType: 'SESI', hourlyWage: 75000
    });
    const staffToken = await cashierToken(sqlite, cashier.id);
    insertClosedSession(sqlite, cashier.id, 'store_pendem', '2026-09-24T01:00:00.000Z', '2026-09-24T09:00:00.000Z');

    const adminResponse = await getAdminAttendance(env, adminToken, 'PENDEM', cashier.id);
    const adminPayload = await adminResponse.json();
    const staffResponse = await handleStaffPortalApi(request('/api/staff/portal', { token: staffToken }), env, '/api/staff/portal');
    const staffPayload = await staffResponse.json();

    assert.deepEqual(adminPayload.payroll, staffPayload.payroll);
    assert.equal(adminPayload.attendance[0].checkIn.at, staffPayload.attendance[0].checkIn.at);
  } finally { sqlite.close(); }
});

test('Admin tidak bisa melihat presensi kasir gerai lain -- 404, bukan bocor lintas gerai', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const adminPendemToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const adminDermoToken = await storeAdminToken(sqlite, 'admin_dermo_0080');
    const cashierPendem = await createCashier(env, adminPendemToken, 'PENDEM', { username: 'kasir_cs_3', password: 'rahasia1', employeeName: 'CS Pendem' });

    const response = await getAdminAttendance(env, adminDermoToken, 'DERMO', cashierPendem.id);
    assert.equal(response.status, 404);
    const payload = await response.json();
    assert.match(payload.error, /tidak ditemukan/i);
  } finally { sqlite.close(); }
});

test('Foto presensi versi Admin discoped ke gerai, bukan lintas gerai atau kasir yang salah', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const adminDermoToken = await storeAdminToken(sqlite, 'admin_dermo_0080');
    const cashier = await createCashier(env, adminToken, 'PENDEM', { username: 'kasir_cs_4', password: 'rahasia1', employeeName: 'CS Empat' });
    const attendanceId = insertClosedSession(sqlite, cashier.id, 'store_pendem', '2026-09-24T01:00:00.000Z', '2026-09-24T03:00:00.000Z');

    const okPath = `/api/admin/cashiers/${encodeURIComponent(cashier.id)}/attendance/${encodeURIComponent(attendanceId)}/photo`;
    const okResponse = await handleAdminCashierApi(request(okPath, { token: adminToken, store: 'PENDEM' }), env, okPath);
    assert.equal(okResponse.status, 200);
    assert.equal(okResponse.headers.get('Content-Type'), 'image/jpeg');
    const bytes = new Uint8Array(await okResponse.arrayBuffer());
    assert.deepEqual([...bytes], [0x01, 0x02]);

    // `pathname` (argumen ke-3) wajib PATH SAJA tanpa query string -- persis
    // seperti index.js selalu memanggilnya (new URL(request.url).pathname).
    // `?which=out` cukup ada di URL Request-nya sendiri; handler membacanya
    // lewat new URL(request.url).searchParams, bukan dari argumen pathname.
    const outResponse = await handleAdminCashierApi(request(`${okPath}?which=out`, { token: adminToken, store: 'PENDEM' }), env, okPath);
    const outBytes = new Uint8Array(await outResponse.arrayBuffer());
    assert.deepEqual([...outBytes], [0x03, 0x04]);

    const wrongStoreResponse = await handleAdminCashierApi(request(okPath, { token: adminDermoToken, store: 'DERMO' }), env, okPath);
    assert.equal(wrongStoreResponse.status, 404, 'Admin gerai lain tidak boleh bisa menarik foto presensi kasir ini');
  } finally { sqlite.close(); }
});
