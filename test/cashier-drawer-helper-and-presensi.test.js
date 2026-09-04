import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierDrawerApi } from '../src/cashier-drawer.js';
import { handleCashierAuthApi } from '../src/cashier-auth.js';
import { hashCredential } from '../src/owner-auth.js';

// 2026-09-04, Bos Cyo: two cashiers of the same store may be logged in at
// once. The drawer itself stays exclusive (one OPEN drawer per store), but a
// second cashier who is NOT the drawer opener should still be able to help
// with real transactions instead of being forced read-only -- only the
// drawer opener (penanggung jawab) can close it. Workflow after login is
// also now supposed to require presensi masuk first. These tests exercise
// both changes against a real migrated in-memory DB, not just source-string
// assertions, since this touches authorization and actor attribution.

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

test('helper cashier can write while another cashier holds the drawer, attributed to their own account, but only the opener can close it', async () => {
  const db = migratedDatabase();
  try {
    const owner = await seedCashier(db, 'store_001', 'penanggungjawab', 'Kasir Penanggung Jawab');
    const helper = await seedCashier(db, 'store_001', 'bantu', 'Kasir Bantu');
    const env = { DB: new D1Database(db) };

    const openRes = await handleCashierDrawerApi(
      request('/api/cashier/drawer/open', { token: owner.token, method: 'POST', body: { openingAmount: 100000 } }),
      env, '/api/cashier/drawer/open'
    );
    assert.equal(openRes.status, 201);

    const helperDrawer = await (await handleCashierDrawerApi(request('/api/cashier/drawer', { token: helper.token }), env, '/api/cashier/drawer')).json();
    assert.equal(helperDrawer.canWrite, true, 'helper must not be forced read-only anymore');
    assert.equal(helperDrawer.isDrawerOwner, false, 'helper is not the responsible party');

    const ownerDrawer = await (await handleCashierDrawerApi(request('/api/cashier/drawer', { token: owner.token }), env, '/api/cashier/drawer')).json();
    assert.equal(ownerDrawer.canWrite, true);
    assert.equal(ownerDrawer.isDrawerOwner, true);

    const expenseRes = await handleCashierDrawerApi(
      request('/api/cashier/expenses', { token: helper.token, method: 'POST', body: { description: 'Beli es batu', amount: 15000 } }),
      env, '/api/cashier/expenses'
    );
    assert.equal(expenseRes.status, 201);
    const expenseBody = await expenseRes.json();
    const expenseRow = db.prepare('SELECT cashier_id, drawer_session_id FROM expenses WHERE id = ?').get(expenseBody.id);
    assert.equal(expenseRow.cashier_id, helper.id, 'transaction stays attributed to the acting cashier, not the drawer owner');
    assert.equal(expenseRow.drawer_session_id, ownerDrawer.drawer.id, 'transaction still links to the one shared drawer session for reconciliation');

    const helperCloseRes = await handleCashierDrawerApi(
      request('/api/cashier/drawer/close', { token: helper.token, method: 'POST', body: { closingAmount: 100000 } }),
      env, '/api/cashier/drawer/close'
    );
    assert.equal(helperCloseRes.status, 403);
    assert.equal((await helperCloseRes.json()).code, 'DRAWER_OWNED_BY_OTHER');

    const secondOpenRes = await handleCashierDrawerApi(
      request('/api/cashier/drawer/open', { token: helper.token, method: 'POST', body: { openingAmount: 50000 } }),
      env, '/api/cashier/drawer/open'
    );
    assert.equal(secondOpenRes.status, 409, 'the drawer itself stays exclusive -- only opening/closing it, not writing, becomes shared');
    assert.equal((await secondOpenRes.json()).code, 'DRAWER_ALREADY_OPEN');

    const ownerCloseRes = await handleCashierDrawerApi(
      request('/api/cashier/drawer/close', { token: owner.token, method: 'POST', body: { closingAmount: 115000 } }),
      env, '/api/cashier/drawer/close'
    );
    assert.equal(ownerCloseRes.status, 200);
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

    db.prepare(`
      INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at)
      VALUES ('att_in', ?, 'store_001', 'in', x'00', 'image/jpeg', '2026-09-04T01:00:00.000Z')
    `).run(cashier.id);
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
