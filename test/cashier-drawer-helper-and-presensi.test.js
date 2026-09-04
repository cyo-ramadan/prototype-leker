import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierDrawerApi } from '../src/cashier-drawer.js';
import { handleCashierAuthApi } from '../src/cashier-auth.js';
import { hashCredential } from '../src/owner-auth.js';

// 2026-09-04, Bos Cyo: two cashiers of the same store may log in and presensi
// (attendance) at the same time -- that part was never blocked. What stays
// exclusive is ENTRY: only the cashier who opened the drawer may write
// transactions; a cashier who did not open it stays read-only (unchanged
// design, first attempt this session wrongly loosened it and was corrected).
// What's new is a three-state login workflow: (1) logged in only, (2) logged
// in + presensi masuk, (3) logged in + presensi + opened the drawer -- and
// opening the drawer now requires presensi to have happened first. These
// tests exercise all of that against a real migrated in-memory DB, not just
// source-string assertions, since this touches authorization.

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
    INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at)
    VALUES (?, ?, ?, 'in', x'00', 'image/jpeg', ?)
  `).run(`att_${cashierId}_${at}`, cashierId, storeId, at);
}

function request(pathname, { token, method = 'GET', body } = {}) {
  return new Request(`https://example.test${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

test('a cashier must presensi masuk before opening the drawer', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'store_001', 'belumpresensi', 'Kasir Belum Presensi');
    const env = { DB: new D1Database(db) };

    const blockedRes = await handleCashierDrawerApi(
      request('/api/cashier/drawer/open', { token: cashier.token, method: 'POST', body: { openingAmount: 100000 } }),
      env, '/api/cashier/drawer/open'
    );
    assert.equal(blockedRes.status, 403);
    assert.equal((await blockedRes.json()).code, 'PRESENSI_REQUIRED');

    markPresensiIn(db, cashier.id, 'store_001');
    const openRes = await handleCashierDrawerApi(
      request('/api/cashier/drawer/open', { token: cashier.token, method: 'POST', body: { openingAmount: 100000 } }),
      env, '/api/cashier/drawer/open'
    );
    assert.equal(openRes.status, 201, 'after presensi masuk, opening the drawer must succeed');
  } finally {
    db.close();
  }
});

test('only the drawer opener can write transactions; a second logged-in and presensi-ed cashier stays read-only', async () => {
  const db = migratedDatabase();
  try {
    const owner = await seedCashier(db, 'store_001', 'penanggungjawab', 'Kasir Penanggung Jawab');
    const other = await seedCashier(db, 'store_001', 'kasirlain', 'Kasir Lain');
    markPresensiIn(db, owner.id, 'store_001');
    markPresensiIn(db, other.id, 'store_001');
    const env = { DB: new D1Database(db) };

    const openRes = await handleCashierDrawerApi(
      request('/api/cashier/drawer/open', { token: owner.token, method: 'POST', body: { openingAmount: 100000 } }),
      env, '/api/cashier/drawer/open'
    );
    assert.equal(openRes.status, 201);

    // the other cashier logged in and presensi-ed fine, but is still read-only for entry
    const otherDrawer = await (await handleCashierDrawerApi(request('/api/cashier/drawer', { token: other.token }), env, '/api/cashier/drawer')).json();
    assert.equal(otherDrawer.canWrite, false, 'a cashier who did not open the drawer stays read-only');

    const blockedExpenseRes = await handleCashierDrawerApi(
      request('/api/cashier/expenses', { token: other.token, method: 'POST', body: { description: 'Beli es batu', amount: 15000 } }),
      env, '/api/cashier/expenses'
    );
    assert.equal(blockedExpenseRes.status, 403);
    assert.equal((await blockedExpenseRes.json()).code, 'DRAWER_OWNED_BY_OTHER');

    // the owner can write normally
    const ownerExpenseRes = await handleCashierDrawerApi(
      request('/api/cashier/expenses', { token: owner.token, method: 'POST', body: { description: 'Beli es batu', amount: 15000 } }),
      env, '/api/cashier/expenses'
    );
    assert.equal(ownerExpenseRes.status, 201);

    // and a second drawer for the store is still rejected outright
    const secondOpenRes = await handleCashierDrawerApi(
      request('/api/cashier/drawer/open', { token: other.token, method: 'POST', body: { openingAmount: 50000 } }),
      env, '/api/cashier/drawer/open'
    );
    assert.equal(secondOpenRes.status, 409);
    assert.equal((await secondOpenRes.json()).code, 'DRAWER_ALREADY_OPEN');
  } finally {
    db.close();
  }
});

test('cashier me/login report attendance status derived from the latest staff_attendance row', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'store_001', 'presensitest', 'Kasir Presensi');
    const env = { DB: new D1Database(db) };

    const beforeCheckin = await (await handleCashierAuthApi(request('/api/cashier/me', { token: cashier.token }), env, '/api/cashier/me')).json();
    assert.equal(beforeCheckin.attendanceStatus, 'out', 'no attendance recorded yet means not checked in');

    markPresensiIn(db, cashier.id, 'store_001');
    const afterCheckin = await (await handleCashierAuthApi(request('/api/cashier/me', { token: cashier.token }), env, '/api/cashier/me')).json();
    assert.equal(afterCheckin.attendanceStatus, 'in');

    db.prepare(`
      INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at)
      VALUES ('att_out', ?, 'store_001', 'out', x'00', 'image/jpeg', '2026-09-04T09:00:00.000Z')
    `).run(cashier.id);
    const afterCheckout = await (await handleCashierAuthApi(request('/api/cashier/me', { token: cashier.token }), env, '/api/cashier/me')).json();
    assert.equal(afterCheckout.attendanceStatus, 'out', 'checking out again requires presensi masuk before working again');
  } finally {
    db.close();
  }
});

test('login response also carries attendanceStatus so the client can gate right after login', () => {
  const authSource = readFileSync(new URL('../src/cashier-auth.js', import.meta.url), 'utf8');
  assert.match(authSource, /attendanceStatus: await latestAttendanceStatus\(db, row\.id\)/);
  assert.match(authSource, /attendanceStatus: await latestAttendanceStatus\(db, auth\.cashier\.id\)/);
});

test('opening the drawer is gated on presensi masuk, using the same attendance helper as login/me', () => {
  const drawerSource = readFileSync(new URL('../src/cashier-drawer.js', import.meta.url), 'utf8');
  assert.match(drawerSource, /latestAttendanceStatus\(db, cashier\.id\) !== 'in'/);
  assert.match(drawerSource, /PRESENSI_REQUIRED/);
  // entry stays exclusive to the drawer opener -- this must never come back
  // without an explicit new instruction, see the comment above requireDrawerOwner.
  assert.doesNotMatch(drawerSource, /requireOpenDrawer/);
});

test('cashier page gates the dashboard behind a mandatory presensi masuk step after login', () => {
  const html = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');
  const gateUi = readFileSync(new URL('../public/cashier-presensi-gate.js', import.meta.url), 'utf8');
  assert.match(html, /id="cashierPresensiGate"/);
  assert.match(html, /cashier-presensi-gate\.js/);
  assert.match(gateUi, /const proceedToDashboard = openDashboard;/);
  assert.match(gateUi, /openDashboard = async function gatedOpenDashboard/);
  assert.match(gateUi, /api\('\/api\/cashier\/me'\)/);
  assert.match(gateUi, /form\.set\('type', 'in'\)/);
  assert.match(gateUi, /api\('\/api\/staff\/attendance', \{ method: 'POST', body: form \}\)/);
});
