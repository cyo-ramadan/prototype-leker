import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminCashierApi } from '../src/cashier-auth.js';
import { handleStaffPortalApi } from '../src/staff-portal.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-24: "untuk detil gaji dikasi tombol dan kolom sendiri
// saja. karna selain dari presensi, gaji nanti juga bisa dibuat oleh
// akuntan sendiri, misal tanggal 26 akuntan entry tambahan 30rb karena
// lembur. atau potongan 15rb karna ngilangin barang, atau tambahan 23rb
// karna kesalahan perhitungan ... jadi di tanggal 26 nanti akan terlihat 2
// kartu, 1 dari presensi normal, 2 tambah entryan akuntan."
//
// payroll (dari presensi, dihitung ulang tiap request) dan adjustments
// (entry manual Admin, baris permanen) dua sumber terpisah yang sama-sama
// dikembalikan GET .../payroll -- caller (UI) yang menggabungkan per
// tanggal jadi kartu-kartu terpisah.

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

async function createAdjustment(env, adminToken, store, cashierId, body) {
  const path = `/api/admin/cashiers/${encodeURIComponent(cashierId)}/payroll`;
  return handleAdminCashierApi(request(path, { token: adminToken, store, method: 'POST', body }), env, path);
}

async function getPayroll(env, adminToken, store, cashierId) {
  const path = `/api/admin/cashiers/${encodeURIComponent(cashierId)}/payroll`;
  const response = await handleAdminCashierApi(request(path, { token: adminToken, store }), env, path);
  assert.equal(response.status, 200);
  return response.json();
}

test('Admin bisa entry Penyesuaian Gaji (tambahan lembur) -- muncul terpisah dari payroll presensi, bukan menimpanya', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const cashier = await createCashier(env, adminToken, 'PENDEM', { username: 'kasir_adj_1', password: 'rahasia1', employeeName: 'CS Adj Satu', paymentType: 'JAM', hourlyWage: 20000 });
    // Presensi normal tanggal 26 -- 2 jam kerja x Rp20.000 = Rp40.000.
    insertClosedSession(sqlite, cashier.id, 'store_pendem', '2026-09-26T01:00:00.000Z', '2026-09-26T03:00:00.000Z');

    const createResponse = await createAdjustment(env, adminToken, 'PENDEM', cashier.id, {
      businessDate: '2026-09-26', amountRupiah: 30000, reason: 'Lembur tanggal 26'
    });
    assert.equal(createResponse.status, 201, JSON.stringify(await createResponse.clone().json()));

    const payload = await getPayroll(env, adminToken, 'PENDEM', cashier.id);
    // Dua kartu persis seperti yang Bos Cyo gambarkan: satu dari presensi,
    // satu dari entry manual -- BUKAN digabung jadi satu angka.
    assert.equal(payload.payroll.length, 1);
    assert.equal(payload.payroll[0].earningRupiah, 40000);
    assert.equal(payload.adjustments.length, 1);
    assert.equal(payload.adjustments[0].businessDate, '2026-09-26');
    assert.equal(payload.adjustments[0].amountRupiah, 30000);
    assert.equal(payload.adjustments[0].reason, 'Lembur tanggal 26');
    assert.equal(payload.adjustments[0].createdByRole, 'ADMIN');
    assert.equal(payload.adjustments[0].voided, false);
  } finally { sqlite.close(); }
});

test('Potongan gaji (nominal negatif) dan toleransi telat tersimpan sebagai alasan wajib -- bukan angka tanpa penjelasan', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const cashier = await createCashier(env, adminToken, 'PENDEM', { username: 'kasir_adj_2', password: 'rahasia1', employeeName: 'CS Adj Dua' });

    const potongan = await createAdjustment(env, adminToken, 'PENDEM', cashier.id, {
      businessDate: '2026-09-26', amountRupiah: -15000, reason: 'Potongan: menghilangkan barang'
    });
    assert.equal(potongan.status, 201);

    const toleransi = await createAdjustment(env, adminToken, 'PENDEM', cashier.id, {
      businessDate: '2026-09-26', amountRupiah: 23000,
      reason: 'Toleransi telat 3 jam -- HP mati kemarin, tidak sempat presensi, dikonfirmasi manual'
    });
    assert.equal(toleransi.status, 201);

    const noReason = await createAdjustment(env, adminToken, 'PENDEM', cashier.id, { businessDate: '2026-09-26', amountRupiah: 10000, reason: '' });
    assert.equal(noReason.status, 400, 'alasan kosong wajib ditolak -- ini jejak audit uang karyawan');

    const zero = await createAdjustment(env, adminToken, 'PENDEM', cashier.id, { businessDate: '2026-09-26', amountRupiah: 0, reason: 'iseng' });
    assert.equal(zero.status, 400, 'nominal nol bukan penyesuaian, wajib ditolak');

    const payload = await getPayroll(env, adminToken, 'PENDEM', cashier.id);
    assert.equal(payload.adjustments.length, 2);
    const amounts = payload.adjustments.map(row => row.amountRupiah).sort((a, b) => a - b);
    assert.deepEqual(amounts, [-15000, 23000]);
  } finally { sqlite.close(); }
});

test('Penyesuaian gaji bisa dibatalkan (void) dengan alasan, tapi baris lama tetap ada -- append-only, bukan DELETE', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const cashier = await createCashier(env, adminToken, 'PENDEM', { username: 'kasir_adj_3', password: 'rahasia1', employeeName: 'CS Adj Tiga' });
    const createResponse = await createAdjustment(env, adminToken, 'PENDEM', cashier.id, { businessDate: '2026-09-26', amountRupiah: 50000, reason: 'Salah entry, mau dibatalkan' });
    const { id: adjustmentId } = await createResponse.json();

    const voidPath = `/api/admin/cashiers/${encodeURIComponent(cashier.id)}/payroll-adjustments/${encodeURIComponent(adjustmentId)}/void`;
    const voidResponse = await handleAdminCashierApi(request(voidPath, { token: adminToken, store: 'PENDEM', method: 'POST', body: { reason: 'Salah input nominal' } }), env, voidPath);
    assert.equal(voidResponse.status, 200);

    const payload = await getPayroll(env, adminToken, 'PENDEM', cashier.id);
    assert.equal(payload.adjustments.length, 1, 'baris tetap ada, tidak dihapus');
    assert.equal(payload.adjustments[0].voided, true);
    assert.equal(payload.adjustments[0].voidReason, 'Salah input nominal');

    const voidTwiceResponse = await handleAdminCashierApi(request(voidPath, { token: adminToken, store: 'PENDEM', method: 'POST', body: { reason: 'coba lagi' } }), env, voidPath);
    assert.equal(voidTwiceResponse.status, 404, 'penyesuaian yang sudah dibatalkan tidak boleh dibatalkan dobel');
  } finally { sqlite.close(); }
});

test('Admin gerai lain tidak bisa entry atau membatalkan penyesuaian gaji kasir gerai orang', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const adminPendemToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const adminDermoToken = await storeAdminToken(sqlite, 'admin_dermo_0080');
    const cashier = await createCashier(env, adminPendemToken, 'PENDEM', { username: 'kasir_adj_4', password: 'rahasia1', employeeName: 'CS Adj Empat' });

    const crossStoreCreate = await createAdjustment(env, adminDermoToken, 'DERMO', cashier.id, { businessDate: '2026-09-26', amountRupiah: 20000, reason: 'coba nyelonong' });
    assert.equal(crossStoreCreate.status, 404);

    const own = await createAdjustment(env, adminPendemToken, 'PENDEM', cashier.id, { businessDate: '2026-09-26', amountRupiah: 20000, reason: 'sah' });
    const { id: adjustmentId } = await own.json();
    const voidPath = `/api/admin/cashiers/${encodeURIComponent(cashier.id)}/payroll-adjustments/${encodeURIComponent(adjustmentId)}/void`;
    const crossStoreVoid = await handleAdminCashierApi(request(voidPath, { token: adminDermoToken, store: 'DERMO', method: 'POST', body: { reason: 'coba batalkan punya orang' } }), env, voidPath);
    assert.equal(crossStoreVoid.status, 404);
  } finally { sqlite.close(); }
});

test('Karyawan sendiri ikut melihat Penyesuaian Gaji miliknya lewat Portal Staf -- bukan cuma kelihatan di sisi Admin', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const cashier = await createCashier(env, adminToken, 'PENDEM', { username: 'kasir_adj_5', password: 'rahasia1', employeeName: 'CS Adj Lima' });
    const staffToken = await cashierToken(sqlite, cashier.id);
    await createAdjustment(env, adminToken, 'PENDEM', cashier.id, { businessDate: '2026-09-26', amountRupiah: 30000, reason: 'Bonus rajin' });

    const staffResponse = await handleStaffPortalApi(request('/api/staff/portal', { token: staffToken }), env, '/api/staff/portal');
    const staffPayload = await staffResponse.json();
    assert.equal(staffPayload.payrollAdjustments.length, 1);
    assert.equal(staffPayload.payrollAdjustments[0].amountRupiah, 30000);
    assert.equal(staffPayload.payrollAdjustments[0].reason, 'Bonus rajin');
  } finally { sqlite.close(); }
});
