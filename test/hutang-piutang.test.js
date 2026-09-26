import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminOperationalExpenseApi } from '../src/admin-operational-expense.js';
import { handleHutangPiutangApi } from '../src/hutang-piutang.js';
import { handleBusinessSettingsApi } from '../src/business-settings.js';
import { handleCashierPurchaseApi } from '../src/cashier-purchase.js';
import { getNetProfitReport } from '../src/net-profit-report.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-26: Bea Operasional = pintu MEMBUAT Hutang + Beban (ke
// Supplier/Karyawan/nama bebas), tombol Pembayaran Hutang/Piutang = pintu
// MELUNASI (cara bayar Tunai/Bank/Rekening Bersama SUNGGUHAN), Pembayaran
// Lainnya = beban yang langsung dibayar, Laporan Hutang Piutang per orang,
// Laporan Beban, dan pembelian kasir dengan cara bayar "Jadi Hutang" ikut
// masuk catatan hutang.

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

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  const pendem = db.prepare(`SELECT id, entity_id FROM stores WHERE code = 'PENDEM'`).get();
  return { db, env: { DB: new D1Database(db) }, pendem };
}

async function adminToken(db, adminId = 'admin_pendem_pilot') {
  const token = `hp-admin-${adminId}`;
  db.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, '2026-06-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), adminId);
  return token;
}

function request(pathname, { token, store = 'PENDEM', method = 'GET', body } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store) url.searchParams.set('store', store);
  return new Request(url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function call(handler, env, pathname, options) {
  const response = await handler(request(pathname, options), env, pathname);
  const payload = await response.json();
  return { status: response.status, payload };
}

function seedSupplier(db, storeId, name) {
  const id = `supplier_hp_${name.replace(/\W/g, '').toLowerCase()}`;
  db.prepare(`INSERT INTO suppliers (id, store_id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    .run(id, storeId, name);
  return id;
}

function seedEmployee(db, entityId, name) {
  const id = `emp_hp_${name.replace(/\W/g, '').toLowerCase()}`;
  db.prepare(`INSERT INTO employees (id, entity_id, full_name, status, created_at, updated_at) VALUES (?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    .run(id, entityId, name);
  return id;
}

function seedSharedAccount(db, entityId, name = 'Rekening Maxi Malang') {
  const id = `shared_acc_hp_${Math.random().toString(36).slice(2)}`;
  db.prepare(`INSERT INTO entity_shared_accounts (id, entity_id, name) VALUES (?, ?, ?)`).run(id, entityId, name);
  return id;
}

function storeShare(db, sharedAccountId, storeId) {
  return db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END), 0) AS balance
    FROM entity_shared_account_ledger WHERE shared_account_id = ? AND store_id = ?
  `).get(sharedAccountId, storeId).balance;
}

async function summary(env, token) {
  return (await call(handleHutangPiutangApi, env, '/api/admin/hutang-piutang', { token })).payload;
}

function findAccount(payload, name, account) {
  const person = payload.persons.find(p => p.counterpartyName === name);
  return person?.accounts.find(a => a.account === account);
}

async function catatHutang(env, token, body) {
  return call(handleAdminOperationalExpenseApi, env, '/api/admin/operational-expenses', { token, method: 'POST', body: { businessDate: '2026-09-26', ...body } });
}

test('Bea Operasional membuat Hutang ke Supplier/Karyawan/nama bebas, direkap per orang, Beban diakui sekali', async () => {
  const { db, env, pendem } = setup();
  try {
    const token = await adminToken(db);
    const azis = seedSupplier(db, pendem.id, 'Pak Azis');
    const adiva = seedEmployee(db, pendem.entity_id, 'Adiva');

    assert.equal((await catatHutang(env, token, { category: 'BEA_LAPAK', description: 'Sewa lapak', amount: 500000, counterpartyType: 'SUPPLIER', counterpartyId: azis })).status, 201);
    assert.equal((await catatHutang(env, token, { category: 'BEA_LAINNYA', description: 'Talangan beli gas', amount: 40000, counterpartyType: 'EMPLOYEE', counterpartyId: adiva })).status, 201);
    assert.equal((await catatHutang(env, token, { category: 'BEA_GAJI', description: 'Lembur', amount: 60000, employeeId: adiva })).status, 201);
    assert.equal((await catatHutang(env, token, { category: 'BEA_LAINNYA', description: 'WiFi', amount: 300000, counterpartyType: 'OTHER', counterpartyName: 'Indihome' })).status, 201);

    // Tanpa pihak -> ditolak (hutang wajib punya pemilik).
    assert.equal((await catatHutang(env, token, { category: 'BEA_LAPAK', description: 'x', amount: 1000, counterpartyType: 'OTHER' })).status, 400);
    // Supplier gerai lain -> ditolak.
    const dermo = db.prepare(`SELECT id FROM stores WHERE code = 'DERMO'`).get();
    const otherSupplier = seedSupplier(db, dermo.id, 'Supplier Dermo');
    assert.equal((await catatHutang(env, token, { category: 'BEA_LAPAK', description: 'x', amount: 1000, counterpartyType: 'SUPPLIER', counterpartyId: otherSupplier })).status, 400);

    const data = await summary(env, token);
    assert.equal(findAccount(data, 'Pak Azis', 'BEA_LAPAK').balanceRupiah, 500000);
    const adivaPerson = data.persons.find(p => p.counterpartyName === 'Adiva');
    assert.equal(adivaPerson.accounts.length, 2, 'Adiva: Hutang Gaji + Hutang Lainnya dalam satu orang');
    assert.equal(adivaPerson.hutangRupiah, 100000);
    assert.equal(findAccount(data, 'Indihome', 'BEA_LAINNYA').balanceRupiah, 300000);
    assert.equal(data.totals.hutangRupiah, 900000);

    const { breakdownByKey: rowsByKey } = await getNetProfitReport(env.DB, { storeIds: [pendem.id], from: '2026-09-26', to: '2026-09-26', today: '2099-01-01' });
    const row = rowsByKey.get(`${pendem.id}::2026-09-26`);
    assert.equal(row.beaLapak + row.beaLainnya + row.beaGaji, 900000, 'beban diakui persis sekali');
  } finally { db.close(); }
});

test('Pembayaran Hutang cicil lewat Tunai: saldo turun FIFO, beban tidak bertambah', async () => {
  const { db, env, pendem } = setup();
  try {
    const token = await adminToken(db);
    const azis = seedSupplier(db, pendem.id, 'Pak Azis');
    await catatHutang(env, token, { category: 'BEA_LAPAK', description: 'Sewa Agustus', amount: 200000, counterpartyType: 'SUPPLIER', counterpartyId: azis, businessDate: '2026-08-26' });
    await catatHutang(env, token, { category: 'BEA_LAPAK', description: 'Sewa September', amount: 200000, counterpartyType: 'SUPPLIER', counterpartyId: azis });
    const beforeBeban = db.prepare(`SELECT COUNT(*) n, SUM(amount) s FROM admin_operational_expenses`).get();

    const account = findAccount(await summary(env, token), 'Pak Azis', 'BEA_LAPAK');
    const paid = await call(handleHutangPiutangApi, env, '/api/admin/hutang-piutang/payments', {
      token, method: 'POST', body: { accountKey: account.accountKey, amount: 250000, paymentMethod: 'KAS', businessDate: '2026-09-26' }
    });
    assert.equal(paid.status, 201, JSON.stringify(paid.payload));
    const after = findAccount(paid.payload, 'Pak Azis', 'BEA_LAPAK');
    assert.equal(after.balanceRupiah, 150000);
    assert.deepEqual(after.items.map(i => i.balanceRupiah), [0, 150000], 'tagihan tertua lunas duluan');
    const afterBeban = db.prepare(`SELECT COUNT(*) n, SUM(amount) s FROM admin_operational_expenses`).get();
    assert.deepEqual({ ...afterBeban }, { ...beforeBeban }, 'pelunasan tidak menambah beban');

    // Kelebihan bayar -> saldo minus, bukan error (invariant #8).
    const over = await call(handleHutangPiutangApi, env, '/api/admin/hutang-piutang/payments', {
      token, method: 'POST', body: { accountKey: account.accountKey, amount: 200000, paymentMethod: 'BANK' }
    });
    assert.equal(over.status, 201);
    assert.equal(findAccount(over.payload, 'Pak Azis', 'BEA_LAPAK').balanceRupiah, -50000);
  } finally { db.close(); }
});

test('Cara bayar Rekening Bersama benar-benar mengurangi bagian gerai; Batalkan membaliknya', async () => {
  const { db, env, pendem } = setup();
  try {
    const token = await adminToken(db);
    const rekber = seedSharedAccount(db, pendem.entity_id);
    db.prepare(`INSERT INTO entity_shared_account_ledger (id, shared_account_id, entity_id, store_id, direction, amount, source_type, source_id) VALUES ('seed_in', ?, ?, ?, 'IN', 1000000, 'SALE', 'seed')`)
      .run(rekber, pendem.entity_id, pendem.id);
    await catatHutang(env, token, { category: 'BEA_LAINNYA', description: 'WiFi', amount: 300000, counterpartyType: 'OTHER', counterpartyName: 'Indihome' });
    const account = findAccount(await summary(env, token), 'Indihome', 'BEA_LAINNYA');

    const paid = await call(handleHutangPiutangApi, env, '/api/admin/hutang-piutang/payments', {
      token, method: 'POST', body: { accountKey: account.accountKey, amount: 300000, paymentMethod: 'REKBER', sharedAccountId: rekber }
    });
    assert.equal(paid.status, 201, JSON.stringify(paid.payload));
    assert.equal(storeShare(db, rekber, pendem.id), 700000, 'bagian gerai di Rekening Bersama berkurang sungguhan');
    assert.equal(findAccount(paid.payload, 'Indihome', 'BEA_LAINNYA').balanceRupiah, 0);
    assert.equal(paid.payload.sharedAccounts.find(a => a.id === rekber).storeBalance, 700000);

    // Rekening Bersama wajib dipilih kalau cara bayarnya REKBER.
    assert.equal((await call(handleHutangPiutangApi, env, '/api/admin/hutang-piutang/payments', {
      token, method: 'POST', body: { accountKey: account.accountKey, amount: 1000, paymentMethod: 'REKBER' }
    })).status, 400);

    const voided = await call(handleHutangPiutangApi, env, `/api/admin/hutang-piutang/payments/${paid.payload.payment.id}/void`, {
      token, method: 'POST', body: { reason: 'salah rekening' }
    });
    assert.equal(voided.status, 200, JSON.stringify(voided.payload));
    assert.equal(storeShare(db, rekber, pendem.id), 1000000, 'dibalik lewat baris IN, bukan hapus');
    assert.equal(findAccount(voided.payload, 'Indihome', 'BEA_LAINNYA').balanceRupiah, 300000, 'hutang kembali terbuka');
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM entity_shared_account_ledger WHERE source_id = ?`).get(paid.payload.payment.id).n, 2);
  } finally { db.close(); }
});

test('Pelunasan Hutang Gaji lewat tombol Pembayaran: saldo gaji turun, beban gaji tetap', async () => {
  const { db, env, pendem } = setup();
  try {
    const token = await adminToken(db);
    const adiva = seedEmployee(db, pendem.entity_id, 'Adiva');
    await catatHutang(env, token, { category: 'BEA_GAJI', description: 'Gaji penyesuaian', amount: 150000, employeeId: adiva });
    const account = findAccount(await summary(env, token), 'Adiva', 'GAJI');
    assert.equal(account.balanceRupiah, 150000);

    const paid = await call(handleHutangPiutangApi, env, '/api/admin/hutang-piutang/payments', {
      token, method: 'POST', body: { accountKey: account.accountKey, amount: 100000, paymentMethod: 'KAS', businessDate: '2026-09-26' }
    });
    assert.equal(paid.status, 201, JSON.stringify(paid.payload));
    const after = findAccount(paid.payload, 'Adiva', 'GAJI');
    assert.equal(after.balanceRupiah, 50000);
    assert.equal(after.paidRupiah, 100000);

    const { breakdownByKey: rowsByKey } = await getNetProfitReport(env.DB, { storeIds: [pendem.id], from: '2026-09-26', to: '2026-09-26', today: '2099-01-01' });
    assert.equal(rowsByKey.get(`${pendem.id}::2026-09-26`).beaGaji, 150000, 'beban gaji tidak berkurang karena dibayar');

    const voided = await call(handleHutangPiutangApi, env, `/api/admin/hutang-piutang/payments/${paid.payload.payment.id}/void`, { token, method: 'POST', body: {} });
    assert.equal(findAccount(voided.payload, 'Adiva', 'GAJI').balanceRupiah, 150000);
  } finally { db.close(); }
});

test('Pembayaran Lainnya: beban langsung dibayar, bisa lewat Rekening Bersama, dibatalkan lewat Pembayaran', async () => {
  const { db, env, pendem } = setup();
  try {
    const token = await adminToken(db);
    const rekber = seedSharedAccount(db, pendem.entity_id);
    const paid = await call(handleHutangPiutangApi, env, '/api/admin/hutang-piutang/pembayaran-lainnya', {
      token, method: 'POST', body: { category: 'BEA_LAINNYA', description: 'Galon', counterpartyName: 'Depot', amount: 20000, paymentMethod: 'REKBER', sharedAccountId: rekber, businessDate: '2026-09-26' }
    });
    assert.equal(paid.status, 201, JSON.stringify(paid.payload));
    const expense = db.prepare(`SELECT settlement, amount, voided_at FROM admin_operational_expenses WHERE id = ?`).get(paid.payload.payment.expenseId);
    assert.equal(expense.settlement, 'LANGSUNG');
    assert.equal(storeShare(db, rekber, pendem.id), -20000, 'saldo minus bukan bug (invariant #8)');
    assert.equal((await summary(env, token)).totals.hutangRupiah, 0, 'tidak membuat hutang');

    // Bea-nya tidak boleh dibatalkan dari tab Bea (uangnya harus ikut dibalik).
    const viaBea = await call(handleAdminOperationalExpenseApi, env, `/api/admin/operational-expenses/${paid.payload.payment.expenseId}/void`, { token, method: 'POST', body: {} });
    assert.equal(viaBea.status, 409);
    assert.equal(viaBea.payload.code, 'VOID_VIA_PAYMENT');

    await call(handleHutangPiutangApi, env, `/api/admin/hutang-piutang/payments/${paid.payload.payment.id}/void`, { token, method: 'POST', body: {} });
    assert.ok(db.prepare(`SELECT voided_at FROM admin_operational_expenses WHERE id = ?`).get(paid.payload.payment.expenseId).voided_at);
    assert.equal(storeShare(db, rekber, pendem.id), 0);
  } finally { db.close(); }
});

test('Batalkan Bea yang hutangnya sudah dibayar sebagian: saldo jadi minus sebesar yang sudah dibayar', async () => {
  const { db, env } = setup();
  try {
    const token = await adminToken(db);
    const created = await catatHutang(env, token, { category: 'BEA_LAPAK', description: 'Salah catat', amount: 100000, counterpartyType: 'OTHER', counterpartyName: 'Pak RT' });
    const account = findAccount(await summary(env, token), 'Pak RT', 'BEA_LAPAK');
    await call(handleHutangPiutangApi, env, '/api/admin/hutang-piutang/payments', { token, method: 'POST', body: { accountKey: account.accountKey, amount: 30000, paymentMethod: 'KAS' } });
    await call(handleAdminOperationalExpenseApi, env, `/api/admin/operational-expenses/${created.payload.id}/void`, { token, method: 'POST', body: { reason: 'salah' } });
    const after = findAccount(await summary(env, token), 'Pak RT', 'BEA_LAPAK');
    assert.equal(after.balanceRupiah, -30000, 'uang yang sudah dibayar tidak hilang -- Pak RT berhutang balik');
  } finally { db.close(); }
});

test('Hutang gerai lain tidak bisa dibayar dari gerai ini', async () => {
  const { db, env } = setup();
  try {
    const pendemToken = await adminToken(db);
    const dermoToken = await adminToken(db, 'admin_dermo_0080');
    await catatHutang(env, pendemToken, { category: 'BEA_LAPAK', description: 'Sewa', amount: 100000, counterpartyType: 'OTHER', counterpartyName: 'Pak RT' });
    const account = findAccount(await summary(env, pendemToken), 'Pak RT', 'BEA_LAPAK');
    const cross = await call(handleHutangPiutangApi, env, '/api/admin/hutang-piutang/payments', {
      token: dermoToken, store: 'DERMO', method: 'POST', body: { accountKey: account.accountKey, amount: 1000, paymentMethod: 'KAS' }
    });
    assert.equal(cross.status, 404);
  } finally { db.close(); }
});

test('Pembelian kasir dengan cara bayar "Jadi Hutang" otomatis jadi Hutang Pembelian ke Supplier; menandai cara bayar menarik pembelian lama', async () => {
  const { db, env, pendem } = setup();
  try {
    const token = await adminToken(db);
    const azis = seedSupplier(db, pendem.id, 'Pak Azis');
    // Cara bayar buatan admin, seperti "Piutang Poci Malang" di produksi.
    db.prepare(`INSERT INTO payment_methods (id, store_id, code, name, is_active, is_default) VALUES ('pm_hp_poci', ?, 'PIUTANG_POCI', 'Piutang Poci', 1, 0)`).run(pendem.id);

    const cashierId = 'cashier_hp_1';
    db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES (?, 'hpkasir', 'x', 'Kasir HP', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(cashierId, pendem.id);
    db.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, '2026-09-24T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('hp-kasir'), cashierId);
    db.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES ('drawer_hp', ?, ?, 0, 'OPEN', '2026-09-26T00:00:00.000Z')`).run(pendem.id, cashierId);
    const kasir = (pathname, body) => handleCashierPurchaseApi(new Request(`https://example.test${pathname}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer hp-kasir', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    }), env, pathname);
    const options = await (await kasir('/api/cashier/purchases/options')).json();
    const productId = options.products[0].productId;
    const buy = async (lineTotal, supplierId) => {
      const response = await kasir('/api/cashier/purchases', { paymentMethod: 'PIUTANG_POCI', supplierId, items: [{ productId, quantity: 1, lineTotal }] });
      assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
      return (await response.json()).id;
    };

    // Belum ditandai -> tidak jadi hutang.
    const oldPurchase = await buy(75000, azis);
    assert.equal((await summary(env, token)).totals.hutangRupiah, 0);

    // Admin menandai "Jadi Hutang" -> pembelian lama ikut ditarik.
    const flagged = await call(handleBusinessSettingsApi, env, '/api/admin/settings/business/payment-methods/pm_hp_poci', { token, method: 'PATCH', body: { createsPayable: true } });
    assert.equal(flagged.status, 200, JSON.stringify(flagged.payload));
    assert.equal(flagged.payload.backfilledPurchases, 1);
    assert.equal(findAccount(await summary(env, token), 'Pak Azis', 'PURCHASE_PAYABLE').balanceRupiah, 75000);

    // Pembelian baru langsung jadi hutang; tanpa supplier -> pihaknya nama cara bayar.
    await buy(25000, azis);
    await buy(10000, null);
    const data = await summary(env, token);
    assert.equal(findAccount(data, 'Pak Azis', 'PURCHASE_PAYABLE').balanceRupiah, 100000);
    assert.equal(findAccount(data, 'Piutang Poci', 'PURCHASE_PAYABLE').balanceRupiah, 10000);

    // Menandai ulang tidak menarik dua kali.
    await call(handleBusinessSettingsApi, env, '/api/admin/settings/business/payment-methods/pm_hp_poci', { token, method: 'PATCH', body: { createsPayable: false } });
    const again = await call(handleBusinessSettingsApi, env, '/api/admin/settings/business/payment-methods/pm_hp_poci', { token, method: 'PATCH', body: { createsPayable: true } });
    assert.equal(again.payload.backfilledPurchases, 0);

    // Pembelian dibatalkan -> hutangnya ikut 0.
    db.prepare(`UPDATE purchases SET voided_at = CURRENT_TIMESTAMP WHERE id = ?`).run(oldPurchase);
    assert.equal(findAccount(await summary(env, token), 'Pak Azis', 'PURCHASE_PAYABLE').balanceRupiah, 25000);
  } finally { db.close(); }
});

test('Laporan Beban merinci beban dari Bea Operasional, Pembayaran Lainnya, dan presensi', async () => {
  const { db, env, pendem } = setup();
  try {
    const token = await adminToken(db);
    const adiva = seedEmployee(db, pendem.entity_id, 'Adiva');
    await catatHutang(env, token, { category: 'BEA_LAPAK', description: 'Sewa lapak', amount: 500000, counterpartyType: 'OTHER', counterpartyName: 'Pak RT' });
    await call(handleHutangPiutangApi, env, '/api/admin/hutang-piutang/pembayaran-lainnya', {
      token, method: 'POST', body: { category: 'BEA_LAINNYA', description: 'Galon', amount: 20000, paymentMethod: 'KAS', businessDate: '2026-09-26' }
    });
    db.prepare(`
      INSERT INTO payroll_ledger_entries (id, employee_id, account_type, account_id, store_id, business_date, entry_type, hutang_gaji_delta_scaled, beban_gaji_delta_scaled, source_type, source_id)
      VALUES ('pl_hp_acc', ?, 'CASHIER', 'cashier_x', ?, '2026-09-26', 'ACCRUAL', 40000000000, 40000000000, 'ATTENDANCE', 'att_hp')
    `).run(adiva, pendem.id);

    const report = await call(handleHutangPiutangApi, env, '/api/admin/laporan-beban', { token, store: 'PENDEM' });
    assert.equal(report.status, 200);
    // default: awal bulan s/d hari ini -- pakai rentang eksplisit supaya deterministik.
    const ranged = await handleHutangPiutangApi(new Request('https://example.test/api/admin/laporan-beban?store=PENDEM&from=2026-09-01&to=2026-09-30', {
      headers: { Authorization: `Bearer ${token}` }
    }), env, '/api/admin/laporan-beban');
    const payload = await ranged.json();
    assert.equal(payload.total, 560000);
    const byStatus = Object.fromEntries(payload.rows.map(row => [row.description, row.status]));
    assert.equal(byStatus['Sewa lapak'], 'Jadi Hutang');
    assert.match(byStatus.Galon, /Dibayar langsung/);
    assert.ok(payload.rows.some(row => row.source === 'PRESENSI' && row.party === 'Adiva' && row.amount === 40000));
    assert.ok(payload.byCategory.length >= 3);
  } finally { db.close(); }
});
