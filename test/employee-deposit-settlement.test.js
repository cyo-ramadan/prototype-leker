import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierDrawerApi } from '../src/cashier-drawer.js';
import { handleEmployeeDepositApi } from '../src/employee-deposit-settlement.js';
import { hashCredential } from '../src/owner-auth.js';

// 2026-09-06, Bos Cyo: sisa setoran laci yang belum diserahkan ke kantor jadi
// piutang perusahaan ke CS itu -- boleh dicicil, dan boleh dilunasi lebih dari
// sisa saldo (saldo jadi negatif, bukan bug, invariant #8). Piutangnya sendiri
// hidup di operational_receivables_payables (migration 0074), file ini cuma
// menambahkan cara membuat baris EMPLOYEE_DEPOSIT-nya dan endpoint entry/ACC.

const migrationDir = new URL('../migrations/', import.meta.url);
const STORE_ID = 'store_001';
const STORE_CODE = 'G001';
const ENTITY_ID = 'ENT-G001';

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

async function seedCashier(db, username, employeeName) {
  const id = `cashier_test_${username}`;
  db.prepare(`
    INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
    VALUES (?, ?, 'x', ?, ?, 1, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z')
  `).run(id, username, employeeName, STORE_ID);
  const token = `token-${username}`;
  db.prepare(`
    INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at)
    VALUES (?, ?, '2026-09-06T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(await hashCredential(token), id);
  // Presensi masuk wajib sebelum buka laci (src/cashier-drawer.js) -- disertakan
  // di sini supaya tiap pemanggil tidak perlu mengulang langkah yang sama.
  db.prepare(`
    INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status)
    VALUES (?, ?, ?, 'in', x'00', 'image/jpeg', '2026-09-06T00:30:00.000Z', 'OPEN')
  `).run(`att_${id}`, id, STORE_ID);
  return { id, token };
}

function linkEmployeeToCashier(db, cashierId, fullName) {
  const employeeId = `emp_test_${cashierId}`;
  db.prepare(`
    INSERT INTO employees (id, entity_id, home_store_id, full_name, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ACTIVE', '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z')
  `).run(employeeId, ENTITY_ID, STORE_ID, fullName);
  db.prepare(`
    INSERT INTO employee_account_links (id, employee_id, entity_id, account_type, account_id, store_id, effective_from)
    VALUES (?, ?, ?, 'CASHIER', ?, ?, '2026-09-06T00:00:00.000Z')
  `).run(`link_${cashierId}`, employeeId, ENTITY_ID, cashierId, STORE_ID);
  return employeeId;
}

async function ownerToken(db) {
  const owner = db.prepare('SELECT id FROM owner_accounts ORDER BY id LIMIT 1').get();
  const token = 'deposit-owner-token';
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, '2026-09-06T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), owner.id);
  return token;
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

async function openDrawer(env, token, openingAmount = 100000) {
  const res = await handleCashierDrawerApi(
    request('/api/cashier/drawer/open', { token, method: 'POST', body: { openingAmount } }),
    env, '/api/cashier/drawer/open'
  );
  return res.json();
}

async function closeDrawer(env, token, body) {
  const res = await handleCashierDrawerApi(
    request('/api/cashier/drawer/close', { token, method: 'POST', body }),
    env, '/api/cashier/drawer/close'
  );
  return { status: res.status, body: await res.json() };
}

test('tutup laci tanpa depositAmount berperilaku identik seperti sebelum perubahan ini', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'nodesposit', 'Kasir Tanpa Setoran');
    const env = { DB: new D1Database(db) };
    await openDrawer(env, cashier.token, 50000);

    const { status, body } = await closeDrawer(env, cashier.token, { closingAmount: 200000 });
    assert.equal(status, 200);
    assert.equal(body.employeeDeposit, null);

    const row = db.prepare('SELECT closing_amount, deposit_amount FROM cash_drawer_sessions WHERE id = ?').get(body.drawerId);
    assert.equal(row.closing_amount, 200000);
    assert.equal(row.deposit_amount, 0);

    await openDrawer(env, cashier.token);
    const nextOpen = db.prepare(`SELECT opening_amount FROM cash_drawer_sessions WHERE cashier_id = ? AND status = 'OPEN'`).get(cashier.id);
    assert.equal(nextOpen.opening_amount, 200000, 'saldo awal shift berikutnya tetap penuh sama seperti closing_amount ketika tidak ada setoran');
  } finally {
    db.close();
  }
});

test('tutup laci dengan setoran membuat piutang EMPLOYEE_DEPOSIT dan memotong saldo awal shift berikutnya', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'adasetoran', 'Siti');
    linkEmployeeToCashier(db, cashier.id, 'Siti');
    const env = { DB: new D1Database(db) };
    await openDrawer(env, cashier.token, 50000);

    const { status, body } = await closeDrawer(env, cashier.token, { closingAmount: 500000, depositAmount: 300000 });
    assert.equal(status, 200);
    assert.ok(body.employeeDeposit);
    assert.equal(body.employeeDeposit.sourceType, 'EMPLOYEE_DEPOSIT');
    assert.equal(body.employeeDeposit.counterpartyName, 'Siti');
    assert.equal(body.employeeDeposit.entityId, ENTITY_ID);
    assert.equal(body.employeeDeposit.originalAmountRupiah, 300000);
    assert.equal(body.employeeDeposit.balanceRupiah, 300000);

    await openDrawer(env, cashier.token);
    const nextOpen = db.prepare(`SELECT opening_amount FROM cash_drawer_sessions WHERE cashier_id = ? AND status = 'OPEN'`).get(cashier.id);
    assert.equal(nextOpen.opening_amount, 200000, 'saldo awal shift berikutnya = closing_amount dikurangi deposit_amount');
  } finally {
    db.close();
  }
});

test('setoran tanpa karyawan yang ditautkan ke akun kasir tidak membuat piutang apa pun (tidak menebak siapa yang ditagih)', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'tanpatautan', 'Kasir Belum Ditautkan');
    const env = { DB: new D1Database(db) };
    await openDrawer(env, cashier.token, 50000);

    const { status, body } = await closeDrawer(env, cashier.token, { closingAmount: 500000, depositAmount: 300000 });
    assert.equal(status, 200);
    assert.equal(body.employeeDeposit, null);
  } finally {
    db.close();
  }
});

test('setoran tidak boleh melebihi saldo akhir laci', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'kelebihan', 'Kasir Kelebihan');
    linkEmployeeToCashier(db, cashier.id, 'Kasir Kelebihan');
    const env = { DB: new D1Database(db) };
    await openDrawer(env, cashier.token, 50000);

    const { status } = await closeDrawer(env, cashier.token, { closingAmount: 100000, depositAmount: 150000 });
    assert.equal(status, 400);
    const drawer = db.prepare(`SELECT status FROM cash_drawer_sessions WHERE cashier_id = ?`).get(cashier.id);
    assert.equal(drawer.status, 'OPEN', 'laci tidak boleh ikut tertutup ketika setoran ditolak');
  } finally {
    db.close();
  }
});

test('entry bukti setoran wajib proofReference, masuk pending_approval, dan tidak langsung mengurangi saldo', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'entrysetoran', 'Budi');
    linkEmployeeToCashier(db, cashier.id, 'Budi');
    const env = { DB: new D1Database(db) };
    await openDrawer(env, cashier.token, 50000);
    const { body: closeBody } = await closeDrawer(env, cashier.token, { closingAmount: 530000, depositAmount: 530000 });
    const receivableId = closeBody.employeeDeposit.id;

    const noProofRes = await handleEmployeeDepositApi(
      request(`/api/cashier/employee-deposits/${receivableId}/payments`, { token: cashier.token, method: 'POST', body: { amountRupiah: 450000 } }),
      env, `/api/cashier/employee-deposits/${receivableId}/payments`
    );
    assert.equal(noProofRes.status, 400);

    const submitRes = await handleEmployeeDepositApi(
      request(`/api/cashier/employee-deposits/${receivableId}/payments`, {
        token: cashier.token, method: 'POST',
        body: { amountRupiah: 450000, proofReference: 'transfer://bukti-001' }
      }),
      env, `/api/cashier/employee-deposits/${receivableId}/payments`
    );
    assert.equal(submitRes.status, 201);
    const submitBody = await submitRes.json();
    assert.equal(submitBody.payment.approvalStatus, 'pending_approval');
    assert.equal(submitBody.item.balanceRupiah, 530000, 'belum di-ACC, saldo belum berkurang');
  } finally {
    db.close();
  }
});

test('kasir lain tidak bisa submit bukti setoran untuk piutang milik kasir lain', async () => {
  const db = migratedDatabase();
  try {
    const cashierA = await seedCashier(db, 'kasira', 'Kasir A');
    linkEmployeeToCashier(db, cashierA.id, 'Kasir A');
    const cashierB = await seedCashier(db, 'kasirb', 'Kasir B');
    const env = { DB: new D1Database(db) };
    await openDrawer(env, cashierA.token, 50000);
    const { body: closeBody } = await closeDrawer(env, cashierA.token, { closingAmount: 200000, depositAmount: 200000 });
    const receivableId = closeBody.employeeDeposit.id;

    const res = await handleEmployeeDepositApi(
      request(`/api/cashier/employee-deposits/${receivableId}/payments`, {
        token: cashierB.token, method: 'POST',
        body: { amountRupiah: 200000, proofReference: 'transfer://curi' }
      }),
      env, `/api/cashier/employee-deposits/${receivableId}/payments`
    );
    assert.equal(res.status, 403);
  } finally {
    db.close();
  }
});

test('Finance ACC mengurangi saldo bertahap (cicilan), dan boleh melebihi sisa saldo tanpa ditolak', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'cicilan', 'Wati');
    linkEmployeeToCashier(db, cashier.id, 'Wati');
    const env = { DB: new D1Database(db) };
    await openDrawer(env, cashier.token, 0);
    const { body: closeBody } = await closeDrawer(env, cashier.token, { closingAmount: 530000, depositAmount: 530000 });
    const receivableId = closeBody.employeeDeposit.id;
    const owner = await ownerToken(db);

    async function submit(amount, ref) {
      const res = await handleEmployeeDepositApi(
        request(`/api/cashier/employee-deposits/${receivableId}/payments`, {
          token: cashier.token, method: 'POST', body: { amountRupiah: amount, proofReference: ref }
        }),
        env, `/api/cashier/employee-deposits/${receivableId}/payments`
      );
      return (await res.json()).payment.id;
    }
    async function review(paymentId, action, rejectionReason) {
      const res = await handleEmployeeDepositApi(
        request(`/api/admin/employee-deposits/payments/${paymentId}`, {
          token: owner, method: 'PATCH', store: STORE_CODE, body: { action, rejectionReason }
        }),
        env, `/api/admin/employee-deposits/payments/${paymentId}`
      );
      return { status: res.status, body: await res.json() };
    }

    // Cicilan pertama: 450rb dari total 530rb, tidak wajib pas.
    const firstPayment = await submit(450000, 'transfer://cicilan-1');
    const firstReview = await review(firstPayment, 'APPROVE');
    assert.equal(firstReview.status, 200);

    const pendingRes = await handleEmployeeDepositApi(
      request('/api/admin/employee-deposits/pending', { token: owner, store: STORE_CODE }),
      env, '/api/admin/employee-deposits/pending'
    );
    const pendingBody = await pendingRes.json();
    assert.equal(pendingBody.payments.length, 0, 'yang sudah di-ACC tidak lagi muncul di antrean pending');

    // Cicilan kedua sengaja melebihi sisa saldo (80rb) -- tetap boleh di-ACC, saldo jadi negatif.
    const secondPayment = await submit(100000, 'transfer://cicilan-2');
    const rejectNoReason = await review(secondPayment, 'REJECT');
    assert.equal(rejectNoReason.status, 400, 'reject wajib ada alasan');
    const secondReview = await review(secondPayment, 'APPROVE');
    assert.equal(secondReview.status, 200);
  } finally {
    db.close();
  }
});

test('Finance reject setoran wajib alasan dan tidak mengubah saldo', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'ditolak', 'Rian');
    linkEmployeeToCashier(db, cashier.id, 'Rian');
    const env = { DB: new D1Database(db) };
    await openDrawer(env, cashier.token, 0);
    const { body: closeBody } = await closeDrawer(env, cashier.token, { closingAmount: 200000, depositAmount: 200000 });
    const receivableId = closeBody.employeeDeposit.id;
    const owner = await ownerToken(db);

    const submitRes = await handleEmployeeDepositApi(
      request(`/api/cashier/employee-deposits/${receivableId}/payments`, {
        token: cashier.token, method: 'POST', body: { amountRupiah: 200000, proofReference: 'transfer://buram' }
      }),
      env, `/api/cashier/employee-deposits/${receivableId}/payments`
    );
    const paymentId = (await submitRes.json()).payment.id;

    const rejectRes = await handleEmployeeDepositApi(
      request(`/api/admin/employee-deposits/payments/${paymentId}`, {
        token: owner, method: 'PATCH', store: STORE_CODE, body: { action: 'REJECT', rejectionReason: 'Foto buram, nominal tidak terbaca' }
      }),
      env, `/api/admin/employee-deposits/payments/${paymentId}`
    );
    assert.equal(rejectRes.status, 200);

    const listRes = await handleEmployeeDepositApi(
      request('/api/cashier/employee-deposits', { token: cashier.token }),
      env, '/api/cashier/employee-deposits'
    );
    const listBody = await listRes.json();
    assert.equal(listBody.items[0].balanceRupiah, 200000, 'ditolak tidak mengurangi saldo');
    assert.equal(listBody.items[0].payments[0].approvalStatus, 'rejected');
    assert.equal(listBody.items[0].payments[0].rejectionReason, 'Foto buram, nominal tidak terbaca');
  } finally {
    db.close();
  }
});

test('migration 0075 cuma ADD COLUMN, additive, tidak menyentuh baris tabel gerai yang sudah ada', () => {
  const migration = readFileSync(new URL('../migrations/0075_drawer_deposit_split.sql', import.meta.url), 'utf8');
  assert.match(migration, /ALTER TABLE cash_drawer_sessions ADD COLUMN deposit_amount INTEGER NOT NULL DEFAULT 0/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|UPDATE /i);
});
