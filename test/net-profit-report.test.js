import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { getNetProfitReport } from '../src/net-profit-report.js';
import { hashCredential } from '../src/owner-auth.js';

// Laporan Net Profit harian, Bos Cyo 2026-09-17: "desainnya sampai detik
// ini harus bisa dulu tanpa akuntansi" -- dihitung dari business fact
// kasir langsung (sales/sale_items/expenses/other_income/approval_requests
// Penyesuaian Stok), bukan dari Accounting journal. KANTOR dan PENDEM
// dipakai sebagai dua gerai yang sudah nyata berbagi entity ENT-KPM
// (migration 0064), IKAN01 sebagai gerai entity lain (ENT-GALEH,
// migration 0050) untuk uji isolasi entity.

const migrationDir = new URL('../migrations/', import.meta.url);
const COST_SCALE = 1_000_000;

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

function storeId(db, code) {
  return db.prepare('SELECT id FROM stores WHERE code = ?').get(code).id;
}

let seq = 0;
function nextId(prefix) { return `${prefix}_${++seq}`; }

function seedDrawer(db, storeCode) {
  const sId = storeId(db, storeCode);
  const cashierId = nextId('cashier');
  db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
    VALUES (?, ?, 'x', 'Kasir Test', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(cashierId, nextId('user'), sId);
  const drawerId = nextId('drawer');
  db.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES (?, ?, ?, 0, 'OPEN', CURRENT_TIMESTAMP)`).run(drawerId, sId, cashierId);
  return { storeId: sId, cashierId, drawerId };
}

function seedSale(db, { storeId: sId, drawerId, cashierId, createdAt, totalAmount, lineCogsRupiah, voided = false }) {
  const saleId = nextId('sale');
  db.prepare(`INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, total_amount, created_at, voided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(saleId, sId, drawerId, cashierId, totalAmount, createdAt, voided ? createdAt : null);
  db.prepare(`INSERT INTO sale_items (id, sale_id, store_id, product_id, product_name, unit_price, quantity, line_total, unit_cost_snapshot, line_cogs)
    VALUES (?, ?, ?, 1, 'Es Teh', ?, 1, ?, ?, ?)`).run(
    nextId('item'), saleId, sId, totalAmount, totalAmount,
    Math.round(lineCogsRupiah * COST_SCALE), Math.round(lineCogsRupiah * COST_SCALE)
  );
  return saleId;
}

function seedExpense(db, { storeId: sId, drawerId, cashierId, createdAt, amount, voided = false }) {
  db.prepare(`INSERT INTO expenses (id, store_id, drawer_session_id, cashier_id, description, amount, created_at, voided_at)
    VALUES (?, ?, ?, ?, 'Beban Operasional Test', ?, ?, ?)`).run(nextId('expense'), sId, drawerId, cashierId, amount, createdAt, voided ? createdAt : null);
}

function seedOtherIncome(db, { storeId: sId, drawerId, cashierId, createdAt, amount }) {
  db.prepare(`INSERT INTO other_income (id, store_id, drawer_session_id, cashier_id, description, amount, created_at)
    VALUES (?, ?, ?, ?, 'Pendapatan Lain Test', ?, ?)`).run(nextId('income'), sId, drawerId, cashierId, amount, createdAt);
}

function seedStockAdjustment(db, { storeId: sId, drawerId, cashierId, postedAt, direction, totalCostRupiah }) {
  const payload = JSON.stringify({ purpose: 'STOCK_ADJUSTMENT', direction, totalCostSnapshotScaled: Math.round(totalCostRupiah * COST_SCALE) });
  db.prepare(`INSERT INTO approval_requests (id, store_id, drawer_session_id, cashier_id, request_type, approval_status, posting_status, payload_json, created_at, updated_at, approved_at, posted_at)
    VALUES (?, ?, ?, ?, 'GOODS_FLOW', 'approved', 'posted', ?, ?, ?, ?, ?)`)
    .run(nextId('approval'), sId, drawerId, cashierId, payload, postedAt, postedAt, postedAt, postedAt);
}

test('Net Profit dihitung murni dari business fact kasir: Pendapatan Lain + Penjualan - HPP - Beban +/- Penyesuaian Stok, tanpa Accounting sama sekali', async () => {
  const db = migratedDatabase();
  try {
    const ctx = seedDrawer(db, 'KANTOR');
    const date = '2026-06-01';
    const createdAt = `${date}T05:00:00.000Z`; // 05:00 UTC = 12:00 Jakarta, jelas satu business date

    seedSale(db, { ...ctx, createdAt, totalAmount: 50000, lineCogsRupiah: 20000 });
    seedOtherIncome(db, { ...ctx, createdAt, amount: 5000 });
    seedExpense(db, { ...ctx, createdAt, amount: 10000 });
    seedStockAdjustment(db, { ...ctx, postedAt: createdAt, direction: 'OUT', totalCostRupiah: 3000 });

    const env = new D1Database(db);
    const { netProfitByKey } = await getNetProfitReport(env, { storeIds: [ctx.storeId], from: date, to: date, today: '2026-06-05' });

    // Gross Profit = 5000 + 50000 - 20000 = 35000; Net Profit = 35000 - 10000 - 3000 (stok hilang) = 22000
    assert.equal(netProfitByKey.get(`${ctx.storeId}::${date}`), 22000);
  } finally {
    db.close();
  }
});

test('Penyesuaian Stok arah IN (stok lebih) menambah Net Profit seperti pendapatan lain', async () => {
  const db = migratedDatabase();
  try {
    const ctx = seedDrawer(db, 'KANTOR');
    const date = '2026-06-01';
    const createdAt = `${date}T05:00:00.000Z`;
    seedSale(db, { ...ctx, createdAt, totalAmount: 10000, lineCogsRupiah: 4000 });
    seedStockAdjustment(db, { ...ctx, postedAt: createdAt, direction: 'IN', totalCostRupiah: 2000 });

    const env = new D1Database(db);
    const { netProfitByKey } = await getNetProfitReport(env, { storeIds: [ctx.storeId], from: date, to: date, today: '2026-06-05' });
    // Gross Profit = 0 + 10000 - 4000 = 6000; Net Profit = 6000 - 0 + 2000 = 8000
    assert.equal(netProfitByKey.get(`${ctx.storeId}::${date}`), 8000);
  } finally {
    db.close();
  }
});

test('transaksi yang dibatalkan (voided) tidak ikut dihitung sama sekali', async () => {
  const db = migratedDatabase();
  try {
    const ctx = seedDrawer(db, 'KANTOR');
    const date = '2026-06-01';
    const createdAt = `${date}T05:00:00.000Z`;
    seedSale(db, { ...ctx, createdAt, totalAmount: 999999, lineCogsRupiah: 1, voided: true });
    seedExpense(db, { ...ctx, createdAt, amount: 999999, voided: true });
    seedSale(db, { ...ctx, createdAt, totalAmount: 1000, lineCogsRupiah: 0 });

    const env = new D1Database(db);
    const { netProfitByKey } = await getNetProfitReport(env, { storeIds: [ctx.storeId], from: date, to: date, today: '2026-06-05' });
    assert.equal(netProfitByKey.get(`${ctx.storeId}::${date}`), 1000);
  } finally {
    db.close();
  }
});

test('Pembelian Bahan (tabel purchases) tidak pernah ikut memengaruhi Net Profit berapa pun nilainya', async () => {
  const db = migratedDatabase();
  try {
    const ctx = seedDrawer(db, 'KANTOR');
    const date = '2026-06-01';
    const createdAt = `${date}T05:00:00.000Z`;
    seedSale(db, { ...ctx, createdAt, totalAmount: 10000, lineCogsRupiah: 3000 });
    db.prepare(`INSERT INTO purchases (id, store_id, drawer_session_id, cashier_id, description, total_amount, created_at)
      VALUES (?, ?, ?, ?, 'Beli bahan banyak sekali', 50000000, ?)`).run(nextId('purchase'), ctx.storeId, ctx.drawerId, ctx.cashierId, createdAt);

    const env = new D1Database(db);
    const { netProfitByKey } = await getNetProfitReport(env, { storeIds: [ctx.storeId], from: date, to: date, today: '2026-06-05' });
    assert.equal(netProfitByKey.get(`${ctx.storeId}::${date}`), 7000);
  } finally {
    db.close();
  }
});

test('hari yang sudah lewat di-cache dan TIDAK dihitung ulang, meski data sumbernya diubah setelahnya', async () => {
  const db = migratedDatabase();
  try {
    const ctx = seedDrawer(db, 'KANTOR');
    const date = '2026-06-01';
    const createdAt = `${date}T05:00:00.000Z`;
    seedSale(db, { ...ctx, createdAt, totalAmount: 10000, lineCogsRupiah: 0 });
    const env = new D1Database(db);

    const first = await getNetProfitReport(env, { storeIds: [ctx.storeId], from: date, to: date, today: '2026-06-05' });
    assert.equal(first.netProfitByKey.get(`${ctx.storeId}::${date}`), 10000);

    const cachedRow = db.prepare('SELECT net_profit FROM store_daily_profit_snapshot WHERE store_id = ? AND business_date = ?').get(ctx.storeId, date);
    assert.equal(cachedRow.net_profit, 10000, 'hari yang sudah lewat wajib ditulis ke cache');

    // Ubah data sumber SETELAH ke-cache -- kalau report ini benar, hasilnya
    // TIDAK BOLEH ikut berubah, karena hari itu sudah dianggap tutup buku.
    db.prepare('UPDATE sales SET total_amount = 999999 WHERE store_id = ?').run(ctx.storeId);

    const second = await getNetProfitReport(env, { storeIds: [ctx.storeId], from: date, to: date, today: '2026-06-05' });
    assert.equal(second.netProfitByKey.get(`${ctx.storeId}::${date}`), 10000, 'harus tetap baca dari cache, bukan hitung ulang');
  } finally {
    db.close();
  }
});

test('hari INI tidak pernah ditulis ke cache -- selalu dihitung live', async () => {
  const db = migratedDatabase();
  try {
    const ctx = seedDrawer(db, 'KANTOR');
    const today = '2026-06-05';
    const createdAt = `${today}T05:00:00.000Z`;
    seedSale(db, { ...ctx, createdAt, totalAmount: 5000, lineCogsRupiah: 0 });
    const env = new D1Database(db);

    const result = await getNetProfitReport(env, { storeIds: [ctx.storeId], from: today, to: today, today });
    assert.equal(result.netProfitByKey.get(`${ctx.storeId}::${today}`), 5000);

    const cachedRow = db.prepare('SELECT * FROM store_daily_profit_snapshot WHERE store_id = ? AND business_date = ?').get(ctx.storeId, today);
    assert.equal(cachedRow, undefined, 'hari ini tidak boleh masuk cache karena transaksinya masih berjalan');
  } finally {
    db.close();
  }
});

async function seedOwnerToken(db) {
  const ownerId = 'owner_np_test';
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES (?, 'owner_np_test', 'x', 'Test Owner')`).run(ownerId);
  const token = 'owner-np-token';
  const tokenHash = await hashCredential(token);
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, '2026-06-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(tokenHash, ownerId);
  return token;
}

function request(pathname, { token, store, search } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store) url.searchParams.set('store', store);
  if (search) for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
  return new Request(url, { method: 'GET', headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

test('endpoint laporan menolak gerai di luar entity pemanggil, dan mengembalikan grid tanggal x gerai + Total', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    seedSale(db, { ...seedDrawer(db, 'KANTOR'), createdAt: '2026-06-01T05:00:00.000Z', totalAmount: 20000, lineCogsRupiah: 5000 });
    seedSale(db, { ...seedDrawer(db, 'PENDEM'), createdAt: '2026-06-01T05:00:00.000Z', totalAmount: 30000, lineCogsRupiah: 10000 });
    const env = { DB: new D1Database(db) };

    const crossEntity = await worker.fetch(request('/api/admin/reports/net-profit', {
      token, store: 'KANTOR', search: { from: '2026-06-01', to: '2026-06-01', stores: 'IKAN01' }
    }), env);
    assert.equal(crossEntity.status, 403);
    assert.equal((await crossEntity.json()).code, 'STORE_OUT_OF_ENTITY_SCOPE');

    const res = await worker.fetch(request('/api/admin/reports/net-profit', {
      token, store: 'KANTOR', search: { from: '2026-06-01', to: '2026-06-01', stores: 'KANTOR,PENDEM' }
    }), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.rows.length, 1);
    assert.equal(body.rows[0].byStore.KANTOR, 15000);
    assert.equal(body.rows[0].byStore.PENDEM, 20000);
    assert.equal(body.rows[0].total, 35000);
    assert.equal(body.totals.total, 35000);
  } finally {
    db.close();
  }
});
