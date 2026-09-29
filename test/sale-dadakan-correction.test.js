import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { prepareSaleStockProduction } from '../src/stock-production.js';
import { buildSaleStatements } from '../src/cashier-sales-tracking.js';
import { executeTransactionCorrection } from '../src/transaction-correction-executor.js';
import { resolveLinkedRecipe } from '../src/product-policy.js';

// Bos Cyo, 2026-09-24: hapus penjualan yang memicu produksi dadakan dibalik
// penuh -- "yang + diganti minus dan yang minus diganti +" -- dan "yang bisa
// dipasang di link dadakan hanyalah yang hasilnya 1."

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(sqlite, sql, params = []) { this.sqlite = sqlite; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.sqlite, this.sql, params); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.params) ?? null; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.params) }; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class D1Database {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new D1Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

const COMPONENT_A_COST = 2_000_000;
const COMPONENT_B_COST = 3_000_500;

// Barang jadi dengan resep hasil 1 dari dua bahan (2 A + 1 B per porsi),
// pakai produk seed G001 supaya bentuk schema-nya asli.
function dadakanFixture(sqlite, { outputOpeningStock = 0, outputOpeningCost = 0, recipeOutput = 1 } = {}) {
  const store = sqlite.prepare(`SELECT id, code, store_name FROM stores WHERE code = 'G001' LIMIT 1`).get();
  const [output, componentA, componentB] = sqlite.prepare(`
    SELECT p.id, p.base_unit_id FROM products p
    WHERE p.store_id = ? AND p.base_unit_id IS NOT NULL
    ORDER BY p.id LIMIT 3
  `).all(store.id);
  assert.ok(output && componentA && componentB);
  const cashier = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1`).get(store.id);

  const setStock = (productId, quantity, cost) => {
    sqlite.prepare(`UPDATE products SET is_active = 1, stock_tracking_enabled = 1, average_cost = ? WHERE id = ? AND store_id = ?`)
      .run(cost, productId, store.id);
    sqlite.prepare(`
      INSERT INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
      VALUES (?, ?, ?, '2026-09-24T00:00:00.000Z')
      ON CONFLICT(store_id, product_id) DO UPDATE SET quantity = excluded.quantity
    `).run(store.id, productId, quantity);
  };
  setStock(componentA.id, 100, COMPONENT_A_COST);
  setStock(componentB.id, 50, COMPONENT_B_COST);
  setStock(output.id, outputOpeningStock, outputOpeningCost);

  const recipeId = `recipe_dadakan_correction_${output.id}`;
  sqlite.prepare(`
    INSERT INTO manufacturing_recipes (id, store_id, output_product_id, output_unit_id, output_quantity, revision, status, created_at)
    VALUES (?, ?, ?, ?, ?, 1, 'ACTIVE', '2026-09-24T00:00:00.000Z')
  `).run(recipeId, store.id, output.id, output.base_unit_id, recipeOutput);
  sqlite.prepare(`
    INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
    VALUES (?, ?, ?, ?, ?, 2, 1), (?, ?, ?, ?, ?, 1, 2)
  `).run(
    `rc_a_${output.id}`, recipeId, store.id, componentA.id, componentA.base_unit_id,
    `rc_b_${output.id}`, recipeId, store.id, componentB.id, componentB.base_unit_id
  );
  sqlite.prepare(`UPDATE products SET linked_recipe_id = ?, recipe_link_enabled = 1 WHERE id = ? AND store_id = ?`)
    .run(recipeId, output.id, store.id);

  const drawerId = `drawer_dadakan_correction_${output.id}`;
  sqlite.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES (?, ?, ?, 0, 'OPEN', '2026-09-24T00:00:00.000Z')
  `).run(drawerId, store.id, cashier.id);

  return {
    store: { id: store.id, code: store.code, storeName: store.store_name },
    storeId: store.id, drawerId, cashierId: cashier.id, recipeId,
    outputId: Number(output.id), componentAId: Number(componentA.id), componentBId: Number(componentB.id)
  };
}

async function postDadakanSale(db, fixture, { saleId, quantity, now = '2026-09-24T10:00:00.000Z' }) {
  const lines = [{ productId: fixture.outputId, productName: 'Es Teh Poci', unitPrice: 8000, quantity, lineTotal: 8000 * quantity, note: '' }];
  const prepared = await prepareSaleStockProduction(db, {
    storeId: fixture.storeId, drawerId: fixture.drawerId, cashierId: fixture.cashierId, saleId, lines, now
  });
  assert.equal(prepared.ok, true, prepared.error);
  assert.equal(prepared.lines[0].productionMode, 'DADAKAN');
  await db.batch(buildSaleStatements(db, {
    saleId, storeId: fixture.storeId, drawerId: fixture.drawerId, cashierId: fixture.cashierId,
    linkedOrderId: null, customerId: null, customerName: 'Walk-in', total: 8000 * quantity,
    totalPoints: 0, note: '', now, channel: 'CASH', lines: prepared.lines,
    operationalStatements: prepared.statements, pointShareGroupId: null
  }));
}

function stockState(sqlite, fixture, productId) {
  const row = sqlite.prepare(`
    SELECT COALESCE(b.quantity, 0) AS quantity, p.average_cost
    FROM products p
    LEFT JOIN inventory_stock_balances b ON b.store_id = p.store_id AND b.product_id = p.id
    WHERE p.id = ? AND p.store_id = ?
  `).get(productId, fixture.storeId);
  return { quantity: Number(row.quantity), averageCost: Number(row.average_cost) };
}

function approvedPermit(sqlite, fixture, saleId) {
  const permitId = `permit_${crypto.randomUUID()}`;
  sqlite.prepare(`
    INSERT INTO approval_permits (
      id, store_id, drawer_session_id, cashier_id, permit_type,
      subject_type, subject_id, subject_snapshot_json, reason,
      approval_status, execution_status, requested_at, updated_at,
      decided_at, approved_by_role, approved_by_id
    ) VALUES (?, ?, ?, ?, 'TRANSACTION_VOID', 'SALE', ?, '{}', 'salah input',
              'approved', 'NOT_ATTEMPTED', '2026-09-24T10:30:00.000Z', '2026-09-24T10:30:00.000Z',
              '2026-09-24T10:30:00.000Z', 'ADMIN', 'admin_test')
  `).run(permitId, fixture.storeId, fixture.drawerId, fixture.cashierId, saleId);
  return { id: permitId, subjectType: 'SALE', subjectId: saleId, reason: 'salah input' };
}

const actor = { role: 'ADMIN', id: 'admin_test' };

test('hapus penjualan dadakan membalik penuh: bahan kembali, hasil produksi ditarik, produksi dibatalkan', async () => {
  const sqlite = freshDatabase();
  const db = new D1Database(sqlite);
  try {
    const fixture = dadakanFixture(sqlite);
    const before = {
      output: stockState(sqlite, fixture, fixture.outputId),
      a: stockState(sqlite, fixture, fixture.componentAId),
      b: stockState(sqlite, fixture, fixture.componentBId)
    };

    await postDadakanSale(db, fixture, { saleId: 'sale_dadakan_void', quantity: 3 });
    assert.equal(stockState(sqlite, fixture, fixture.componentAId).quantity, 94);
    assert.equal(stockState(sqlite, fixture, fixture.componentBId).quantity, 47);

    const permit = approvedPermit(sqlite, fixture, 'sale_dadakan_void');
    const result = await executeTransactionCorrection(db, fixture.store, permit, actor, '2026-09-24T10:31:00.000Z');
    assert.equal(result.ok, true, JSON.stringify(result));

    assert.deepEqual(stockState(sqlite, fixture, fixture.componentAId), before.a);
    assert.deepEqual(stockState(sqlite, fixture, fixture.componentBId), before.b);
    assert.equal(stockState(sqlite, fixture, fixture.outputId).quantity, before.output.quantity);

    const run = sqlite.prepare(`SELECT status FROM production_runs WHERE sale_id = ?`).get('sale_dadakan_void');
    assert.equal(run.status, 'CANCELLED');
    const sale = sqlite.prepare(`SELECT voided_at, void_permit_id FROM sales WHERE id = ?`).get('sale_dadakan_void');
    assert.ok(sale.voided_at);
    assert.equal(sale.void_permit_id, permit.id);

    const mirrors = sqlite.prepare(`
      SELECT product_id, direction, quantity FROM stock_movements
      WHERE source_type = 'PRODUCTION_VOID' ORDER BY product_id
    `).all().map(row => ({ ...row }));
    assert.deepEqual(mirrors, [
      { product_id: fixture.outputId, direction: 'OUT', quantity: 3 },
      { product_id: fixture.componentAId, direction: 'IN', quantity: 6 },
      { product_id: fixture.componentBId, direction: 'IN', quantity: 3 }
    ].sort((x, y) => x.product_id - y.product_id));

    // Riwayat lama tidak diubah: mutasi produksi dan penjualan aslinya tetap ada.
    const originals = sqlite.prepare(`
      SELECT COUNT(*) AS n FROM stock_movements WHERE source_type IN ('PRODUCTION_INPUT', 'PRODUCTION_OUTPUT', 'SALE')
    `).get();
    assert.equal(originals.n, 4);
  } finally {
    sqlite.close();
  }
});

test('Retry Eksekusi aman diulang: pembalik produksi tidak diterapkan dua kali', async () => {
  const sqlite = freshDatabase();
  const db = new D1Database(sqlite);
  try {
    const fixture = dadakanFixture(sqlite);
    await postDadakanSale(db, fixture, { saleId: 'sale_dadakan_retry', quantity: 2 });
    const permit = approvedPermit(sqlite, fixture, 'sale_dadakan_retry');
    const first = await executeTransactionCorrection(db, fixture.store, permit, actor, '2026-09-24T10:31:00.000Z');
    assert.equal(first.ok, true);
    const afterFirst = stockState(sqlite, fixture, fixture.componentAId);

    const second = await executeTransactionCorrection(db, fixture.store, permit, actor, '2026-09-24T10:32:00.000Z');
    assert.equal(second.ok, true);
    assert.equal(second.duplicate, true);
    assert.deepEqual(stockState(sqlite, fixture, fixture.componentAId), afterFirst);
    const mirrors = sqlite.prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE source_type = 'PRODUCTION_VOID'`).get();
    assert.equal(mirrors.n, 3);
  } finally {
    sqlite.close();
  }
});

test('stok barang jadi yang sudah ada sebelumnya: Average Cost kembali ke nilai awal (selisih pembulatan maks 1 unit skala)', async () => {
  const sqlite = freshDatabase();
  const db = new D1Database(sqlite);
  try {
    const fixture = dadakanFixture(sqlite, { outputOpeningStock: 5, outputOpeningCost: 9_000_000 });
    await postDadakanSale(db, fixture, { saleId: 'sale_dadakan_prior_stock', quantity: 3 });
    assert.notEqual(stockState(sqlite, fixture, fixture.outputId).averageCost, 9_000_000,
      'produksi dadakan memang menggeser Average Cost barang jadi yang punya stok lama');

    const permit = approvedPermit(sqlite, fixture, 'sale_dadakan_prior_stock');
    const result = await executeTransactionCorrection(db, fixture.store, permit, actor, '2026-09-24T10:31:00.000Z');
    assert.equal(result.ok, true);
    const output = stockState(sqlite, fixture, fixture.outputId);
    assert.equal(output.quantity, 5);
    assert.ok(Math.abs(output.averageCost - 9_000_000) <= 1, `average cost ${output.averageCost}`);
    assert.deepEqual(stockState(sqlite, fixture, fixture.componentAId), { quantity: 100, averageCost: COMPONENT_A_COST });
  } finally {
    sqlite.close();
  }
});

test('produksi lama yang hasilnya lebih besar dari yang dijual tetap HOLD tanpa mengubah data', async () => {
  const sqlite = freshDatabase();
  const db = new D1Database(sqlite);
  try {
    const fixture = dadakanFixture(sqlite);
    await postDadakanSale(db, fixture, { saleId: 'sale_dadakan_legacy_excess', quantity: 1 });
    // Mensimulasikan run lama sebelum link dadakan dikunci ke resep hasil 1.
    sqlite.prepare(`UPDATE production_runs SET total_output_quantity = 5 WHERE sale_id = ?`).run('sale_dadakan_legacy_excess');
    const stockBefore = stockState(sqlite, fixture, fixture.componentAId);

    const permit = approvedPermit(sqlite, fixture, 'sale_dadakan_legacy_excess');
    const result = await executeTransactionCorrection(db, fixture.store, permit, actor, '2026-09-24T10:31:00.000Z');
    assert.equal(result.ok, false);
    assert.equal(result.status, 'HOLD');
    assert.equal(result.code, 'SALE_AUTO_PRODUCTION_EXCESS_OUTPUT');
    assert.equal(sqlite.prepare(`SELECT voided_at FROM sales WHERE id = ?`).get('sale_dadakan_legacy_excess').voided_at, null);
    assert.deepEqual(stockState(sqlite, fixture, fixture.componentAId), stockBefore);
  } finally {
    sqlite.close();
  }
});

test('link dadakan hanya menerima resep hasil 1; link lama hasil banyak tidak bisa dijual Dadakan', async () => {
  const sqlite = freshDatabase();
  const db = new D1Database(sqlite);
  try {
    const fixture = dadakanFixture(sqlite, { recipeOutput: 2000 });
    const link = await resolveLinkedRecipe(db, fixture.storeId, fixture.outputId, fixture.recipeId);
    assert.equal(link.ok, false);
    assert.equal(link.code, 'DADAKAN_RECIPE_OUTPUT_MUST_BE_ONE');

    const lines = [{ productId: fixture.outputId, productName: 'Larutan', unitPrice: 8000, quantity: 1, lineTotal: 8000, note: '', productionMode: 'DADAKAN' }];
    const explicit = await prepareSaleStockProduction(db, {
      storeId: fixture.storeId, drawerId: fixture.drawerId, cashierId: fixture.cashierId,
      saleId: 'sale_legacy_link', lines, now: '2026-09-24T10:00:00.000Z'
    });
    assert.equal(explicit.ok, false);
    assert.match(explicit.error, /hanya untuk resep hasil 1/);
  } finally {
    sqlite.close();
  }
});
