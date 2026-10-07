import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { addOperationalPayment } from '../src/operational-receivables-payables.js';
import { listPosPaymentMethods } from '../src/pos-payment-methods.js';
import { listSetoranHolders } from '../src/hutang-piutang.js';
import { dispatchAdminAccountingFact } from '../src/accounting-admin-bridge.js';
import { postPendingEmployeeDepositJournals } from '../src/employee-deposit-settlement.js';
import { getPartyReconciliation } from '../src/accounting-party-ledger.js';

// Bos Cyo, 2026-10-06: "setiap gerai aktifkan rekening bersama, dan masukkan rekening bersama itu
// pilihan pembayaran ... ketika cs mau setoran itu nanti setornya ke rekening bersama. piutang
// kredit, rekber debet. hutang2 gaji juga dibayar pake rekber. tapi sediakan juga ... hutang gaji
// bisa dibayar pake ... piutang dari cs yang bawa setoran itu".

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
  batch(statements) {
    this.db.exec('BEGIN');
    try { const out = statements.map(s => s.run()); this.db.exec('COMMIT'); return out; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_rb', 'owner_rb', 'x', 'Bos')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_rb', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-rb'));
  db.prepare(`INSERT INTO employees (id, entity_id, home_store_id, full_name, status) VALUES ('emp_cs', 'ENT-KPM', 'store_pendem', 'Sari CS', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO employees (id, entity_id, home_store_id, full_name, status) VALUES ('emp_gaji', 'ENT-KPM', 'store_pendem', 'Budi', 'ACTIVE')`).run();
  return { db, env: { DB: new D1Database(db) } };
}

const call = (env, path, body, method) => worker.fetch(new Request(`https://example.test${path}${path.includes('?') ? '&' : '?'}store=PENDEM`, {
  method: method || (body ? 'POST' : 'GET'),
  headers: { Authorization: 'Bearer owner-rb', ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined
}), env);

async function createSharedAccount(env) {
  const res = await call(env, '/api/entity/shared-accounts', { name: 'Rekening Bersama Malang' });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()).account;
}

function seedSetoran(db, { id = 'orp_setor_1', amountRupiah = 200000, date = '2026-10-05' } = {}) {
  db.prepare(`
    INSERT INTO operational_receivables_payables (id, store_id, entity_id, source_type, balance_type, source_id, counterparty_id, counterparty_name_snapshot, counterparty_type, description, original_amount, transaction_date)
    VALUES (?, 'store_pendem', 'ENT-KPM', 'EMPLOYEE_DEPOSIT', 'RECEIVABLE', ?, 'emp_cs', 'Sari CS', 'EMPLOYEE', 'Setoran laci', ?, ?)
  `).run(id, `drawer_${id}`, amountRupiah * 1_000_000, date);
}

const lines = (db, journalId) => db.prepare(`
  SELECT a.code, l.side, l.amount_scaled FROM accounting_journal_lines l JOIN chart_of_accounts a ON a.id = l.account_id
  WHERE l.journal_id = ? ORDER BY l.line_number
`).all(journalId).map(row => [row.code, row.side, Number(row.amount_scaled)]);

test('Pasang Rekening Bersama di semua gerai: cara bayar baru tersambung ke 1103 + Rekening Bersama, idempotent', async () => {
  const { db, env } = await setup();
  try {
    const account = await createSharedAccount(env);
    const first = await (await call(env, `/api/entity/shared-accounts/${account.id}/activate-stores`, {})).json();
    const kpmStores = db.prepare(`SELECT COUNT(*) n FROM stores WHERE entity_id = 'ENT-KPM' AND is_active = 1`).get().n;
    assert.equal(first.stores.length, kpmStores);
    assert.ok(first.stores.every(row => row.status === 'DIBUAT'));
    const pendem = db.prepare(`
      SELECT pm.code, pm.is_default, a.code AS account_code FROM payment_methods pm
      LEFT JOIN chart_of_accounts a ON a.id = pm.account_id WHERE pm.store_id = 'store_pendem' AND pm.shared_account_id = ?
    `).all(account.id);
    assert.deepEqual(pendem.map(row => ({ ...row })), [{ code: 'REKBER', is_default: 0, account_code: '1103' }]);

    const again = await (await call(env, `/api/entity/shared-accounts/${account.id}/activate-stores`, {})).json();
    assert.ok(again.stores.every(row => row.status === 'SUDAH_AKTIF'));
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM payment_methods WHERE shared_account_id = ?`).get(account.id).n, kpmStores, 'tidak dobel');

    // Kasir langsung melihatnya di pilihan bayar; Kas tetap default.
    const methods = await listPosPaymentMethods(env.DB, 'store_pendem');
    assert.ok(methods.some(row => row.code === 'REKBER'));
    assert.equal(methods.find(row => row.isDefault)?.code, 'CASH');

    // Gerai entity lain tidak tersentuh.
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM payment_methods pm JOIN stores s ON s.id = pm.store_id WHERE s.entity_id <> 'ENT-KPM' AND pm.shared_account_id IS NOT NULL`).get().n, 0);
  } finally { db.close(); }
});

test('Setoran CS ke Rekening Bersama: ACC menaikkan saldo gerai + jurnal Dr 1103 / Cr 1202; ACC ulang tidak dobel', async () => {
  const { db, env } = await setup();
  try {
    const account = await createSharedAccount(env);
    seedSetoran(db);
    const { payment } = await addOperationalPayment(env.DB, 'orp_setor_1', { amountRupiah: 150000, proofReference: 'Foto bukti transfer', sharedAccountId: account.id, submittedBy: 'kasir' }, { storeId: 'store_pendem' });

    const acc = await call(env, `/api/admin/employee-deposits/payments/${payment.id}`, { action: 'APPROVE' }, 'PATCH');
    assert.equal(acc.status, 200, await acc.clone().text());
    const body = await acc.json();
    assert.equal(body.accounting.status, 'POSTED');
    assert.deepEqual(lines(db, body.accounting.journalId), [['1103', 'DEBIT', 150_000_000_000], ['1202', 'CREDIT', 150_000_000_000]]);

    const ledger = db.prepare(`SELECT store_id, direction, amount, source_type, source_kind, source_id FROM entity_shared_account_ledger WHERE shared_account_id = ?`).all(account.id);
    assert.deepEqual(ledger.map(row => ({ ...row })), [{ store_id: 'store_pendem', direction: 'IN', amount: 150000, source_type: 'EXPENSE', source_kind: 'SETORAN_CS', source_id: payment.id }]);
    assert.ok(db.prepare(`SELECT shared_ledger_id FROM operational_receivable_payable_payments WHERE id = ?`).get(payment.id).shared_ledger_id);

    const ulang = await call(env, `/api/admin/employee-deposits/payments/${payment.id}`, { action: 'APPROVE' }, 'PATCH');
    assert.equal(ulang.status, 200);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM entity_shared_account_ledger WHERE shared_account_id = ?`).get(account.id).n, 1, 'ACC ulang tidak menulis baris kedua');

    const view = await (await call(env, `/api/entity/shared-accounts/${account.id}/view`)).json();
    assert.equal(view.total, 150000);
    const mutasi = await (await call(env, `/api/entity/shared-accounts/${account.id}/ledger?storeId=store_pendem&limit=10`)).json();
    assert.equal(mutasi.entries.length, 1);
    assert.equal(mutasi.entries[0].sourceKind, 'SETORAN_CS');
    assert.equal(mutasi.hasMore, false);
    const nyasar = await call(env, `/api/entity/shared-accounts/${account.id}/ledger?storeId=store_bukan_entity_ini`);
    assert.equal(nyasar.status, 404, 'gerai di luar entity ditolak');
  } finally { db.close(); }
});

test('Setoran lama tanpa tujuan Rekening Bersama tetap dijurnal ke Kas', async () => {
  const { db, env } = await setup();
  try {
    seedSetoran(db);
    const { payment } = await addOperationalPayment(env.DB, 'orp_setor_1', { amountRupiah: 50000, proofReference: 'Foto bukti transfer', submittedBy: 'kasir' }, { storeId: 'store_pendem' });
    const body = await (await call(env, `/api/admin/employee-deposits/payments/${payment.id}`, { action: 'APPROVE' }, 'PATCH')).json();
    assert.deepEqual(lines(db, body.accounting.journalId), [['1101', 'DEBIT', 50_000_000_000], ['1202', 'CREDIT', 50_000_000_000]]);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM entity_shared_account_ledger`).get().n, 0);
  } finally { db.close(); }
});

test('Hutang gaji dibayar dari uang setoran yang dipegang CS: piutang CS berkurang, jurnal Dr 2102 / Cr 1202, bisa dibatalkan', async () => {
  const { db, env } = await setup();
  try {
    seedSetoran(db, { id: 'orp_a', amountRupiah: 60000, date: '2026-10-03' });
    seedSetoran(db, { id: 'orp_b', amountRupiah: 80000, date: '2026-10-04' });
    db.prepare(`
      INSERT INTO payroll_ledger_entries (id, employee_id, store_id, business_date, entry_type, hutang_gaji_delta_scaled, beban_gaji_delta_scaled, source_type, source_id, description)
      VALUES ('gaji_budi', 'emp_gaji', 'store_pendem', '2026-10-05', 'ADJUSTMENT', 100000000000, 100000000000, 'BEA_OPERASIONAL', 'seed_gaji_budi', 'Gaji Budi')
    `).run();
    const summary = await (await call(env, '/api/admin/hutang-piutang')).json();
    assert.deepEqual(summary.setoranHolders, [{ employeeId: 'emp_cs', name: 'Sari CS', balanceRupiah: 140000 }]);
    const gaji = summary.persons.flatMap(person => person.accounts.map(account => ({ person, account }))).find(row => row.account.account === 'GAJI' && row.person.counterpartyName === 'Budi');
    assert.ok(gaji, JSON.stringify(summary.persons));

    const kelebihan = await call(env, '/api/admin/hutang-piutang/payments', { accountKey: gaji.account.accountKey, amount: 150000, paymentMethod: 'SETORAN', setoranEmployeeId: 'emp_cs', businessDate: '2026-10-06' });
    assert.equal(kelebihan.status, 400, 'tidak boleh lebih dari uang yang dipegang CS');

    const res = await call(env, '/api/admin/hutang-piutang/payments', { accountKey: gaji.account.accountKey, amount: 100000, paymentMethod: 'SETORAN', setoranEmployeeId: 'emp_cs', businessDate: '2026-10-06' });
    assert.equal(res.status, 201, await res.clone().text());
    const paid = await res.json();
    assert.equal(paid.payment.paymentMethodLabel, 'Setoran CS Sari CS');
    assert.deepEqual(paid.setoranHolders, [{ employeeId: 'emp_cs', name: 'Sari CS', balanceRupiah: 40000 }]);
    // FIFO: setoran tertua habis dulu.
    const draws = db.prepare(`SELECT receivable_payable_id, amount FROM operational_receivable_payable_payments WHERE admin_payment_id = ? ORDER BY amount DESC`).all(paid.payment.id);
    assert.deepEqual(draws.map(row => [row.receivable_payable_id, Number(row.amount)]), [['orp_a', 60_000_000_000], ['orp_b', 40_000_000_000]]);

    await dispatchAdminAccountingFact(env.DB, 'BAYAR_HUTANG', paid.payment.id);
    const delivery = db.prepare(`SELECT status, journal_id FROM accounting_bridge_deliveries WHERE fact_type = 'BAYAR_HUTANG' AND fact_id = ?`).get(paid.payment.id);
    assert.equal(delivery.status, 'POSTED');
    assert.deepEqual(lines(db, delivery.journal_id), [['2102', 'DEBIT', 100_000_000_000], ['1202', 'CREDIT', 100_000_000_000]]);

    // Penarikan setoran itu bukan "setoran masuk Kas": tidak boleh ikut dijurnal ulang sebagai pelunasan.
    const store = db.prepare(`SELECT id, edition FROM stores WHERE id = 'store_pendem'`).get();
    await postPendingEmployeeDepositJournals(env.DB, store.id);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM accounting_journal_headers WHERE source_system = 'EMPLOYEE_DEPOSIT' AND source_reference_id IN (SELECT id FROM operational_receivable_payable_payments WHERE admin_payment_id = ?)`).get(paid.payment.id).n, 0);

    // Cek Sinkron: setoran di buku = setoran per karyawan.
    const recon = await getPartyReconciliation(env.DB, { id: 'store_pendem', entityId: 'ENT-KPM' });
    assert.equal(recon.setoran.inSync, true, JSON.stringify(recon.setoran));

    // Batal: uang setoran CS kembali utuh.
    const batal = await call(env, `/api/admin/hutang-piutang/payments/${paid.payment.id}/void`, { reason: 'salah pilih' });
    assert.equal(batal.status, 200, await batal.clone().text());
    assert.equal((await listSetoranHolders(env.DB, 'store_pendem'))[0].balanceRupiah, 140000);
  } finally { db.close(); }
});
