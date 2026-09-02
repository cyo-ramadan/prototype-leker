import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');
const inputUi = readFileSync(new URL('../public/cashier-payment-methods.js', import.meta.url), 'utf8');
const salesUi = readFileSync(new URL('../public/cashier-sales-orders.js', import.meta.url), 'utf8');
const pimasatuUi = readFileSync(new URL('../public/pimasatu-ui.js', import.meta.url), 'utf8');
const pimasatuContract = readFileSync(new URL('../contracts/pimasatu-ui-v1.md', import.meta.url), 'utf8');
const transactionContract = readFileSync(new URL('../contracts/cashier-transaction-composition-v1.md', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const bridgeSource = readFileSync(new URL('../src/accounting-pos-bridge.js', import.meta.url), 'utf8');

function ordered(source, ...tokens) {
  let previous = -1;
  for (const token of tokens) {
    const index = source.indexOf(token);
    assert.ok(index >= 0, `token not found: ${token}`);
    assert.ok(index > previous, `token out of order: ${token}`);
    previous = index;
  }
}

test('PIMASATU remains a UI-only item composer with no transaction-module ownership', () => {
  assert.match(pimasatuContract, /PIMASATU hanya mengatur \*\*format interaksi UI\/UX\*\*/);
  assert.match(pimasatuContract, /tidak memiliki ownership atas modul bisnis/);
  assert.match(pimasatuContract, /urutan field transaction modal di luar item composer/);
  assert.doesNotMatch(pimasatuContract, /PIMASATU item\/variabel → counterpart/);
  assert.doesNotMatch(pimasatuUi, /accounting|journal|supplier|customer|payment_method|paymentMethod/i);
});

test('transaction composition owns item counterpart payment ordering outside PIMASATU', () => {
  assert.match(transactionContract, /Kontrak ini terpisah dari PIMASATU/);
  assert.match(transactionContract, /item\/variabel composer/);
  assert.match(transactionContract, /counterpart yang relevan/);
  assert.match(transactionContract, /metode pembayaran/);
  assert.match(transactionContract, /counterpart dan metode pembayaran tetap berada di luar komponen PIMASATU/);
});

test('cashier loads canonical transaction inputs before enhancement scripts and does not load legacy procurement runtime', () => {
  ordered(
    cashierHtml,
    '/cashier-workspace.js',
    '/cashier-payment-methods.js?v=20260821-pos-payment-core-v2-decimal-koma-fix',
    '/cashier-enhancements.js?v=20260816-purchase-autofill-v6'
  );
  assert.match(cashierHtml, /data-cashier-payment-methods="1"/);
  assert.doesNotMatch(cashierHtml, /<script src="\/cashier-procurement-ui\.js"><\/script>/);
});

test('purchase and operational transaction composition is item first counterpart second payment third', () => {
  ordered(inputUi, 'id="purchasePimasatu"', 'id="dialogSupplier"', 'id="dialogPurchasePayment"');
  ordered(inputUi, 'id="operationalPimasatu"', 'id="operationalContactSummary"', 'id="dialogOperationalPayment"');
  assert.match(inputUi, /window\.MAXIPimasatu\.create\(\{[\s\S]*host: byId\('purchasePimasatu'\)/);
  assert.match(inputUi, /window\.MAXIPimasatu\.create\(\{[\s\S]*host: byId\('operationalPimasatu'\)/);
});

test('sale transaction keeps item composer above customer and places configured payment before note', () => {
  ordered(salesUi, 'id="salePimasatu"', 'id="cashierCustomerIdentitySearch"', 'id="saleDialogCustomerName"', 'id="saleDialogNote"');
  assert.match(inputUi, /id = 'saleDialogPaymentField'/);
  assert.match(inputUi, /id="saleDialogPaymentMethod"/);
  assert.match(inputUi, /saleDialogNote/);
  assert.match(inputUi, /insertAdjacentElement\('beforebegin', field\)/);
  assert.match(inputUi, /refreshCashierWorkspace\(\{ includeMenu: false \}\)/);
});

test('committed transaction writes use one canonical fact transport instead of legacy body mutation', () => {
  assert.match(inputUi, /async function canonicalFactPost/);
  assert.match(inputUi, /new Request\(new URL\(path, location\.origin\)/);
  assert.match(inputUi, /canonicalFactPost\('\/api\/cashier\/purchases'/);
  assert.match(inputUi, /canonicalFactPost\('\/api\/cashier\/expenses'/);
  assert.match(inputUi, /path === '\/api\/cashier\/sales'[\s\S]*return canonicalFactPost\(path, payload\)/);
});

test('SALE PURCHASE and EXPENSE remain connected to Accounting bridge after operational commit', () => {
  assert.match(indexSource, /attachAccountingBridgeToCommittedResponse\(trackedSaleResponse, env, 'SALE'\)/);
  assert.match(indexSource, /attachAccountingBridgeToCommittedResponse\(purchaseResponse, env, 'PURCHASE'\)/);
  assert.match(indexSource, /attachAccountingBridgeToCommittedResponse\(purchaseResponse, env, 'EXPENSE'\)/);
  assert.match(bridgeSource, /SALE: \{ transactionCategoryCode: 'sale'/);
  assert.match(bridgeSource, /PURCHASE: \{ transactionCategoryCode: 'purchase_material'/);
  assert.match(bridgeSource, /EXPENSE: \{ transactionCategoryCode: 'operational'/);
  assert.match(bridgeSource, /FROM payment_methods p/);
  assert.match(bridgeSource, /FROM journal_rules r/);
  assert.match(bridgeSource, /FROM item_categories/);
});
