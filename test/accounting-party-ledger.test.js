import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { postAccountingJournal } from '../src/accounting-ledger.js';

// Bos Cyo, 2026-10-05: "piutang dan hutang wajib kasih nama". Jurnal manual ke akun piutang/hutang
// tanpa nama pihak membuat saldo per karyawan (setoran) tidak sinkron dengan buku. Server menolak,
// nama disimpan atomik bersama jurnalnya, dan masuk ke saldo/mutasi setoran karyawan.

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
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_p', 'owner_p', 'x', 'Bos')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_p', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-p'));
  db.prepare(`INSERT INTO employees (id, entity_id, home_store_id, full_name, status) VALUES ('emp_sari', 'ENT-KPM', 'store_pendem', 'Sari', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO employees (id, entity_id, home_store_id, full_name, status) VALUES ('emp_lama', 'ENT-KPM', 'store_pendem', 'Lama', 'INACTIVE')`).run();
  db.prepare(`INSERT INTO suppliers (id, store_id, name) VALUES ('sup_1', 'store_pendem', 'Toko Maju')`).run();
  const acc = code => db.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = 'store_pendem' AND code = ?`).get(code).id;
  return { db, env: { DB: new D1Database(db) }, acc };
}

const call = (env, path, body, method) => worker.fetch(new Request(`https://example.test${path}${path.includes('?') ? '&' : '?'}store=PENDEM`, {
  method: method || (body ? 'POST' : 'GET'),
  headers: { Authorization: 'Bearer owner-p', ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined
}), env);

const journal = (lines, extra = {}) => ({ businessDate: '2026-10-05', description: 'Tes jurnal manual', journalLines: lines, ...extra });

test('jurnal manual ke Piutang Karyawan tanpa nama ditolak; dengan karyawan tersimpan bersama jurnalnya', async () => {
  const { db, env, acc } = await setup();
  try {
    const tanpaNama = await call(env, '/api/admin/accounting/journals', journal([
      { accountId: acc('1202'), side: 'DEBIT', amountExact: '150000' },
      { accountId: acc('1101'), side: 'CREDIT', amountExact: '150000' }
    ]));
    assert.equal(tanpaNama.status, 400);
    assert.equal((await tanpaNama.json()).code, 'PARTY_REQUIRED');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_journal_headers').get().n, 0, 'tidak ada jurnal yang terposting');

    const nonaktif = await call(env, '/api/admin/accounting/journals', journal([
      { accountId: acc('1202'), side: 'DEBIT', amountExact: '150000', party: { employeeId: 'emp_lama' } },
      { accountId: acc('1101'), side: 'CREDIT', amountExact: '150000' }
    ]));
    assert.equal((await nonaktif.json()).code, 'PARTY_INVALID', 'karyawan nonaktif / bukan entity ini ditolak');

    const ok = await call(env, '/api/admin/accounting/journals', journal([
      { accountId: acc('1202'), side: 'DEBIT', amountExact: '150000', party: { employeeId: 'emp_sari' } },
      { accountId: acc('1101'), side: 'CREDIT', amountExact: '150000' }
    ]));
    assert.equal(ok.status, 201, await ok.clone().text());
    const entries = db.prepare('SELECT employee_id, party_name, account_code, side, amount_scaled FROM accounting_party_entries').all();
    assert.equal(entries.length, 1, 'baris Kas tidak butuh nama');
    assert.deepEqual({ ...entries[0] }, { employee_id: 'emp_sari', party_name: 'Sari', account_code: '1202', side: 'DEBIT', amount_scaled: 150_000_000_000 });
  } finally { db.close(); }
});

test('Utang Usaha: pemasok terdaftar atau nama bebas; Utang Gaji harus karyawan; piutang usaha cukup nama', async () => {
  const { db, env, acc } = await setup();
  try {
    const post = (accountCode, party, side = 'CREDIT') => call(env, '/api/admin/accounting/journals', journal([
      { accountId: acc(accountCode), side, amountExact: '1000', ...(party ? { party } : {}) },
      { accountId: acc('3101'), side: side === 'CREDIT' ? 'DEBIT' : 'CREDIT', amountExact: '1000' }
    ], { sourceReferenceId: `ref_${accountCode}_${Math.random()}` }));

    assert.equal((await post('2101')).status, 400, 'Utang Usaha tanpa nama');
    assert.equal((await post('2101', { supplierId: 'sup_tidak_ada' })).status, 400);
    assert.equal((await post('2101', { supplierId: 'sup_1' })).status, 201);
    assert.equal((await post('2101', { name: 'Warung Sebelah' })).status, 201);
    assert.equal((await post('2102', { name: 'Sari' })).status, 400, 'Utang Gaji wajib pilih karyawan terdaftar, bukan ketik nama');
    assert.equal((await post('2102', { employeeId: 'emp_sari' })).status, 201);
    assert.equal((await post('1201', { name: 'A' }, 'DEBIT')).status, 400, 'nama minimal 2 huruf');
    assert.equal((await post('1201', { name: 'Pak Budi' }, 'DEBIT')).status, 201);
    assert.equal((await post('2103', null)).status, 400);
    const names = db.prepare('SELECT party_type, party_name FROM accounting_party_entries ORDER BY created_at, id').all().map(row => [row.party_type, row.party_name]);
    assert.deepEqual(names.map(row => row[1]).sort(), ['Pak Budi', 'Sari', 'Toko Maju', 'Warung Sebelah']);
  } finally { db.close(); }
});

test('mutasi manual 1202 masuk saldo setoran karyawan (panel Admin) dan pilihan nama tersedia', async () => {
  const { db, env, acc } = await setup();
  try {
    const options = await (await call(env, '/api/admin/accounting/party-options')).json();
    assert.deepEqual(options.employees.map(row => row.name), ['Sari'], 'hanya karyawan aktif');
    assert.deepEqual(options.suppliers.map(row => row.name), ['Toko Maju']);
    assert.equal(options.rules['1202'], 'EMPLOYEE');

    // Piutang setoran laci Sari Rp100.000 (jalur Operasional), lalu akuntan menambah Rp25.000 dan menguranginya Rp5.000.
    db.prepare(`
      INSERT INTO operational_receivables_payables (id, store_id, entity_id, source_type, balance_type, source_id, counterparty_id, counterparty_name_snapshot, description, original_amount, transaction_date)
      VALUES ('orp_1', 'store_pendem', 'ENT-KPM', 'EMPLOYEE_DEPOSIT', 'RECEIVABLE', 'drawer_x', 'emp_sari', 'Sari', 'Setoran laci', 100000000000, '2026-10-04')
    `).run();
    for (const [side, amount] of [['DEBIT', '25000'], ['CREDIT', '5000']]) {
      const res = await call(env, '/api/admin/accounting/journals', journal([
        { accountId: acc('1202'), side, amountExact: amount, party: { employeeId: 'emp_sari' }, description: 'Penyesuaian akuntan' },
        { accountId: acc('3101'), side: side === 'DEBIT' ? 'CREDIT' : 'DEBIT', amountExact: amount }
      ], { sourceReferenceId: `ref_${side}` }));
      assert.equal(res.status, 201, await res.clone().text());
    }
    const overview = await (await call(env, '/api/admin/employee-deposits/overview')).json();
    const sari = overview.balances.find(row => row.employeeName === 'Sari');
    assert.equal(sari.originalAmountRupiah, 100000);
    assert.equal(sari.manualAdjustmentRupiah, 20000);
    assert.equal(sari.balanceRupiah, 120000);
    assert.equal(sari.manualEntries.length, 2);
  } finally { db.close(); }
});

test('cek sinkron: jurnal ke piutang tanpa nama (jalur sistem/lama) terdeteksi, yang bernama dan setoran tidak', async () => {
  const { db, env, acc } = await setup();
  try {
    const bersih = await (await call(env, '/api/admin/accounting/party-reconciliation')).json();
    assert.equal(bersih.allInSync, true);

    await call(env, '/api/admin/accounting/journals', journal([
      { accountId: acc('1202'), side: 'DEBIT', amountExact: '40000', party: { employeeId: 'emp_sari' } },
      { accountId: acc('1101'), side: 'CREDIT', amountExact: '40000' }
    ]));
    // Jurnal lama / jalur lain yang tidak menyebut nama (dibuat langsung lewat mesin jurnal, bukan form).
    const store = { id: 'store_pendem', entityId: 'ENT-KPM' };
    const lama = await postAccountingJournal(env.DB, store, {
      businessDate: '2026-10-01', sourceSystem: 'MANUAL', sourceReferenceId: 'lama_1', idempotencyKey: 'MANUAL:store_pendem:lama_1',
      description: 'Jurnal lama tanpa nama',
      journalLines: [
        { accountId: acc('1202'), side: 'DEBIT', amountExact: '70000' },
        { accountId: acc('1101'), side: 'CREDIT', amountExact: '70000' }
      ]
    });
    assert.equal(lama.ok, true);

    const hasil = await (await call(env, '/api/admin/accounting/party-reconciliation')).json();
    const piutang = hasil.accounts.find(row => row.accountCode === '1202');
    assert.equal(piutang.glBalanceRupiah, 110000);
    assert.equal(piutang.namedRupiah, 40000);
    assert.equal(piutang.unnamedRupiah, 70000);
    assert.equal(piutang.inSync, false);
    assert.equal(piutang.unnamedItems[0].description, 'Jurnal lama tanpa nama');
    assert.equal(hasil.allInSync, false);
    assert.deepEqual(piutang.parties.map(row => [row.name, row.balanceRupiah]), [['Sari', 40000]]);
  } finally { db.close(); }
});

test('form jurnal manual menampilkan pemilih nama dan mengirim party; migration punya entity_id', () => {
  const ui = readFileSync(new URL('../public/admin-accounting-workspace.js', import.meta.url), 'utf8');
  assert.match(ui, /data-line-party-id/);
  assert.match(ui, /\/api\/admin\/accounting\/party-options/);
  assert.match(ui, /\/api\/admin\/accounting\/party-reconciliation/);
  const html = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
  assert.match(html, /admin-accounting-workspace\.js\?v=20261005-nama-piutang-v1/);
  const sql = readFileSync(new URL('../migrations/0138_accounting_party_entries.sql', import.meta.url), 'utf8');
  assert.match(sql, /entity_id TEXT/);
});
