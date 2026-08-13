import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../src/cashier-workspace.js', import.meta.url), 'utf8');
const workspaceUi = readFileSync(new URL('../public/cashier-workspace.js', import.meta.url), 'utf8');
const inputUi = readFileSync(new URL('../public/cashier-payment-methods.js', import.meta.url), 'utf8');
const sales = readFileSync(new URL('../src/cashier-sales-tracking.js', import.meta.url), 'utf8');
const purchases = readFileSync(new URL('../src/cashier-purchase.js', import.meta.url), 'utf8');
const expenses = readFileSync(new URL('../src/cashier-operational-expense.js', import.meta.url), 'utf8');
const drawerReport = readFileSync(new URL('../src/drawer-report.js', import.meta.url), 'utf8');

test('cashier workspace exposes configured payment methods and operational components', () => {
  assert.match(workspace, /listPosPaymentMethods/);
  assert.match(workspace, /listOperationalAccountingComponents/);
  assert.match(workspace, /paymentMethods/);
  assert.match(workspace, /operationalAccountingComponents/);
  assert.match(workspaceUi, /state\.paymentMethods/);
  assert.match(workspaceUi, /state\.operationalAccountingComponents/);
  assert.match(workspaceUi, /cashier:workspace-applied/);
});

test('sale purchase and operational writes validate payment codes through Accounting Settings', () => {
  assert.match(sales, /resolvePosPaymentMethod/);
  assert.match(purchases, /resolvePosPaymentMethod/);
  assert.match(expenses, /resolvePosPaymentMethod/);
  assert.doesNotMatch(sales, /NON_CASH'\s*\?\s*'NON_CASH'\s*:\s*'CASH'/);
  assert.doesNotMatch(purchases, /const PAYMENT_METHODS = new Set/);
  assert.doesNotMatch(purchases, /function purchasePaymentMethod/);
});

test('operational component selection carries rule identity rather than a POS-owned account decision', () => {
  assert.match(expenses, /accountingComponentRuleId/);
  assert.match(expenses, /listOperationalAccountingComponents/);
  assert.match(expenses, /accounting_component_rule_id/);
  assert.match(inputUi, /dialogOperationalComponent/);
  assert.match(inputUi, /accountingComponentRuleId/);
  assert.doesNotMatch(inputUi, /debitAccountId|creditAccountId/);
});

test('cashier UI consumes the configured registry for sale purchase and operational payment inputs', () => {
  assert.match(inputUi, /salePaymentMethod/);
  assert.match(inputUi, /dialogPurchasePayment/);
  assert.match(inputUi, /dialogOperationalPayment/);
  assert.match(inputUi, /state\.paymentMethods/);
  assert.match(inputUi, /Hanya CASH/);
});

test('drawer classification treats only CASH as physical cash', () => {
  assert.match(drawerReport, /row\.payment_method \|\| 'CASH'/);
  assert.match(drawerReport, /cashSales = sales\.filter\(row => row\.paymentMethod === 'CASH'\)/);
  assert.match(drawerReport, /nonCashSales = sales\.filter\(row => row\.paymentMethod !== 'CASH'\)/);
  assert.match(drawerReport, /nonCashPurchases = purchases\.filter\(row => row\.paymentMethod !== 'CASH'\)/);
  assert.match(drawerReport, /nonCashExpenses = expenses\.filter\(row => row\.paymentMethod !== 'CASH'\)/);
});
