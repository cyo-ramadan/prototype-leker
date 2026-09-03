import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildSaleStatements } from '../src/cashier-sales-tracking.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const migration = readFileSync(new URL('../migrations/0017_product_stock_production_points.sql', import.meta.url), 'utf8');
const exactCostMigration = readFileSync(new URL('../migrations/0021_exact_production_costing.sql', import.meta.url), 'utf8');
const productPolicy = readFileSync(new URL('../src/product-policy.js', import.meta.url), 'utf8');
const stockProduction = readFileSync(new URL('../src/stock-production.js', import.meta.url), 'utf8');
const cashierSale = readFileSync(new URL('../src/cashier-sales-tracking.js', import.meta.url), 'utf8');
const cashierProduction = readFileSync(new URL('../src/cashier-production.js', import.meta.url), 'utf8');
const cashierCustomers = readFileSync(new URL('../src/cashier-customers.js', import.meta.url), 'utf8');
const stockApi = readFileSync(new URL('../src/admin-stock.js', import.meta.url), 'utf8');
const stockUi = readFileSync(new URL('../public/admin-stock.js', import.meta.url), 'utf8');
const transactionDetail = readFileSync(new URL('../src/admin-transaction-detail.js', import.meta.url), 'utf8');
const productionDetail = readFileSync(new URL('../src/admin-production-detail.js', import.meta.url), 'utf8');
const transactionUi = readFileSync(new URL('../public/admin-transactions-ui.js', import.meta.url), 'utf8');
const productPolicyUi = readFileSync(new URL('../public/admin-product-policy.js', import.meta.url), 'utf8');
const masterMenuUi = readFileSync(new URL('../public/admin-master-menu.js', import.meta.url), 'utf8');
const cashierUi = readFileSync(new URL('../public/cashier-sales-orders.js', import.meta.url), 'utf8');
const cashierActions = readFileSync(new URL('../public/cashier-approval-actions.js', import.meta.url), 'utf8');
const OLD_SALE_COST_SCALED = 1_250_001;
const NEW_SALE_COST_SCALED = 2_750_003;

function d1(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...args) {
          return { _statement: statement, _args: args };
        }
      };
    },
    async batch(boundStatements) {
      sqlite.exec('BEGIN');
      try {
        const results = boundStatements.map(item => item._statement.run(...item._args));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function saleFixture(sqlite) {
  const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001' LIMIT 1`).get();
  assert.ok(store?.id);
  const product = sqlite.prepare(`
    SELECT p.id, p.name, p.price
    FROM products p
    JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    WHERE p.store_id = ? AND p.base_unit_id IS NOT NULL AND t.can_sell = 1
    ORDER BY p.id
    LIMIT 1
  `).get(store.id);
  const cashier = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1`).get(store.id);
  assert.ok(product?.id && cashier?.id);
  sqlite.prepare(`UPDATE products SET is_active = 1, average_cost = ? WHERE store_id = ? AND id = ?`)
    .run(OLD_SALE_COST_SCALED, store.id, product.id);
  const drawerId = 'drawer_temporal_sale_test';
  sqlite.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES (?, ?, ?, 0, 'OPEN', '2026-08-20T09:00:00.000Z')
  `).run(drawerId, store.id, cashier.id);
  return {
    storeId: store.id,
    drawerId,
    cashierId: cashier.id,
    productId: Number(product.id),
    productName: product.name,
    unitPrice: Number(product.price)
  };
}

async function postSale(db, fixture, { saleId, quantity, now }) {
  const lineTotal = fixture.unitPrice * quantity;
  await db.batch(buildSaleStatements(db, {
    saleId,
    storeId: fixture.storeId,
    drawerId: fixture.drawerId,
    cashierId: fixture.cashierId,
    linkedOrderId: null,
    customerId: null,
    customerName: '',
    total: lineTotal,
    totalPoints: 0,
    note: '',
    now,
    channel: 'CASH',
    lines: [{
      productId: fixture.productId,
      productName: fixture.productName,
      unitPrice: fixture.unitPrice,
      quantity,
      lineTotal
    }],
    operationalStatements: [],
    pointShareGroupId: null
  }));
}

test('product policy stores points recipe link and stock tracking while product fulfillment mode is legacy-only', () => {
  assert.match(migration, /points_per_unit INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /production_mode TEXT NOT NULL DEFAULT 'STOCK'/);
  assert.match(migration, /recipe_link_enabled INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /stock_tracking_enabled INTEGER NOT NULL DEFAULT 1/);
  assert.match(migration, /UPDATE products SET stock_tracking_enabled = 0/);
  assert.match(productPolicy, /legacyProductionMode/);
  assert.doesNotMatch(productPolicy, /SET points_per_unit = \?, production_mode/);
  assert.match(productPolicy, /linked_recipe_id/);
  assert.match(productPolicyUi, /Poin per 1 barang/);
  assert.match(productPolicyUi, /Recipe Linked/);
  assert.doesNotMatch(productPolicyUi, /id="productProductionMode"/);
});

test('legacy quantity columns remain integer until canonical quantity migration while new HPP writer is exact scaled integer', () => {
  assert.match(migration, /batches INTEGER NOT NULL/);
  assert.match(migration, /total_output_quantity INTEGER NOT NULL/);
  assert.match(migration, /quantity INTEGER NOT NULL CHECK \(quantity > 0\)/);
  assert.match(migration, /hpp_total REAL/);
  assert.match(exactCostMigration, /hpp_total_scaled INTEGER/);
  assert.match(exactCostMigration, /hpp_per_unit_scaled INTEGER/);
  assert.match(exactCostMigration, /unit_cost_snapshot_scaled INTEGER/);
  assert.match(exactCostMigration, /total_cost_snapshot_scaled INTEGER/);
  assert.match(stockProduction, /hpp_total_scaled/);
  assert.match(stockProduction, /hpp_per_unit_scaled/);
  assert.match(stockProduction, /unit_cost_snapshot_scaled/);
  assert.match(stockProduction, /total_cost_snapshot_scaled/);
  assert.doesNotMatch(stockProduction, /SET hpp_total =/);
  assert.doesNotMatch(stockProduction, /\* 1\.0/);
  assert.match(stockProduction, /Number\.isInteger\(batchCount\)/);
});

test('dadakan execution engine snapshots production then stock, now driven by per-sale-line fulfillment', () => {
  assert.match(stockProduction, /AUTO_DADAKAN/);
  assert.match(stockProduction, /Math\.ceil\(Number\(line\.quantity\) \/ recipe\.outputQuantity\)/);
  assert.match(stockProduction, /PRODUCTION_INPUT/);
  assert.match(stockProduction, /PRODUCTION_OUTPUT/);
  assert.match(stockProduction, /sourceKey: `SALE:\$\{saleId\}:\$\{product\.id\}`/);
  assert.match(stockProduction, /validateTrackedProduction/);
  assert.match(cashierSale, /prepareSaleStockProduction/);
  assert.match(cashierSale, /customer_point_ledger/);
  assert.match(cashierSale, /points_per_unit, line_points, recipe_id, production_run_id/);
  assert.match(cashierSale, /await env\.DB\.batch\(statements\)/);
});

test('sale HPP snapshots are temporal: old rows stay fixed and later sales use the new exact cost', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const fixture = saleFixture(sqlite);
    await postSale(db, fixture, {
      saleId: 'sale_temporal_hpp_before',
      quantity: 2,
      now: '2026-08-20T09:01:00.000Z'
    });

    sqlite.prepare(`UPDATE products SET average_cost = ? WHERE store_id = ? AND id = ?`)
      .run(NEW_SALE_COST_SCALED, fixture.storeId, fixture.productId);

    const saleBefore = sqlite.prepare(`
      SELECT unit_cost_snapshot, line_cogs,
             typeof(unit_cost_snapshot) AS unit_type, typeof(line_cogs) AS line_type
      FROM sale_items
      WHERE sale_id = ?
    `).get('sale_temporal_hpp_before');
    assert.deepEqual({ ...saleBefore }, {
      unit_cost_snapshot: OLD_SALE_COST_SCALED,
      line_cogs: OLD_SALE_COST_SCALED * 2,
      unit_type: 'integer',
      line_type: 'integer'
    });

    await postSale(db, fixture, {
      saleId: 'sale_temporal_hpp_after',
      quantity: 3,
      now: '2026-08-20T09:02:00.000Z'
    });
    const saleAfter = sqlite.prepare(`
      SELECT unit_cost_snapshot, line_cogs,
             typeof(unit_cost_snapshot) AS unit_type, typeof(line_cogs) AS line_type
      FROM sale_items
      WHERE sale_id = ?
    `).get('sale_temporal_hpp_after');
    assert.deepEqual({ ...saleAfter }, {
      unit_cost_snapshot: NEW_SALE_COST_SCALED,
      line_cogs: NEW_SALE_COST_SCALED * 3,
      unit_type: 'integer',
      line_type: 'integer'
    });

    sqlite.prepare(`UPDATE products SET average_cost = ? WHERE store_id = ? AND id = ?`)
      .run(4_125_007, fixture.storeId, fixture.productId);
    assert.deepEqual(sqlite.prepare(`
      SELECT sale_id, unit_cost_snapshot, line_cogs
      FROM sale_items
      WHERE sale_id IN (?, ?)
      ORDER BY sale_id
    `).all('sale_temporal_hpp_before', 'sale_temporal_hpp_after').map(row => ({ ...row })), [
      { sale_id: 'sale_temporal_hpp_after', unit_cost_snapshot: NEW_SALE_COST_SCALED, line_cogs: NEW_SALE_COST_SCALED * 3 },
      { sale_id: 'sale_temporal_hpp_before', unit_cost_snapshot: OLD_SALE_COST_SCALED, line_cogs: OLD_SALE_COST_SCALED * 2 }
    ]);
  } finally {
    sqlite.close();
  }
});

test('manual production reuses the same canonical stock production engine', () => {
  assert.match(stockProduction, /prepareManualProduction/);
  assert.match(stockProduction, /productionRunStatements/);
  assert.match(cashierProduction, /prepareManualProduction/);
  assert.match(cashierProduction, /await env\.DB\.batch\(prepared\.statements\)/);
  assert.match(cashierActions, /\/api\/cashier\/production\/options/);
  assert.match(cashierActions, /\/api\/cashier\/production/);
  assert.doesNotMatch(cashierActions, /Produksi.*pending contract/i);
});

test('cashier customer identity lookup is lazy and sends customer id for point earning', () => {
  assert.match(cashierCustomers, /LIMIT 10/);
  assert.match(cashierCustomers, /resolveCustomerScope/);
  assert.match(cashierUi, /setTimeout\(searchCustomers, 180\)/);
  assert.match(cashierUi, /customerId: draftOriginOrderId \? null : selectedSaleCustomer\?\.id/);
  assert.match(cashierUi, /poin akan masuk ke akun ini/);
});

test('admin stock panel exposes balance and lazy stock movement history', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS stock_movements/);
  assert.match(stockApi, /\/api\/admin\/stock/);
  assert.match(stockApi, /occurred_at DESC, id DESC/);
  assert.match(stockApi, /nextCursor/);
  assert.match(stockUi, /Tracking Stok Barang/);
  assert.match(stockUi, /Lihat Mutasi/);
  assert.match(stockUi, /Muat lagi/);
});

test('transaction detail snapshots sale HPP, kind, recipe production and accounting references lazily', () => {
  assert.match(transactionDetail, /productionRuns/);
  assert.match(transactionDetail, /recipeRevision/);
  assert.match(transactionDetail, /unitCostSnapshot/);
  assert.match(transactionDetail, /lineCogs/);
  assert.match(transactionDetail, /productKindCode/);
  assert.match(transactionDetail, /costFromScaled/);
  assert.match(productionDetail, /PRODUCTION_RUN/);
  assert.match(productionDetail, /exactCost/);
  assert.match(transactionUi, /data-transaction-detail-id/);
  assert.match(transactionUi, /renderProductionDetail/);
  assert.match(transactionUi, /HPP\/unit/);
});

test('admin groups master entities under Master while stock and transactions remain operational tabs', () => {
  for (const tab of ['products', 'categories', 'suppliers', 'customers', 'cashiers', 'manufacturing']) {
    assert.match(masterMenuUi, new RegExp(`['\"]${tab}['\"]`));
  }
  assert.match(masterMenuUi, /adminMasterMenuLabel">Master<\/span> ▾/);
  assert.match(masterMenuUi, /Peran Barang/);
  assert.match(masterMenuUi, /Klasifikasi Accounting/);
  assert.match(masterMenuUi, /Satuan/);
  assert.match(masterMenuUi, /Resep \/ BOM/);
  assert.match(stockUi, /dataset\.tab = 'stock'/);
  assert.match(transactionUi, /dataset\.tab = 'transactions'/);
});

test('Master dropdown escapes the horizontally scrolling tab container', () => {
  assert.match(masterMenuUi, /\.admin-master-menu-panel\{position:fixed/);
  assert.match(masterMenuUi, /document\.body\.appendChild\(panel\)/);
  assert.match(masterMenuUi, /panel\.contains\(event\.target\)/);
  assert.match(masterMenuUi, /aria-expanded/);
  assert.match(masterMenuUi, /window\.addEventListener\('resize', positionPanel/);
});
