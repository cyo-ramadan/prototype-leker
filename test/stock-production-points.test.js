import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('legacy dadakan execution still snapshots production then stock until sale-level fulfillment replaces it', () => {
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
  assert.match(masterMenuUi, /Tipe Barang/);
  assert.match(masterMenuUi, /Jenis Barang/);
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
