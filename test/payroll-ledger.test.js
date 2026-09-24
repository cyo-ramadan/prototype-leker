import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleStaffPortalApi } from '../src/staff-portal.js';
import { handleAdminOperationalExpenseApi } from '../src/admin-operational-expense.js';
import { handleEmployeeMasterApi } from '../src/employee-master.js';
import { getNetProfitReport } from '../src/net-profit-report.js';
import { recordAttendanceAccrual } from '../src/payroll-ledger.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-24 (koreksi atas Penyesuaian Gaji): "harusnya entry gaji
// cukup yang di operasional itu kan bisa ... bikin semacam akun gaji, dan
// apabila menyentuh itu harus cek juga employ dan nama karyawan itu ...
// (pastikan tanggungan gaji per gerai walaupun memakai user bersama) ...
// riwayat gaji itu mending acuannya per nama orang aja ... model akun gaji
// ini sebaiknya mengikuti konsep debet dan kredit." Lalu soal presensi
// harian: "kalo dalam akuntansi ketika ada gaji harian itu jurnalnya debet
// beban gaji kredit hutang gaji ... jadi harusnya nominal di sesi jam
// harian itu uda mencetak beban dan hutang gaji."

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
  const id = `cashier_pl_${username}`;
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

function seedJobDetail(db, cashierId, { hourlyWage = 50000, paymentType = 'SESI' } = {}) {
  db.prepare(`
    INSERT INTO account_job_details (account_type, account_id, hourly_wage_scaled, job_type, payment_type, updated_at)
    VALUES ('CASHIER', ?, ?, '', ?, CURRENT_TIMESTAMP)
  `).run(cashierId, Math.round(hourlyWage * 1_000_000), paymentType);
}

function seedEmployee(db, entityId, fullName) {
  const id = `emp_pl_${Math.random().toString(36).slice(2)}`;
  db.prepare(`
    INSERT INTO employees (id, entity_id, full_name, status, created_at, updated_at)
    VALUES (?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(id, entityId, fullName);
  return id;
}

function linkEmployee(db, employeeId, entityId, accountId, storeId, effectiveFrom, effectiveTo = null) {
  const id = `emplink_pl_${Math.random().toString(36).slice(2)}`;
  db.prepare(`
    INSERT INTO employee_account_links (id, employee_id, entity_id, account_type, account_id, store_id, effective_from, effective_to, created_at)
    VALUES (?, ?, ?, 'CASHIER', ?, ?, ?, ?, ?)
  `).run(id, employeeId, entityId, accountId, storeId, effectiveFrom, effectiveTo, effectiveFrom);
  return id;
}

async function seedAdminToken(db, adminId) {
  const token = `emp-admin-${adminId}`;
  db.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, '2026-06-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), adminId);
  return token;
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

async function checkIn(env, token) {
  return handleStaffPortalApi(attendanceRequest({ token, type: 'in' }), env, '/api/staff/attendance');
}
async function checkOut(env, token) {
  return handleStaffPortalApi(attendanceRequest({ token, type: 'out' }), env, '/api/staff/attendance');
}

function backdateOpenSession(db, cashierId, createdAtIso) {
  db.prepare(`UPDATE staff_attendance SET created_at = ? WHERE user_id = ? AND status = 'OPEN'`).run(createdAtIso, cashierId);
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

test('Sesi presensi SELESAI otomatis mencatat ACCRUAL ke Akun Gaji dan menambah Beban Gaji di Rugi Laba', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const pendem = storeRow(db, 'PENDEM');
    const cashier = await seedCashier(db, pendem.id, 'akrual1', 'CS Akrual Satu');
    seedJobDetail(db, cashier.id, { hourlyWage: 75000, paymentType: 'SESI' });
    const employeeId = seedEmployee(db, pendem.entity_id, 'Rika Akrual');
    linkEmployee(db, employeeId, pendem.entity_id, cashier.id, pendem.id, '2026-09-24T00:00:00.000Z');

    const inRes = await checkIn(env, cashier.token);
    assert.equal(inRes.status, 201);
    const outRes = await checkOut(env, cashier.token);
    assert.equal(outRes.status, 201);

    const rows = db.prepare(`SELECT * FROM payroll_ledger_entries WHERE account_id = ?`).all(cashier.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].entry_type, 'ACCRUAL');
    assert.equal(rows[0].employee_id, employeeId);
    assert.equal(rows[0].hutang_gaji_delta_scaled, 75000 * 1_000_000);
    assert.equal(rows[0].beban_gaji_delta_scaled, 75000 * 1_000_000);
    assert.equal(rows[0].store_id, pendem.id);

    const businessDate = rows[0].business_date;
    const { netProfitByKey } = await getNetProfitReport(env.DB, {
      storeIds: [pendem.id], from: businessDate, to: businessDate, today: '2099-01-01'
    });
    assert.equal(netProfitByKey.get(`${pendem.id}::${businessDate}`), -75000, 'akrual presensi harus mengurangi Rugi Laba gerai itu di tanggal itu');
  } finally { db.close(); }
});

test('Akun yang belum ditautkan ke Master Karyawan tetap tercatat (employee_id kosong), tidak diblokir dari presensi', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const pendem = storeRow(db, 'PENDEM');
    const cashier = await seedCashier(db, pendem.id, 'akrual2', 'CS Akrual Dua');
    seedJobDetail(db, cashier.id, { hourlyWage: 60000, paymentType: 'SESI' });

    const inRes = await checkIn(env, cashier.token);
    assert.equal(inRes.status, 201);
    const outRes = await checkOut(env, cashier.token);
    assert.equal(outRes.status, 201);

    const rows = db.prepare(`SELECT * FROM payroll_ledger_entries WHERE account_id = ?`).all(cashier.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].employee_id, null, 'belum ditautkan -- uangnya tetap tercatat, employee_id kosong');
  } finally { db.close(); }
});

test('Tanpa detail gaji (jobDetail belum diisi), presensi tidak mencatat apa pun ke Akun Gaji', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const pendem = storeRow(db, 'PENDEM');
    const cashier = await seedCashier(db, pendem.id, 'akrual3', 'CS Akrual Tiga');

    await checkIn(env, cashier.token);
    await checkOut(env, cashier.token);

    const rows = db.prepare(`SELECT * FROM payroll_ledger_entries WHERE account_id = ?`).all(cashier.id);
    assert.equal(rows.length, 0);
  } finally { db.close(); }
});

test('recordAttendanceAccrual idempotent -- dipanggil dua kali untuk sesi yang sama tidak dobel Beban Gaji', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const pendem = storeRow(db, 'PENDEM');
    const params = {
      accountType: 'CASHIER', accountId: 'cashier_x', storeId: pendem.id,
      businessDate: '2026-09-24', checkInAtIso: '2026-09-24T01:00:00.000Z',
      amountScaled: 50000 * 1_000_000, attendanceId: 'attendance_dupe_test', description: 'test'
    };
    await recordAttendanceAccrual(env.DB, params);
    await recordAttendanceAccrual(env.DB, params);
    const rows = db.prepare(`SELECT * FROM payroll_ledger_entries WHERE source_id = ?`).all('attendance_dupe_test');
    assert.equal(rows.length, 1, 'INSERT OR IGNORE pada UNIQUE(source_type, source_id) wajib mencegah dobel');
  } finally { db.close(); }
});

test('Akun backup dipakai gantian orang -- gaji menempel ke ORANG yang pegang akun SAAT presensi, bukan siapa pun yang sekarang', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const pendem = storeRow(db, 'PENDEM');
    const cashier = await seedCashier(db, pendem.id, 'backup1', 'CS Backup Satu');
    seedJobDetail(db, cashier.id, { hourlyWage: 80000, paymentType: 'SESI' });

    const employeeA = seedEmployee(db, pendem.entity_id, 'Freelance A');
    const employeeB = seedEmployee(db, pendem.entity_id, 'Freelance B');
    // A pegang akun ini periode lama (sudah ditutup), B pegang sekarang (aktif).
    linkEmployee(db, employeeA, pendem.entity_id, cashier.id, pendem.id, '2026-09-01T00:00:00.000Z', '2026-09-10T00:00:00.000Z');
    linkEmployee(db, employeeB, pendem.entity_id, cashier.id, pendem.id, '2026-09-10T00:00:00.000Z');

    await checkIn(env, cashier.token);
    // Presensi masuknya "dibekukan" ke tanggal saat A masih pegang akun ini --
    // menyimulasikan sesi lampau yang baru sekarang ditutup, atau kejadian
    // yang jam kejadiannya jelas ada di periode A.
    backdateOpenSession(db, cashier.id, '2026-09-05T01:00:00.000Z');
    await checkOut(env, cashier.token);

    const rows = db.prepare(`SELECT * FROM payroll_ledger_entries WHERE account_id = ?`).all(cashier.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].employee_id, employeeA, 'gaji sesi ini milik A (pemegang akun SAAT presensi masuk), bukan B (pemegang SEKARANG)');
  } finally { db.close(); }
});

test('Tanggungan gaji per gerai walaupun memakai user bersama -- dua sesi di dua gerai berbeda tercatat terpisah per gerai', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const pendem = storeRow(db, 'PENDEM');
    const dermo = storeRow(db, 'DERMO');
    const cashierPendem = await seedCashier(db, pendem.id, 'backup2p', 'CS Backup Dua (Pendem)');
    const cashierDermo = await seedCashier(db, dermo.id, 'backup2d', 'CS Backup Dua (Dermo)');
    seedJobDetail(db, cashierPendem.id, { hourlyWage: 40000, paymentType: 'SESI' });
    seedJobDetail(db, cashierDermo.id, { hourlyWage: 40000, paymentType: 'SESI' });
    const employeeId = seedEmployee(db, pendem.entity_id, 'CS Lintas Gerai');
    linkEmployee(db, employeeId, pendem.entity_id, cashierPendem.id, pendem.id, '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z');
    linkEmployee(db, employeeId, pendem.entity_id, cashierDermo.id, dermo.id, '2026-09-02T00:00:00.000Z');

    await checkIn(env, cashierPendem.token);
    backdateOpenSession(db, cashierPendem.id, '2026-09-01T01:00:00.000Z');
    await checkOut(env, cashierPendem.token);

    await checkIn(env, cashierDermo.token);
    backdateOpenSession(db, cashierDermo.id, '2026-09-02T01:00:00.000Z');
    await checkOut(env, cashierDermo.token);

    const rows = db.prepare(`SELECT store_id, business_date FROM payroll_ledger_entries WHERE employee_id = ? ORDER BY business_date`).all(employeeId);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].store_id, pendem.id);
    assert.equal(rows[1].store_id, dermo.id);

    const { netProfitByKey: pendemProfit } = await getNetProfitReport(env.DB, { storeIds: [pendem.id], from: '2026-09-01', to: '2026-09-01', today: '2099-01-01' });
    assert.equal(pendemProfit.get(`${pendem.id}::2026-09-01`), -40000, 'gerai Pendem cuma menanggung sesi yang dikerjakan di Pendem');
    const { netProfitByKey: dermoProfit } = await getNetProfitReport(env.DB, { storeIds: [dermo.id], from: '2026-09-02', to: '2026-09-02', today: '2099-01-01' });
    assert.equal(dermoProfit.get(`${dermo.id}::2026-09-02`), -40000, 'gerai Dermo cuma menanggung sesi yang dikerjakan di Dermo');
  } finally { db.close(); }
});

test('Riwayat Gaji per nama orang menggabungkan akrual presensi + Bea Gaji manual lintas gerai, dengan saldo Hutang Gaji yang benar', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const pendem = storeRow(db, 'PENDEM');
    const dermo = storeRow(db, 'DERMO');
    const cashier = await seedCashier(db, pendem.id, 'gab1', 'CS Gabungan');
    seedJobDetail(db, cashier.id, { hourlyWage: 30000, paymentType: 'SESI' });
    const employeeId = seedEmployee(db, pendem.entity_id, 'Karyawan Gabungan');
    linkEmployee(db, employeeId, pendem.entity_id, cashier.id, pendem.id, '2026-09-01T00:00:00.000Z');

    await checkIn(env, cashier.token);
    backdateOpenSession(db, cashier.id, '2026-09-24T01:00:00.000Z');
    await checkOut(env, cashier.token);

    const adminToken = await seedAdminToken(db, 'admin_dermo_0080');
    const bonus = await handleAdminOperationalExpenseApi(adminRequest('/api/admin/operational-expenses', {
      token: adminToken, store: 'DERMO', method: 'POST',
      body: { category: 'BEA_GAJI', description: 'Bonus lembur', amount: 20000, businessDate: '2026-09-25', employeeId }
    }), env, '/api/admin/operational-expenses');
    assert.equal(bonus.status, 201, JSON.stringify(await bonus.clone().json()));

    const ledgerRes = await handleEmployeeMasterApi(adminRequest(`/api/admin/employees/${encodeURIComponent(employeeId)}/payroll-ledger`, {
      token: adminToken, store: 'DERMO'
    }), env, `/api/admin/employees/${employeeId}/payroll-ledger`);
    assert.equal(ledgerRes.status, 200);
    const ledgerPayload = await ledgerRes.json();
    assert.equal(ledgerPayload.entries.length, 2);
    assert.equal(ledgerPayload.hutangGajiBalanceRupiah, 50000);
    const stores = ledgerPayload.entries.map(entry => entry.storeCode).sort();
    assert.deepEqual(stores, ['DERMO', 'PENDEM']);
  } finally { db.close(); }
});

test('Void Bea Gaji ikut membatalkan mirror-nya di Akun Gaji, saldo Hutang Gaji ikut turun', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const pendem = storeRow(db, 'PENDEM');
    const employeeId = seedEmployee(db, pendem.entity_id, 'Karyawan Void Test');
    const adminToken = await seedAdminToken(db, 'admin_pendem_pilot');

    const createRes = await handleAdminOperationalExpenseApi(adminRequest('/api/admin/operational-expenses', {
      token: adminToken, store: 'PENDEM', method: 'POST',
      body: { category: 'BEA_GAJI', description: 'Salah entry', amount: 100000, businessDate: '2026-09-24', employeeId }
    }), env, '/api/admin/operational-expenses');
    const created = await createRes.json();

    const before = await handleEmployeeMasterApi(adminRequest(`/api/admin/employees/${encodeURIComponent(employeeId)}/payroll-ledger`, { token: adminToken, store: 'PENDEM' }), env, `/api/admin/employees/${employeeId}/payroll-ledger`);
    assert.equal((await before.json()).hutangGajiBalanceRupiah, 100000);

    const voidRes = await handleAdminOperationalExpenseApi(adminRequest(`/api/admin/operational-expenses/${created.id}/void`, {
      token: adminToken, store: 'PENDEM', method: 'POST', body: { reason: 'salah input' }
    }), env, `/api/admin/operational-expenses/${created.id}/void`);
    assert.equal(voidRes.status, 200);

    const after = await handleEmployeeMasterApi(adminRequest(`/api/admin/employees/${encodeURIComponent(employeeId)}/payroll-ledger`, { token: adminToken, store: 'PENDEM' }), env, `/api/admin/employees/${employeeId}/payroll-ledger`);
    const afterPayload = await after.json();
    assert.equal(afterPayload.hutangGajiBalanceRupiah, 0, 'baris dibatalkan tidak boleh ikut saldo lagi');
    assert.equal(afterPayload.entries.length, 1, 'baris tetap ada (append-only), ditandai voided');
    assert.equal(afterPayload.entries[0].voided, true);
  } finally { db.close(); }
});
