import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleStaffPortalApi } from '../src/staff-portal.js';
import { handleAdminCashierApi } from '../src/cashier-auth.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-19: "itu uda ada setting masuk dan pulang jm brp kn. nah
// brarti ud bs tahu keterlambatannya ... untuk gaji kan uda diisi berapa per
// jam nya jadi uda bisa langsung diisi ya."
//
// lateMinutes dihitung dari jadwal HARI itu (account_shift_schedule, migration
// 0106 -- lihat test/account-shift-schedule.test.js untuk variasi per hari)
// dibandingkan jam presensi MASUK, keduanya jam dinding Jakarta. 2026-09-19
// yang dipakai di test-test di bawah adalah hari Sabtu (day_of_week 6).
// Riwayat Gaji dihitung dari staff_attendance CLOSED x tarif akun saat ini --
// JAM: durasi kerja x tarif per jam. SESI: flat per sesi selesai. Riwayat Gaji
// TIDAK bergantung jadwal harian -- cuma durasi presensi asli, jadi test di
// sini boleh tidak mengisi schedule sama sekali.

const migrationDir = new URL('../migrations/', import.meta.url);
const staffJs = readFileSync(new URL('../public/staff.js', import.meta.url), 'utf8');

// node:sqlite menolak ArrayBuffer mentah untuk parameter BLOB (readLivePhoto
// mengembalikan photo.bytes sebagai ArrayBuffer) -- wrapper ini menormalkan
// ke Uint8Array, sama seperti test/cashier-drawer-helper-and-presensi.test.js.
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
  sqlite.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, '2026-09-19T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), adminId);
  return token;
}

async function createCashier(env, adminToken, store, body) {
  const response = await handleAdminCashierApi(request('/api/admin/cashiers', { token: adminToken, store, method: 'POST', body }), env, '/api/admin/cashiers');
  assert.equal(response.status, 201, `gagal bikin kasir: ${JSON.stringify(await response.clone().json())}`);
  return response.json();
}

async function cashierToken(sqlite, cashierId) {
  const token = `cashier-token-${cashierId}`;
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, '2026-09-19T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), cashierId);
  return token;
}

// at* dalam ISO UTC -- Jakarta = UTC+7 sepanjang tahun (tanpa DST), jadi
// Jakarta "08:05" ditulis sebagai "...T01:05:00.000Z".
function insertClosedSession(sqlite, cashierId, storeId, checkInAtUtc, checkOutAtUtc) {
  const id = `attn_${cashierId}_${checkInAtUtc}`;
  sqlite.prepare(`
    INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status, check_out_at, check_out_photo_blob, check_out_photo_type)
    VALUES (?, ?, ?, 'in', x'00', 'image/jpeg', ?, 'CLOSED', ?, x'00', 'image/jpeg')
  `).run(id, cashierId, storeId, checkInAtUtc, checkOutAtUtc);
  return id;
}

function insertOpenSession(sqlite, cashierId, storeId, checkInAtUtc) {
  const id = `attn_${cashierId}_${checkInAtUtc}`;
  sqlite.prepare(`
    INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status)
    VALUES (?, ?, ?, 'in', x'00', 'image/jpeg', ?, 'OPEN')
  `).run(id, cashierId, storeId, checkInAtUtc);
  return id;
}

async function loadPortal(env, token) {
  const response = await handleStaffPortalApi(request('/api/staff/portal', { token }), env, '/api/staff/portal');
  assert.equal(response.status, 200);
  return response.json();
}

test('lateMinutes: tepat waktu, telat beberapa ambang, dan lebih awal tetap 0 -- dibandingkan ke jadwal hari itu (Sabtu, day_of_week 6)', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const cashier = await createCashier(env, adminToken, 'PENDEM', {
      username: 'kasir_telat', password: 'rahasia1', employeeName: 'Kasir Telat',
      schedule: [{ dayOfWeek: 6, shiftStart: '08:00', shiftEnd: '16:00' }]
    });
    const token = await cashierToken(sqlite, cashier.id);

    insertClosedSession(sqlite, cashier.id, 'store_pendem', '2026-09-19T01:00:00.000Z', '2026-09-19T09:00:00.000Z'); // Jakarta 08:00 -- tepat waktu
    insertClosedSession(sqlite, cashier.id, 'store_pendem', '2026-09-19T01:03:00.000Z', '2026-09-19T09:03:00.000Z'); // 08:03 -- telat 3 menit
    insertClosedSession(sqlite, cashier.id, 'store_pendem', '2026-09-19T01:07:00.000Z', '2026-09-19T09:07:00.000Z'); // 08:07 -- telat 7 menit
    insertClosedSession(sqlite, cashier.id, 'store_pendem', '2026-09-19T01:15:00.000Z', '2026-09-19T09:15:00.000Z'); // 08:15 -- telat 15 menit
    insertClosedSession(sqlite, cashier.id, 'store_pendem', '2026-09-19T00:50:00.000Z', '2026-09-19T08:50:00.000Z'); // 07:50 -- lebih awal, tetap 0

    const portal = await loadPortal(env, token);
    const byCheckIn = Object.fromEntries(portal.attendance.map(row => [row.checkIn.at, row.checkIn.lateMinutes]));
    assert.equal(byCheckIn['2026-09-19T01:00:00.000Z'], 0);
    assert.equal(byCheckIn['2026-09-19T01:03:00.000Z'], 3);
    assert.equal(byCheckIn['2026-09-19T01:07:00.000Z'], 7);
    assert.equal(byCheckIn['2026-09-19T01:15:00.000Z'], 15);
    assert.equal(byCheckIn['2026-09-19T00:50:00.000Z'], 0, 'datang lebih awal tidak boleh jadi minus');
  } finally { sqlite.close(); }
});

test('lateMinutes null kalau jadwal hari itu belum diatur Admin -- tidak boleh dianggap telat/tepat waktu diam-diam', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const cashier = await createCashier(env, adminToken, 'PENDEM', { username: 'kasir_polos', password: 'rahasia1', employeeName: 'Kasir Polos' });
    const token = await cashierToken(sqlite, cashier.id);
    insertClosedSession(sqlite, cashier.id, 'store_pendem', '2026-09-19T01:30:00.000Z', '2026-09-19T09:00:00.000Z');

    const portal = await loadPortal(env, token);
    assert.equal(portal.attendance[0].checkIn.lateMinutes, null);
  } finally { sqlite.close(); }
});

test('Riwayat Gaji JAM: durasi kerja x tarif per jam, sesi OPEN belum masuk hitungan', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const cashier = await createCashier(env, adminToken, 'PENDEM', {
      username: 'kasir_jam', password: 'rahasia1', employeeName: 'Kasir Jam', paymentType: 'JAM', hourlyWage: 20000
    });
    const token = await cashierToken(sqlite, cashier.id);

    // 2.5 jam kerja -- Rp20.000/jam x 2.5 = Rp50.000.
    insertClosedSession(sqlite, cashier.id, 'store_pendem', '2026-09-19T01:00:00.000Z', '2026-09-19T03:30:00.000Z');
    // Masih berjalan -- tidak boleh ikut dihitung karena durasinya belum final.
    insertOpenSession(sqlite, cashier.id, 'store_pendem', '2026-09-19T05:00:00.000Z');

    const portal = await loadPortal(env, token);
    assert.equal(portal.payroll.length, 1, 'sesi yang masih OPEN tidak boleh punya entry Riwayat Gaji');
    assert.equal(portal.payroll[0].paymentType, 'JAM');
    assert.equal(portal.payroll[0].hoursWorked, 2.5);
    assert.equal(portal.payroll[0].earningRupiah, 50000);
  } finally { sqlite.close(); }
});

test('Riwayat Gaji SESI: nominal flat per sesi selesai, tidak peduli berapa lama durasinya', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const cashier = await createCashier(env, adminToken, 'PENDEM', {
      username: 'kasir_sesi', password: 'rahasia1', employeeName: 'Kasir Sesi', paymentType: 'SESI', hourlyWage: 75000
    });
    const token = await cashierToken(sqlite, cashier.id);

    insertClosedSession(sqlite, cashier.id, 'store_pendem', '2026-09-19T01:00:00.000Z', '2026-09-19T03:00:00.000Z'); // 2 jam
    insertClosedSession(sqlite, cashier.id, 'store_pendem', '2026-09-20T01:00:00.000Z', '2026-09-20T09:00:00.000Z'); // 8 jam

    const portal = await loadPortal(env, token);
    assert.equal(portal.payroll.length, 2);
    for (const entry of portal.payroll) {
      assert.equal(entry.paymentType, 'SESI');
      assert.equal(entry.earningRupiah, 75000, 'flat per sesi, tidak dikali durasi');
      assert.equal(entry.hoursWorked, null, 'SESI tidak melaporkan jam kerja sebagai basis hitung');
    }
  } finally { sqlite.close(); }
});

test('UI Portal Staf punya indikator telat dan render Riwayat Gaji, bukan lagi placeholder V1', () => {
  assert.match(staffJs, /lateMinutes/);
  assert.match(staffJs, /renderPayroll/);
  assert.match(staffJs, /staffPayrollList/);
});

// Bos Cyo, 2026-09-19: "presensi itu kalo di klik langsung jadi modal buat
// presensi aja, engga perlu habis klik itu trus klik tombol lagi" -- klik
// tab Presensi harus langsung memicu startAttendance(), bukan cuma pindah
// panel lalu menunggu klik tombol terpisah.
test('klik tab Presensi langsung memicu startAttendance(), bukan cuma pindah panel', () => {
  const bindTabsBlock = staffJs.slice(staffJs.indexOf('function bindTabs'), staffJs.indexOf('el(\'attendanceToggleBtn\').addEventListener'));
  assert.match(bindTabsBlock, /tab === 'attendance'/);
  assert.match(bindTabsBlock, /startAttendance\(/);
});
