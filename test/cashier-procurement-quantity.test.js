import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');
const procurementUi = readFileSync(new URL('../public/cashier-procurement-ui.js', import.meta.url), 'utf8');
const purchaseApi = readFileSync(new URL('../src/cashier-purchase.js', import.meta.url), 'utf8');
const expenseApi = readFileSync(new URL('../src/cashier-operational-expense.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0020_expense_quantity_behavior.sql', import.meta.url), 'utf8');

test('Beli Bahan loads purchasable products from the database and exposes quantity', () => {
  assert.match(cashierHtml, /cashier-procurement-ui\.js/);
  assert.match(procurementUi, /\/api\/cashier\/purchases\/options/);
  assert.match(procurementUi, /id="dialogPurchaseProduct"/);
  assert.match(procurementUi, /id="dialogPurchaseQty"/);
  assert.match(procurementUi, /items:\s*lines\.map/);
  assert.match(purchaseApi, /FROM products p/);
  assert.match(purchaseApi, /p\.stock_tracking_enabled = 1/);
});

test('purchase UI does not allow free-text product identity', () => {
  assert.match(procurementUi, /Barang tidak menerima input nama bebas/);
  assert.doesNotMatch(procurementUi, /dialogPurchaseProductName/);
});

test('operational expense persists quantity as canonical decimal text', () => {
  assert.match(procurementUi, /id="dialogOperationalQty"/);
  assert.match(procurementUi, /quantity,\s*amount/);
  assert.match(expenseApi, /canonicalPositiveDecimal/);
  assert.match(expenseApi, /description, amount, quantity, created_at, payment_method/);
  assert.match(migration, /ALTER TABLE expenses ADD COLUMN quantity TEXT NOT NULL DEFAULT '1'/);
});

test('operational quantity is behavioral metadata and does not post stock', () => {
  assert.match(procurementUi, /Qty operasional tidak mengubah stok barang secara otomatis/);
  assert.doesNotMatch(expenseApi, /stock_movements/);
  assert.doesNotMatch(expenseApi, /inventory_stock_balances/);
});
