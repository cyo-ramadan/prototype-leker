import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveProductionInventoryTransfer } from '../src/accounting-warehouse-production-bridge.js';

const migration = readFileSync(new URL('../migrations/0039_flexible_manual_production.sql', import.meta.url), 'utf8');
const warehouseProduction = readFileSync(new URL('../src/warehouse-production.js', import.meta.url), 'utf8');
const cashierProduction = readFileSync(new URL('../src/cashier-production.js', import.meta.url), 'utf8');
const accountingBridge = readFileSync(new URL('../src/accounting-warehouse-production-bridge.js', import.meta.url), 'utf8');
const productionUi = readFileSync(new URL('../public/cashier-production-v2.js', import.meta.url), 'utf8');
const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');

test('same inventory account produces no accounting movement', () => {
  const result = resolveProductionInventoryTransfer('inventory_all', [
    { inventoryAccountId: 'inventory_all', totalCostScaled: 12_000_000 },
    { inventoryAccountId: 'inventory_all', totalCostScaled: 8_000_000 }
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.accountingChange, 'NONE_SAME_INVENTORY_ACCOUNT');
  assert.equal(result.transferAmountScaled, 0);
  assert.deepEqual(result.journalLines, []);
});

test('different material inventory accounts transfer only the differing value into finished goods', () => {
  const result = resolveProductionInventoryTransfer('inventory_finished', [
    { inventoryAccountId: 'inventory_raw', totalCostScaled: 12_000_000 },
    { inventoryAccountId: 'inventory_raw', totalCostScaled: 8_000_000 },
    { inventoryAccountId: 'inventory_finished', totalCostScaled: 5_000_000 },
    { inventoryAccountId: 'inventory_packaging', totalCostScaled: 3_000_000 }
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.accountingChange, 'INVENTORY_ACCOUNT_TRANSFER');
  assert.equal(result.transferAmountScaled, 23_000_000);
  assert.deepEqual(result.journalLines, [
    { accountId: 'inventory_finished', side: 'DEBIT', amountScaled: 23_000_000, description: 'Persediaan hasil produksi' },
    { accountId: 'inventory_raw', side: 'CREDIT', amountScaled: 20_000_000, description: 'Persediaan bahan produksi' },
    { accountId: 'inventory_packaging', side: 'CREDIT', amountScaled: 3_000_000, description: 'Persediaan bahan produksi' }
  ]);
});

test('production execution snapshots actual facts without mutating Recipe Master', () => {
  assert.match(migration, /template_modified INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /output_product_kind_id TEXT/);
  assert.match(migration, /component_product_kind_id TEXT/);
  assert.match(warehouseProduction, /prepareManualProductionV2/);
  assert.match(warehouseProduction, /templateMatchesActual/);
  assert.match(warehouseProduction, /production_run_components/);
  assert.match(warehouseProduction, /PRODUCTION_INPUT/);
  assert.match(warehouseProduction, /PRODUCTION_OUTPUT/);
  assert.match(warehouseProduction, /hpp_total_scaled/);
  assert.match(warehouseProduction, /hpp_per_unit_scaled/);
  assert.match(warehouseProduction, /UPDATE products[\s\S]*average_cost/);
  assert.doesNotMatch(warehouseProduction, /UPDATE manufacturing_recipes/);
  assert.doesNotMatch(warehouseProduction, /UPDATE manufacturing_recipe_components/);
});

test('cashier Production Panel V2 is editable and dynamically adds material rows', () => {
  assert.match(cashierHtml, /cashier-production-v2\.css/);
  assert.match(cashierHtml, /cashier-production-v2\.js/);
  assert.match(productionUi, /Hasil produksi/);
  assert.match(productionUi, /Qty hasil/);
  assert.match(productionUi, /Recipe \/ BOM acuan/);
  assert.match(productionUi, /Bahan baku aktual/);
  assert.match(productionUi, /Tambah bahan/);
  assert.match(productionUi, /componentDraft\.push/);
  assert.match(productionUi, /componentDraft\.splice/);
  assert.match(productionUi, /tidak mengubah Master Recipe/);
  assert.match(productionUi, /outputQuantity, recipeId, components/);
});

test('production commit dispatches Warehouse accounting bridge after stock batch', () => {
  assert.match(cashierProduction, /await env\.DB\.batch\(prepared\.statements\)/);
  assert.match(cashierProduction, /dispatchWarehouseProductionAccountingFact/);
  assert.match(accountingBridge, /producer_module = 'WAREHOUSE'/);
  assert.match(accountingBridge, /fact_type = 'PRODUCTION'/);
  assert.match(accountingBridge, /code = 'wh_production'/);
  assert.match(accountingBridge, /sourceSystem: 'LEKER_WAREHOUSE'/);
  assert.match(accountingBridge, /postAccountingJournal/);
});
