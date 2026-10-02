import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { getNetProfitReport } from '../src/net-profit-report.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-10-02: "kalo leker itu harganya 2000 maka bahannya 2000 adonan.
// nah harga 1 adonan itu kan 1 rupiah. jadi kalo leker itu harusnya ga ada
// provit sama sekali, karna itu barang titipan aja. bisa dibenerin pake hitung
// ulang? kalo bisa jadikan itu fitur ... hanya berlaku untuk hpp."

const migrationDir = new URL('../migrations/', import.meta.url);
const SCALE = 1_000_000;
const WRONG_COST = 1092 * SCALE; // harga adonan per satuan yang salah tercatat
const KIND = 'product_kind_store_kantor_raw_material';

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

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  return db;
}

let seq = 0;
const nextId = prefix => `${prefix}_${++seq}`;

function addProduct(db, name, unitId, averageCost = 0) {
  const id = Number(db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM products').get().n);
  db.prepare(`INSERT INTO products (id, store_id, name, price, category, base_unit_id, product_kind_id, average_cost, stock_tracking_enabled)
    VALUES (?, 'store_kantor', ?, 0, 'Uji', ?, ?, ?, 0)`).run(id, name, unitId, KIND, averageCost);
  return id;
}

async function setup() {
  const db = migratedDatabase();
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_hpp', 'owner_hpp', 'x', 'Owner')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_hpp', '2026-09-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-hpp'));
  db.prepare(`INSERT INTO units (id, store_id, code, name, symbol, decimal_scale) VALUES ('unit_kantor_rp', 'store_kantor', 'RUPIAH', 'Rupiah', 'Rp', 0)`).run();
  db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES ('kasir_hpp', 'kasir_hpp', 'x', 'Kasir', 'store_kantor', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();
  db.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES ('laci_hpp', 'store_kantor', 'kasir_hpp', 0, 'OPEN', CURRENT_TIMESTAMP)`).run();
  const adonan = addProduct(db, 'Adonan Leker', 'unit_kantor_rp', WRONG_COST);
  const leker = addProduct(db, 'Leker Keju', 'unit_store_kantor_pcs');
  db.prepare(`INSERT INTO manufacturing_recipes (id, store_id, output_product_id, output_unit_id, output_quantity, revision, status, created_at)
    VALUES ('resep_leker', 'store_kantor', ?, 'unit_store_kantor_pcs', 1, 1, 'ACTIVE', '2026-09-01T00:00:00.000Z')`).run(leker);
  return { db, d1: new D1Database(db), adonan, leker, token: 'owner-hpp' };
}

// Satu penjualan Leker dadakan: harga = jumlah adonan (1 adonan = Rp1), tapi
// HPP tercatat memakai harga adonan yang salah.
function seedDadakanSale(ctx, { price, createdAt, voided = false, journalPosted = false }) {
  const { db, adonan, leker } = ctx;
  const saleId = nextId('sale');
  const runId = nextId('run');
  const wrongCost = price * WRONG_COST;
  db.prepare(`INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, total_amount, created_at, voided_at) VALUES (?, 'store_kantor', 'laci_hpp', 'kasir_hpp', ?, ?, ?)`)
    .run(saleId, price, createdAt, voided ? createdAt : null);
  db.prepare(`INSERT INTO production_runs (id, store_id, drawer_session_id, sale_id, mode, output_product_id, output_product_name, output_unit_id, output_unit_symbol,
      recipe_id, recipe_revision, batches, output_quantity_per_batch, total_output_quantity, hpp_total_scaled, status, created_by_role, created_by_id, created_at)
    VALUES (?, 'store_kantor', 'laci_hpp', ?, 'AUTO_DADAKAN', ?, 'Leker Keju', 'unit_store_kantor_pcs', 'pcs', 'resep_leker', 1, 1, 1, 1, ?, 'POSTED', 'CASHIER', 'kasir_hpp', ?)`)
    .run(runId, saleId, leker, wrongCost, createdAt);
  db.prepare(`INSERT INTO production_run_components (id, production_run_id, store_id, component_product_id, component_product_name, component_unit_id, component_unit_symbol,
      quantity_per_batch, total_quantity, unit_cost_snapshot_scaled, total_cost_snapshot_scaled, component_product_kind_id)
    VALUES (?, ?, 'store_kantor', ?, 'Adonan Leker', 'unit_kantor_rp', 'Rp', ?, ?, ?, ?, ?)`)
    .run(nextId('comp'), runId, adonan, price, price, WRONG_COST, wrongCost, KIND);
  db.prepare(`INSERT INTO sale_items (id, sale_id, store_id, product_id, product_name, unit_price, quantity, line_total, unit_cost_snapshot, line_cogs, production_run_id, product_kind_id)
    VALUES (?, ?, 'store_kantor', ?, 'Leker Keju', ?, 1, ?, ?, ?, ?, ?)`)
    .run(nextId('item'), saleId, leker, price, price, wrongCost, wrongCost, runId, KIND);
  if (journalPosted) {
    db.prepare(`INSERT INTO accounting_bridge_deliveries (id, store_id, producer_module, fact_type, fact_id, transaction_category_code, status)
      VALUES (?, 'store_kantor', 'POS', 'SALE', ?, 'sale', 'POSTED')`).run(nextId('delivery'), saleId);
  }
  return saleId;
}

function call(ctx, method, path, body) {
  const url = new URL(`https://example.test${path}`);
  url.searchParams.set('store', 'KANTOR');
  return worker.fetch(new Request(url, {
    method, headers: { authorization: `Bearer ${ctx.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  }), { DB: ctx.d1 });
}

test('pratinjau: HPP Leker dihitung ulang dengan 1 adonan = Rp1, jadi HPP = harga jual; penjualan batal tidak ikut', async () => {
  const ctx = await setup();
  try {
    seedDadakanSale(ctx, { price: 2000, createdAt: '2026-09-15T05:00:00.000Z' });
    seedDadakanSale(ctx, { price: 5000, createdAt: '2026-09-16T05:00:00.000Z' });
    seedDadakanSale(ctx, { price: 3000, createdAt: '2026-09-16T06:00:00.000Z', voided: true });

    const res = await call(ctx, 'POST', '/api/admin/hpp-recalculation/preview', { componentProductId: ctx.adonan, unitCost: '1', from: '2026-09-01' });
    assert.equal(res.status, 200);
    const { summary } = await res.json();
    assert.equal(summary.saleCount, 2);
    assert.equal(summary.newHppRupiah, 7000);
    assert.equal(summary.oldHppRupiah, 7000 * 1092);
    assert.equal(summary.deltaRupiah, 7000 - 7000 * 1092);
    assert.deepEqual(summary.byDate.map(day => [day.businessDate, day.newHppRupiah]), [['2026-09-15', 2000], ['2026-09-16', 5000]]);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM hpp_recalculation_lines').get().n, 0, 'pratinjau tidak menyimpan apa pun');
  } finally { ctx.db.close(); }
});

test('terapkan: hanya HPP yang berubah -- untung Leker jadi nol, snapshot lama, stok dan nominal penjualan tidak ditulis ulang', async () => {
  const ctx = await setup();
  try {
    ctx.db.prepare("UPDATE stores SET edition = 'FLEXIBLE' WHERE id = 'store_kantor'").run();
    seedDadakanSale(ctx, { price: 2000, createdAt: '2026-09-15T05:00:00.000Z' });
    const before = ctx.db.prepare('SELECT line_cogs, line_total FROM sale_items').get();

    assert.equal((await call(ctx, 'POST', '/api/admin/hpp-recalculation', { componentProductId: ctx.adonan, unitCost: '1', from: '2026-09-01' })).status, 400, 'alasan wajib');
    const res = await call(ctx, 'POST', '/api/admin/hpp-recalculation', { componentProductId: ctx.adonan, unitCost: '1', from: '2026-09-01', reason: 'Leker barang titipan, 1 adonan = Rp1' });
    assert.equal(res.status, 201);

    const after = ctx.db.prepare('SELECT line_cogs, line_total FROM sale_items').get();
    assert.deepEqual(after, before, 'snapshot penjualan tidak ditulis ulang');
    assert.equal(ctx.db.prepare('SELECT average_cost FROM products WHERE id = ?').get(ctx.adonan).average_cost, SCALE, 'harga rata-rata adonan jadi Rp1');

    const report = await getNetProfitReport(ctx.d1, { storeIds: ['store_kantor'], from: '2026-09-15', to: '2026-09-15', today: '2026-10-02' });
    const day = report.breakdownByKey.get('store_kantor::2026-09-15');
    assert.equal(day.revenue, 2000);
    assert.equal(day.hpp, 2000);
    assert.equal(day.netProfit, 0, 'Leker titipan: untung nol');

    const again = await call(ctx, 'POST', '/api/admin/hpp-recalculation', { componentProductId: ctx.adonan, unitCost: '1', from: '2026-09-01', reason: 'ulang lagi tidak boleh dobel' });
    assert.equal(again.status, 409, 'hitung ulang kedua dengan harga sama tidak menggandakan koreksi');

    const history = await (await call(ctx, 'GET', '/api/admin/hpp-recalculation')).json();
    assert.equal(history.history.length, 1);
    assert.equal(history.history[0].previousAverageCostRupiah, 1092);
  } finally { ctx.db.close(); }
});

test('gerai Akuntansi: jurnal koreksi Debit Persediaan bahan / Kredit HPP untuk penjualan yang jurnalnya sudah masuk; yang belum masuk menunggu tombol sinkron', async () => {
  const ctx = await setup();
  try {
    const posted = seedDadakanSale(ctx, { price: 2000, createdAt: '2026-09-15T05:00:00.000Z', journalPosted: true });
    const pending = seedDadakanSale(ctx, { price: 5000, createdAt: '2026-09-16T05:00:00.000Z' });

    const res = await call(ctx, 'POST', '/api/admin/hpp-recalculation', { componentProductId: ctx.adonan, unitCost: '1', from: '2026-09-01', reason: 'Leker barang titipan' });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.journals.filter(item => item.status === 'POSTED').length, 1);

    const lines = ctx.db.prepare(`
      SELECT a.code, l.side, l.amount_scaled FROM accounting_journal_lines l
      JOIN accounting_journal_headers h ON h.id = l.journal_id JOIN chart_of_accounts a ON a.id = l.account_id
      WHERE h.source_reference_id LIKE 'HPP_KOREKSI:%' ORDER BY l.side`).all();
    const delta = 2000 * 1092 * SCALE - 2000 * SCALE;
    assert.deepEqual(lines.map(line => [line.code, line.side, Number(line.amount_scaled)]), [['5101', 'CREDIT', delta], ['1301', 'DEBIT', delta]]);
    assert.equal(ctx.db.prepare("SELECT business_date FROM accounting_journal_headers WHERE source_reference_id LIKE 'HPP_KOREKSI:%'").get().business_date, '2026-09-15');

    // Penjualan kedua baru masuk pembukuan belakangan -> koreksinya ikut lewat tombol sinkron.
    ctx.db.prepare(`INSERT INTO accounting_bridge_deliveries (id, store_id, producer_module, fact_type, fact_id, transaction_category_code, status)
      VALUES ('delivery_late', 'store_kantor', 'POS', 'SALE', ?, 'sale', 'POSTED')`).run(pending);
    const sync = await (await call(ctx, 'POST', '/api/admin/accounting/bridge/sync', {})).json();
    assert.equal(sync.results.filter(row => row.factType === 'HPP_KOREKSI' && row.status === 'POSTED').length, 1);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM accounting_journal_headers WHERE source_reference_id LIKE 'HPP_KOREKSI:%'").get().n, 2);

    const syncAgain = await (await call(ctx, 'POST', '/api/admin/accounting/bridge/sync', {})).json();
    assert.equal(syncAgain.results.filter(row => row.factType === 'HPP_KOREKSI').length, 0, 'tidak diposting dua kali');
    assert.ok(posted);
  } finally { ctx.db.close(); }
});

test('validasi: bahan gerai lain ditolak, harga harus angka, tanpa login ditolak, daftar bahan hanya yang dipakai produksi dadakan', async () => {
  const ctx = await setup();
  try {
    seedDadakanSale(ctx, { price: 2000, createdAt: '2026-09-15T05:00:00.000Z' });
    assert.equal((await call(ctx, 'POST', '/api/admin/hpp-recalculation/preview', { componentProductId: ctx.adonan, unitCost: 'abc', from: '2026-09-01' })).status, 400);
    assert.equal((await call(ctx, 'POST', '/api/admin/hpp-recalculation/preview', { componentProductId: ctx.adonan, unitCost: '1', from: '' })).status, 400);
    const otherStoreProduct = ctx.db.prepare("SELECT id FROM products WHERE store_id <> 'store_kantor' LIMIT 1").get().id;
    assert.equal((await call(ctx, 'POST', '/api/admin/hpp-recalculation/preview', { componentProductId: otherStoreProduct, unitCost: '1', from: '2026-09-01' })).status, 404);
    const anon = await worker.fetch(new Request('https://example.test/api/admin/hpp-recalculation/components?store=KANTOR'), { DB: ctx.d1 });
    assert.equal(anon.status, 401);

    const list = await (await call(ctx, 'GET', '/api/admin/hpp-recalculation/components')).json();
    assert.deepEqual(list.components.map(item => item.name), ['Adonan Leker']);
  } finally { ctx.db.close(); }
});

test('UI: tab Hitung Ulang HPP di Admin Gerai, pratinjau dulu baru terapkan, menegaskan hanya HPP yang berubah', () => {
  const js = readFileSync(new URL('../public/admin-hpp-recalc.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
  assert.match(js, /Hitung Ulang HPP/);
  assert.match(js, /\/api\/admin\/hpp-recalculation\/preview/);
  assert.match(js, /Hanya HPP yang berubah/);
  assert.match(js, /Pratinjau dulu sebelum menerapkan/);
  assert.match(html, /admin-hpp-recalc\.js\?v=20261002-hitung-ulang-hpp-v1/);
});
