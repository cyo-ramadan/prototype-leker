import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminOperationalExpenseApi } from '../src/admin-operational-expense.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-26: "lapak juga lewat hutang dulu aja ... jadi nanti
// pembayaran2 by admin tinggal bayar2 hutang aja". Bea Lapak/Bea Lainnya
// sekarang membuka Hutang lewat operational_receivables_payables (migration
// 0120, src/operational-expense-payables.js) tepat saat baris Bea itu
// dibuat, dan dilunasi lewat endpoint pay terpisah tanpa menambah Beban lagi.

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

async function seedAdminToken(db, adminId) {
  const token = `emp-admin-${adminId}`;
  db.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, '2026-06-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), adminId);
  return token;
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

test('Bea Lapak membuka Hutang sekali (Beban tidak dobel saat nanti dibayar)', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const adminToken = await seedAdminToken(db, 'admin_pendem_pilot');

    const createRes = await handleAdminOperationalExpenseApi(adminRequest('/api/admin/operational-expenses', {
      token: adminToken, store: 'PENDEM', method: 'POST',
      body: { category: 'BEA_LAPAK', description: 'Sewa lapak September', amount: 500000, businessDate: '2026-09-26', counterpartyName: 'Pak RT' }
    }), env, '/api/admin/operational-expenses');
    assert.equal(createRes.status, 201, JSON.stringify(await createRes.clone().json()));
    const created = await createRes.json();

    // Beban cuma satu baris, satu kali, sebesar nominal Bea-nya.
    const expenseRows = db.prepare(`SELECT amount FROM admin_operational_expenses WHERE category = 'BEA_LAPAK'`).all();
    assert.equal(expenseRows.length, 1);
    assert.equal(expenseRows[0].amount, 500000);

    assert.equal(created.hutangLapakLainnya.length, 1);
    assert.equal(created.hutangLapakLainnya[0].balanceRupiah, 500000);
    assert.equal(created.hutangLapakLainnya[0].counterpartyName, 'Pak RT');
    assert.equal(created.hutangLapakLainnya[0].sourceType, 'BEA_LAPAK');

    const listRes = await handleAdminOperationalExpenseApi(adminRequest('/api/admin/operational-expenses/payables', {
      token: adminToken, store: 'PENDEM'
    }), env, '/api/admin/operational-expenses/payables');
    const listPayload = await listRes.json();
    assert.equal(listPayload.hutangLapakLainnya.length, 1);
  } finally { db.close(); }
});

test('Bayar Hutang Lapak sebagian tidak menambah baris Beban baru, saldo berkurang', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const adminToken = await seedAdminToken(db, 'admin_pendem_pilot');

    const createRes = await handleAdminOperationalExpenseApi(adminRequest('/api/admin/operational-expenses', {
      token: adminToken, store: 'PENDEM', method: 'POST',
      body: { category: 'BEA_LAINNYA', description: 'Tagihan WiFi', amount: 300000, businessDate: '2026-09-26', counterpartyName: 'Indihome' }
    }), env, '/api/admin/operational-expenses');
    const created = await createRes.json();
    const payableId = created.hutangLapakLainnya[0].id;

    const payRes = await handleAdminOperationalExpenseApi(adminRequest(`/api/admin/operational-expenses/payables/${payableId}/pay`, {
      token: adminToken, store: 'PENDEM', method: 'POST', body: { amount: 100000, note: 'Cicilan pertama' }
    }), env, `/api/admin/operational-expenses/payables/${payableId}/pay`);
    assert.equal(payRes.status, 200, JSON.stringify(await payRes.clone().json()));
    const payPayload = await payRes.json();
    assert.equal(payPayload.item.balanceRupiah, 200000);
    assert.equal(payPayload.hutangLapakLainnya[0].balanceRupiah, 200000);

    // Beban tetap satu baris -- pembayaran tidak menambah admin_operational_expenses.
    const expenseRows = db.prepare(`SELECT amount FROM admin_operational_expenses WHERE category = 'BEA_LAINNYA'`).all();
    assert.equal(expenseRows.length, 1);
    assert.equal(expenseRows[0].amount, 300000);
  } finally { db.close(); }
});

test('Kelebihan bayar Hutang Lapak/Lainnya membuat saldo minus, bukan error (invariant #8)', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const adminToken = await seedAdminToken(db, 'admin_pendem_pilot');

    const createRes = await handleAdminOperationalExpenseApi(adminRequest('/api/admin/operational-expenses', {
      token: adminToken, store: 'PENDEM', method: 'POST',
      body: { category: 'BEA_LAPAK', description: 'Sewa lapak', amount: 100000, businessDate: '2026-09-26' }
    }), env, '/api/admin/operational-expenses');
    const created = await createRes.json();
    const payableId = created.hutangLapakLainnya[0].id;

    const payRes = await handleAdminOperationalExpenseApi(adminRequest(`/api/admin/operational-expenses/payables/${payableId}/pay`, {
      token: adminToken, store: 'PENDEM', method: 'POST', body: { amount: 150000 }
    }), env, `/api/admin/operational-expenses/payables/${payableId}/pay`);
    assert.equal(payRes.status, 200);
    const payPayload = await payRes.json();
    assert.equal(payPayload.item.balanceRupiah, -50000);
  } finally { db.close(); }
});

test('Hutang Lapak/Lainnya terisolasi per gerai -- gerai lain tidak bisa membayar punya gerai lain', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const pendemToken = await seedAdminToken(db, 'admin_pendem_pilot');
    const dermoToken = await seedAdminToken(db, 'admin_dermo_0080');

    const createRes = await handleAdminOperationalExpenseApi(adminRequest('/api/admin/operational-expenses', {
      token: pendemToken, store: 'PENDEM', method: 'POST',
      body: { category: 'BEA_LAPAK', description: 'Sewa lapak Pendem', amount: 100000, businessDate: '2026-09-26' }
    }), env, '/api/admin/operational-expenses');
    const created = await createRes.json();
    const payableId = created.hutangLapakLainnya[0].id;

    const crossStorePay = await handleAdminOperationalExpenseApi(adminRequest(`/api/admin/operational-expenses/payables/${payableId}/pay`, {
      token: dermoToken, store: 'DERMO', method: 'POST', body: { amount: 50000 }
    }), env, `/api/admin/operational-expenses/payables/${payableId}/pay`);
    assert.equal(crossStorePay.status, 404);
  } finally { db.close(); }
});

test('Void Bea Lapak yang belum dibayar menutup Hutangnya jadi nol; yang sudah dibayar dibiarkan apa adanya', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const adminToken = await seedAdminToken(db, 'admin_pendem_pilot');

    // Kasus 1: belum dibayar sama sekali -- void ikut menutup Hutang jadi 0.
    const untouchedRes = await handleAdminOperationalExpenseApi(adminRequest('/api/admin/operational-expenses', {
      token: adminToken, store: 'PENDEM', method: 'POST',
      body: { category: 'BEA_LAPAK', description: 'Salah entry', amount: 200000, businessDate: '2026-09-26' }
    }), env, '/api/admin/operational-expenses');
    const untouched = await untouchedRes.json();
    const untouchedVoid = await handleAdminOperationalExpenseApi(adminRequest(`/api/admin/operational-expenses/${untouched.id}/void`, {
      token: adminToken, store: 'PENDEM', method: 'POST', body: { reason: 'salah kategori' }
    }), env, `/api/admin/operational-expenses/${untouched.id}/void`);
    assert.equal(untouchedVoid.status, 200);
    const untouchedVoidPayload = await untouchedVoid.json();
    assert.equal(untouchedVoidPayload.hutangLapakLainnya.length, 0, 'Hutang yang belum tersentuh harus ikut tertutup, tidak nyantol jadi open selamanya');

    // Kasus 2: sudah dibayar sebagian -- void tidak boleh menghapus jejak pembayaran itu.
    const paidRes = await handleAdminOperationalExpenseApi(adminRequest('/api/admin/operational-expenses', {
      token: adminToken, store: 'PENDEM', method: 'POST',
      body: { category: 'BEA_LAINNYA', description: 'Tagihan listrik', amount: 400000, businessDate: '2026-09-26' }
    }), env, '/api/admin/operational-expenses');
    const paid = await paidRes.json();
    const paidPayableId = paid.hutangLapakLainnya[0].id;
    await handleAdminOperationalExpenseApi(adminRequest(`/api/admin/operational-expenses/payables/${paidPayableId}/pay`, {
      token: adminToken, store: 'PENDEM', method: 'POST', body: { amount: 150000 }
    }), env, `/api/admin/operational-expenses/payables/${paidPayableId}/pay`);

    const paidVoid = await handleAdminOperationalExpenseApi(adminRequest(`/api/admin/operational-expenses/${paid.id}/void`, {
      token: adminToken, store: 'PENDEM', method: 'POST', body: { reason: 'coba batalkan' }
    }), env, `/api/admin/operational-expenses/${paid.id}/void`);
    assert.equal(paidVoid.status, 200, 'void expense-nya sendiri tetap boleh, cuma Hutangnya yang tidak ikut disentuh');
    const paidVoidPayload = await paidVoid.json();
    const survivingPayable = paidVoidPayload.hutangLapakLainnya.find(item => item.id === paidPayableId);
    assert.ok(survivingPayable, 'Hutang yang sudah pernah dibayar tidak boleh hilang/ditutup diam-diam oleh void');
    assert.equal(survivingPayable.balanceRupiah, 250000, 'saldo tidak berubah gara-gara void -- pembayaran yang sudah terjadi tetap dihormati');
  } finally { db.close(); }
});

test('Bea Gaji tidak ikut membuka Hutang di operational_receivables_payables -- tetap lewat payroll ledger sendiri', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const adminToken = await seedAdminToken(db, 'admin_pendem_pilot');
    const pendem = storeRow(db, 'PENDEM');
    const employeeId = 'emp_oep_test';
    db.prepare(`INSERT INTO employees (id, entity_id, full_name, status, created_at, updated_at) VALUES (?, ?, 'Karyawan OEP Test', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .run(employeeId, pendem.entity_id);

    await handleAdminOperationalExpenseApi(adminRequest('/api/admin/operational-expenses', {
      token: adminToken, store: 'PENDEM', method: 'POST',
      body: { category: 'BEA_GAJI', description: 'Gaji test', amount: 250000, businessDate: '2026-09-26', employeeId }
    }), env, '/api/admin/operational-expenses');

    const orpRows = db.prepare(`SELECT source_type FROM operational_receivables_payables WHERE store_id = ?`).all(pendem.id);
    assert.equal(orpRows.length, 0, 'Bea Gaji tidak boleh membuat baris di operational_receivables_payables');
  } finally { db.close(); }
});
