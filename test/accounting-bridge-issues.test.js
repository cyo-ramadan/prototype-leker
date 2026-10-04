import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

// Bos Cyo, 2026-10-03: laba rugi dibaca dari jurnal, jadi semua transaksi uang
// harus berjurnal. Una butuh daftar yang masih berutang jurnal + sebabnya.

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
    try { const out = statements.map(statement => statement.run()); this.db.exec('COMMIT'); return out; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

function setup(edition = 'ACCOUNTING') {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_iss', 'owner_iss', 'x', 'Owner')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_iss', '2026-09-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(
    // hash dihitung lewat owner-auth di bawah
    'placeholder'
  );
  db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES ('kasir_iss', 'kasir_iss', 'x', 'Kasir', 'store_kantor', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();
  db.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES ('laci_iss', 'store_kantor', 'kasir_iss', 0, 'OPEN', CURRENT_TIMESTAMP)`).run();
  db.prepare(`UPDATE stores SET edition = ? WHERE id = 'store_kantor'`).run(edition);
  return db;
}

let seq = 0;
const id = prefix => `${prefix}_${++seq}`;

function addSale(db, { voided = false, createdAt = '2026-10-01T05:00:00.000Z', amount = 10000 } = {}) {
  const saleId = id('sale');
  db.prepare(`INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, total_amount, created_at, voided_at) VALUES (?, 'store_kantor', 'laci_iss', 'kasir_iss', ?, ?, ?)`)
    .run(saleId, amount, createdAt, voided ? createdAt : null);
  return saleId;
}
function addPurchase(db, { createdAt = '2026-10-01T05:00:00.000Z', amount = 50000 } = {}) {
  const purchaseId = id('purchase');
  db.prepare(`INSERT INTO purchases (id, store_id, drawer_session_id, cashier_id, description, total_amount, created_at) VALUES (?, 'store_kantor', 'laci_iss', 'kasir_iss', 'Uji', ?, ?)`)
    .run(purchaseId, amount, createdAt);
  return purchaseId;
}
function addExpense(db, { createdAt = '2026-10-01T05:00:00.000Z', amount = 7000 } = {}) {
  const expenseId = id('expense');
  db.prepare(`INSERT INTO expenses (id, store_id, drawer_session_id, cashier_id, description, amount, created_at) VALUES (?, 'store_kantor', 'laci_iss', 'kasir_iss', 'Uji', ?, ?)`)
    .run(expenseId, amount, createdAt);
  return expenseId;
}
function addDelivery(db, factType, factId, status, { code = '', detail = '', category = '', attempts = 1 } = {}) {
  db.prepare(`INSERT INTO accounting_bridge_deliveries (id, store_id, producer_module, fact_type, fact_id, transaction_category_code, status, failure_code, failure_detail, attempts, last_attempt_at)
    VALUES (?, 'store_kantor', 'POS', ?, ?, ?, ?, ?, ?, ?, '2026-10-02T00:00:00.000Z')`).run(id('delivery'), factType, factId, category, status, code, detail, attempts);
}

async function ownerToken(db) {
  const { hashCredential } = await import('../src/owner-auth.js');
  const token = 'owner-iss-token';
  db.prepare('UPDATE owner_sessions SET token_hash = ? WHERE owner_id = ?').run(await hashCredential(token), 'owner_iss');
  return token;
}

async function getIssues(db, token = null) {
  const url = new URL('https://example.test/api/admin/accounting/bridge/issues');
  url.searchParams.set('store', 'KANTOR');
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  return worker.fetch(new Request(url, { headers }), { DB: new D1Database(db) });
}

test('tanpa login ditolak', async () => {
  const db = setup();
  try {
    assert.equal((await getIssues(db)).status, 401);
  } finally { db.close(); }
});

test('gerai non-Akuntansi: tidak ada utang jurnal untuk dibereskan', async () => {
  const db = setup('FLEXIBLE');
  try {
    addSale(db);
    const body = await (await getIssues(db, await ownerToken(db))).json();
    assert.equal(body.accounting, false);
    assert.deepEqual(body.facts, []);
  } finally { db.close(); }
});

test('daftar utang jurnal: sebab, alat pembereskan, belum-pernah-dicoba, dan yang dibatalkan tidak ditampilkan', async () => {
  const db = setup();
  try {
    const posted = addSale(db); addDelivery(db, 'SALE', posted, 'POSTED');
    const neverTried = addSale(db, { createdAt: '2026-09-02T05:00:00.000Z', amount: 25000 });
    const voided = addSale(db, { voided: true }); addDelivery(db, 'SALE', voided, 'NEEDS_CONFIGURATION', { code: 'NEEDS_PAYMENT_MAPPING' });
    const noKind = addSale(db, { createdAt: '2026-09-03T05:00:00.000Z' }); addDelivery(db, 'SALE', noKind, 'NEEDS_CONFIGURATION', { code: 'NEEDS_PRODUCT_KIND', detail: 'Barang transaksi belum memiliki Jenis Barang.', category: 'sale' });
    const alloc = addPurchase(db, { createdAt: '2026-09-04T05:00:00.000Z', amount: 80000 }); addDelivery(db, 'PURCHASE', alloc, 'NEEDS_CONFIGURATION', { code: 'NEEDS_COMPONENT_ALLOCATION', category: 'purchase_material' });
    const noRule = addExpense(db, { createdAt: '2026-09-30T05:00:00.000Z' }); addDelivery(db, 'EXPENSE', noRule, 'NEEDS_CONFIGURATION', { code: 'NEEDS_MAPPING', category: 'operational', attempts: 14 });
    const failed = addExpense(db, { createdAt: '2026-10-01T05:00:00.000Z' }); addDelivery(db, 'EXPENSE', failed, 'FAILED', { code: 'ACCOUNTING_POST_FAILED', detail: 'Tanggal bisnis ditutup.' });

    const res = await getIssues(db, await ownerToken(db));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.accounting, true);
    assert.equal(body.summary.owing, 5, 'posted dan voided tidak berutang jurnal');
    assert.equal(body.ignored.voided, 1);

    const byId = Object.fromEntries(body.facts.map(fact => [fact.factId, fact]));
    assert.equal(byId[posted], undefined);
    assert.equal(byId[voided], undefined);

    assert.equal(byId[neverTried].neverTried, true);
    assert.equal(byId[neverTried].cause.alat, 'sinkron_akuntansi');
    assert.equal(byId[neverTried].amountRupiah, 25000);
    assert.equal(byId[neverTried].businessDate, '2026-09-02');

    assert.equal(byId[noKind].cause.alat, 'sinkron_akuntansi', 'jembatan mengisi Jenis Barang kosong sendiri saat sinkron');
    assert.match(byId[noKind].cause.langkah, /betulkan_klasifikasi_barang/);

    assert.equal(byId[alloc].cause.alat, 'samakan_aturan_jurnal');
    assert.deepEqual(byId[alloc].cause.parameter, { kategori: 'purchase_material' });
    assert.equal(byId[alloc].amountRupiah, 80000);

    assert.equal(byId[noRule].cause.alat, 'samakan_aturan_jurnal');
    assert.deepEqual(byId[noRule].cause.parameter, { kategori: 'operational' });
    assert.equal(byId[noRule].attempts, 14);

    assert.equal(byId[failed].cause.alat, 'sinkron_akuntansi');
    assert.match(byId[failed].cause.arti, /Tanggal bisnis ditutup/);

    // diurutkan dari yang tertua; kelompok sebab menghitung jumlah dan rentang tanggal
    assert.deepEqual(body.facts.map(fact => fact.businessDate), [...body.facts.map(fact => fact.businessDate)].sort());
    const mapping = body.summary.byCause.find(group => group.code === 'NEEDS_MAPPING');
    assert.equal(mapping.count, 1);
    assert.equal(body.order.length, 3);
  } finally { db.close(); }
});

test('semua beres: daftar kosong dan tidak ada urutan kerja', async () => {
  const db = setup();
  try {
    const sale = addSale(db); addDelivery(db, 'SALE', sale, 'POSTED');
    const body = await (await getIssues(db, await ownerToken(db))).json();
    assert.equal(body.summary.owing, 0);
    assert.deepEqual(body.facts, []);
    assert.deepEqual(body.order, []);
  } finally { db.close(); }
});
