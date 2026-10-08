import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { dispatchAdminAccountingFact } from '../src/accounting-admin-bridge.js';
import {
  postEmployeeDepositRecognitionJournal,
  postEmployeeDepositSettlementJournal
} from '../src/accounting-employee-deposit-bridge.js';

// ADR-054 (Bos Cyo, 2026-10-08): "output program wajib masuk akuntansi, data akuntansi itulah yang
// ditampilkan di semua data tentang keuangan". Saldo per orang hanya bisa dibaca dari buku kalau
// setiap jurnal OTOMATIS pada akun Hutang Gaji (2102) / Piutang Karyawan (1202) membawa nama
// orangnya -- dulu hanya jurnal manual akuntan yang bernama.

const migrationDir = new URL('../migrations/', import.meta.url);
const srcDir = new URL('../src/', import.meta.url);

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
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_an', 'owner_an', 'x', 'Bos')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_an', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-an'));
  db.prepare(`INSERT INTO employees (id, entity_id, home_store_id, full_name, status) VALUES ('emp_cs', 'ENT-KPM', 'store_pendem', 'Sari CS', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO employees (id, entity_id, home_store_id, full_name, status) VALUES ('emp_gaji', 'ENT-KPM', 'store_pendem', 'Budi', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id) VALUES ('cashier_lepas', 'kasir_lepas', 'x', 'Rina Lepas', 'store_pendem')`).run();
  return { db, env: { DB: new D1Database(db) } };
}

const call = (env, path, body, method) => worker.fetch(new Request(`https://example.test${path}${path.includes('?') ? '&' : '?'}store=PENDEM`, {
  method: method || (body ? 'POST' : 'GET'),
  headers: { Authorization: 'Bearer owner-an', ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined
}), env);

// [kode akun, sisi, id orang, nama] per baris jurnal yang bernama.
const named = (db, journalId) => db.prepare(`
  SELECT account_code, side, employee_id, party_name FROM accounting_party_entries
  WHERE journal_id = ? ORDER BY journal_line_id
`).all(journalId).map(row => [row.account_code, row.side, row.employee_id, row.party_name]);

const journalOf = (db, factType, factId) => db.prepare(`
  SELECT status, journal_id FROM accounting_bridge_deliveries WHERE fact_type = ? AND fact_id = ?
`).get(factType, factId);

// Saldo Hutang Gaji (2102) per orang menurut buku: Kredit - Debit.
const hutangGajiBuku = (db, employeeId) => Number(db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN side = 'CREDIT' THEN amount_scaled ELSE -amount_scaled END), 0) AS n
  FROM accounting_party_entries WHERE account_code = '2102' AND employee_id = ?
`).get(employeeId).n);

function seedAccrual(db, { id, employeeId = null, accountId = null, amountRupiah }) {
  db.prepare(`
    INSERT INTO payroll_ledger_entries (id, employee_id, account_type, account_id, store_id, business_date, entry_type,
      hutang_gaji_delta_scaled, beban_gaji_delta_scaled, source_type, source_id, description)
    VALUES (?, ?, 'CASHIER', ?, 'store_pendem', '2026-10-07', 'ACCRUAL', ?, ?, 'ATTENDANCE', ?, 'Gaji presensi 2026-10-07')
  `).run(id, employeeId, accountId || 'cashier_pendem_pilot', amountRupiah * 1_000_000, amountRupiah * 1_000_000, `att_${id}`);
}

test('Gaji presensi: baris Utang Gaji di buku tertulis atas nama karyawannya, akun kasir lepas atas nama akunnya', async () => {
  const { db, env } = await setup();
  try {
    seedAccrual(db, { id: 'acc_budi', employeeId: 'emp_gaji', amountRupiah: 50000 });
    seedAccrual(db, { id: 'acc_rina', accountId: 'cashier_lepas', amountRupiah: 40000 });
    assert.equal((await dispatchAdminAccountingFact(env.DB, 'GAJI_PRESENSI', 'acc_budi')).status, 'POSTED');
    assert.equal((await dispatchAdminAccountingFact(env.DB, 'GAJI_PRESENSI', 'acc_rina')).status, 'POSTED');
    assert.deepEqual(named(db, journalOf(db, 'GAJI_PRESENSI', 'acc_budi').journal_id), [['2102', 'CREDIT', 'emp_gaji', 'Budi']]);
    assert.deepEqual(named(db, journalOf(db, 'GAJI_PRESENSI', 'acc_rina').journal_id), [['2102', 'CREDIT', 'cashier:cashier_lepas', 'Rina Lepas']]);
  } finally { db.close(); }
});

test('Bea Gaji (penyesuaian) tertulis atas nama karyawan; dibatalkan -> jurnal pembalik mewarisi namanya', async () => {
  const { db, env } = await setup();
  try {
    const res = await call(env, '/api/admin/operational-expenses', { category: 'BEA_GAJI', employeeId: 'emp_gaji', amount: 25000, description: 'Bonus lembur' });
    assert.equal(res.status, 201, await res.clone().text());
    const expense = await res.json();
    const posted = journalOf(db, 'BEA', expense.id);
    assert.equal(posted.status, 'POSTED');
    assert.deepEqual(named(db, posted.journal_id), [['2102', 'CREDIT', 'emp_gaji', 'Budi']]);
    assert.equal(hutangGajiBuku(db, 'emp_gaji'), 25_000_000_000);

    const batal = await call(env, `/api/admin/operational-expenses/${expense.id}/void`, { reason: 'salah input' });
    assert.equal(batal.status, 200, await batal.clone().text());
    const reversal = journalOf(db, 'BEA_VOID', expense.id);
    assert.equal(reversal.status, 'POSTED');
    assert.deepEqual(named(db, reversal.journal_id), [['2102', 'DEBIT', 'emp_gaji', 'Budi']]);
    assert.equal(hutangGajiBuku(db, 'emp_gaji'), 0, 'pembatalan ikut mengurangi saldo orang yang sama');
  } finally { db.close(); }
});

test('Setoran CS: pengakuan dan pelunasan Piutang Karyawan tertulis atas nama CS pemegang setoran', async () => {
  const { db, env } = await setup();
  try {
    db.prepare(`
      INSERT INTO operational_receivables_payables (id, store_id, entity_id, source_type, balance_type, source_id, counterparty_id, counterparty_name_snapshot, counterparty_type, description, original_amount, transaction_date)
      VALUES ('orp_s1', 'store_pendem', 'ENT-KPM', 'EMPLOYEE_DEPOSIT', 'RECEIVABLE', 'drawer_s1', 'emp_cs', 'Sari CS', 'EMPLOYEE', 'Setoran laci', 80000000000, '2026-10-07')
    `).run();
    db.prepare(`
      INSERT INTO operational_receivable_payable_payments (id, receivable_payable_id, store_id, entity_id, amount, approval_status, proof_reference, note, submitted_by)
      VALUES ('orpp_s1', 'orp_s1', 'store_pendem', 'ENT-KPM', 30000000000, 'approved', 'tf', '', 'CASHIER:x')
    `).run();
    const store = { id: 'store_pendem', edition: 'ACCOUNTING' };
    const recognition = await postEmployeeDepositRecognitionJournal(env.DB, store, { receivableId: 'orp_s1', businessDate: '2026-10-07', amountScaled: 80_000_000_000 });
    const settlement = await postEmployeeDepositSettlementJournal(env.DB, store, { paymentId: 'orpp_s1', businessDate: '2026-10-08', amountScaled: 30_000_000_000 });
    assert.equal(recognition.ok && settlement.ok, true, JSON.stringify({ recognition, settlement }));
    assert.deepEqual(named(db, recognition.journal.journalId), [['1202', 'DEBIT', 'emp_cs', 'Sari CS']]);
    assert.deepEqual(named(db, settlement.journal.journalId), [['1202', 'CREDIT', 'emp_cs', 'Sari CS']]);
  } finally { db.close(); }
});

test('Hutang gaji dibayar dari setoran CS: Utang Gaji atas nama yang digaji, Piutang atas nama CS pembawa uang', async () => {
  const { db, env } = await setup();
  try {
    db.prepare(`
      INSERT INTO operational_receivables_payables (id, store_id, entity_id, source_type, balance_type, source_id, counterparty_id, counterparty_name_snapshot, counterparty_type, description, original_amount, transaction_date)
      VALUES ('orp_b1', 'store_pendem', 'ENT-KPM', 'EMPLOYEE_DEPOSIT', 'RECEIVABLE', 'drawer_b1', 'emp_cs', 'Sari CS', 'EMPLOYEE', 'Setoran laci', 120000000000, '2026-10-05')
    `).run();
    db.prepare(`
      INSERT INTO payroll_ledger_entries (id, employee_id, store_id, business_date, entry_type, hutang_gaji_delta_scaled, beban_gaji_delta_scaled, source_type, source_id, description)
      VALUES ('gaji_budi', 'emp_gaji', 'store_pendem', '2026-10-05', 'ADJUSTMENT', 100000000000, 100000000000, 'BEA_OPERASIONAL', 'seed_gaji_budi', 'Gaji Budi')
    `).run();
    const summary = await (await call(env, '/api/admin/hutang-piutang')).json();
    const gaji = summary.persons.flatMap(person => person.accounts.map(account => ({ person, account })))
      .find(row => row.account.account === 'GAJI' && row.person.counterpartyName === 'Budi');
    const res = await call(env, '/api/admin/hutang-piutang/payments', { accountKey: gaji.account.accountKey, amount: 100000, paymentMethod: 'SETORAN', setoranEmployeeId: 'emp_cs', businessDate: '2026-10-06' });
    assert.equal(res.status, 201, await res.clone().text());
    const paid = await res.json();
    const posted = journalOf(db, 'BAYAR_HUTANG', paid.payment.id);
    assert.equal(posted.status, 'POSTED');
    assert.deepEqual(named(db, posted.journal_id), [['2102', 'DEBIT', 'emp_gaji', 'Budi'], ['1202', 'CREDIT', 'emp_cs', 'Sari CS']]);

    const batal = await call(env, `/api/admin/hutang-piutang/payments/${paid.payment.id}/void`, { reason: 'salah pilih' });
    assert.equal(batal.status, 200, await batal.clone().text());
    const reversal = journalOf(db, 'BAYAR_HUTANG_VOID', paid.payment.id);
    assert.deepEqual(named(db, reversal.journal_id), [['2102', 'CREDIT', 'emp_gaji', 'Budi'], ['1202', 'DEBIT', 'emp_cs', 'Sari CS']]);
  } finally { db.close(); }
});

// Penjaga (ADR-054): setiap modul yang memposting jurnal harus sudah memutuskan soal "atas nama
// siapa". Modul baru yang memanggil postAccountingJournal tanpa label nama dan tanpa alasan tertulis
// di daftar ini membuat tes gagal -- pembuatnya wajib memikirkan akun dan jurnalnya (dan namanya)
// saat mengoding, bukan belakangan. Daftar ini hanya boleh menyusut.
const TANPA_NAMA_DENGAN_ALASAN = Object.freeze({
  'accounting-pos-bridge.js': 'CELAH DIKETAHUI: penjualan/pembelian kasir ke Piutang Pelanggan 1201 / Utang Usaha 2101 belum bernama (ADR-054 tahap berikutnya).',
  'accounting-cash-flow-bridge.js': 'Arus Kas kasir: Kas dan beban/pendapatan, bukan akun per orang.',
  'accounting-voucher-bridge.js': 'Voucher: pendapatan/diskon, bukan akun per orang.',
  'accounting-warehouse-production-bridge.js': 'Produksi: Persediaan dan HPP, bukan akun per orang.',
  'accounting-standardize.js': 'Standardisasi akun: memindah saldo antar akun sekali jalan; selisihnya tampil di Cek Sinkron sebagai "belum bernama".',
  'accounting-journal-schedules.js': 'CELAH DIKETAHUI: Beban Rutin/Split memakai akun pilihan akuntan; kalau memilih akun bernama, barisnya belum bernama.',
  'accounting-pos-reversal.js': 'Pembalik transaksi kasir: jurnal pembalik mewarisi nama baris aslinya otomatis.',
  'hpp-recalculation.js': 'Koreksi HPP: Persediaan dan HPP (jurnal pembaliknya mewarisi nama otomatis).',
  'stock-adjustment-correction.js': 'Koreksi nilai SO: Persediaan dan beban/pendapatan stok.'
});

test('Penjaga: modul pemosting jurnal wajib memberi nama, atau tercatat alasannya', () => {
  const posters = readdirSync(srcDir)
    .filter(name => name.endsWith('.js') && name !== 'accounting-ledger.js')
    .filter(name => readFileSync(new URL(name, srcDir), 'utf8').includes('postAccountingJournal('));
  const labelled = name => {
    const source = readFileSync(new URL(name, srcDir), 'utf8');
    return /lineParties\s*:/.test(source) || /partyEntryStatements/.test(source);
  };
  const unexplained = posters.filter(name => !labelled(name) && !TANPA_NAMA_DENGAN_ALASAN[name]);
  assert.deepEqual(unexplained, [], 'Modul baru memposting jurnal tanpa nama pihak. Tambahkan lineParties (lihat ADR-054) atau tulis alasannya di TANPA_NAMA_DENGAN_ALASAN.');
  for (const name of Object.keys(TANPA_NAMA_DENGAN_ALASAN)) {
    assert.ok(posters.includes(name), `${name} tidak lagi memposting jurnal: hapus dari daftar pengecualian.`);
  }
  for (const name of ['accounting-admin-bridge.js', 'accounting-employee-deposit-bridge.js', 'accounting-workspace.js']) {
    assert.ok(labelled(name), `${name} harus tetap memberi nama pihak pada jurnalnya.`);
  }
});

test('Migration 0143: jurnal otomatis lama tanpa nama diberi label dari fakta asalnya, tanpa mengubah jurnal', async () => {
  const { db, env } = await setup();
  try {
    seedAccrual(db, { id: 'acc_lama', employeeId: 'emp_gaji', amountRupiah: 30000 });
    await dispatchAdminAccountingFact(env.DB, 'GAJI_PRESENSI', 'acc_lama');
    const journalId = journalOf(db, 'GAJI_PRESENSI', 'acc_lama').journal_id;
    // Keadaan sebelum ADR-054: jurnal otomatis tanpa label.
    db.prepare(`DELETE FROM accounting_party_entries WHERE journal_id = ?`).run(journalId);
    const linesBefore = db.prepare(`SELECT * FROM accounting_journal_lines WHERE journal_id = ? ORDER BY line_number`).all(journalId);

    const sql = readFileSync(new URL('0143_label_nama_jurnal_otomatis.sql', migrationDir), 'utf8');
    db.exec(sql);
    db.exec(sql); // aman dijalankan ulang
    assert.deepEqual(named(db, journalId), [['2102', 'CREDIT', 'emp_gaji', 'Budi']]);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM accounting_party_entries WHERE journal_id = ?`).get(journalId).n, 1);
    assert.deepEqual(db.prepare(`SELECT * FROM accounting_journal_lines WHERE journal_id = ? ORDER BY line_number`).all(journalId), linesBefore);
  } finally { db.close(); }
});

test('Koreksi akuntan pada Hutang Gaji muncul di Riwayat Gaji (Admin, Entity, Portal Staf) dan sisa Hutang Gaji', async () => {
  const { db, env } = await setup();
  try {
    db.prepare(`INSERT INTO employee_account_links (id, employee_id, entity_id, store_id, account_type, account_id, effective_from) VALUES ('lnk_budi', 'emp_gaji', 'ENT-KPM', 'store_pendem', 'CASHIER', 'cashier_pendem_pilot', '2026-01-01T00:00:00.000Z')`).run();
    seedAccrual(db, { id: 'acc_b', employeeId: 'emp_gaji', amountRupiah: 50000 });
    await dispatchAdminAccountingFact(env.DB, 'GAJI_PRESENSI', 'acc_b');
    const acc = code => db.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = 'store_pendem' AND code = ?`).get(code).id;
    const koreksi = await call(env, '/api/admin/accounting/journals', {
      businessDate: '2026-10-08', description: 'Lembur belum tercatat', sourceReferenceId: 'koreksi_budi',
      journalLines: [
        { accountId: acc('6102'), side: 'DEBIT', amountExact: '15000' },
        { accountId: acc('2102'), side: 'CREDIT', amountExact: '15000', party: { employeeId: 'emp_gaji' }, description: 'Lembur 3 jam' }
      ]
    });
    assert.equal(koreksi.status, 201, await koreksi.clone().text());

    const riwayat = await (await call(env, '/api/admin/employees/emp_gaji/payroll-ledger')).json();
    assert.equal(riwayat.hutangGajiBalanceRupiah, 65000);
    assert.equal(riwayat.belumMasukBukuRupiah, 0);
    const kartu = riwayat.entries.find(entry => entry.sourceType === 'AKUNTANSI');
    assert.ok(kartu, JSON.stringify(riwayat.entries));
    assert.equal(kartu.hutangGajiDeltaRupiah, 15000);
    assert.match(kartu.journalNumber, /^JRN/);

    const summary = await (await call(env, '/api/admin/hutang-piutang')).json();
    const gaji = summary.persons.flatMap(person => person.accounts.map(account => ({ person, account })))
      .find(row => row.account.account === 'GAJI' && row.person.counterpartyName === 'Budi');
    assert.equal(gaji.account.balanceRupiah, 65000, 'sisa Hutang Gaji yang dibayar ikut koreksi akuntan');
    assert.equal(gaji.account.adjustmentRupiah, 15000);

    const { buildEmployeeLedger } = await import('../src/employee-ledger-view.js');
    const entity = await buildEmployeeLedger(env.DB, { employeeId: 'emp_gaji', entityId: 'ENT-KPM', kind: 'gaji' });
    assert.equal(entity.balanceRupiah, 65000);
    assert.ok(entity.entries.some(entry => entry.kind === 'JURNAL_AKUNTANSI' && entry.amountRupiah === 15000));

    // Sebelum ADR-054 hanya fakta presensi yang terlihat; sekarang penyesuaian akuntan juga.
    const sesi = await hashCredential('kasir-budi');
    db.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, 'cashier_pendem_pilot', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(sesi);
    const portal = await worker.fetch(new Request('https://example.test/api/staff/portal?store=PENDEM', { headers: { Authorization: 'Bearer kasir-budi' } }), env);
    assert.equal(portal.status, 200, await portal.clone().text());
    const staff = await portal.json();
    assert.deepEqual(staff.accountingPayrollAdjustments.map(row => [row.amountRupiah, row.description]), [[15000, 'Lembur 3 jam']]);
  } finally { db.close(); }
});
