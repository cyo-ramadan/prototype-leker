import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { dispatchAdminAccountingFact, reverseAdminAccountingFact } from '../src/accounting-admin-bridge.js';
import { hashCredential } from '../src/owner-auth.js';

// ADR-046, Bos Cyo 2026-09-27: fitur admin (Bea Operasional, Pembayaran
// Hutang/Piutang, Pembayaran Lainnya, gaji presensi, Uang Muka/Deposit)
// otomatis jadi jurnal Akuntansi untuk transaksi BARU, tanpa admin mengatur
// apa pun. Test lewat worker.fetch supaya jalur produksi (index.js) ikut teruji.

const migrationDir = new URL('../migrations/', import.meta.url);
const SCALE = 1_000_000;

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
    try {
      const out = statements.map(statement => statement.run());
      this.db.exec('COMMIT');
      return out;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function migrationFiles() {
  return readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
}

function setup({ beforeAdminBridge } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of migrationFiles()) {
    if (file.startsWith('0123_') && beforeAdminBridge) beforeAdminBridge(db);
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  const pendem = db.prepare(`SELECT id, entity_id FROM stores WHERE code = 'PENDEM'`).get();
  return { db, env: { DB: new D1Database(db) }, pendem };
}

async function adminToken(db) {
  const token = 'aab-admin';
  db.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, 'admin_pendem_pilot', '2026-06-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token));
  return token;
}

async function api(env, token, pathname, body, method = 'POST') {
  const url = new URL(`https://example.test${pathname}`);
  url.searchParams.set('store', 'PENDEM');
  const response = await worker.fetch(new Request(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }), env);
  return { status: response.status, payload: await response.json() };
}

function accountBalances(db, storeId) {
  const rows = db.prepare(`
    SELECT a.code, SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount_scaled ELSE -l.amount_scaled END) AS net
    FROM accounting_journal_lines l
    JOIN chart_of_accounts a ON a.id = l.account_id
    JOIN accounting_journal_headers h ON h.id = l.journal_id
    WHERE l.store_id = ? AND h.source_system LIKE 'LEKER_ADMIN%'
    GROUP BY a.code
  `).all(storeId);
  return Object.fromEntries(rows.map(row => [row.code, Number(row.net) / SCALE]));
}

function journalCount(db, storeId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM accounting_journal_headers WHERE store_id = ? AND source_system LIKE 'LEKER_ADMIN%'`).get(storeId).n;
}

function findAccountKey(payload, name, account) {
  const person = payload.persons.find(p => p.counterpartyName === name);
  return person?.accounts.find(a => a.account === account)?.accountKey;
}

test('Bea Lapak jadi Hutang otomatis terjurnal Beban vs Utang; dibatalkan = jurnal pembalik, bukan diedit', async () => {
  const { db, env, pendem } = setup();
  try {
    const token = await adminToken(db);
    const created = await api(env, token, '/api/admin/operational-expenses', {
      category: 'BEA_LAPAK', description: 'Sewa lapak Oktober', amount: 500000,
      counterpartyType: 'OTHER', counterpartyName: 'Pak RT', businessDate: '2026-09-27'
    });
    assert.equal(created.status, 201, JSON.stringify(created.payload));
    assert.equal(created.payload.accounting.deliveries[0].bridgeStatus, 'POSTED', JSON.stringify(created.payload.accounting));
    assert.deepEqual(accountBalances(db, pendem.id), { 2101: -500000, 6106: 500000 });

    const voided = await api(env, token, `/api/admin/operational-expenses/${created.payload.id}/void`, { reason: 'salah catat' });
    assert.equal(voided.status, 200, JSON.stringify(voided.payload));
    assert.equal(voided.payload.accounting.deliveries[0].bridgeStatus, 'POSTED');
    assert.deepEqual(accountBalances(db, pendem.id), { 2101: 0, 6106: 0 });
    assert.equal(journalCount(db, pendem.id), 2, 'jurnal asli tetap ada, ditambah satu pembalik');
    const reversal = db.prepare(`SELECT reversal_of_journal_id FROM accounting_journal_headers WHERE source_system = 'LEKER_ADMIN_VOID'`).get();
    assert.ok(reversal.reversal_of_journal_id);
  } finally { db.close(); }
});

test('Pelunasan hutang: Utang berkurang lawan Kas / Rekening Bersama sesuai cara bayar', async () => {
  const { db, env, pendem } = setup();
  try {
    const token = await adminToken(db);
    await api(env, token, '/api/admin/operational-expenses', {
      category: 'BEA_LAINNYA', description: 'Talangan gas', amount: 300000,
      counterpartyType: 'OTHER', counterpartyName: 'Adiva', businessDate: '2026-09-27'
    });
    const summary = await api(env, token, '/api/admin/hutang-piutang', null, 'GET');
    const accountKey = findAccountKey(summary.payload, 'Adiva', 'BEA_LAINNYA');

    const tunai = await api(env, token, '/api/admin/hutang-piutang/payments', { accountKey, amount: 100000, paymentMethod: 'KAS', businessDate: '2026-09-27' });
    assert.equal(tunai.status, 201, JSON.stringify(tunai.payload));
    assert.equal(tunai.payload.accounting.deliveries[0].bridgeStatus, 'POSTED', JSON.stringify(tunai.payload.accounting));

    const rekber = db.prepare(`SELECT id FROM entity_shared_accounts LIMIT 1`).get()?.id || (() => {
      db.prepare(`INSERT INTO entity_shared_accounts (id, entity_id, name) VALUES ('rk_aab', ?, 'Rekening Bersama Malang')`).run(pendem.entity_id);
      return 'rk_aab';
    })();
    const viaRekber = await api(env, token, '/api/admin/hutang-piutang/payments', { accountKey, amount: 50000, paymentMethod: 'REKBER', sharedAccountId: rekber });
    assert.equal(viaRekber.payload.accounting.deliveries[0].bridgeStatus, 'POSTED');

    assert.deepEqual(accountBalances(db, pendem.id), { 1101: -100000, 1103: -50000, 2103: -150000, 6104: 300000 });

    const voided = await api(env, token, `/api/admin/hutang-piutang/payments/${tunai.payload.payment.id}/void`, {});
    assert.equal(voided.payload.accounting.deliveries[0].bridgeStatus, 'POSTED');
    assert.deepEqual(accountBalances(db, pendem.id), { 1101: 0, 1103: -50000, 2103: -250000, 6104: 300000 });
  } finally { db.close(); }
});

test('Uang Muka: dibuat = Uang Muka vs Bank; realisasi Pembayaran Lainnya = Beban vs Uang Muka, bukan uang keluar lagi', async () => {
  const { db, env, pendem } = setup();
  try {
    const token = await adminToken(db);
    const deposit = await api(env, token, '/api/admin/hutang-piutang/deposits', {
      category: 'DEPOSIT_LISTRIK', counterpartyType: 'OTHER', counterpartyName: 'PLN', amount: 1000000,
      paymentMethod: 'BANK', businessDate: '2026-09-27'
    });
    assert.equal(deposit.status, 201, JSON.stringify(deposit.payload));
    assert.equal(deposit.payload.accounting.deliveries[0].bridgeStatus, 'POSTED', JSON.stringify(deposit.payload.accounting));
    assert.deepEqual(accountBalances(db, pendem.id), { 1102: -1000000, 1401: 1000000 });

    const realisasi = await api(env, token, '/api/admin/hutang-piutang/pembayaran-lainnya', {
      category: 'BEA_LAINNYA', description: 'Token terpakai September', amount: 400000,
      paymentMethod: 'DEPOSIT', depositId: deposit.payload.deposit.id, businessDate: '2026-09-27'
    });
    assert.equal(realisasi.status, 201, JSON.stringify(realisasi.payload));
    assert.equal(realisasi.payload.accounting.deliveries[0].bridgeStatus, 'POSTED');
    assert.deepEqual(accountBalances(db, pendem.id), { 1102: -1000000, 1401: 600000, 6104: 400000 });

    await api(env, token, `/api/admin/hutang-piutang/payments/${realisasi.payload.payment.id}/void`, {});
    assert.deepEqual(accountBalances(db, pendem.id), { 1102: -1000000, 1401: 1000000, 6104: 0 });
  } finally { db.close(); }
});

test('Uang Muka dari Rekening Bersama benar-benar mengurangi bagian gerai di rekening itu', async () => {
  const { db, env, pendem } = setup();
  try {
    const token = await adminToken(db);
    db.prepare(`INSERT INTO entity_shared_accounts (id, entity_id, name) VALUES ('rk_dep', ?, 'Rekening Bersama Malang')`).run(pendem.entity_id);
    const deposit = await api(env, token, '/api/admin/hutang-piutang/deposits', {
      category: 'DEPOSIT_IKLAN', counterpartyType: 'OTHER', counterpartyName: 'Meta Ads', amount: 250000,
      paymentMethod: 'REKBER', sharedAccountId: 'rk_dep'
    });
    assert.equal(deposit.status, 201, JSON.stringify(deposit.payload));
    const share = db.prepare(`SELECT SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END) AS s FROM entity_shared_account_ledger WHERE shared_account_id = 'rk_dep' AND store_id = ?`).get(pendem.id).s;
    assert.equal(share, -250000);
    assert.deepEqual(accountBalances(db, pendem.id), { 1103: -250000, 1401: 250000 });
    assert.equal(db.prepare(`SELECT funding_method FROM operational_receivables_payables WHERE id = ?`).get(deposit.payload.deposit.id).funding_method, 'REKBER');
  } finally { db.close(); }
});

test('Gaji: Bea Gaji potongan membalik sisi; akrual presensi Beban vs Utang Gaji; pelunasan mengurangi Utang Gaji', async () => {
  const { db, env, pendem } = setup();
  try {
    const token = await adminToken(db);
    db.prepare(`INSERT INTO employees (id, entity_id, full_name, status, created_at, updated_at) VALUES ('emp_aab', ?, 'Adiva', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(pendem.entity_id);
    const lembur = await api(env, token, '/api/admin/operational-expenses', { category: 'BEA_GAJI', description: 'Lembur', amount: 60000, employeeId: 'emp_aab', businessDate: '2026-09-27' });
    assert.equal(lembur.payload.accounting.deliveries[0].bridgeStatus, 'POSTED', JSON.stringify(lembur.payload.accounting));
    await api(env, token, '/api/admin/operational-expenses', { category: 'BEA_GAJI', description: 'Potongan telat', amount: -10000, employeeId: 'emp_aab', businessDate: '2026-09-27' });

    db.prepare(`
      INSERT INTO payroll_ledger_entries (id, employee_id, account_type, account_id, store_id, business_date, entry_type, hutang_gaji_delta_scaled, beban_gaji_delta_scaled, source_type, source_id)
      VALUES ('pl_aab', 'emp_aab', 'CASHIER', 'cashier_x', ?, '2026-09-27', 'ACCRUAL', 44520000000, 44520000000, 'ATTENDANCE', 'att_aab')
    `).run(pendem.id);
    const accrual = await dispatchAdminAccountingFact(env.DB, 'GAJI_PRESENSI', 'pl_aab');
    assert.equal(accrual.status, 'POSTED', JSON.stringify(accrual));
    assert.equal((await dispatchAdminAccountingFact(env.DB, 'GAJI_PRESENSI', 'pl_aab')).duplicate, true, 'tidak dobel');
    assert.deepEqual(accountBalances(db, pendem.id), { 2102: -94520, 6102: 94520 });

    const summary = await api(env, token, '/api/admin/hutang-piutang', null, 'GET');
    const accountKey = findAccountKey(summary.payload, 'Adiva', 'GAJI');
    const bayar = await api(env, token, '/api/admin/hutang-piutang/payments', { accountKey, amount: 94520, paymentMethod: 'KAS' });
    assert.equal(bayar.payload.accounting.deliveries[0].bridgeStatus, 'POSTED');
    assert.deepEqual(accountBalances(db, pendem.id), { 1101: -94520, 2102: 0, 6102: 94520 });

    db.prepare(`
      INSERT INTO payroll_ledger_entries (id, employee_id, account_type, account_id, store_id, business_date, entry_type, hutang_gaji_delta_scaled, beban_gaji_delta_scaled, source_type, source_id)
      VALUES ('pl_zero', 'emp_aab', 'CASHIER', 'cashier_x', ?, '2026-09-27', 'ACCRUAL', 0, 0, 'ATTENDANCE', 'att_zero')
    `).run(pendem.id);
    assert.equal((await dispatchAdminAccountingFact(env.DB, 'GAJI_PRESENSI', 'pl_zero')).status, 'NOT_REQUIRED');
  } finally { db.close(); }
});

test('Data lama tanpa jurnal: dibatalkan tidak memunculkan jurnal pembalik', async () => {
  const { db, env, pendem } = setup();
  try {
    db.prepare(`
      INSERT INTO admin_operational_expenses (id, store_id, category, description, amount, business_date, settlement, counterparty_name)
      VALUES ('beaops_lama', ?, 'BEA_LAINNYA', 'Bea lama', 20000, '2026-09-01', 'HUTANG', 'Pak Lama')
    `).run(pendem.id);
    const result = await reverseAdminAccountingFact(env.DB, 'BEA', 'beaops_lama');
    assert.equal(result.status, 'NOT_REQUIRED');
    assert.equal(journalCount(db, pendem.id), 0);
  } finally { db.close(); }
});

test('Gerai mode ringan (bukan ACCOUNTING) dilewati tanpa jejak', async () => {
  const { db, env } = setup();
  try {
    const ikan = db.prepare(`SELECT id FROM stores WHERE edition <> 'ACCOUNTING' LIMIT 1`).get();
    assert.ok(ikan, 'fixture punya gerai non-ACCOUNTING');
    db.prepare(`
      INSERT INTO admin_operational_expenses (id, store_id, category, description, amount, business_date, settlement, counterparty_name)
      VALUES ('beaops_lite', ?, 'BEA_LAINNYA', 'x', 1000, '2026-09-27', 'HUTANG', 'y')
    `).run(ikan.id);
    const result = await dispatchAdminAccountingFact(env.DB, 'BEA', 'beaops_lite');
    assert.equal(result.status, 'NOT_REQUIRED');
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM accounting_bridge_deliveries WHERE fact_id = 'beaops_lite'`).get().n, 0);
  } finally { db.close(); }
});

test('Akun yang sudah dibuat admin sendiri (nama sama persis) dipakai ulang, bukan diduplikasi', async () => {
  const { db } = setup({
    beforeAdminBridge(db) {
      db.prepare(`INSERT INTO chart_of_accounts (id, store_id, code, name, type) VALUES ('acc_bsl', 'store_pendem', 'ACC-000003', 'Beban Sewa Lapak', 'EXPENSE')`).run();
      db.prepare(`INSERT INTO chart_of_accounts (id, store_id, code, name, type) VALUES ('acc_hsl', 'store_pendem', 'ACC-000001', 'Hutang Sewa Lapak', 'LIABILITY')`).run();
      db.prepare(`INSERT INTO chart_of_accounts (id, store_id, code, name, type) VALUES ('acc_bdd', 'store_pendem', 'ACC-000002', 'Beban Dibayar Dimuka', 'ASSET')`).run();
    }
  });
  try {
    const rules = Object.fromEntries(db.prepare(`
      SELECT r.id, r.fixed_account_id FROM journal_rules r WHERE r.store_id = 'store_pendem' AND r.id LIKE '%admin_%'
    `).all().map(row => [row.id, row.fixed_account_id]));
    assert.equal(rules.jrule_store_pendem_admin_bea_lapak_dr, 'acc_bsl');
    assert.equal(rules.jrule_store_pendem_admin_bea_lapak_cr, 'acc_hsl');
    assert.equal(rules.jrule_store_pendem_admin_uang_muka_dr, 'acc_bdd');
    const duplicates = db.prepare(`SELECT code FROM chart_of_accounts WHERE store_id = 'store_pendem' AND code IN ('6106', '1401')`).all();
    assert.deepEqual(duplicates, [], 'tidak bikin akun kembar kalau admin sudah punya');
  } finally { db.close(); }
});

test('Gerai baru langsung punya akun + aturan jurnal admin, dan Non Tunai sudah tertaut ke Bank', async () => {
  const { db, pendem } = setup();
  try {
    db.prepare(`INSERT INTO stores (id, code, store_name, entity_id) VALUES ('store_aabnew', 'AABNEW', 'Gerai Baru', ?)`).run(pendem.entity_id);
    const codes = db.prepare(`
      SELECT c.code, COUNT(r.id) AS n FROM transaction_categories c
      JOIN journal_rules r ON r.transaction_category_id = c.id
      WHERE c.store_id = 'store_aabnew' AND c.code LIKE 'admin_%' GROUP BY c.code ORDER BY c.code
    `).all().map(row => `${row.code}:${row.n}`);
    assert.deepEqual(codes, ['admin_bea_lainnya:2', 'admin_bea_lapak:2', 'admin_gaji:2', 'admin_uang_muka:2']);
    assert.equal(db.prepare(`SELECT account_id FROM payment_methods WHERE store_id = 'store_aabnew' AND code = 'NON_CASH'`).get().account_id, 'coa_store_aabnew_1102');
  } finally { db.close(); }
});

test('Barang baru tanpa Jenis Barang otomatis dapat Jenis Barang sesuai Tipe Barang', async () => {
  const { db } = setup();
  try {
    const type = db.prepare(`SELECT id, code FROM item_types WHERE store_id = 'store_pendem' AND code = 'FINISHED_GOOD' LIMIT 1`).get();
    db.prepare(`INSERT INTO products (id, store_id, name, purchase_price, price, category, emoji, image_data, display_order, is_active, item_type_id) VALUES (98001, 'store_pendem', 'Pentol Baru', 0, 0, 'Lain', '', '', 1, 1, ?)`).run(type?.id || null);
    const kind = db.prepare(`SELECT k.code FROM products p JOIN product_kinds k ON k.id = p.product_kind_id WHERE p.id = 98001`).get();
    assert.ok(kind, 'Jenis Barang terpasang');
    if (type) assert.equal(kind.code === 'FINISHED_GOOD' || kind.code === 'RAW_MATERIAL', true);
  } finally { db.close(); }
});

test('Pembelian kasir dari Deposit: laci tidak dianggap keluar uang, jurnalnya mengurangi Uang Muka', async () => {
  const { db, env, pendem } = setup();
  try {
    const token = await adminToken(db);
    const deposit = await api(env, token, '/api/admin/hutang-piutang/deposits', {
      category: 'DEPOSIT_BAHAN_BAKU', counterpartyType: 'OTHER', counterpartyName: 'Pak Azis', amount: 1000000, paymentMethod: 'KAS'
    });
    assert.equal(deposit.status, 201, JSON.stringify(deposit.payload));

    db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES ('cashier_aab', 'aabkasir', 'x', 'Kasir AAB', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(pendem.id);
    db.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, 'cashier_aab', '2026-09-24T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('aab-kasir'));
    db.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES ('drawer_aab', ?, 'cashier_aab', 0, 'OPEN', '2026-09-27T00:00:00.000Z')`).run(pendem.id);
    const kasir = async (pathname, body) => {
      const response = await worker.fetch(new Request(`https://example.test${pathname}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: 'Bearer aab-kasir', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
      }), env);
      return { status: response.status, payload: await response.json() };
    };
    const options = await kasir('/api/cashier/purchases/options');
    const product = options.payload.products[0];
    const bought = await kasir('/api/cashier/purchases', {
      paymentMethod: 'CASH', depositId: deposit.payload.deposit.id, items: [{ productId: product.productId, quantity: 1, lineTotal: 700000 }]
    });
    assert.equal(bought.status, 201, JSON.stringify(bought.payload));
    assert.equal(bought.payload.paymentMethod, 'DEPOSIT', 'bukan CASH -- laci tidak keluar uang');
    assert.equal(bought.payload.accounting.bridgeStatus, 'POSTED', JSON.stringify(bought.payload.accounting));

    const lines = db.prepare(`
      SELECT a.code, l.side, l.amount_scaled FROM accounting_journal_lines l
      JOIN chart_of_accounts a ON a.id = l.account_id
      WHERE l.journal_id = ?
    `).all(bought.payload.accounting.journalReference).map(row => `${row.side}:${row.code}:${Number(row.amount_scaled) / SCALE}`).sort();
    assert.deepEqual(lines, ['CREDIT:1401:700000', 'DEBIT:1301:700000']);
  } finally { db.close(); }
});

test('Presensi keluar yang mencatat gaji langsung ikut dijurnal lewat jalur respons', async () => {
  const { db, env, pendem } = setup();
  try {
    db.prepare(`
      INSERT INTO payroll_ledger_entries (id, employee_id, account_type, account_id, store_id, business_date, entry_type, hutang_gaji_delta_scaled, beban_gaji_delta_scaled, source_type, source_id)
      VALUES ('pl_resp', NULL, 'CASHIER', 'cashier_x', ?, '2026-09-27', 'ACCRUAL', 30000000000, 30000000000, 'ATTENDANCE', 'att_resp')
    `).run(pendem.id);
    const { attachAdminAccountingToCommittedResponse } = await import('../src/accounting-admin-bridge.js');
    const response = await attachAdminAccountingToCommittedResponse(
      new Request('https://example.test/api/staff/attendance', { method: 'POST' }),
      Response.json({ ok: true, attendance: { id: 'att_resp' } }, { status: 201 }),
      env,
      '/api/staff/attendance'
    );
    const payload = await response.json();
    assert.equal(payload.accounting.deliveries[0].factType, 'GAJI_PRESENSI');
    assert.equal(payload.accounting.deliveries[0].bridgeStatus, 'POSTED');
    assert.deepEqual(accountBalances(db, pendem.id), { 2102: -30000, 6102: 30000 });
  } finally { db.close(); }
});
