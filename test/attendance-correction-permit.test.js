import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleAttendanceCorrectionPermitApi } from '../src/attendance-correction-permit.js';
import { handleStaffPortalApi } from '../src/staff-portal.js';
import { computeEarningScaled } from '../src/staff-attendance.js';
import { getJakartaDayOfWeek, jakartaWallClockToUtc } from '../src/time.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-10-01: permit untuk mengubah jam presensi masuk yang telat
// karena alasan sah (mis. web error). Karyawan mengajukan, Admin ACC/Tolak,
// saat ACC jam masuk diganti dan alasannya tercatat. Hanya selagi sesi masih
// berjalan (belum posted ke gaji/Akuntansi); sesi selesai -> permit kadaluarsa,
// koreksinya lewat Penyesuaian Gaji.

const migrationDir = new URL('../migrations/', import.meta.url);
const AGENT_TOKEN = 'c'.repeat(40);
const WAGE = 20_000;
const BUSINESS_DATE = '2026-09-28';

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

const at = hhmm => jakartaWallClockToUtc(BUSINESS_DATE, hhmm).toISOString();

async function seedCashier(db, storeId, username) {
  const id = `cashier_acp_${username}`;
  db.prepare(`
    INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
    VALUES (?, ?, 'x', ?, ?, 1, '2026-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z')
  `).run(id, username, `Karyawan ${username}`, storeId);
  const token = `token-acp-${username}`;
  db.prepare(`
    INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at)
    VALUES (?, ?, '2026-09-24T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(await hashCredential(token), id);
  db.prepare(`
    INSERT INTO account_job_details (account_type, account_id, hourly_wage_scaled, job_type, payment_type, updated_at)
    VALUES ('CASHIER', ?, ?, '', 'JAM', CURRENT_TIMESTAMP)
  `).run(id, WAGE * 1_000_000);
  db.prepare(`
    INSERT INTO account_shift_schedule (account_type, account_id, day_of_week, is_day_off, shift_start, shift_end)
    VALUES ('CASHIER', ?, ?, 0, '09:00', '18:00')
  `).run(id, getJakartaDayOfWeek(jakartaWallClockToUtc(BUSINESS_DATE, '12:00')));
  return { id, token };
}

function insertAttendance(db, cashier, storeId, { checkIn, checkOut = null }) {
  const id = `attendance_acp_${Math.random().toString(36).slice(2)}`;
  db.prepare(`
    INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status, check_out_at)
    VALUES (?, ?, ?, 'in', x'0102', 'image/jpeg', ?, ?, ?)
  `).run(id, cashier.id, storeId, checkIn, checkOut ? 'CLOSED' : 'OPEN', checkOut);
  return id;
}

function staffRequest(cashier, attendanceId, body) {
  const path = `/api/staff/attendance/${attendanceId}/correction-permits`;
  return handleAttendanceCorrectionPermitApi(new Request(`https://example.test${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${cashier.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body)
  }), { DB: staffRequest.d1 }, path);
}

function adminCall(method, path, body, store = 'G001') {
  const url = new URL(`https://example.test${path}`);
  url.searchParams.set('store', store);
  return handleAttendanceCorrectionPermitApi(new Request(url, {
    method, headers: { authorization: `Bearer ${AGENT_TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  }), { DB: staffRequest.d1, AGENT_ADMIN_TOKEN: AGENT_TOKEN }, url.pathname);
}

async function setup() {
  const sqlite = migratedDatabase();
  const d1 = new D1Database(sqlite);
  staffRequest.d1 = d1;
  const store = sqlite.prepare("SELECT id FROM stores WHERE code = 'G001'").get();
  const cashier = await seedCashier(sqlite, store.id, 'rina');
  return { sqlite, d1, store, cashier };
}

const checkoutRequest = token => {
  const form = new FormData();
  form.set('type', 'out');
  form.set('photo', new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' }), 'out.jpg');
  return new Request('https://example.test/api/staff/attendance', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
};

test('alur lengkap: ajukan saat sesi berjalan, ACC, jam diganti + alasan tercatat, lalu gaji saat pulang memakai jam hasil koreksi', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(at('17:00')).getTime() });
  const { sqlite, d1, store, cashier } = await setup();
  try {
    const checkIn = at('13:05');
    const attendanceId = insertAttendance(sqlite, cashier, store.id, { checkIn });

    const created = await staffRequest(cashier, attendanceId, { requestedTime: '09:00', reason: 'Web presensi error dari pagi' });
    assert.equal(created.status, 201);
    const permit = (await created.json()).permit;
    assert.equal(permit.status, 'PENDING');
    assert.equal(permit.requestedCheckInAt, at('09:00'));

    const pending = await (await adminCall('GET', '/api/admin/attendance-correction-permits')).json();
    assert.equal(pending.permits.length, 1);
    assert.equal(pending.permits[0].requestedByName, 'Karyawan rina');

    const decided = await adminCall('PATCH', `/api/admin/attendance-correction-permits/${permit.id}`, { decision: 'ACC', note: 'Benar, web error dikonfirmasi' });
    assert.equal(decided.status, 200);
    assert.equal((await decided.json()).permit.status, 'APPROVED');

    const row = sqlite.prepare('SELECT created_at, original_created_at, correction_reason, correction_decision_note, correction_permit_id FROM staff_attendance WHERE id = ?').get(attendanceId);
    assert.equal(row.created_at, at('09:00'));
    assert.equal(row.original_created_at, checkIn);
    assert.equal(row.correction_reason, 'Web presensi error dari pagi');
    assert.equal(row.correction_decision_note, 'Benar, web error dikonfirmasi');
    assert.equal(row.correction_permit_id, permit.id);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM payroll_ledger_entries').get().n, 0, 'belum ada gaji tercatat selama sesi berjalan');

    // Portal Staf: kartu presensi menunjukkan koreksi, tidak telat lagi, dan daftar permit ikut terkirim.
    const portal = await (await handleStaffPortalApi(new Request('https://example.test/api/staff/portal', { headers: { authorization: `Bearer ${cashier.token}` } }), { DB: d1 }, '/api/staff/portal')).json();
    const card = portal.attendance.find(item => item.id === attendanceId);
    assert.equal(card.checkIn.at, at('09:00'));
    assert.equal(card.checkIn.lateMinutes, 0);
    assert.equal(card.correction.originalAt, checkIn);
    assert.equal(card.correction.reason, 'Web presensi error dari pagi');
    assert.equal(portal.attendanceCorrectionPermits[0].status, 'APPROVED');

    // Presensi pulang jam 17:00: gaji dihitung dari 09:00, bukan 13:05.
    const out = await handleStaffPortalApi(checkoutRequest(cashier.token), { DB: d1 }, '/api/staff/attendance');
    assert.equal(out.status, 201);
    const accrual = sqlite.prepare("SELECT beban_gaji_delta_scaled AS amount FROM payroll_ledger_entries WHERE source_type = 'ATTENDANCE' AND source_id = ?").get(attendanceId);
    assert.equal(Number(accrual.amount), 8 * WAGE * 1_000_000, '09:00-17:00 = 8 jam');

    // Sudah pernah dikoreksi: tidak bisa diajukan lagi (dan sesinya pun sudah selesai).
    const again = await staffRequest(cashier, attendanceId, { requestedTime: '09:00', reason: 'Coba lagi saja' });
    assert.equal(again.status, 409);

    const twice = await adminCall('PATCH', `/api/admin/attendance-correction-permits/${permit.id}`, { decision: 'ACC' });
    assert.equal(twice.status, 409, 'keputusan yang sama tidak bisa diulang');
  } finally { sqlite.close(); }
});

test('sesi sudah selesai: tidak bisa diajukan, diarahkan ke Penyesuaian Gaji', async () => {
  const { sqlite, store, cashier } = await setup();
  try {
    const attendanceId = insertAttendance(sqlite, cashier, store.id, { checkIn: at('13:05'), checkOut: at('18:00') });
    const response = await staffRequest(cashier, attendanceId, { requestedTime: '09:00', reason: 'Web error dari pagi' });
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.code, 'SESSION_ALREADY_CLOSED');
    assert.match(payload.error, /Penyesuaian Gaji/);
  } finally { sqlite.close(); }
});

test('pengajuan yang belum diputuskan kadaluarsa saat presensi pulang, dan gajinya memakai jam asli (koreksi lewat Penyesuaian)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(at('17:00')).getTime() });
  const { sqlite, d1, store, cashier } = await setup();
  try {
    const attendanceId = insertAttendance(sqlite, cashier, store.id, { checkIn: at('13:05') });
    const permit = (await (await staffRequest(cashier, attendanceId, { requestedTime: '09:00', reason: 'Web error dari pagi' })).json()).permit;

    assert.equal((await handleStaffPortalApi(checkoutRequest(cashier.token), { DB: d1 }, '/api/staff/attendance')).status, 201);
    const row = sqlite.prepare('SELECT status, decided_by_role, decision_note FROM attendance_correction_permits WHERE id = ?').get(permit.id);
    assert.equal(row.status, 'EXPIRED');
    assert.equal(row.decided_by_role, 'SYSTEM');
    assert.match(row.decision_note, /Penyesuaian Gaji/);

    const late = await adminCall('PATCH', `/api/admin/attendance-correction-permits/${permit.id}`, { decision: 'ACC' });
    assert.equal(late.status, 409);
    assert.equal((await late.json()).code, 'PERMIT_EXPIRED');
    const untouched = sqlite.prepare('SELECT created_at, original_created_at FROM staff_attendance WHERE id = ?').get(attendanceId);
    assert.equal(untouched.created_at, at('13:05'));
    assert.equal(untouched.original_created_at, null);
    const accrual = sqlite.prepare("SELECT beban_gaji_delta_scaled AS amount FROM payroll_ledger_entries WHERE source_id = ?").get(attendanceId);
    assert.ok(Number(accrual.amount) < 8 * WAGE * 1_000_000, 'gaji dihitung dari 13:05');
  } finally { sqlite.close(); }
});

test('sesi ditutup sistem atau lewat jalur lain: ACC pada pengajuan basi ditolak dan permit menjadi EXPIRED', async () => {
  const { sqlite, store, cashier } = await setup();
  try {
    const attendanceId = insertAttendance(sqlite, cashier, store.id, { checkIn: at('13:05') });
    const permit = (await (await staffRequest(cashier, attendanceId, { requestedTime: '09:00', reason: 'Web error dari pagi' })).json()).permit;
    sqlite.prepare("UPDATE staff_attendance SET status = 'CLOSED', check_out_at = ? WHERE id = ?").run(at('18:00'), attendanceId);

    const listing = await (await adminCall('GET', '/api/admin/attendance-correction-permits?status=ALL')).json();
    assert.equal(listing.permits.find(item => item.id === permit.id).status, 'EXPIRED', 'daftar Admin ikut menyapu yang kadaluarsa');
    const decided = await adminCall('PATCH', `/api/admin/attendance-correction-permits/${permit.id}`, { decision: 'ACC' });
    assert.equal(decided.status, 409);
    assert.equal(sqlite.prepare('SELECT original_created_at FROM staff_attendance WHERE id = ?').get(attendanceId).original_created_at, null);
  } finally { sqlite.close(); }
});

test('ditolak: jam presensi tidak berubah dan alasan penolakan wajib diisi', async () => {
  const { sqlite, store, cashier } = await setup();
  try {
    const attendanceId = insertAttendance(sqlite, cashier, store.id, { checkIn: at('13:05') });
    const permit = (await (await staffRequest(cashier, attendanceId, { requestedTime: '09:00', reason: 'Lupa presensi pagi' })).json()).permit;

    const noNote = await adminCall('PATCH', `/api/admin/attendance-correction-permits/${permit.id}`, { decision: 'REJECT' });
    assert.equal(noNote.status, 400);

    const rejected = await adminCall('PATCH', `/api/admin/attendance-correction-permits/${permit.id}`, { decision: 'REJECT', note: 'Lupa bukan alasan sah' });
    assert.equal(rejected.status, 200);
    assert.equal((await rejected.json()).permit.decisionNote, 'Lupa bukan alasan sah');
    const row = sqlite.prepare('SELECT created_at, original_created_at FROM staff_attendance WHERE id = ?').get(attendanceId);
    assert.equal(row.created_at, at('13:05'));
    assert.equal(row.original_created_at, null);

    // Setelah ditolak, karyawan boleh mengajukan lagi selama sesinya masih berjalan.
    assert.equal((await staffRequest(cashier, attendanceId, { requestedTime: '09:00', reason: 'Ada bukti screenshot error' })).status, 201);
  } finally { sqlite.close(); }
});

test('validasi pengajuan: jam harus lebih awal, tidak sebelum shift, alasan wajib, milik sendiri, dan tidak ganda', async () => {
  const { sqlite, store, cashier } = await setup();
  try {
    const other = await seedCashier(sqlite, store.id, 'bimo');
    const attendanceId = insertAttendance(sqlite, cashier, store.id, { checkIn: at('13:05') });
    const send = payload => staffRequest(cashier, attendanceId, payload);

    assert.equal((await send({ requestedTime: '13:05', reason: 'Web error hari ini' })).status, 400, 'jam sama dengan yang tercatat');
    assert.equal((await send({ requestedTime: '14:00', reason: 'Web error hari ini' })).status, 400, 'lebih lambat bukan koreksi telat');
    const beforeShift = await send({ requestedTime: '08:30', reason: 'Web error hari ini' });
    assert.equal(beforeShift.status, 400);
    assert.match((await beforeShift.json()).error, /jam mulai shift \(09:00\)/);
    assert.equal((await send({ requestedTime: 'sembilan', reason: 'Web error hari ini' })).status, 400);
    assert.equal((await send({ requestedTime: '09:00', reason: '  ' })).status, 400);

    const foreign = await staffRequest(other, attendanceId, { requestedTime: '09:00', reason: 'Bukan presensi saya' });
    assert.equal(foreign.status, 404, 'presensi orang lain tidak bisa diajukan');

    assert.equal((await send({ requestedTime: '09:00', reason: 'Web error hari ini' })).status, 201);
    const duplicate = await send({ requestedTime: '09:15', reason: 'Web error hari ini' });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).code, 'PERMIT_ALREADY_PENDING');
  } finally { sqlite.close(); }
});

test('hari libur ditolak, dan permit hanya bisa diputuskan Admin gerai yang sama', async () => {
  const { sqlite, store, cashier } = await setup();
  try {
    const attendanceId = insertAttendance(sqlite, cashier, store.id, { checkIn: at('13:05') });
    sqlite.prepare("UPDATE account_shift_schedule SET is_day_off = 1 WHERE account_id = ?").run(cashier.id);
    const dayOff = await staffRequest(cashier, attendanceId, { requestedTime: '09:00', reason: 'Web error hari ini' });
    assert.equal(dayOff.status, 400);
    assert.match((await dayOff.json()).error, /libur/);
    sqlite.prepare("UPDATE account_shift_schedule SET is_day_off = 0 WHERE account_id = ?").run(cashier.id);

    const permit = (await (await staffRequest(cashier, attendanceId, { requestedTime: '09:00', reason: 'Web error hari ini' })).json()).permit;
    const otherStore = sqlite.prepare("SELECT code FROM stores WHERE code <> 'G001' LIMIT 1").get();
    const wrongStore = await adminCall('PATCH', `/api/admin/attendance-correction-permits/${permit.id}`, { decision: 'ACC' }, otherStore.code);
    assert.equal(wrongStore.status, 403);
    assert.equal((await wrongStore.json()).code, 'PERMIT_STORE_SCOPE_MISMATCH');
    assert.equal(sqlite.prepare('SELECT status FROM attendance_correction_permits WHERE id = ?').get(permit.id).status, 'PENDING');
  } finally { sqlite.close(); }
});

test('presensi yang berubah sejak diajukan: ACC otomatis ditolak sistem, bukan menerapkan data basi', async () => {
  const { sqlite, store, cashier } = await setup();
  try {
    const attendanceId = insertAttendance(sqlite, cashier, store.id, { checkIn: at('13:05') });
    const permit = (await (await staffRequest(cashier, attendanceId, { requestedTime: '09:00', reason: 'Web error hari ini' })).json()).permit;
    sqlite.prepare('UPDATE staff_attendance SET created_at = ? WHERE id = ?').run(at('13:30'), attendanceId);
    const decided = await adminCall('PATCH', `/api/admin/attendance-correction-permits/${permit.id}`, { decision: 'ACC' });
    assert.equal(decided.status, 409);
    assert.equal((await decided.json()).code, 'ATTENDANCE_CHANGED');
    const row = sqlite.prepare('SELECT status, decided_by_role FROM attendance_correction_permits WHERE id = ?').get(permit.id);
    assert.equal(row.status, 'REJECTED');
    assert.equal(row.decided_by_role, 'SYSTEM');
    assert.equal(sqlite.prepare('SELECT created_at FROM staff_attendance WHERE id = ?').get(attendanceId).created_at, at('13:30'));
  } finally { sqlite.close(); }
});

test('tampilan: Portal Staf punya dialog pengajuan, panel Admin punya antrean ACC, dan versi skrip dinaikkan', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const staff = read('../public/staff.js');
  const admin = read('../public/admin-cashiers.js');
  assert.match(staff, /data-correct-attendance/);
  assert.match(staff, /correction-permits/);
  assert.match(staff, /row\.status === 'OPEN' && row\.checkIn/, 'tombol hanya untuk sesi yang masih berjalan');
  assert.match(admin, /\/api\/admin\/attendance-correction-permits/);
  assert.match(admin, /data-acc-correction/);
  assert.match(admin, /row\.correction/, 'riwayat presensi Admin menampilkan alasan koreksi');
  assert.match(read('../public/staff.html'), /staff\.js\?v=20261001-gps-presensi-v1/);
  assert.match(read('../public/branch-admin.html'), /admin-cashiers\.js\?v=20261001-gps-presensi-v1/);
});
