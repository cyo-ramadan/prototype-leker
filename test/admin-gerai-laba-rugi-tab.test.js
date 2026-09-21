import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';

// Laporan Untung Rugi versi panel Admin Gerai (Bos Cyo, 2026-09-17:
// "kerjakan juga langsung laporan net profitnya ya"). Dua hal yang dijaga
// test ini:
//
// 1. PAGAR: Admin Gerai terikat ke satu gerai lewat `?store=`, tapi laporan
//    punya parameter `stores=` yang jalurnya terpisah. Tanpa pagar di
//    handler, Admin gerai A bisa membaca untung-rugi gerai B cukup dengan
//    menukar satu parameter -- bocor lintas gerai, invariant CLAUDE.md #5.
// 2. RINCIAN: panel gerai butuh tahu KENAPA untung/ruginya segitu, bukan
//    cuma angka akhirnya. Rinciannya cuma ikut kalau yang dipilih PERSIS
//    satu gerai.

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
const nextId = prefix => `${prefix}_${++seq}`;

async function seedStoreAdminToken(db, storeCode) {
  const sId = storeId(db, storeCode);
  const adminId = `admin_labarugi_${storeCode}`;
  db.prepare(`INSERT INTO store_admins (id, store_id, username, password_hash, display_name)
    VALUES (?, ?, ?, 'x', 'Admin Laba Rugi')`).run(adminId, sId, `admin_labarugi_${storeCode}`);
  const token = `labarugi-token-${storeCode}`;
  db.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at)
    VALUES (?, ?, '2026-09-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential(token), adminId);
  return token;
}

async function seedOwnerToken(db) {
  const ownerId = 'owner_labarugi_test';
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name)
    VALUES (?, 'owner_labarugi', 'x', 'Test Owner')`).run(ownerId);
  const token = 'owner-labarugi-token';
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at)
    VALUES (?, ?, '2026-09-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential(token), ownerId);
  return token;
}

function seedSale(db, storeCode, { createdAt, totalAmount, lineCogsRupiah }) {
  const sId = storeId(db, storeCode);
  const cashierId = nextId('cashier');
  db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
    VALUES (?, ?, 'x', 'Kasir Test', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(cashierId, nextId('user'), sId);
  const drawerId = nextId('drawer');
  db.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES (?, ?, ?, 0, 'OPEN', CURRENT_TIMESTAMP)`).run(drawerId, sId, cashierId);
  const saleId = nextId('sale');
  db.prepare(`INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, total_amount, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(saleId, sId, drawerId, cashierId, totalAmount, createdAt);
  db.prepare(`INSERT INTO sale_items (id, sale_id, store_id, product_id, product_name, unit_price, quantity, line_total, unit_cost_snapshot, line_cogs)
    VALUES (?, ?, ?, 1, 'Es Teh', ?, 1, ?, ?, ?)`).run(
    nextId('item'), saleId, sId, totalAmount, totalAmount,
    Math.round(lineCogsRupiah * COST_SCALE), Math.round(lineCogsRupiah * COST_SCALE)
  );
  return { storeId: sId, drawerId, cashierId };
}

function reportRequest({ token, store, from, to, stores }) {
  const url = new URL('https://example.test/api/admin/reports/net-profit');
  url.searchParams.set('store', store);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  if (stores !== undefined) url.searchParams.set('stores', stores);
  return new Request(url, { headers: { Authorization: `Bearer ${token}` } });
}

test('Admin Gerai TIDAK bisa membaca laporan gerai lain lewat parameter stores=', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedStoreAdminToken(db, 'KANTOR');
    seedSale(db, 'PENDEM', { createdAt: '2026-06-01T05:00:00.000Z', totalAmount: 500000, lineCogsRupiah: 100000 });
    const env = { DB: new D1Database(db) };

    const res = await worker.fetch(reportRequest({
      token, store: 'KANTOR', from: '2026-06-01', to: '2026-06-01', stores: 'PENDEM'
    }), env);
    assert.equal(res.status, 403, 'Admin KANTOR tidak boleh melihat untung-rugi PENDEM');
    assert.equal((await res.json()).code, 'STORE_OUT_OF_CALLER_SCOPE');
  } finally {
    db.close();
  }
});

test('Admin Gerai tanpa parameter stores= hanya dapat gerainya sendiri, bukan seluruh entity', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedStoreAdminToken(db, 'KANTOR');
    seedSale(db, 'KANTOR', { createdAt: '2026-06-01T05:00:00.000Z', totalAmount: 20000, lineCogsRupiah: 5000 });
    seedSale(db, 'PENDEM', { createdAt: '2026-06-01T05:00:00.000Z', totalAmount: 900000, lineCogsRupiah: 100000 });
    const env = { DB: new D1Database(db) };

    const res = await worker.fetch(reportRequest({ token, store: 'KANTOR', from: '2026-06-01', to: '2026-06-01' }), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.scope, 'STORE');
    assert.deepEqual(body.stores.map(store => store.code), ['KANTOR']);
    assert.equal(body.totals.total, 15000, 'angka PENDEM tidak boleh bocor ke total Admin KANTOR');
  } finally {
    db.close();
  }
});

test('Owner tetap bisa melihat seluruh gerai satu entity -- pagar hanya berlaku untuk Admin Gerai', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    seedSale(db, 'KANTOR', { createdAt: '2026-06-01T05:00:00.000Z', totalAmount: 20000, lineCogsRupiah: 5000 });
    seedSale(db, 'PENDEM', { createdAt: '2026-06-01T05:00:00.000Z', totalAmount: 30000, lineCogsRupiah: 10000 });
    const env = { DB: new D1Database(db) };

    const res = await worker.fetch(reportRequest({
      token, store: 'KANTOR', from: '2026-06-01', to: '2026-06-01', stores: 'KANTOR,PENDEM'
    }), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.scope, 'ENTITY');
    assert.equal(body.totals.total, 35000);
  } finally {
    db.close();
  }
});

test('satu gerai dapat rincian per hari yang penjumlahannya konsisten dengan untung bersihnya', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedStoreAdminToken(db, 'KANTOR');
    const ctx = seedSale(db, 'KANTOR', { createdAt: '2026-06-01T05:00:00.000Z', totalAmount: 50000, lineCogsRupiah: 20000 });
    db.prepare(`INSERT INTO other_income (id, store_id, drawer_session_id, cashier_id, description, amount, created_at)
      VALUES (?, ?, ?, ?, 'Pendapatan Lain', 5000, '2026-06-01T05:00:00.000Z')`).run(nextId('income'), ctx.storeId, ctx.drawerId, ctx.cashierId);
    db.prepare(`INSERT INTO expenses (id, store_id, drawer_session_id, cashier_id, description, amount, created_at)
      VALUES (?, ?, ?, ?, 'Beban Kasir', 10000, '2026-06-01T05:00:00.000Z')`).run(nextId('expense'), ctx.storeId, ctx.drawerId, ctx.cashierId);
    db.prepare(`INSERT INTO admin_operational_expenses (id, store_id, category, description, amount, business_date, created_by_role, created_by_id, created_at)
      VALUES (?, ?, 'BEA_LAPAK', 'Sewa lapak Juni', 7000, '2026-06-01', 'ADMIN', 'x', CURRENT_TIMESTAMP)`).run(nextId('beaops'), ctx.storeId);
    const env = { DB: new D1Database(db) };

    const res = await worker.fetch(reportRequest({ token, store: 'KANTOR', from: '2026-06-01', to: '2026-06-01', stores: 'KANTOR' }), env);
    const body = await res.json();
    const row = body.rows[0];

    assert.equal(row.breakdown.revenue, 50000);
    assert.equal(row.breakdown.otherIncome, 5000);
    assert.equal(row.breakdown.hpp, 20000);
    assert.equal(row.breakdown.expense, 17000, 'Beban = Pengeluaran Kasir 10.000 + Bea Lapak 7.000');
    // Gross = 5000 + 50000 - 20000 = 35000; Net = 35000 - 17000 = 18000
    assert.equal(row.breakdown.netProfit, 18000);
    assert.equal(row.breakdown.netProfit, row.total, 'rincian dan angka utama tidak boleh beda sumber');
    assert.equal(body.breakdownTotals.netProfit, 18000);
  } finally {
    db.close();
  }
});

test('rincian TIDAK ikut dikirim kalau yang dipilih lebih dari satu gerai', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const res = await worker.fetch(reportRequest({
      token, store: 'KANTOR', from: '2026-06-01', to: '2026-06-01', stores: 'KANTOR,PENDEM'
    }), env);
    const body = await res.json();
    assert.equal(body.breakdownTotals, undefined);
    assert.equal(body.rows[0].breakdown, undefined);
  } finally {
    db.close();
  }
});

test('rincian dibaca dari cache dengan angka yang sama, bukan cuma waktu dihitung pertama kali', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedStoreAdminToken(db, 'KANTOR');
    seedSale(db, 'KANTOR', { createdAt: '2026-06-01T05:00:00.000Z', totalAmount: 50000, lineCogsRupiah: 20000 });
    const env = { DB: new D1Database(db) };
    const args = { token, store: 'KANTOR', from: '2026-06-01', to: '2026-06-01', stores: 'KANTOR' };

    const first = await (await worker.fetch(reportRequest(args), env)).json();
    assert.ok(
      db.prepare('SELECT 1 FROM store_daily_profit_snapshot WHERE store_id = ? AND business_date = ?').get(storeId(db, 'KANTOR'), '2026-06-01'),
      'hari yang sudah lewat wajib masuk cache dulu supaya test ini bermakna'
    );
    const second = await (await worker.fetch(reportRequest(args), env)).json();

    assert.deepEqual(second.rows[0].breakdown, first.rows[0].breakdown, 'rincian dari cache harus identik dengan hasil hitung langsung');
    assert.equal(second.rows[0].breakdown.revenue, 50000);
    assert.equal(second.rows[0].breakdown.hpp, 20000);
  } finally {
    db.close();
  }
});

test('panel Admin Gerai memuat tab Bea Operasional dan Laporan Untung Rugi', () => {
  const html = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="\/admin-operational-expense\.js/);
  assert.match(html, /<script src="\/admin-net-profit-report\.js/);

  const bea = readFileSync(new URL('../public/admin-operational-expense.js', import.meta.url), 'utf8');
  assert.match(bea, /dataset\.tab = 'beaops'/);
  assert.match(bea, /id="tab-beaops"/);
  assert.match(bea, /\/api\/admin\/operational-expenses/);

  const laba = readFileSync(new URL('../public/admin-net-profit-report.js', import.meta.url), 'utf8');
  assert.match(laba, /dataset\.tab = 'labarugi'/);
  assert.match(laba, /id="tab-labarugi"/);
  // Gerainya dikunci ke gerai yang sedang dibuka -- kalau parameter ini hilang,
  // Owner yang membuka panel gerai akan melihat gabungan seluruh entity.
  assert.match(laba, /stores=\$\{encodeURIComponent\(storeCode\)\}/);
  assert.match(laba, /window\.LEKER_STORE_CODE/);
});

test('istilah di layar Laporan Untung Rugi pakai bahasa warung, bukan istilah akuntansi', () => {
  const laba = readFileSync(new URL('../public/admin-net-profit-report.js', import.meta.url), 'utf8');
  // Bos Cyo: POS ini untuk "user yang ga paham akunting". Label di layar tidak
  // boleh memakai singkatan akuntansi -- di dalam kode boleh (nama field API).
  const body = laba.slice(laba.indexOf('function renderSummary'), laba.indexOf('function summaryRow'));
  const labels = [...body.matchAll(/summaryRow\(([\s\S]*?), -?[a-z]/g)].flatMap(match => match[1].match(/'[^']*'/g) || []);
  assert.ok(labels.length >= 7, `ringkasan wajib memecah angkanya jadi beberapa baris, bukan satu angka saja (ketemu ${labels.length})`);
  for (const label of labels) {
    assert.doesNotMatch(label, /HPP|COGS|Net Profit|Gross Profit|Beban Pokok/i, `label ${label} masih istilah akuntansi`);
  }
});
