import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../src/cashier-workspace.js', import.meta.url), 'utf8');
const workspaceUi = readFileSync(new URL('../public/cashier-workspace.js', import.meta.url), 'utf8');
const inputUi = readFileSync(new URL('../public/cashier-payment-methods.js', import.meta.url), 'utf8');
const enhancedInputUi = readFileSync(new URL('../public/cashier-enhancements.js', import.meta.url), 'utf8');
const sales = readFileSync(new URL('../src/cashier-sales-tracking.js', import.meta.url), 'utf8');
const purchases = readFileSync(new URL('../src/cashier-purchase.js', import.meta.url), 'utf8');
const expenses = readFileSync(new URL('../src/cashier-operational-expense.js', import.meta.url), 'utf8');
const drawerReport = readFileSync(new URL('../src/drawer-report.js', import.meta.url), 'utf8');
const purchaseDefaults = readFileSync(new URL('../migrations/0029_purchase_accounting_defaults.sql', import.meta.url), 'utf8');
const cashierPosCss = readFileSync(new URL('../public/cashier-pos.css', import.meta.url), 'utf8');
const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');

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
  assert.match(inputUi, /item\.isDefault/);
  assert.match(inputUi, /Hanya CASH/);
});

test('purchase dialog keeps one Accounting payment selector and starts with five empty item rows', () => {
  assert.match(inputUi, /<select id="dialogPurchasePayment"/);
  assert.match(enhancedInputUi, /!el\('dialogPurchasePayment'\) && !el\('dialogPaymentMethod'\)/);
  assert.match(enhancedInputUi, /<option value=""[^>]*>None<\/option>/);
  assert.match(enhancedInputUi, /for \(let index = 0; index < 5; index \+= 1\) addPurchaseRow\(\)/);
  assert.match(enhancedInputUi, /purchaseItemsPayload\(\)\.filter\(item => item\.productId > 0\)/);
});

test('purchase item editor is mobile-first and retains a desktop layout', () => {
  assert.match(enhancedInputUi, /class="purchase-item-row"/);
  assert.match(enhancedInputUi, /purchase-item-product/);
  assert.doesNotMatch(enhancedInputUi, /grid-template-columns:minmax\(0,1fr\) 90px 150px auto/);
  assert.match(enhancedInputUi, /purchase-item-heading"><strong>Barang \$\{id\}<\/strong>/);
  assert.match(cashierPosCss, /grid-template-columns:72px minmax\(0,1fr\)/);
  assert.match(cashierPosCss, /\.purchase-item-product\{grid-column:1\/-1\}/);
  assert.match(cashierPosCss, /\.purchase-item-quantity\{grid-column:1\}\.purchase-item-total\{grid-column:2\}/);
  assert.match(cashierPosCss, /border-radius:16px;background:#fffcf8/);
  assert.match(cashierPosCss, /\.purchase-item-row \.text-input\{[^}]*min-width:0;[^}]*width:100%/);
  assert.match(cashierPosCss, /@media\(min-width:700px\)/);
  assert.match(cashierPosCss, /grid-template-columns:minmax\(0,1fr\) 90px 150px 40px/);
});

test('cashier mobile purchase assets are versioned so deployed layout changes bypass stale browser cache', () => {
  assert.match(cashierHtml, /cashier-pos\.css\?v=20260816-mobile-purchase-v2/);
  assert.match(cashierHtml, /cashier-enhancements\.js\?v=20260816-mobile-purchase-v2/);
});

test('purchase Accounting defaults are canonical and remain editable by admin', () => {
  assert.match(purchaseDefaults, /Persediaan sesuai Jenis Barang/);
  assert.match(purchaseDefaults, /item_category_inventory/);
  assert.match(purchaseDefaults, /payment_method/);
  assert.match(purchaseDefaults, /is_default/);
  assert.match(purchaseDefaults, /Kompensasi Piutang \(review\)/);
  assert.match(purchaseDefaults, /coa_' \|\| k\.store_id \|\| '_1301/);
});

test('drawer classification treats only CASH as physical cash', () => {
  assert.match(drawerReport, /row\.payment_method \|\| 'CASH'/);
  assert.match(drawerReport, /cashSales = sales\.filter\(row => row\.paymentMethod === 'CASH'\)/);
  assert.match(drawerReport, /nonCashSales = sales\.filter\(row => row\.paymentMethod !== 'CASH'\)/);
  assert.match(drawerReport, /nonCashPurchases = purchases\.filter\(row => row\.paymentMethod !== 'CASH'\)/);
  assert.match(drawerReport, /nonCashExpenses = expenses\.filter\(row => row\.paymentMethod !== 'CASH'\)/);
});
