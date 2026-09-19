import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminCashierApi } from '../src/cashier-auth.js';
import { handleStaffPortalApi } from '../src/staff-portal.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-19: "untuk ganti konsep ga jadi deh, bener yang udah
// jalan sekarang, tapi akunnya dibikin lebih detil aja misal jam kerja dan
// hari kerja. jadi misal hari senin jam 9-18 sampai hari jumat sama, terus
// sabtu libur, minggu jam 9-22."
//
// account_job_details.shift_start/shift_end (migration 0104, satu jam untuk
// semua hari) digantikan account_shift_schedule (migration 0106, 7 baris
// per akun -- day_of_week 0=Minggu..6=Sabtu, sama seperti JS Date.getUTCDay()).

const migrationDir = new URL('../migrations/', import.meta.url);
const cashierAdminUi = readFileSync(new URL('../public/admin-cashiers.js', import.meta.url), 'utf8');

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

function insertClosedSession(sqlite, cashierId, storeId, checkInAtUtc, checkOutAtUtc) {
  const id = `attn_${cashierId}_${checkInAtUtc}`;
  sqlite.prepare(`
    INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status, check_out_at, check_out_photo_blob, check_out_photo_type)
    VALUES (?, ?, ?, 'in', x'00', 'image/jpeg', ?, 'CLOSED', ?, x'00', 'image/jpeg')
  `).run(id, cashierId, storeId, checkInAtUtc, checkOutAtUtc);
  return id;
}

async function loadPortal(env, token) {
  const response = await handleStaffPortalApi(request('/api/staff/portal', { token }), env, '/api/staff/portal');
  assert.equal(response.status, 200);
  return response.json();
}

// Contoh persis Bos Cyo: Senin(1)-Jumat(5) 09:00-18:00, Sabtu(6) libur,
// Minggu(0) 09:00-22:00.
const CONTOH_JADWAL_BOS_CYO = [
  { dayOfWeek: 1, shiftStart: '09:00', shiftEnd: '18:00' },
  { dayOfWeek: 2, shiftStart: '09:00', shiftEnd: '18:00' },
  { dayOfWeek: 3, shiftStart: '09:00', shiftEnd: '18:00' },
  { dayOfWeek: 4, shiftStart: '09:00', shiftEnd: '18:00' },
  { dayOfWeek: 5, shiftStart: '09:00', shiftEnd: '18:00' },
  { dayOfWeek: 6, isDayOff: true },
  { dayOfWeek: 0, shiftStart: '09:00', shiftEnd: '22:00' }
];

test('jadwal 7 hari tersimpan persis contoh Bos Cyo -- Senin-Jumat sama, Sabtu libur, Minggu beda', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const created = await createCashier(env, token, 'PENDEM', {
      username: 'kasir_jadwal', password: 'rahasia1', employeeName: 'Kasir Jadwal', schedule: CONTOH_JADWAL_BOS_CYO
    });

    const rows = sqlite.prepare(`SELECT day_of_week, is_day_off, shift_start, shift_end FROM account_shift_schedule WHERE account_id = ? ORDER BY day_of_week`).all(created.id);
    assert.equal(rows.length, 7, 'harus selalu 7 baris, satu per hari');
    const byDay = Object.fromEntries(rows.map(row => [row.day_of_week, row]));
    for (const weekday of [1, 2, 3, 4, 5]) {
      assert.equal(byDay[weekday].is_day_off, 0);
      assert.equal(byDay[weekday].shift_start, '09:00');
      assert.equal(byDay[weekday].shift_end, '18:00');
    }
    assert.equal(byDay[6].is_day_off, 1, 'Sabtu libur');
    assert.equal(byDay[6].shift_start, '', 'jam dikosongkan otomatis waktu libur, walau tidak dikirim eksplisit');
    assert.equal(byDay[0].is_day_off, 0);
    assert.equal(byDay[0].shift_start, '09:00');
    assert.equal(byDay[0].shift_end, '22:00', 'Minggu beda jam dari hari kerja biasa');

    const list = await (await handleAdminCashierApi(request('/api/admin/cashiers', { token, store: 'PENDEM' }), env, '/api/admin/cashiers')).json();
    const schedule = list.cashiers.find(c => c.id === created.id).schedule;
    assert.equal(schedule.length, 7);
    assert.ok(schedule.find(day => day.dayOfWeek === 6 && day.isDayOff === true));
  } finally { sqlite.close(); }
});

test('PATCH jadwal mengganti ke-7 hari sekaligus, bukan per-hari -- dan tidak dikirim sama sekali berarti jadwal lama dipertahankan', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const created = await createCashier(env, token, 'PENDEM', {
      username: 'kasir_jadwal', password: 'rahasia1', employeeName: 'Kasir Jadwal', schedule: CONTOH_JADWAL_BOS_CYO
    });

    // PATCH cuma ganti gaji -- schedule tidak dikirim sama sekali.
    await handleAdminCashierApi(request(`/api/admin/cashiers/${created.id}`, { token, store: 'PENDEM', method: 'PATCH', body: { hourlyWage: 30000 } }), env, `/api/admin/cashiers/${created.id}`);
    let rows = sqlite.prepare(`SELECT is_day_off, shift_start FROM account_shift_schedule WHERE account_id = ? AND day_of_week = 6`).all(created.id);
    assert.equal(rows[0].is_day_off, 1, 'jadwal lama (Sabtu libur) tidak boleh berubah kalau schedule tidak dikirim di PATCH ini');

    // PATCH lain benar-benar ganti jadwal -- Sabtu yang tadinya libur sekarang buka.
    await handleAdminCashierApi(request(`/api/admin/cashiers/${created.id}`, {
      token, store: 'PENDEM', method: 'PATCH',
      body: { schedule: [{ dayOfWeek: 6, shiftStart: '10:00', shiftEnd: '14:00' }] }
    }), env, `/api/admin/cashiers/${created.id}`);
    rows = sqlite.prepare(`SELECT day_of_week, is_day_off, shift_start, shift_end FROM account_shift_schedule WHERE account_id = ? ORDER BY day_of_week`).all(created.id);
    const bySabtu = rows.find(row => row.day_of_week === 6);
    assert.equal(bySabtu.is_day_off, 0, 'Sabtu sekarang buka');
    assert.equal(bySabtu.shift_start, '10:00');
    // Hari lain yang tidak disebut di PATCH ini kembali ke "belum diatur"
    // (bukan mempertahankan nilai lama per-hari) -- schedule diganti utuh.
    const bySenin = rows.find(row => row.day_of_week === 1);
    assert.equal(bySenin.is_day_off, 0);
    assert.equal(bySenin.shift_start, '', 'schedule diganti utuh sekaligus, hari yang tidak disebut ulang jadi belum diatur');
  } finally { sqlite.close(); }
});

test('jadwal ditolak kalau jam formatnya salah, kecuali hari itu ditandai libur', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    const badTime = await handleAdminCashierApi(request('/api/admin/cashiers', {
      token, store: 'PENDEM', method: 'POST',
      body: { username: 'kasir_x', password: 'rahasia1', employeeName: 'X', schedule: [{ dayOfWeek: 1, shiftStart: '25:99', shiftEnd: '18:00' }] }
    }), env, '/api/admin/cashiers');
    assert.equal(badTime.status, 400);
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM cashiers WHERE username = 'kasir_x'`).get().n, 0);

    // isDayOff:true tidak perlu jam valid sama sekali -- tidak boleh ikut ditolak.
    const okDayOff = await createCashier(env, token, 'PENDEM', {
      username: 'kasir_libur', password: 'rahasia1', employeeName: 'Libur', schedule: [{ dayOfWeek: 1, isDayOff: true, shiftStart: 'ngaco' }]
    });
    assert.ok(okDayOff.id);
  } finally { sqlite.close(); }
});

test('lateMinutes null di hari libur, walau shift_start hari lain di akun yang sama terisi', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    // 2026-09-19 = Sabtu (day_of_week 6) -- ditandai libur di jadwal ini,
    // walau Senin-Jumat & Minggu terisi jam kerja.
    const cashier = await createCashier(env, adminToken, 'PENDEM', {
      username: 'kasir_jadwal', password: 'rahasia1', employeeName: 'Kasir Jadwal', schedule: CONTOH_JADWAL_BOS_CYO
    });
    const token = await cashierToken(sqlite, cashier.id);
    insertClosedSession(sqlite, cashier.id, 'store_pendem', '2026-09-19T05:00:00.000Z', '2026-09-19T09:00:00.000Z'); // Sabtu, tetap masuk walau harusnya libur

    const portal = await loadPortal(env, token);
    assert.equal(portal.attendance[0].checkIn.lateMinutes, null, 'hari libur tidak bisa dinilai telat/tepat waktu');
  } finally { sqlite.close(); }
});

test('lateMinutes beda hasil di hari berbeda untuk akun yang sama, sesuai jadwal masing-masing hari', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const cashier = await createCashier(env, adminToken, 'PENDEM', {
      username: 'kasir_jadwal', password: 'rahasia1', employeeName: 'Kasir Jadwal', schedule: CONTOH_JADWAL_BOS_CYO
    });
    const token = await cashierToken(sqlite, cashier.id);

    // Senin 2026-09-21, jadwal 09:00 -- datang Jakarta 09:10 (UTC 02:10) = telat 10 menit.
    insertClosedSession(sqlite, cashier.id, 'store_pendem', '2026-09-21T02:10:00.000Z', '2026-09-21T11:00:00.000Z');
    // Minggu 2026-09-20, jadwal 09:00 -- datang Jakarta 09:00 (UTC 02:00) = tepat waktu.
    insertClosedSession(sqlite, cashier.id, 'store_pendem', '2026-09-20T02:00:00.000Z', '2026-09-20T15:00:00.000Z');

    const portal = await loadPortal(env, token);
    const byCheckIn = Object.fromEntries(portal.attendance.map(row => [row.checkIn.at, row.checkIn.lateMinutes]));
    assert.equal(byCheckIn['2026-09-21T02:10:00.000Z'], 10);
    assert.equal(byCheckIn['2026-09-20T02:00:00.000Z'], 0);
  } finally { sqlite.close(); }
});

test('UI Master Kasir menampilkan 7 baris jadwal (Senin..Sabtu, Minggu) dengan checkbox Libur', () => {
  assert.match(cashierAdminUi, /data-sched-off/);
  assert.match(cashierAdminUi, /data-sched-start/);
  assert.match(cashierAdminUi, /data-sched-end/);
  assert.match(cashierAdminUi, /Libur/);
  for (const day of ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']) {
    assert.match(cashierAdminUi, new RegExp(day));
  }
});
