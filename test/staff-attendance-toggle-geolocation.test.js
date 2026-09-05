import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleStaffPortalApi } from '../src/staff-portal.js';
import { hashCredential } from '../src/owner-auth.js';

// 2026-09-04, Bos Cyo: (1) presensi masuk/keluar adalah toggle -- tidak boleh
// presensi masuk dua kali berturut-turut tanpa presensi keluar di antaranya,
// dan tidak bisa presensi keluar sebelum presensi masuk; (2) foto presensi
// sekarang boleh menyertakan koordinat GPS + akurasi, disimpan terpisah dari
// pixel foto supaya bisa diquery, bukan cuma di-watermark ke gambarnya.

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  boundParams() {
    // node:sqlite (unlike the real D1 binding) rejects a raw ArrayBuffer for
    // a BLOB parameter -- readLivePhoto() returns photo.bytes as one. Coerce
    // to Uint8Array here so the real production handler can be exercised
    // as-is instead of duplicating its INSERT with a raw x'..' SQL literal.
    return this.params.map(value => (value instanceof ArrayBuffer ? new Uint8Array(value) : value));
  }
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

function attendanceRequest({ token, type, latitude, longitude, accuracy, withPhoto = true }) {
  const form = new FormData();
  form.set('type', type);
  if (withPhoto) form.set('photo', new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' }), 'test.jpg');
  if (latitude != null) form.set('latitude', String(latitude));
  if (longitude != null) form.set('longitude', String(longitude));
  if (accuracy != null) form.set('accuracy', String(accuracy));
  return new Request('https://example.test/api/staff/attendance', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

function portalRequest(token) {
  return new Request('https://example.test/api/staff/portal', { headers: { Authorization: `Bearer ${token}` } });
}

test('presensi masuk/keluar enforces toggle sequence', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'store_001', 'togglecheck', 'Kasir Toggle');
    const env = { DB: new D1Database(db) };

    const outBeforeIn = await handleStaffPortalApi(attendanceRequest({ token: cashier.token, type: 'out' }), env, '/api/staff/attendance');
    assert.equal(outBeforeIn.status, 409);
    assert.equal((await outBeforeIn.json()).code, 'NOT_CHECKED_IN');

    const firstIn = await handleStaffPortalApi(attendanceRequest({ token: cashier.token, type: 'in' }), env, '/api/staff/attendance');
    assert.equal(firstIn.status, 201);

    const secondIn = await handleStaffPortalApi(attendanceRequest({ token: cashier.token, type: 'in' }), env, '/api/staff/attendance');
    assert.equal(secondIn.status, 409);
    assert.equal((await secondIn.json()).code, 'ALREADY_CHECKED_IN');

    const out = await handleStaffPortalApi(attendanceRequest({ token: cashier.token, type: 'out' }), env, '/api/staff/attendance');
    assert.equal(out.status, 201);

    const secondOut = await handleStaffPortalApi(attendanceRequest({ token: cashier.token, type: 'out' }), env, '/api/staff/attendance');
    assert.equal(secondOut.status, 409);
    assert.equal((await secondOut.json()).code, 'NOT_CHECKED_IN');

    const inAgain = await handleStaffPortalApi(attendanceRequest({ token: cashier.token, type: 'in' }), env, '/api/staff/attendance');
    assert.equal(inAgain.status, 201, 'checking out unlocks checking in again');
  } finally {
    db.close();
  }
});

test('presensi stores GPS coordinates and accuracy, nullable when unavailable', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'store_001', 'geocheck', 'Kasir Geo');
    const env = { DB: new D1Database(db) };

    const withGeo = await handleStaffPortalApi(
      attendanceRequest({ token: cashier.token, type: 'in', latitude: -7.98281, longitude: 112.6296, accuracy: 12.5 }),
      env, '/api/staff/attendance'
    );
    assert.equal(withGeo.status, 201);
    const withGeoBody = await withGeo.json();
    assert.equal(withGeoBody.attendance.status, 'OPEN');
    assert.equal(withGeoBody.attendance.checkIn.latitude, -7.98281);
    assert.equal(withGeoBody.attendance.checkIn.longitude, 112.6296);
    assert.equal(withGeoBody.attendance.checkIn.accuracyMeters, 12.5);

    const row = db.prepare('SELECT latitude, longitude, location_accuracy_meters FROM staff_attendance WHERE id = ?').get(withGeoBody.attendance.id);
    assert.equal(row.latitude, -7.98281);
    assert.equal(row.longitude, 112.6296);

    const checkout = await handleStaffPortalApi(attendanceRequest({ token: cashier.token, type: 'out' }), env, '/api/staff/attendance');
    const checkoutBody = await checkout.json();
    assert.equal(checkoutBody.attendance.status, 'CLOSED');
    assert.equal(checkoutBody.attendance.checkIn.latitude, -7.98281, 'check-in facts stay on the same row after checking out');
    assert.equal(checkoutBody.attendance.checkOut.latitude, null, 'no GPS sent on checkout -- stays null');

    const withoutGeo = await handleStaffPortalApi(attendanceRequest({ token: cashier.token, type: 'in' }), env, '/api/staff/attendance');
    const withoutGeoBody = await withoutGeo.json();
    assert.equal(withoutGeoBody.attendance.checkIn.latitude, null, 'GPS denied/unavailable must not block presensi -- coordinates stay null');
  } finally {
    db.close();
  }
});

test('staff portal reports attendanceStatus and location alongside the attendance list', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'store_001', 'portalgeo', 'Kasir Portal Geo');
    const env = { DB: new D1Database(db) };

    const beforeCheckin = await (await handleStaffPortalApi(portalRequest(cashier.token), env, '/api/staff/portal')).json();
    assert.equal(beforeCheckin.attendanceStatus, 'out');

    await handleStaffPortalApi(attendanceRequest({ token: cashier.token, type: 'in', latitude: 1.5, longitude: 2.5, accuracy: 8 }), env, '/api/staff/attendance');
    const afterCheckin = await (await handleStaffPortalApi(portalRequest(cashier.token), env, '/api/staff/portal')).json();
    assert.equal(afterCheckin.attendanceStatus, 'in');
    assert.equal(afterCheckin.attendance[0].status, 'OPEN');
    assert.equal(afterCheckin.attendance[0].checkIn.latitude, 1.5);
    assert.equal(afterCheckin.attendance[0].checkIn.longitude, 2.5);
    assert.equal(afterCheckin.attendance[0].checkOut, null, 'still one row, not yet closed');
  } finally {
    db.close();
  }
});

test('migration adds nullable GPS columns to staff_attendance', () => {
  const migration = readFileSync(new URL('../migrations/0067_staff_attendance_geolocation.sql', import.meta.url), 'utf8');
  assert.match(migration, /ALTER TABLE staff_attendance ADD COLUMN latitude REAL/);
  assert.match(migration, /ALTER TABLE staff_attendance ADD COLUMN longitude REAL/);
  assert.match(migration, /ALTER TABLE staff_attendance ADD COLUMN location_accuracy_meters REAL/);
});

test('migration 0068 reshapes staff_attendance into one row per shift and backfills pre-existing rows', () => {
  const migration = readFileSync(new URL('../migrations/0068_staff_attendance_shift_row.sql', import.meta.url), 'utf8');
  assert.match(migration, /ALTER TABLE staff_attendance ADD COLUMN status TEXT/);
  assert.match(migration, /ALTER TABLE staff_attendance ADD COLUMN check_out_at TEXT/);
  assert.match(migration, /ALTER TABLE staff_attendance ADD COLUMN check_out_photo_blob BLOB/);
  assert.match(migration, /UPDATE staff_attendance/);
  assert.match(migration, /WHERE status IS NULL/);

  // Apply every migration except 0068, seed rows in the OLD event-log shape
  // (one row per masuk/keluar action, no status column yet -- this is what
  // production actually had before this migration), then apply 0068 alone
  // and check the backfill turns each pre-existing row into a sensible
  // status without losing it.
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const files = readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
  for (const file of files) {
    if (file.startsWith('0068_')) continue;
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  // cashier_wowo/store_001 are seeded by migration 0005 -- reused here just
  // to satisfy the FK, not relevant to what this test actually checks.
  db.prepare(`
    INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at)
    VALUES ('legacy_in', 'cashier_wowo', 'store_001', 'in', x'00', 'image/jpeg', '2026-08-01T01:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at)
    VALUES ('legacy_out', 'cashier_wowo', 'store_001', 'out', x'00', 'image/jpeg', '2026-08-01T02:00:00.000Z')
  `).run();

  db.exec(migration);

  const legacyIn = db.prepare('SELECT status FROM staff_attendance WHERE id = ?').get('legacy_in');
  const legacyOut = db.prepare('SELECT status FROM staff_attendance WHERE id = ?').get('legacy_out');
  assert.equal(legacyIn.status, 'OPEN', 'a dangling legacy in-row keeps counting as an open shift after backfill');
  assert.equal(legacyOut.status, 'CLOSED');
  db.close();
});

test('camera modal captures geolocation and burns a timestamp+location watermark when requested', () => {
  const cameraSource = readFileSync(new URL('../public/camera-snapshot-modal.js', import.meta.url), 'utf8');
  assert.match(cameraSource, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(cameraSource, /function drawWatermark/);
  assert.match(cameraSource, /watermarkEnabled/);
  assert.match(cameraSource, /success\?\.\(blob, \{ latitude: geo\?\.latitude/);
});

test('staff portal UI passes watermark:true, forwards GPS fields, disables the wrong presensi button, renders one row per shift, and links out to the Workboard', () => {
  const staffUi = readFileSync(new URL('../public/staff.js', import.meta.url), 'utf8');
  const staffHtml = readFileSync(new URL('../public/staff.html', import.meta.url), 'utf8');
  const gateUi = readFileSync(new URL('../public/cashier-presensi-gate.js', import.meta.url), 'utf8');
  assert.match(staffUi, /watermark: true/);
  assert.match(staffUi, /form\.set\('latitude', String\(geo\.latitude\)\)/);
  assert.match(staffUi, /el\('attendanceInBtn'\)\.disabled = checkedIn/);
  assert.match(staffUi, /el\('attendanceOutBtn'\)\.disabled = !checkedIn/);
  assert.match(staffUi, /row\.checkIn/);
  assert.match(staffUi, /row\.checkOut/);
  assert.match(staffUi, /facts\.attendance\?\.closed/);
  assert.match(staffUi, /facts\.attendance\?\.open/);
  assert.match(staffHtml, /program-task\.daily-napkin\.workers\.dev/);
  assert.match(staffHtml, /Maxi Store Workboard/);
  assert.match(gateUi, /watermark: true/);
  assert.match(gateUi, /form\.set\('latitude', String\(geo\.latitude\)\)/);
});
