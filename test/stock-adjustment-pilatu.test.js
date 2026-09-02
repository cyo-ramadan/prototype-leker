import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  prepareStockAdjustmentRows,
  selectStockAdjustmentForm,
  selectStockAdjustmentProduct,
  stockAdjustmentDifference,
  updateStockAdjustmentActualQuantity
} from '../public/stock-adjustment-pilatu.js';

const liveUiSource = readFileSync(new URL('../public/cashier-stock-adjustment-pilatu.js', import.meta.url), 'utf8');
const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');

test('PILATU keeps Mineral when Margarin is selected next', () => {
  const mineral = { productId: 101, productName: 'Mineral', currentQuantity: 12, unitSymbol: 'PCS' };
  const margarin = { productId: 102, productName: 'Margarin', currentQuantity: 7, unitSymbol: 'PCS' };

  let rows = selectStockAdjustmentProduct([], mineral);
  rows = updateStockAdjustmentActualQuantity(rows, mineral.productId, '10');
  rows = selectStockAdjustmentProduct(rows, margarin);

  assert.deepEqual(rows.map(row => row.productName), ['Margarin', 'Mineral']);
  assert.equal(rows[1].actualQuantity, '10');

  rows = updateStockAdjustmentActualQuantity(rows, margarin.productId, '9');
  assert.equal(stockAdjustmentDifference(rows[0]), 2);
  assert.equal(stockAdjustmentDifference(rows[1]), -2);

  rows = selectStockAdjustmentProduct(rows, mineral);
  assert.deepEqual(rows.map(row => row.productName), ['Mineral', 'Margarin']);
  assert.equal(rows[0].actualQuantity, '10');

  assert.deepEqual(
    prepareStockAdjustmentRows(rows).map(row => ({ name: row.productName, target: row.targetQuantity, difference: row.difference })),
    [
      { name: 'Mineral', target: 10, difference: -2 },
      { name: 'Margarin', target: 9, difference: 2 }
    ]
  );
});

test('PILATU form selection adds exactly its products and preserves entered quantities', () => {
  const mineral = { productId: 101, productName: 'Mineral', currentQuantity: 12, unitSymbol: 'PCS' };
  const margarin = { productId: 102, productName: 'Margarin', currentQuantity: 7, unitSymbol: 'PCS' };
  const gula = { productId: 103, productName: 'Gula', currentQuantity: 5, unitSymbol: 'KG' };

  let rows = selectStockAdjustmentProduct([], mineral);
  rows = updateStockAdjustmentActualQuantity(rows, mineral.productId, '10');
  rows = selectStockAdjustmentForm(rows, [margarin, mineral]);

  assert.deepEqual(new Set(rows.map(row => row.productId)), new Set([101, 102]));
  assert.equal(rows.find(row => row.productId === 101).actualQuantity, '10');
  assert.equal(rows.some(row => row.productId === gula.productId), false);
});

test('live Stock Adjustment override is valid classic-script syntax', () => {
  assert.doesNotThrow(() => new vm.Script(liveUiSource, { filename: 'cashier-stock-adjustment-pilatu.js' }));
});

test('live Stock Adjustment loads PILATU after legacy approval actions and intercepts its click', () => {
  const legacyIndex = cashierHtml.indexOf('/cashier-approval-actions.js');
  const pilatuIndex = cashierHtml.indexOf('/cashier-stock-adjustment-pilatu.js');
  assert.ok(legacyIndex >= 0);
  assert.ok(pilatuIndex > legacyIndex);
  assert.match(liveUiSource, /#stockAdjustmentBtn/);
  assert.match(liveUiSource, /event\.stopImmediatePropagation\(\)/);
  assert.match(liveUiSource, /}, true\);/);
  assert.match(liveUiSource, /import\('\/stock-adjustment-pilatu\.js'\)/);
});

test('live Stock Adjustment exposes the five business columns and independent V1 requests', () => {
  assert.match(liveUiSource, /<span>Barang<\/span><span>Qty Tercatat<\/span><span>Qty Sebenarnya<\/span><span>HPP<\/span><span>Selisih<\/span>/);
  assert.match(liveUiSource, /data-stock-adjustment-actual/);
  assert.match(liveUiSource, /selectStockAdjustmentProduct\(selectedRows, product\)/);
  assert.match(liveUiSource, /for \(const row of changed\)/);
  assert.match(liveUiSource, /requestType: 'GOODS_FLOW'/);
  assert.match(liveUiSource, /purpose: 'STOCK_ADJUSTMENT'/);
  assert.match(liveUiSource, /targetQuantity: row\.targetQuantity/);
  assert.match(liveUiSource, /HPP<\/b><br \/>Read-only milik Accounting/);
  assert.match(liveUiSource, /Pilih Form/);
  assert.match(liveUiSource, /selectStockAdjustmentForm\(selectedRows, formProducts\)/);
  assert.doesNotMatch(liveUiSource, /stockAdjustmentReason/);
});
