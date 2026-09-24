import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminCashierApi } from '../src/cashier-auth.js';
import { handleStaffPortalApi } from '../src/staff-portal.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-24: "untuk konsep username ini kan ada kerjaan sebagai
// kasir atau sidak dsb. kalo kerjaannya itu misal kasir backup atau cs
// freelance ... intinya hal ini untuk menghindari di hari dan jam normal cs
// ini presensi memakai user backup, karna user backup itu gaji per jam nya
// lebih gede." Lalu: "untuk akun backup mending ikut entity aja, jadi bikin
// akunnya cuma 1 aja." Dua kebutuhan itu SATU mekanisme -- lihat migration
// 0115 dan src/entity-backup-cashiers.js untuk desain lengkapnya.

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

// PENDEM dan DERMO datang dari seed dengan entity_id masing-masing sendiri
// (satu entity per gerai) -- dipaksa berbagi SATU entity di sini murni untuk
// fixture test ini, sama seperti pola di entity-shared-accounts.test.js.
function mergeIntoSharedEntity(sqlite) {
  const entityId = 'entity_backup_test';
  sqlite.prepare(`INSERT INTO entities (id, name) VALUES (?, 'Entity Backup Test')`).run(entityId);
  sqlite.prepare(`UPDATE stores SET entity_id = ? WHERE id IN ('store_pendem', 'store_dermo')`).run(entityId);
  return entityId;
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

async function cashierToken(sqlite, cashierId) {
  const token = `cashier-token-${cashierId}`;
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, '2026-09-24T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), cashierId);
  return token;
}

async function createCashier(env, adminToken, store, body) {
  const path = '/api/admin/cashiers';
  const response = await handleAdminCashierApi(request(path, { token: adminToken, store, method: 'POST', body }), env, path);
  assert.equal(response.status, 201, `gagal bikin kasir: ${JSON.stringify(await response.clone().json())}`);
  return response.json();
}

async function listCashiers(env, adminToken, store) {
  const path = '/api/admin/cashiers';
  const response = await handleAdminCashierApi(request(path, { token: adminToken, store }), env, path);
  assert.equal(response.status, 200);
  return response.json();
}

async function activateToday(env, adminToken, store, cashierId) {
  const path = `/api/admin/cashiers/${encodeURIComponent(cashierId)}/activate-today`;
  return handleAdminCashierApi(request(path, { token: adminToken, store, method: 'POST' }), env, path);
}

function multipartAttendanceBody(type) {
  const form = new FormData();
  form.set('type', type);
  form.set('photo', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'photo.jpg');
  return form;
}

async function checkIn(env, staffToken, type = 'in') {
  const path = '/api/staff/attendance';
  const url = new URL(`https://example.test${path}`);
  const req = new Request(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` },
    body: multipartAttendanceBody(type)
  });
  return handleStaffPortalApi(req, env, path);
}

test('Akun backup entity kelihatan di Master Kasir gerai sesama entity, bukan cuma gerai tempat dibuat', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    mergeIntoSharedEntity(sqlite);
    const pendemToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const dermoToken = await storeAdminToken(sqlite, 'admin_dermo_0080');
    const backup = await createCashier(env, pendemToken, 'PENDEM', {
      username: 'cs_backup_1', password: 'rahasia1', employeeName: 'CS Backup Satu', isEntityBackup: true
    });

    const fromDermo = await listCashiers(env, dermoToken, 'DERMO');
    const seen = fromDermo.cashiers.find(row => row.id === backup.id);
    assert.ok(seen, 'akun backup dari gerai lain sesama entity wajib kelihatan');
    assert.equal(seen.isEntityBackup, true);
    assert.equal(seen.todayActivation, null, 'belum diaktifkan hari ini');
  } finally { sqlite.close(); }
});

test('Aktivasi memindahkan store_id akun backup + tercatat, dan aktivasi kedua di gerai sama tidak dobel baris', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    mergeIntoSharedEntity(sqlite);
    const pendemToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const dermoToken = await storeAdminToken(sqlite, 'admin_dermo_0080');
    const backup = await createCashier(env, pendemToken, 'PENDEM', {
      username: 'cs_backup_2', password: 'rahasia1', employeeName: 'CS Backup Dua', isEntityBackup: true
    });

    const activateResponse = await activateToday(env, dermoToken, 'DERMO', backup.id);
    assert.equal(activateResponse.status, 200, JSON.stringify(await activateResponse.clone().json()));
    const activatePayload = await activateResponse.json();
    assert.equal(activatePayload.alreadyActive, false);

    const cashierRow = sqlite.prepare('SELECT store_id FROM cashiers WHERE id = ?').get(backup.id);
    assert.equal(cashierRow.store_id, 'store_dermo', 'store_id akun harus pindah ke gerai pengaktif');

    const activationRows = sqlite.prepare('SELECT * FROM account_daily_activations WHERE account_id = ?').all(backup.id);
    assert.equal(activationRows.length, 1);
    assert.equal(activationRows[0].store_id, 'store_dermo');
    assert.equal(activationRows[0].activated_by_role, 'ADMIN');

    const secondActivate = await activateToday(env, dermoToken, 'DERMO', backup.id);
    assert.equal(secondActivate.status, 200);
    const secondPayload = await secondActivate.json();
    assert.equal(secondPayload.alreadyActive, true, 'aktivasi kedua di gerai yang sama bukan error, cuma no-op');
    const activationRowsAfter = sqlite.prepare('SELECT * FROM account_daily_activations WHERE account_id = ?').all(backup.id);
    assert.equal(activationRowsAfter.length, 1, 'tidak boleh ada baris dobel untuk hari yang sama');
  } finally { sqlite.close(); }
});

test('Satu akun backup cuma bisa aktif di satu gerai per hari -- aktivasi gerai lain di hari sama ditolak', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    mergeIntoSharedEntity(sqlite);
    const pendemToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const dermoToken = await storeAdminToken(sqlite, 'admin_dermo_0080');
    const backup = await createCashier(env, pendemToken, 'PENDEM', {
      username: 'cs_backup_3', password: 'rahasia1', employeeName: 'CS Backup Tiga', isEntityBackup: true
    });

    const activateDermo = await activateToday(env, dermoToken, 'DERMO', backup.id);
    assert.equal(activateDermo.status, 200);

    const activatePendemAgain = await activateToday(env, pendemToken, 'PENDEM', backup.id);
    assert.equal(activatePendemAgain.status, 400);
    const errorPayload = await activatePendemAgain.json();
    assert.match(errorPayload.error, /sudah diaktifkan untuk gerai lain/);

    const cashierRow = sqlite.prepare('SELECT store_id FROM cashiers WHERE id = ?').get(backup.id);
    assert.equal(cashierRow.store_id, 'store_dermo', 'gagal pindah ke gerai kedua -- tetap di gerai yang sudah aktif');
  } finally { sqlite.close(); }
});

test('Presensi masuk akun backup ditolak sebelum diaktivasi Admin hari ini, diizinkan setelah diaktivasi', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    mergeIntoSharedEntity(sqlite);
    const pendemToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const backup = await createCashier(env, pendemToken, 'PENDEM', {
      username: 'cs_backup_4', password: 'rahasia1', employeeName: 'CS Backup Empat', isEntityBackup: true
    });
    const staffToken = await cashierToken(sqlite, backup.id);

    const blocked = await checkIn(env, staffToken, 'in');
    assert.equal(blocked.status, 403);
    const blockedPayload = await blocked.json();
    assert.equal(blockedPayload.code, 'BACKUP_NOT_ACTIVATED');

    const activateResponse = await activateToday(env, pendemToken, 'PENDEM', backup.id);
    assert.equal(activateResponse.status, 200);

    const allowed = await checkIn(env, staffToken, 'in');
    assert.equal(allowed.status, 201, JSON.stringify(await allowed.clone().json()));
  } finally { sqlite.close(); }
});

test('Kasir biasa (bukan akun backup) tetap bisa presensi masuk tanpa aktivasi apa pun -- gerbang ini cuma untuk akun backup', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const pendemToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const normal = await createCashier(env, pendemToken, 'PENDEM', { username: 'cs_biasa_1', password: 'rahasia1', employeeName: 'CS Biasa Satu' });
    const staffToken = await cashierToken(sqlite, normal.id);

    const response = await checkIn(env, staffToken, 'in');
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  } finally { sqlite.close(); }
});

test('Admin di luar entity tidak bisa melihat maupun mengaktifkan akun backup entity lain', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    mergeIntoSharedEntity(sqlite);
    const pendemToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const outsiderToken = await storeAdminToken(sqlite, 'admin_kaliurang_0080');
    const backup = await createCashier(env, pendemToken, 'PENDEM', {
      username: 'cs_backup_5', password: 'rahasia1', employeeName: 'CS Backup Lima', isEntityBackup: true
    });

    const outsiderList = await listCashiers(env, outsiderToken, 'KALIURANG');
    assert.ok(!outsiderList.cashiers.some(row => row.id === backup.id), 'akun backup entity lain tidak boleh terlihat');

    const outsiderActivate = await activateToday(env, outsiderToken, 'KALIURANG', backup.id);
    assert.equal(outsiderActivate.status, 403);
  } finally { sqlite.close(); }
});
