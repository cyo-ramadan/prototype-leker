import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');
const transactionUi = readFileSync(new URL('../public/cashier-payment-methods.js', import.meta.url), 'utf8');
const pimasatuUi = readFileSync(new URL('../public/pimasatu-ui.js', import.meta.url), 'utf8');
const purchaseApi = readFileSync(new URL('../src/cashier-purchase.js', import.meta.url), 'utf8');
const expenseApi = readFileSync(new URL('../src/cashier-operational-expense.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0020_expense_quantity_behavior.sql', import.meta.url), 'utf8');

test('Beli Bahan loads purchasable products from the database and exposes quantity through canonical PIMASATU UI', () => {
  assert.match(cashierHtml, /cashier-payment-methods\.js/);
  assert.doesNotMatch(cashierHtml, /<script src="\/cashier-procurement-ui\.js"><\/script>/);
  assert.match(transactionUi, /\/api\/cashier\/purchases\/options/);
  assert.match(transactionUi, /host: byId\('purchasePimasatu'\)/);
  assert.match(transactionUi, /getId: item => item\.productId/);
  assert.match(transactionUi, /quantity: Number\(line\.quantity\)/);
  assert.match(pimasatuUi, /class="text-input pimasatu-qty"[^>]*value="1"/);
  assert.match(purchaseApi, /FROM products p/);
  assert.match(purchaseApi, /p\.stock_tracking_enabled = 1/);
});

test('purchase UI does not allow free-text product identity', () => {
  assert.match(pimasatuUi, /if\(!item\)return onError\('Pilih item dari hasil pencarian\.'/);
  assert.match(transactionUi, /items: products/);
  assert.doesNotMatch(transactionUi, /dialogPurchaseProductName/);
});

test('operational expense persists quantity as canonical text through Master Biaya items', () => {
  assert.match(transactionUi, /host: byId\('operationalPimasatu'\)/);
  assert.match(transactionUi, /costMasterId: line\.id/);
  assert.match(transactionUi, /quantity: line\.quantity/);
  assert.match(expenseApi, /String\(item\.quantity\)/);
  assert.match(expenseApi, /description, amount, quantity, created_at, payment_method/);
  assert.match(migration, /ALTER TABLE expenses ADD COLUMN quantity TEXT NOT NULL DEFAULT '1'/);
});

test('operational quantity is behavioral metadata and does not post stock', () => {
  assert.doesNotMatch(expenseApi, /stock_movements/);
  assert.doesNotMatch(expenseApi, /inventory_stock_balances/);
});
