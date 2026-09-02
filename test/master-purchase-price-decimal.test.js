import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { scaledPurchasePriceFromInput } from '../src/product-master.js';

const purchasePriceScaleMigration = readFileSync(new URL('../migrations/0059_master_purchase_price_scaled.sql', import.meta.url), 'utf8');
const branchAdminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
const productPolicyUi = readFileSync(new URL('../public/admin-product-policy.js', import.meta.url), 'utf8');
const pimasatuUi = readFileSync(new URL('../public/pimasatu-ui.js', import.meta.url), 'utf8');
const cashierPaymentMethods = readFileSync(new URL('../public/cashier-payment-methods.js', import.meta.url), 'utf8');

test('Master Barang purchase price accepts sub-rupiah decimals and stores them scaled, never as float', () => {
  assert.equal(scaledPurchasePriceFromInput(0.5), 500_000, 'Rp0,5/ml must survive as an exact scaled integer');
  assert.equal(scaledPurchasePriceFromInput(583.333333), 583_333_333, 'up to 6 decimals must round half-up at the 7th digit');
  assert.equal(scaledPurchasePriceFromInput(0), 0);
  assert.equal(scaledPurchasePriceFromInput(-1), null, 'negative purchase price is invalid');
  assert.equal(scaledPurchasePriceFromInput(NaN), null);
  assert.equal(scaledPurchasePriceFromInput(Infinity), null);
  assert.equal(scaledPurchasePriceFromInput(50_000_000), null, 'must stay bounded like other money inputs');
});

test('products.purchase_price is migrated onto the same exact-unit-cost scale as average_cost/last_purchase_price', () => {
  assert.match(purchasePriceScaleMigration, /UPDATE products/);
  assert.match(purchasePriceScaleMigration, /purchase_price\s*=\s*purchase_price\s*\*\s*1000000/);
});

test('Master Barang Harga Beli field no longer forces whole-rupiah step', () => {
  assert.doesNotMatch(branchAdminHtml, /id="productPurchasePrice" type="number" min="0" step="1"/);
  assert.match(branchAdminHtml, /id="productPurchasePrice" type="number" min="0" step="any"/);
  assert.match(productPolicyUi, /input\.step = 'any'/);
  assert.doesNotMatch(productPolicyUi, /input\.step = '1'/);
});

test('Pembelian (Beli Bahan) unit-price composer allows decimal amounts while Penjualan/Operasional stay whole-rupiah', () => {
  assert.match(pimasatuUi, /allowDecimalAmount/);
  assert.match(cashierPaymentMethods, /allowDecimalAmount:\s*true/);
  const purchaseBlockStart = cashierPaymentMethods.indexOf("host: byId('purchasePimasatu')");
  const operationalBlockStart = cashierPaymentMethods.indexOf("host: byId('operationalPimasatu')");
  assert.ok(purchaseBlockStart > -1 && operationalBlockStart > -1);
  const purchaseBlock = cashierPaymentMethods.slice(purchaseBlockStart, purchaseBlockStart + 600);
  const operationalBlock = cashierPaymentMethods.slice(operationalBlockStart, operationalBlockStart + 600);
  assert.match(purchaseBlock, /allowDecimalAmount:\s*true/, 'Beli Bahan must allow decimal unit price');
  assert.doesNotMatch(operationalBlock, /allowDecimalAmount:\s*true/, 'Pengeluaran Operasional must stay whole-rupiah only');
});
