import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierDrawerApi } from '../src/cashier-drawer.js';
import { handleEmployeeDepositApi } from '../src/employee-deposit-settlement.js';
import { buildDrawerReport } from '../src/drawer-report.js';
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

function request(pathname, { token, method = 'GET', body, store, form } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store) url.searchParams.set('store', store);
  return new Request(url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined)
  });
}

// Bos Cyo, 2026-10-04: setoran dibuktikan dengan FOTO bukti transfer (multipart).
const FOTO_BUKTI = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
function setoranForm(amountRupiah, keterangan = '', { foto = true } = {}) {
  const form = new FormData();
  form.set('amountRupiah', String(amountRupiah));
  if (keterangan) form.set('proofReference', keterangan);
  if (foto) form.set('photo', new File([FOTO_BUKTI], 'bukti.png', { type: 'image/png' }));
  return form;
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
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS count FROM accounting_journal_headers
      WHERE source_system = 'EMPLOYEE_DEPOSIT'
    `).get().count, 0);

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
    assert.equal(body.employeeDeposit.accounting.ok, true);

    const stored = db.prepare(`
      SELECT original_amount FROM operational_receivables_payables WHERE id = ?
    `).get(body.employeeDeposit.id);
    assert.equal(stored.original_amount, 300000 * 1_000_000);
    assert.equal(Number.isSafeInteger(stored.original_amount), true);

    const journalLines = db.prepare(`
      SELECT l.side, l.amount_scaled, a.code
      FROM accounting_journal_lines l
      JOIN accounting_journal_headers h ON h.id = l.journal_id AND h.store_id = l.store_id
      JOIN chart_of_accounts a ON a.id = l.account_id AND a.store_id = l.store_id
      WHERE h.source_system = 'EMPLOYEE_DEPOSIT' AND h.source_reference_id = ?
      ORDER BY l.line_number
    `).all(body.employeeDeposit.id);
    assert.deepEqual(journalLines.map(row => ({ ...row })), [
      { side: 'DEBIT', amount_scaled: 300000 * 1_000_000, code: '1202' },
      { side: 'CREDIT', amount_scaled: 300000 * 1_000_000, code: '1101' }
    ]);

    await openDrawer(env, cashier.token);
    const nextOpen = db.prepare(`SELECT opening_amount FROM cash_drawer_sessions WHERE cashier_id = ? AND status = 'OPEN'`).get(cashier.id);
    assert.equal(nextOpen.opening_amount, 200000, 'saldo awal shift berikutnya = closing_amount dikurangi deposit_amount');
  } finally {
    db.close();
  }
});

// Kebijakan lama (2026-09-06): akun kasir tanpa tautan karyawan tidak membuat piutang
// ("tidak menebak siapa yang ditagih"). Dibalik 2026-10-03 atas arahan Bos Cyo:
// selama kasir belum menyetor, piutangnya harus terus bertambah -- tidak ada setoran
// yang boleh lolos dari pembukuan. Piutang dicatat atas nama akun kasir itu.
test('setoran dari akun kasir yang belum ditautkan ke karyawan tetap menjadi piutang atas nama akun kasir itu', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'tanpatautan', 'Kasir Belum Ditautkan');
    const env = { DB: new D1Database(db) };
    await openDrawer(env, cashier.token, 50000);

    const { status, body } = await closeDrawer(env, cashier.token, { closingAmount: 500000, depositAmount: 300000 });
    assert.equal(status, 200);
    assert.ok(body.employeeDeposit, 'piutang setoran terbentuk');
    assert.equal(body.employeeDeposit.accounting.ok, true);
    const row = db.prepare("SELECT counterparty_id, counterparty_name_snapshot FROM operational_receivables_payables WHERE source_type = 'EMPLOYEE_DEPOSIT'").get();
    assert.equal(row.counterparty_id, `cashier:${cashier.id}`);
    assert.ok(row.counterparty_name_snapshot);
  } finally {
    db.close();
  }
});

test('store non-ACCOUNTING tetap menyimpan fakta operasional dan melewati jurnal', async () => {
  const db = migratedDatabase();
  try {
    db.prepare(`UPDATE stores SET edition = 'LITE' WHERE id = ?`).run(STORE_ID);
    const cashier = await seedCashier(db, 'lite', 'Kasir Lite');
    linkEmployeeToCashier(db, cashier.id, 'Kasir Lite');
    const env = { DB: new D1Database(db) };
    await openDrawer(env, cashier.token, 50000);

    const { status, body } = await closeDrawer(env, cashier.token, {
      closingAmount: 300000,
      depositAmount: 125000
    });
    assert.equal(status, 200);
    assert.equal(body.employeeDeposit.originalAmountRupiah, 125000);
    assert.equal(body.employeeDeposit.accounting.status, 'SKIPPED_NON_ACCOUNTING');
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS count FROM accounting_journal_headers
      WHERE source_system = 'EMPLOYEE_DEPOSIT'
    `).get().count, 0);
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

test('entry bukti setoran wajib FOTO, masuk pending_approval, dan tidak langsung mengurangi saldo', async () => {
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
    assert.equal(noProofRes.status, 400, 'kiriman lama tanpa foto (JSON) ditolak');
    assert.equal((await noProofRes.json()).code, 'EMPLOYEE_DEPOSIT_PHOTO_REQUIRED');
    const tanpaFoto = await handleEmployeeDepositApi(
      request(`/api/cashier/employee-deposits/${receivableId}/payments`, { token: cashier.token, method: 'POST', form: setoranForm(450000, 'transfer', { foto: false }) }),
      env, `/api/cashier/employee-deposits/${receivableId}/payments`
    );
    assert.equal(tanpaFoto.status, 400);
    assert.match((await tanpaFoto.json()).error, /Foto bukti transfer wajib/);

    const submitRes = await handleEmployeeDepositApi(
      request(`/api/cashier/employee-deposits/${receivableId}/payments`, {
        token: cashier.token, method: 'POST',
        form: setoranForm(450000, 'transfer://bukti-001')
      }),
      env, `/api/cashier/employee-deposits/${receivableId}/payments`
    );
    assert.equal(submitRes.status, 201);
    const submitBody = await submitRes.json();
    assert.equal(submitBody.payment.approvalStatus, 'pending_approval');
    assert.equal(submitBody.item.balanceRupiah, 530000, 'belum di-ACC, saldo belum berkurang');
    const storedPayment = db.prepare(`
      SELECT amount FROM operational_receivable_payable_payments WHERE id = ?
    `).get(submitBody.payment.id);
    assert.equal(storedPayment.amount, 450000 * 1_000_000);
    assert.equal(Number.isSafeInteger(storedPayment.amount), true);
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS count FROM accounting_journal_headers
      WHERE source_system = 'EMPLOYEE_DEPOSIT' AND source_reference_id = ?
    `).get(submitBody.payment.id).count, 0, 'PENDING belum boleh membentuk jurnal pelunasan');
  } finally {
    db.close();
  }
});

test('foto bukti tersimpan; hanya pemilik setoran dan Admin yang bisa melihatnya; ACC tetap manual', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'fotosetoran', 'Sari');
    linkEmployeeToCashier(db, cashier.id, 'Sari');
    const lain = await seedCashier(db, 'fotolain', 'Dewi');
    linkEmployeeToCashier(db, lain.id, 'Dewi');
    const env = { DB: new D1Database(db) };
    await openDrawer(env, cashier.token, 0);
    const { body: closeBody } = await closeDrawer(env, cashier.token, { closingAmount: 300000, leftInDrawerAmount: 0 });
    const receivableId = closeBody.employeeDeposit.id;

    const kirim = await handleEmployeeDepositApi(
      request(`/api/cashier/employee-deposits/${receivableId}/payments`, { token: cashier.token, method: 'POST', form: setoranForm(300000, 'BCA 04/10') }),
      env, `/api/cashier/employee-deposits/${receivableId}/payments`
    );
    assert.equal(kirim.status, 201);
    const { payment } = await kirim.json();
    assert.equal(payment.approvalStatus, 'pending_approval', 'tidak ada ACC otomatis');
    assert.equal(payment.hasPhoto, true);
    assert.equal(payment.proofReference, 'Foto bukti transfer · BCA 04/10');

    const fotoPath = `/api/cashier/employee-deposits/payments/${payment.id}/photo`;
    const fotoSendiri = await handleEmployeeDepositApi(request(fotoPath, { token: cashier.token }), env, fotoPath);
    assert.equal(fotoSendiri.status, 200);
    assert.equal(fotoSendiri.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await fotoSendiri.arrayBuffer()), FOTO_BUKTI);
    const fotoOrangLain = await handleEmployeeDepositApi(request(fotoPath, { token: lain.token }), env, fotoPath);
    assert.equal(fotoOrangLain.status, 404, 'CS lain tidak bisa mengintip foto setoran orang lain');

    const owner = await ownerToken(db);
    const adminFoto = `/api/admin/employee-deposits/payments/${payment.id}/photo`;
    assert.equal((await handleEmployeeDepositApi(request(adminFoto, { token: owner, store: STORE_CODE }), env, adminFoto)).status, 200);

    // Daftar riwayat tidak memuat isi foto (hanya penanda hasPhoto).
    const daftar = await (await handleEmployeeDepositApi(request('/api/cashier/employee-deposits', { token: cashier.token }), env, '/api/cashier/employee-deposits')).json();
    assert.equal(daftar.items[0].payments[0].hasPhoto, true);
    assert.equal('proof_photo' in daftar.items[0].payments[0], false);
    assert.equal(daftar.items[0].balanceRupiah, 300000, 'belum di-ACC, piutang belum berkurang');

    // Tab Setoran CS di Admin: antrean, sisa piutang per CS, riwayat.
    const overviewPath = '/api/admin/employee-deposits/overview';
    const sebelum = await (await handleEmployeeDepositApi(request(overviewPath, { token: owner, store: STORE_CODE }), env, overviewPath)).json();
    assert.equal(sebelum.pending.length, 1);
    assert.equal(sebelum.pending[0].employeeName, 'Sari');
    assert.equal(sebelum.pending[0].hasPhoto, true);
    assert.deepEqual(sebelum.balances.map((b) => [b.employeeName, b.balanceRupiah, b.pendingAmountRupiah]), [['Sari', 300000, 300000]]);
    assert.equal(sebelum.history.length, 0);

    const acc = `/api/admin/employee-deposits/payments/${payment.id}`;
    assert.equal((await handleEmployeeDepositApi(request(acc, { token: owner, method: 'PATCH', store: STORE_CODE, body: { action: 'APPROVE' } }), env, acc)).status, 200);
    const sesudah = await (await handleEmployeeDepositApi(request(overviewPath, { token: owner, store: STORE_CODE }), env, overviewPath)).json();
    assert.equal(sesudah.pending.length, 0);
    assert.deepEqual(sesudah.balances.map((b) => [b.employeeName, b.balanceRupiah, b.pendingAmountRupiah]), [['Sari', 0, 0]]);
    assert.deepEqual(sesudah.history.map((h) => [h.employeeName, h.approvalStatus, h.amountRupiah]), [['Sari', 'approved', 300000]]);
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
        form: setoranForm(200000, 'transfer://curi')
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
          token: cashier.token, method: 'POST', form: setoranForm(amount, ref)
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
    assert.equal(firstReview.body.accounting.status, 'POSTED');
    const firstRetry = await review(firstPayment, 'APPROVE');
    assert.equal(firstRetry.status, 200, 'retry ACC boleh memulihkan delivery jurnal tanpa mengubah fakta payment');
    assert.equal(firstRetry.body.duplicateReview, true);
    assert.equal(firstRetry.body.accounting.duplicate, true);

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
    assert.equal(secondReview.body.accounting.status, 'POSTED');

    const listRes = await handleEmployeeDepositApi(
      request('/api/cashier/employee-deposits', { token: cashier.token }),
      env, '/api/cashier/employee-deposits'
    );
    const listBody = await listRes.json();
    assert.equal(listBody.items[0].paidAmountRupiah, 550000);
    assert.equal(listBody.items[0].balanceRupiah, -20000, 'kelebihan bayar tetap signed, tidak di-abs atau ditolak');

    const settlementLines = db.prepare(`
      SELECT h.source_reference_id, l.side, l.amount_scaled, a.code
      FROM accounting_journal_headers h
      JOIN accounting_journal_lines l ON l.journal_id = h.id AND l.store_id = h.store_id
      JOIN chart_of_accounts a ON a.id = l.account_id AND a.store_id = l.store_id
      WHERE h.source_system = 'EMPLOYEE_DEPOSIT'
        AND h.source_reference_id IN (?, ?)
      ORDER BY h.source_reference_id, l.line_number
    `).all(firstPayment, secondPayment);
    assert.equal(settlementLines.length, 4);
    for (let index = 0; index < settlementLines.length; index += 2) {
      assert.equal(settlementLines[index].side, 'DEBIT');
      assert.equal(settlementLines[index].code, '1101');
      assert.equal(settlementLines[index + 1].side, 'CREDIT');
      assert.equal(settlementLines[index + 1].code, '1202');
      assert.equal(settlementLines[index].amount_scaled, settlementLines[index + 1].amount_scaled);
    }
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
        token: cashier.token, method: 'POST', form: setoranForm(200000, 'transfer://buram')
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
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS count FROM accounting_journal_headers
      WHERE source_system = 'EMPLOYEE_DEPOSIT' AND source_reference_id = ?
    `).get(paymentId).count, 0, 'REJECTED tidak boleh membentuk jurnal pelunasan');
  } finally {
    db.close();
  }
});

// Diperbarui 2026-10-03: kasir tidak lagi mengisi setoran; dialog mengirim Titip laci
// dan server menghitung setoran (lihat tes UI di akhir file).
test('dialog tutup laci di kasir mengirim Taruh uang laci (bukan setoran) ke server', () => {
  const cashierUi = readFileSync(new URL('../public/cashier.js', import.meta.url), 'utf8');
  assert.match(cashierUi, /id="dialogLeftAmount"/);
  assert.match(cashierUi, /leftInDrawerAmount: Number\(el\('dialogLeftAmount'\)\.value\)/);
});

test('Portal Staf: tab Setor Uang (nominal + FOTO bukti multipart) terpisah dari Riwayat Setoran yang hanya data', () => {
  const staffUi = readFileSync(new URL('../public/staff.js', import.meta.url), 'utf8');
  const staffHtml = readFileSync(new URL('../public/staff.html', import.meta.url), 'utf8');
  assert.match(staffUi, /staffApi\('\/api\/cashier\/employee-deposits'\)/);
  assert.match(staffUi, /id="setorKirim"/);
  assert.match(staffUi, /employee-deposits\/\$\{encodeURIComponent\(pilih\.value\)\}\/payments/);
  assert.match(staffUi, /type="file" accept="image\/\*"/, 'foto bukti transfer diambil dari kamera/galeri');
  assert.match(staffUi, /form\.set\('photo'/, 'dikirim sebagai multipart dengan foto');
  assert.match(staffUi, /\/api\/cashier\/employee-deposits\/payments\/\$\{encodeURIComponent\(img\.dataset\.depositPhoto\)\}\/photo/);
  assert.match(staffHtml, /\/staff\.js\?v=20261006-portal-lihat-v2/, 'versi staff.js dibump supaya browser lama ikut ambil');
  assert.match(staffHtml, /data-staff-tab="setor"/, 'Setor Uang punya tombol sendiri');
  assert.match(staffHtml, /id="staffPanelSetor"/);
  assert.match(staffUi, /function renderSetorForm/);
  assert.match(staffUi, /function renderDeposits/);
  assert.match(staffUi, /Tutup laci jam/, 'riwayat setoran menampilkan jam tutup laci');
});

test('panel Admin punya tab sendiri "Setoran CS": antrean dengan foto, ACC/Tolak manual, sisa piutang, riwayat', () => {
  const adminUi = readFileSync(new URL('../public/admin-employee-deposits.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
  const nav = readFileSync(new URL('../public/nav-groups.js', import.meta.url), 'utf8');
  const pkg = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  assert.match(adminUi, /\/api\/admin\/employee-deposits\/overview/);
  assert.match(adminUi, /data-approve-payment/);
  assert.match(adminUi, /data-reject-payment/);
  assert.match(adminUi, /\/api\/admin\/employee-deposits\/payments\/\$\{encodeURIComponent\(img\.dataset\.depositPhoto\)\}\/photo/);
  assert.match(html, /<script src="\/admin-employee-deposits\.js/);
  assert.match(nav, /'setoran-cs'/, 'tab didaftarkan ke grupnya di nav-groups.js');
  assert.match(pkg, /public\/admin-employee-deposits\.js/, 'file baru masuk script check');
  const karyawan = readFileSync(new URL('../public/admin-employees.js', import.meta.url), 'utf8');
  assert.doesNotMatch(karyawan, /depositPendingList/, 'antrean pindah ke tab Setoran CS, tidak dobel di tab Karyawan');
});

test('migration 0136 hanya menambah kolom foto bukti setoran', () => {
  const migration = readFileSync(new URL('../migrations/0136_employee_deposit_proof_photo.sql', import.meta.url), 'utf8');
  assert.match(migration, /ALTER TABLE operational_receivable_payable_payments ADD COLUMN proof_photo BLOB/);
  assert.match(migration, /ALTER TABLE operational_receivable_payable_payments ADD COLUMN proof_photo_type TEXT/);
  assert.doesNotMatch(migration, /DROP|DELETE|UPDATE/i);
});

test('migration 0075 additive: tambah split drawer dan akun canonical tanpa mengubah fakta operasional lama', () => {
  const migration = readFileSync(new URL('../migrations/0075_drawer_deposit_split.sql', import.meta.url), 'utf8');
  assert.match(migration, /ALTER TABLE cash_drawer_sessions ADD COLUMN deposit_amount INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /'1202', 'Piutang Karyawan',\s*'ASSET', 'RECEIVABLE'/);
  assert.doesNotMatch(
    migration,
    /(?:DROP TABLE|DELETE FROM|UPDATE)\s+(?:cash_drawer_sessions|operational_receivables_payables|operational_receivable_payable_payments)/i
  );
});

// Bos Cyo, 2026-10-03: kasir mengisi "Titip laci", setoran otomatis = saldo kas fisik
// - titip laci. Contoh: laci 200rb, titip 100rb -> setoran 100rb. Kalau kasir mengisi
// setoran sendiri, sisa uang di laci tidak ikut dicek -- makanya kolom setoran dihapus.
test('tutup laci dengan titip laci: setoran dihitung otomatis dan modal shift berikutnya = titip laci', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'titiplaci', 'Kasir Titip');
    const env = { DB: new D1Database(db) };
    await openDrawer(env, cashier.token, 50000);

    const { status, body } = await closeDrawer(env, cashier.token, { closingAmount: 200000, leftInDrawerAmount: 100000 });
    assert.equal(status, 200);
    assert.ok(body.employeeDeposit, 'setoran Rp100.000 jadi piutang');
    const drawer = db.prepare("SELECT closing_amount, deposit_amount FROM cash_drawer_sessions WHERE status = 'CLOSED' ORDER BY closed_at DESC LIMIT 1").get();
    assert.equal(drawer.closing_amount, 200000);
    assert.equal(drawer.deposit_amount, 100000);
    const receivable = db.prepare("SELECT original_amount FROM operational_receivables_payables WHERE source_type = 'EMPLOYEE_DEPOSIT'").get();
    assert.equal(Number(receivable.original_amount), 100000 * 1_000_000);
  } finally { db.close(); }
});

test('titip laci sama dengan saldo -> tidak ada setoran; titip laci lebih besar dari saldo ditolak; titip laci menang atas depositAmount lama', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'titiplaci2', 'Kasir Titip Dua');
    const env = { DB: new D1Database(db) };
    await openDrawer(env, cashier.token, 50000);

    const tooMuch = await closeDrawer(env, cashier.token, { closingAmount: 100000, leftInDrawerAmount: 150000 });
    assert.equal(tooMuch.status, 400);
    assert.match(tooMuch.body.error, /Taruh uang laci/);

    const { status, body } = await closeDrawer(env, cashier.token, { closingAmount: 100000, leftInDrawerAmount: 100000, depositAmount: 70000 });
    assert.equal(status, 200);
    assert.equal(body.employeeDeposit, null, 'semua ditinggal di laci -> setoran 0');
    assert.equal(db.prepare("SELECT deposit_amount FROM cash_drawer_sessions WHERE status = 'CLOSED' ORDER BY closed_at DESC LIMIT 1").get().deposit_amount, 0);
  } finally { db.close(); }
});

test('UI tutup laci: kolom Taruh uang laci (wajib) + pratinjau Setoran di dialog biasa, dialog foto, dan dialog pengajuan', () => {
  const photo = readFileSync(new URL('../public/cashier-live-photo.js', import.meta.url), 'utf8');
  const cashierJs = readFileSync(new URL('../public/cashier.js', import.meta.url), 'utf8');
  assert.match(photo, /leftInDrawerAmount/);
  assert.match(photo, /Taruh uang laci wajib diisi/);
  assert.match(photo, /dialogDepositPreview/);
  assert.doesNotMatch(photo, /Selisih/);
  assert.doesNotMatch(photo, /depositAmount/);
  assert.match(cashierJs, /dialogLeftAmount/);
  assert.match(cashierJs, /dialogPermitLeftAmount/);
  assert.doesNotMatch(cashierJs, /dialogDepositAmount|dialogPermitDepositAmount/);
  assert.match(readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8'), /cashier-live-photo\.js\?v=20261004-setoran-laci-v1/);
});

// Bos Cyo, 2026-10-04: Detail Laci tidak lagi bicara "Selisih" untuk uang yang dibawa CS.
// Uang di laci = Taruh uang laci + Setoran, dan Setoran langsung jadi piutang di jurnal.
test('Detail Laci memuat Taruh uang laci + Setoran, dan setoran langsung terjurnal sebagai piutang saat laci ditutup', async () => {
  const db = migratedDatabase();
  try {
    const cashier = await seedCashier(db, 'detaillaci', 'Kasir Detail');
    const env = { DB: new D1Database(db) };
    await openDrawer(env, cashier.token, 50000);
    const { status, body } = await closeDrawer(env, cashier.token, { closingAmount: 200000, leftInDrawerAmount: 120000 });
    assert.equal(status, 200);
    const drawerId = db.prepare("SELECT id FROM cash_drawer_sessions WHERE status = 'CLOSED' ORDER BY closed_at DESC LIMIT 1").get().id;

    const report = await buildDrawerReport(env.DB, STORE_ID, drawerId);
    assert.equal(report.totals.closingAmount, 200000);
    assert.equal(report.totals.leftInDrawerAmount, 120000);
    assert.equal(report.totals.depositAmount, 80000);
    assert.equal(report.totals.leftInDrawerAmount + report.totals.depositAmount, report.totals.closingAmount);

    const lines = db.prepare(`
      SELECT l.side, l.amount_scaled, a.code
      FROM accounting_journal_lines l
      JOIN accounting_journal_headers h ON h.id = l.journal_id AND h.store_id = l.store_id
      JOIN chart_of_accounts a ON a.id = l.account_id AND a.store_id = l.store_id
      WHERE h.source_system = 'EMPLOYEE_DEPOSIT' AND h.source_reference_id = ?
      ORDER BY l.line_number
    `).all(body.employeeDeposit.id);
    assert.deepEqual(lines.map(row => ({ ...row })), [
      { side: 'DEBIT', amount_scaled: 80000 * 1_000_000, code: '1202' },
      { side: 'CREDIT', amount_scaled: 80000 * 1_000_000, code: '1101' }
    ]);
  } finally { db.close(); }
});

test('UI Detail Laci: baris "Selisih Kas" diganti Taruh uang laci + Setoran; baris lebih/kurang hanya muncul bila ada angkanya', () => {
  const ui = readFileSync(new URL('../public/drawer-report-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /'Selisih Kas'/);
  assert.match(ui, /Taruh uang laci \(modal shift berikutnya\)/);
  assert.match(ui, /Setoran \(dibawa CS, jadi piutang setoran\)/);
  assert.match(ui, /totals\.cashDifference \?/, 'baris lebih/kurang disembunyikan saat 0');
  const branchAdmin = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
  const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');
  assert.match(branchAdmin, /drawer-report-ui\.js\?v=20261004-setoran-laci-v1/);
  assert.match(cashierHtml, /drawer-report-ui\.js\?v=20261004-setoran-laci-v1/);
  assert.match(branchAdmin, /admin-employees\.js\?v=20261004-setoran-jam-v1/);
});
