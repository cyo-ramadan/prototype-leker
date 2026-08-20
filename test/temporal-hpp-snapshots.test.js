import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const saleWriter = readFileSync(new URL('../src/cashier-sales-tracking.js', import.meta.url), 'utf8');
const purchaseWriter = readFileSync(new URL('../src/cashier-purchase.js', import.meta.url), 'utf8');
const legacyProductionWriter = readFileSync(new URL('../src/stock-production.js', import.meta.url), 'utf8');
const productionV2Writer = readFileSync(new URL('../src/warehouse-production.js', import.meta.url), 'utf8');
const stockAdjustmentWriter = readFileSync(new URL('../src/operational-posting.js', import.meta.url), 'utf8');
const transactionDetailReader = readFileSync(new URL('../src/admin-transaction-detail.js', import.meta.url), 'utf8');
const stockContract = readFileSync(new URL('../contracts/stock-production-points-v2.md', import.meta.url), 'utf8');
const adjustmentContract = readFileSync(new URL('../contracts/stock-adjustment-v2.md', import.meta.url), 'utf8');
const temporalAdr = readFileSync(new URL('../adr/ADR-038-temporal-hpp-snapshots.md', import.meta.url), 'utf8');

function sourceFiles(directoryUrl) {
  return readdirSync(directoryUrl, { withFileTypes: true }).flatMap(entry => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directoryUrl);
    if (entry.isDirectory()) return sourceFiles(child);
    return entry.name.endsWith('.js') ? [readFileSync(child, 'utf8')] : [];
  });
}

const allRuntimeSource = sourceFiles(new URL('../src/', import.meta.url)).join('\n/* next source file */\n');

test('Sale snapshots the HPP in force at posting and runtime code does not rewrite historical Sale HPP', () => {
  assert.match(saleWriter, /INSERT INTO sale_items[\s\S]*unit_cost_snapshot, line_cogs[\s\S]*p\.average_cost, p\.average_cost \* \?/);
  assert.match(transactionDetailReader, /unit_cost_snapshot/);
  assert.match(transactionDetailReader, /line_cogs/);
  assert.doesNotMatch(allRuntimeSource, /UPDATE\s+sale_items[\s\S]{0,800}(?:unit_cost_snapshot|line_cogs)/i);
  assert.match(stockContract, /Historical sale HPP must not be recalculated from the current Product Master later/i);
});

test('Purchase and Production may move current HPP forward for subsequent facts', () => {
  assert.match(purchaseWriter, /UPDATE products[\s\S]*SET average_cost = \(SELECT average_cost_after FROM purchase_items/);
  assert.match(purchaseWriter, /COALESCE\(b\.quantity, 0\) \* p\.average_cost/);
  assert.match(legacyProductionWriter, /UPDATE products[\s\S]*SET average_cost = CASE/);
  assert.match(productionV2Writer, /UPDATE products[\s\S]*SET average_cost = CASE/);
  assert.match(stockContract, /moving weighted average/i);
});

test('Stock Adjustment snapshots contemporaneous HPP but never becomes an HPP writer', () => {
  assert.match(stockAdjustmentWriter, /COALESCE\(p\.average_cost, 0\) AS average_cost_scaled/);
  assert.match(stockAdjustmentWriter, /unitCostSnapshotScaled/);
  assert.match(stockAdjustmentWriter, /totalCostSnapshotScaled/);
  assert.doesNotMatch(stockAdjustmentWriter, /UPDATE\s+products[\s\S]{0,500}average_cost/i);
  assert.match(adjustmentContract, /later Stock Adjustment snapshots the new HPP/i);
  assert.match(adjustmentContract, /does not update `products\.average_cost`/i);
});

test('Temporal costing decision is forward-only and exact-scaled across Sale and Stock Adjustment', () => {
  assert.match(temporalAdr, /before T/i);
  assert.match(temporalAdr, /after T/i);
  assert.match(temporalAdr, /unit_cost_snapshot/);
  assert.match(temporalAdr, /unitCostSnapshotScaled/);
  assert.match(temporalAdr, /scaled INTEGER/i);
  assert.doesNotMatch(temporalAdr, /REAL\/FLOAT.*authoritative/i);
});
