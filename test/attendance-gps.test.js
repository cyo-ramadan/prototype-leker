import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ATTENDANCE_RADIUS_METERS, evaluateGps, gpsFact, gpsNotice, haversineMeters, overRadiusMeters, storeReference } from '../src/attendance-gps.js';
import { handleAttendanceGpsPermitApi } from '../src/attendance-gps-permit.js';
import { handleAttendanceReportApi } from '../src/attendance-report.js';
import { handlePermitReportApi } from '../src/permit-report.js';
import { handleAdminApi } from '../src/admin-multistore.js';
import { handleStaffPortalApi } from '../src/staff-portal.js';
import { getCashierRaportFacts } from '../src/staff-raport.js';
import { jakartaWallClockToUtc } from '../src/time.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-10-01: presensi dinilai terhadap GPS acuan gerai (radius 75 m).
// Tidak pernah ditolak; tanpa GPS atau di luar radius diberi tanda merah di
// kartu presensi; karyawan bisa mengajukan perbaikan, ACC memadamkan tanda
// dengan keterangan, tolak membiarkannya merah; semuanya terkumpul di laporan.

const migrationDir = new URL('../migrations/', import.meta.url);
const AGENT_TOKEN = 'g'.repeat(40);
const BUSINESS_DATE = '2026-09-28';
const REF = { latitude: -6.2, longitude: 106.8 };
// 1 derajat lintang ~ 111.195 m, jadi 0.0009 derajat ~ 100 m.
const north = meters => ({ latitude: REF.latitude + meters / 111_195, longitude: REF.longitude });

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
  const id = `cashier_gps_${username}`;
  db.prepare(`
    INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
    VALUES (?, ?, 'x', ?, ?, 1, '2026-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z')
  `).run(id, username, `Karyawan ${username}`, storeId);
  const token = `token-gps-${username}`;
  db.prepare(`
    INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at)
    VALUES (?, ?, '2026-09-24T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(await hashCredential(token), id);
  // Tes ini menguji GPS, bukan jadwal. Presensi memakai jam sungguhan saat tes jalan, dan sesi yang
  // lewat jam selesai shift ditutup otomatis (forceCloseOverdueSessions) -- dulu shift 09.00-18.00
  // membuat tes merah setiap kali dijalankan sesudah 18.00 WIB. Shift sampai 23.59 di semua hari;
  // jam mulai tetap 09.00 (dipakai tes laporan untuk presensi tepat waktu).
  for (let day = 0; day < 7; day += 1) {
    db.prepare(`
      INSERT OR IGNORE INTO account_shift_schedule (account_type, account_id, day_of_week, is_day_off, shift_start, shift_end)
      VALUES ('CASHIER', ?, ?, 0, '09:00', '23:59')
    `).run(id, day);
  }
  return { id, token };
}

async function setup() {
  const sqlite = migratedDatabase();
  const d1 = new D1Database(sqlite);
  const store = sqlite.prepare("SELECT id FROM stores WHERE code = 'G001'").get();
  const cashier = await seedCashier(sqlite, store.id, 'rina');
  const env = { DB: d1, AGENT_ADMIN_TOKEN: AGENT_TOKEN };
  return { sqlite, d1, env, store, cashier };
}

const setReference = (sqlite, storeId, point = REF) => sqlite.prepare('UPDATE stores SET attendance_ref_latitude = ?, attendance_ref_longitude = ? WHERE id = ?').run(point.latitude, point.longitude, storeId);

function attendanceRequest(token, type, point) {
  const form = new FormData();
  form.set('type', type);
  form.set('photo', new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' }), `${type}.jpg`);
  if (point) { form.set('latitude', String(point.latitude)); form.set('longitude', String(point.longitude)); form.set('accuracy', '8'); }
  return new Request('https://example.test/api/staff/attendance', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
}

const presensi = (env, cashier, type, point) => handleStaffPortalApi(attendanceRequest(cashier.token, type, point), env, '/api/staff/attendance');

function staffCall(env, cashier, method, path, body) {
  return handleAttendanceGpsPermitApi(new Request(`https://example.test${path}`, {
    method, headers: { authorization: `Bearer ${cashier.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  }), env, path);
}

function adminCall(env, handler, method, path, body, store = 'G001') {
  const url = new URL(`https://example.test${path}`);
  if (!url.searchParams.has('store')) url.searchParams.set('store', store);
  return handler(new Request(url, {
    method, headers: { authorization: `Bearer ${AGENT_TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  }), env, url.pathname);
}

const adminPermit = (env, ...args) => adminCall(env, handleAttendanceGpsPermitApi, ...args);

// ---------------------------------------------------------------------------

test('haversine + evaluateGps: di dalam radius OK, di luar radius OUT_OF_RADIUS, tanpa GPS NO_GPS, tanpa titik acuan tidak dinilai', () => {
  assert.ok(Math.abs(haversineMeters(REF, north(100)) - 100) < 1);
  assert.equal(ATTENDANCE_RADIUS_METERS, 75);

  assert.equal(evaluateGps({ ...north(50), reference: REF }).status, 'OK');
  assert.equal(evaluateGps({ ...north(74), reference: REF }).status, 'OK');
  const far = evaluateGps({ ...north(85), reference: REF });
  assert.equal(far.status, 'OUT_OF_RADIUS');
  assert.equal(far.distanceM, 85);

  assert.deepEqual(evaluateGps({ latitude: null, longitude: null, reference: REF }), { status: 'NO_GPS', distanceM: null });
  assert.deepEqual(evaluateGps({ latitude: '', longitude: '', reference: null }), { status: 'NO_GPS', distanceM: null });
  assert.deepEqual(evaluateGps({ ...north(500), reference: null }), { status: null, distanceM: null });

  assert.equal(storeReference({ attendance_ref_latitude: null, attendance_ref_longitude: null }), null);
  assert.deepEqual(storeReference({ attendance_ref_latitude: -6.2, attendance_ref_longitude: 106.8 }), REF);
});

test('pesan ke karyawan hanya menyebut selisih (melebihi batas radius N meter), tidak pernah menyebut batas 75 atau jarak total', () => {
  assert.equal(overRadiusMeters(85), 10);
  assert.equal(overRadiusMeters(75.2), 1);
  assert.equal(overRadiusMeters(76), 1);

  const notice = gpsNotice({ status: 'OUT_OF_RADIUS', distanceM: 85 });
  assert.match(notice, /melebihi batas radius 10 meter/);
  assert.doesNotMatch(notice, /(?<![\w.-])75(?![\w.])/);
  assert.doesNotMatch(notice, /85/);
  assert.equal(gpsNotice({ status: 'OK' }), '');
  assert.match(gpsNotice({ status: 'NO_GPS' }), /tanpa GPS/);

  const staffView = gpsFact('OUT_OF_RADIUS', 85, null, '');
  assert.equal(staffView.overRadiusMeters, 10);
  assert.equal('distanceMeters' in staffView, false);
  assert.equal(gpsFact('OUT_OF_RADIUS', 85, null, '', { includeDistance: true }).distanceMeters, 85);
  assert.equal(gpsFact('OK', 20, null, '').needsAttention, false);
  assert.equal(gpsFact(null, null, null, ''), null);
});

test('presensi di luar radius atau tanpa GPS tetap tersimpan (tidak pernah ditolak) dan responsnya tidak membocorkan batas 75 maupun jarak', async () => {
  const { sqlite, env, store, cashier } = await setup();
  try {
    setReference(sqlite, store.id);

    const masuk = await presensi(env, cashier, 'in', north(85));
    assert.equal(masuk.status, 201);
    const masukBody = await masuk.json();
    assert.equal(masukBody.gps.status, 'OUT_OF_RADIUS');
    assert.equal(masukBody.gps.overRadiusMeters, 10);
    assert.match(masukBody.gps.notice, /melebihi batas radius 10 meter/);
    const raw = JSON.stringify(masukBody);
    assert.doesNotMatch(raw, /(?<![\w.-])75(?![\w.])/);
    assert.doesNotMatch(raw, /distanceMeters/);
    const row = sqlite.prepare('SELECT gps_in_status, gps_in_distance_m, status FROM staff_attendance').get();
    assert.equal(row.gps_in_status, 'OUT_OF_RADIUS');
    assert.equal(row.gps_in_distance_m, 85);
    assert.equal(row.status, 'OPEN');

    const pulang = await presensi(env, cashier, 'out', null);
    assert.equal(pulang.status, 201);
    const pulangBody = await pulang.json();
    assert.equal(pulangBody.gps.status, 'NO_GPS');
    assert.equal(pulangBody.attendance.checkOut.gps.needsAttention, true);
    assert.equal(sqlite.prepare('SELECT gps_out_status FROM staff_attendance').get().gps_out_status, 'NO_GPS');
  } finally { sqlite.close(); }
});

test('presensi di dalam radius bersih (OK, tanpa tanda merah); titik acuan belum diatur: GPS ada tidak dinilai, tanpa GPS tetap NO_GPS', async () => {
  const { sqlite, env, store, cashier } = await setup();
  try {
    // Belum ada titik acuan: ada GPS -> tidak dinilai.
    const tanpaAcuan = await presensi(env, cashier, 'in', north(5000));
    assert.equal(tanpaAcuan.status, 201);
    assert.equal((await tanpaAcuan.json()).gps.status, null);
    assert.equal(sqlite.prepare('SELECT gps_in_status FROM staff_attendance').get().gps_in_status, null);
    await presensi(env, cashier, 'out', null);
    assert.equal(sqlite.prepare('SELECT gps_out_status FROM staff_attendance').get().gps_out_status, 'NO_GPS');

    // Titik acuan ada: di dalam radius -> OK.
    setReference(sqlite, store.id);
    const dalam = await presensi(env, cashier, 'in', north(30));
    assert.equal((await dalam.json()).gps.status, 'OK');
    const row = sqlite.prepare("SELECT gps_in_status FROM staff_attendance WHERE status = 'OPEN'").get();
    assert.equal(row.gps_in_status, 'OK');
  } finally { sqlite.close(); }
});

test('Admin mengisi titik acuan gerai lewat PUT /api/admin/store: validasi pasangan + rentang, kosongkan untuk menghapus', async () => {
  const { sqlite, env, store } = await setup();
  try {
    const put = (body, query = '') => adminCall(env, handleAdminApi, 'PUT', `/api/admin/store${query}`, body);
    const base = { storeName: 'Gerai Uji', address: 'Jl. Uji', logoData: '' };

    const ok = await put({ ...base, attendanceRefLatitude: -6.2, attendanceRefLongitude: 106.8 });
    assert.equal(ok.status, 200);
    let row = sqlite.prepare('SELECT attendance_ref_latitude AS lat, attendance_ref_longitude AS lng FROM stores WHERE id = ?').get(store.id);
    assert.deepEqual({ lat: row.lat, lng: row.lng }, { lat: -6.2, lng: 106.8 });

    assert.equal((await put({ ...base, attendanceRefLatitude: -6.2 })).status, 400, 'hanya satu koordinat ditolak');
    assert.equal((await put({ ...base, attendanceRefLatitude: 95, attendanceRefLongitude: 106.8 })).status, 400, 'lintang di luar rentang');
    assert.equal((await put({ ...base, attendanceRefLatitude: 'abc', attendanceRefLongitude: 106.8 })).status, 400);

    // Tidak dikirim = tidak diubah.
    assert.equal((await put({ ...base })).status, 200);
    row = sqlite.prepare('SELECT attendance_ref_latitude AS lat FROM stores WHERE id = ?').get(store.id);
    assert.equal(row.lat, -6.2);

    assert.equal((await put({ ...base, attendanceRefLatitude: '', attendanceRefLongitude: '' })).status, 200);
    row = sqlite.prepare('SELECT attendance_ref_latitude AS lat FROM stores WHERE id = ?').get(store.id);
    assert.equal(row.lat, null);
  } finally { sqlite.close(); }
});

async function seedFlagged(env, sqlite, store, cashier) {
  setReference(sqlite, store.id);
  await presensi(env, cashier, 'in', north(85));
  await presensi(env, cashier, 'out', null);
  return sqlite.prepare('SELECT id FROM staff_attendance').get().id;
}

test('alur permit: ajukan -> ACC memadamkan tanda dengan keterangan, status asli tetap jadi jejak', async () => {
  const { sqlite, env, store, cashier } = await setup();
  try {
    const attendanceId = await seedFlagged(env, sqlite, store, cashier);

    const created = await staffCall(env, cashier, 'POST', `/api/staff/attendance/${attendanceId}/gps-permits`, { which: 'IN', reason: 'GPS HP error, saya sudah di gerai' });
    assert.equal(created.status, 201);
    const permit = (await created.json()).permit;
    assert.equal(permit.status, 'PENDING');
    assert.equal(permit.overRadiusMeters, 10);
    assert.equal('originalDistanceMeters' in permit, false, 'karyawan tidak menerima jarak');

    const pending = await (await adminPermit(env, 'GET', '/api/admin/attendance-gps-permits')).json();
    assert.equal(pending.permits.length, 1);
    assert.equal(pending.permits[0].originalDistanceMeters, 85, 'Admin melihat jarak asli');
    assert.equal(pending.permits[0].requestedByName, 'Karyawan rina');

    const decided = await adminPermit(env, 'PATCH', `/api/admin/attendance-gps-permits/${permit.id}`, { decision: 'ACC', note: 'Dicek lewat CCTV, benar di gerai' });
    assert.equal(decided.status, 200);
    assert.equal((await decided.json()).permit.status, 'APPROVED');

    const row = sqlite.prepare('SELECT gps_in_status, gps_in_resolved_permit_id, gps_in_resolution_note, gps_out_resolved_permit_id FROM staff_attendance').get();
    assert.equal(row.gps_in_status, 'OUT_OF_RADIUS', 'status asli tetap tersimpan');
    assert.equal(row.gps_in_resolved_permit_id, permit.id);
    assert.match(row.gps_in_resolution_note, /GPS HP error/);
    assert.match(row.gps_in_resolution_note, /CCTV/);
    assert.equal(row.gps_out_resolved_permit_id, null, 'titik pulang tidak ikut padam');

    const portal = await (await staffCall(env, cashier, 'GET', '/api/staff/attendance-gps-permits')).json();
    assert.equal(portal.permits[0].status, 'APPROVED');
  } finally { sqlite.close(); }
});

test('permit ditolak: tanda tetap merah, wajib ada alasan, dan tidak bisa diajukan ulang untuk titik yang sama', async () => {
  const { sqlite, env, store, cashier } = await setup();
  try {
    const attendanceId = await seedFlagged(env, sqlite, store, cashier);
    const permit = (await (await staffCall(env, cashier, 'POST', `/api/staff/attendance/${attendanceId}/gps-permits`, { which: 'IN', reason: 'GPS HP error' })).json()).permit;

    const tanpaAlasan = await adminPermit(env, 'PATCH', `/api/admin/attendance-gps-permits/${permit.id}`, { decision: 'REJECT' });
    assert.equal(tanpaAlasan.status, 400);

    const rejected = await adminPermit(env, 'PATCH', `/api/admin/attendance-gps-permits/${permit.id}`, { decision: 'REJECT', note: 'Di CCTV tidak ada di gerai' });
    assert.equal(rejected.status, 200);
    assert.equal(sqlite.prepare('SELECT gps_in_resolved_permit_id FROM staff_attendance').get().gps_in_resolved_permit_id, null);

    const again = await staffCall(env, cashier, 'POST', `/api/staff/attendance/${attendanceId}/gps-permits`, { which: 'IN', reason: 'Tolong dicek lagi ya' });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).code, 'GPS_PERMIT_EXISTS');

    const decidedTwice = await adminPermit(env, 'PATCH', `/api/admin/attendance-gps-permits/${permit.id}`, { decision: 'ACC' });
    assert.equal(decidedTwice.status, 409);
  } finally { sqlite.close(); }
});

test('validasi pengajuan: alasan minimal, titik harus bermasalah, presensi milik sendiri, pulang butuh sesi selesai, permit gerai lain ditolak', async () => {
  const { sqlite, env, store, cashier } = await setup();
  try {
    setReference(sqlite, store.id);
    await presensi(env, cashier, 'in', north(20));
    const attendanceId = sqlite.prepare('SELECT id FROM staff_attendance').get().id;
    const url = `/api/staff/attendance/${attendanceId}/gps-permits`;

    const bersih = await staffCall(env, cashier, 'POST', url, { which: 'IN', reason: 'Tidak ada yang perlu diperbaiki' });
    assert.equal(bersih.status, 409);
    assert.equal((await bersih.json()).code, 'NOTHING_TO_FIX');

    const pulangBelum = await staffCall(env, cashier, 'POST', url, { which: 'OUT', reason: 'Belum pulang tapi mengajukan' });
    assert.equal(pulangBelum.status, 409);

    const whichSalah = await staffCall(env, cashier, 'POST', url, { which: 'X', reason: 'Titik tidak dikenal' });
    assert.equal(whichSalah.status, 400);

    await presensi(env, cashier, 'out', null); // pulang tanpa GPS -> merah
    const pendek = await staffCall(env, cashier, 'POST', url, { which: 'OUT', reason: 'abc' });
    assert.equal(pendek.status, 400);

    const orangLain = await seedCashier(sqlite, store.id, 'budi');
    const bukanMilik = await staffCall(env, orangLain, 'POST', url, { which: 'OUT', reason: 'Presensi ini bukan milik saya' });
    assert.equal(bukanMilik.status, 404);

    const ok = await staffCall(env, cashier, 'POST', url, { which: 'OUT', reason: 'GPS mati karena baterai habis' });
    assert.equal(ok.status, 201);
    const permit = (await ok.json()).permit;

    sqlite.prepare("INSERT INTO stores (id, code, store_name, address, is_active) VALUES ('store_lain', 'G099', 'Gerai Lain', '', 1)").run();
    const gerailain = await adminPermit(env, 'PATCH', `/api/admin/attendance-gps-permits/${permit.id}`, { decision: 'ACC' }, 'G099');
    assert.equal(gerailain.status, 403);
    assert.equal(sqlite.prepare('SELECT status FROM attendance_gps_permits').get().status, 'PENDING');
  } finally { sqlite.close(); }
});

test('tanda merah tampil di daftar presensi karyawan tanpa jarak; Admin mendapat jarak; ACC mengubah needsAttention jadi false', async () => {
  const { sqlite, env, store, cashier } = await setup();
  try {
    const attendanceId = await seedFlagged(env, sqlite, store, cashier);
    const { listAttendance, scheduleMap } = await import('../src/staff-attendance.js');
    const staffRows = await listAttendance(env.DB, cashier.id, scheduleMap([]), false);
    assert.equal(staffRows[0].checkIn.gps.status, 'OUT_OF_RADIUS');
    assert.equal(staffRows[0].checkIn.gps.needsAttention, true);
    assert.equal('distanceMeters' in staffRows[0].checkIn.gps, false);
    assert.doesNotMatch(JSON.stringify(staffRows), /"distanceMeters"/);
    const adminRows = await listAttendance(env.DB, cashier.id, scheduleMap([]), false, 60, { includeDistance: true });
    assert.equal(adminRows[0].checkIn.gps.distanceMeters, 85);

    const permit = (await (await staffCall(env, cashier, 'POST', `/api/staff/attendance/${attendanceId}/gps-permits`, { which: 'IN', reason: 'GPS HP error' })).json()).permit;
    await adminPermit(env, 'PATCH', `/api/admin/attendance-gps-permits/${permit.id}`, { decision: 'ACC', note: 'ok' });
    const after = await listAttendance(env.DB, cashier.id, scheduleMap([]), false);
    assert.equal(after[0].checkIn.gps.needsAttention, false);
    assert.match(after[0].checkIn.gps.resolved.note, /GPS HP error/);
    assert.equal(after[0].checkOut.gps.needsAttention, true);
  } finally { sqlite.close(); }
});

test('Laporan Presensi: ringkasan per karyawan + sesi bermasalah dengan jarak, status permit, dan GPS yang sudah di-ACC', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(at('13:05')).getTime() });
  const { sqlite, env, store, cashier } = await setup();
  try {
    const attendanceId = await seedFlagged(env, sqlite, store, cashier);
    // Sesi dibuat memakai jam mock (13:05, telat 4 jam dari shift 09:00).
    const permit = (await (await staffCall(env, cashier, 'POST', `/api/staff/attendance/${attendanceId}/gps-permits`, { which: 'IN', reason: 'GPS HP error' })).json()).permit;
    await adminPermit(env, 'PATCH', `/api/admin/attendance-gps-permits/${permit.id}`, { decision: 'ACC', note: 'ok' });
    await staffCall(env, cashier, 'POST', `/api/staff/attendance/${attendanceId}/gps-permits`, { which: 'OUT', reason: 'Baterai HP habis' });

    const report = await (await adminCall(env, handleAttendanceReportApi, 'GET', `/api/admin/attendance-report?from=${BUSINESS_DATE}&to=${BUSINESS_DATE}`)).json();
    assert.equal(report.totals.sessions, 1);
    assert.equal(report.totals.gpsOutOfRadius, 1);
    assert.equal(report.totals.gpsNoGps, 1);
    assert.equal(report.totals.gpsResolved, 1);
    assert.equal(report.totals.gpsStillRed, 1);
    assert.equal(report.totals.gpsPending, 1);
    assert.equal(report.totals.lateCount, 1);
    assert.equal(report.employees.length, 1);
    assert.equal(report.employees[0].employeeName, 'Karyawan rina');

    assert.equal(report.detail.length, 1);
    const [masuk, pulang] = report.detail[0].gps;
    assert.equal(masuk.which, 'IN');
    assert.equal(masuk.distanceMeters, 85);
    assert.equal(masuk.resolved, true);
    assert.match(masuk.resolutionNote, /GPS HP error/);
    assert.equal(masuk.permit.status, 'APPROVED');
    assert.equal(pulang.which, 'OUT');
    assert.equal(pulang.needsAttention, true);
    assert.equal(pulang.permit.status, 'PENDING');

    const other = await (await adminCall(env, handleAttendanceReportApi, 'GET', `/api/admin/attendance-report?from=${BUSINESS_DATE}&to=${BUSINESS_DATE}&requester=cashier_tidak_ada`)).json();
    assert.equal(other.totals.sessions, 0);
    const outside = await (await adminCall(env, handleAttendanceReportApi, 'GET', '/api/admin/attendance-report?from=2026-01-01&to=2026-01-02')).json();
    assert.equal(outside.totals.sessions, 0);
    assert.equal((await adminCall(env, handleAttendanceReportApi, 'GET', '/api/admin/attendance-report?from=2026-02-01&to=2026-01-01')).status, 400);
    assert.equal((await handleAttendanceReportApi(new Request('https://example.test/api/admin/attendance-report'), env, '/api/admin/attendance-report')).status, 401);
  } finally { sqlite.close(); }
});

test('Laporan Permit memuat kategori Perbaikan GPS Presensi dan Raport kasir menghitung GPS merah + di-ACC', async () => {
  const { sqlite, env, store, cashier } = await setup();
  try {
    const attendanceId = await seedFlagged(env, sqlite, store, cashier);
    const permit = (await (await staffCall(env, cashier, 'POST', `/api/staff/attendance/${attendanceId}/gps-permits`, { which: 'IN', reason: 'GPS HP error' })).json()).permit;

    const report = await (await adminCall(env, handlePermitReportApi, 'GET', `/api/admin/permit-report?category=ATTENDANCE_GPS`)).json();
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].categoryLabel, 'Perbaikan GPS Presensi');
    assert.match(report.rows[0].summary, /GPS presensi masuk: melebihi batas radius 10 meter/);
    assert.doesNotMatch(report.rows[0].summary, /75/);

    let facts = (await getCashierRaportFacts(env.DB, store.id, cashier.id)).facts.attendance.gps;
    assert.deepEqual(facts, { noGps: 1, outOfRadius: 1, resolved: 0, stillRed: 2 });

    await adminPermit(env, 'PATCH', `/api/admin/attendance-gps-permits/${permit.id}`, { decision: 'ACC', note: 'ok' });
    facts = (await getCashierRaportFacts(env.DB, store.id, cashier.id)).facts.attendance.gps;
    assert.deepEqual(facts, { noGps: 1, outOfRadius: 1, resolved: 1, stillRed: 1 });
  } finally { sqlite.close(); }
});

test('presensi lama (kolom GPS NULL) tidak ditandai merah dan tidak masuk hitungan laporan', async () => {
  const { sqlite, env, store, cashier } = await setup();
  try {
    sqlite.prepare(`
      INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status, check_out_at)
      VALUES ('lama', ?, ?, 'in', x'0102', 'image/jpeg', ?, 'CLOSED', ?)
    `).run(cashier.id, store.id, at('09:00'), at('17:00'));
    const report = await (await adminCall(env, handleAttendanceReportApi, 'GET', `/api/admin/attendance-report?from=${BUSINESS_DATE}&to=${BUSINESS_DATE}`)).json();
    assert.equal(report.totals.sessions, 1);
    assert.equal(report.totals.gpsStillRed, 0);
    assert.equal(report.detail.length, 0);
    assert.deepEqual((await getCashierRaportFacts(env.DB, store.id, cashier.id)).facts.attendance.gps, { noGps: 0, outOfRadius: 0, resolved: 0, stillRed: 0 });
  } finally { sqlite.close(); }
});

test('UI: kartu presensi staf + antrean Admin + tab Laporan Presensi + form titik acuan terpasang dengan versi ?v= baru', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const staffJs = read('../public/staff.js');
  assert.match(staffJs, /gpsBlockHtml/);
  assert.match(staffJs, /data-gps-fix/);
  assert.match(staffJs, /result\.gps\.notice/);
  assert.doesNotMatch(staffJs, /\b75\b.*meter|radius.*\b75\b/i, 'batas radius tidak boleh muncul di sisi karyawan');
  // Versi boleh lebih baru (fitur sesudahnya ikut membump staff.js), asal tidak mundur.
  assert.ok((read('../public/staff.html').match(/staff\.js\?v=([^"']+)/)?.[1] ?? '') >= '20261003-login-karyawan-v1');

  const adminCashiers = read('../public/admin-cashiers.js');
  assert.match(adminCashiers, /attendance-gps-permits/);
  assert.match(adminCashiers, /adminGpsBlockHtml/);

  const report = read('../public/admin-attendance-report.js');
  assert.match(report, /\/api\/admin\/attendance-report/);
  assert.match(report, /Laporan Presensi/);
  const html = read('../public/branch-admin.html');
  assert.match(html, /admin-attendance-report\.js\?v=20261001-laporan-presensi-v1/);
  assert.match(html, /admin-cashiers\.js\?v=20261001-gps-presensi-v1/);
  assert.match(html, /admin-cashier-raport\.js\?v=20261001-gps-presensi-v1/);
  assert.match(html, /admin\.js\?v=20261001-siap-jual-v3/);
  assert.match(read('../public/admin.js'), /storeRefUseHere/);
});
