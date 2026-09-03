import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { scaledPurchasePriceFromInput } from '../src/product-master.js';

const purchasePriceScaleMigration = readFileSync(new URL('../migrations/0059_master_purchase_price_scaled.sql', import.meta.url), 'utf8');
const branchAdminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
const productPolicyUi = readFileSync(new URL('../public/admin-product-policy.js', import.meta.url), 'utf8');
const pimasatuUi = readFileSync(new URL('../public/pimasatu-ui.js', import.meta.url), 'utf8');
const cashierPaymentMethods = readFileSync(new URL('../public/cashier-payment-methods.js', import.meta.url), 'utf8');

function makeEl(tag) {
  const listeners = {};
  return {
    tagName: tag, className: '', innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, handler) { listeners[type] = handler; },
    set onclick(handler) { listeners.click = handler; },
    set onfocus(handler) { listeners.focus = handler; },
    set oninput(handler) { listeners.input = handler; },
    set onchange(handler) { listeners.change = handler; },
    fire(type, event) { listeners[type]?.(event); },
    querySelector: () => null,
    querySelectorAll: () => [],
    style: {},
    value: ''
  };
}

async function mountPimasatu(options) {
  const vm = await import('node:vm');
  const host = makeEl('div');
  const toggle = makeEl('button'), composer = makeEl('section'), search = makeEl('input'), results = makeEl('div'),
    qty = makeEl('input'), price = makeEl('input'), total = makeEl('input'), amountToggle = makeEl('button'),
    hint = makeEl('div'), linesHost = makeEl('div'), add = makeEl('button'), detailHead = makeEl('div');
  const elements = {
    '.pimasatu-toggle': toggle, '.pimasatu-composer': composer, '.pimasatu-search': search, '.pimasatu-results': results,
    '.pimasatu-qty': qty, '.pimasatu-price': price, '.pimasatu-total': total, '.pimasatu-amount-toggle': amountToggle,
    '.pimasatu-hint': hint, '.pimasatu-lines': linesHost, '.pimasatu-add': add, '.pimasatu-detail-head': detailHead
  };
  host.querySelector = selector => elements[selector] || null;

  const source = pimasatuUi.replace('window.MAXIPimasatu', 'globalThis.MAXIPimasatu');
  const context = vm.createContext({
    document: { querySelector: () => null, createElement: () => makeEl('div') },
    window: {}, globalThis: {}, Intl, console
  });
  vm.runInContext(source, context);

  let addedLine = null;
  const errors = [];
  context.globalThis.MAXIPimasatu.create({
    host,
    items: [{ id: 1, name: 'Air Mineral', purchasePrice: 0.5 }],
    getDefaultAmount: item => item.purchasePrice,
    onAdd: line => { addedLine = line; },
    onError: message => errors.push(message),
    ...options
  });

  return { host, qty, price, total, amountToggle, results, add, errors, getAddedLine: () => addedLine };
}

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

test('Master Barang Harga Beli field no longer forces whole-rupiah step, and reads Indonesian comma decimals', () => {
  assert.doesNotMatch(branchAdminHtml, /id="productPurchasePrice" type="number"/, 'type="number" silently drops a typed comma decimal on id-ID keyboards');
  assert.match(branchAdminHtml, /id="productPurchasePrice" type="text" inputmode="decimal"/);
  assert.match(productPolicyUi, /input\.type = 'text'/);
  assert.match(productPolicyUi, /input\.inputMode = 'decimal'/);
  assert.match(productPolicyUi, /purchasePrice: Number\(String\(el\('productPurchasePrice'\)\.value\)\.trim\(\)\.replace\(',', '\.'\)\)/, 'comma must be normalized to a period before parsing');
});

test('Pembelian (Beli Bahan) defaults to the classic harga-per-satuan field with a toggle to a locked total field', () => {
  assert.match(pimasatuUi, /amountMode/, 'pimasatu must support a toggle-entry mode');
  assert.match(pimasatuUi, /isToggleMode/);
  assert.match(pimasatuUi, /pimasatu-amount-toggle/, 'must render the toggle button next to the locked field');
  const purchaseBlockStart = cashierPaymentMethods.indexOf("host: byId('purchasePimasatu')");
  const operationalBlockStart = cashierPaymentMethods.indexOf("host: byId('operationalPimasatu')");
  assert.ok(purchaseBlockStart > -1 && operationalBlockStart > -1);
  const purchaseBlock = cashierPaymentMethods.slice(purchaseBlockStart, purchaseBlockStart + 600);
  const operationalBlock = cashierPaymentMethods.slice(operationalBlockStart, operationalBlockStart + 600);
  assert.match(purchaseBlock, /amountMode:\s*'toggle'/, 'Beli Bahan must offer the harga-per-satuan/total toggle');
  assert.doesNotMatch(operationalBlock, /amountMode:\s*'toggle'/, 'Pengeluaran Operasional keeps its existing single-field entry');
});

test('Master Barang Harga Beli (reference field) still accepts Indonesian comma decimals for display/reference purposes', () => {
  assert.match(pimasatuUi, /replace\(',', '\.'\)/, 'typed comma decimal must be normalized before Number() parsing where decimal entry is still used');
});

test('Master Barang save handler removes the legacy admin.js submit listener before attaching its own', () => {
  const mountIndex = productPolicyUi.indexOf('function mountProductFields');
  assert.ok(mountIndex > -1);
  const mountBody = productPolicyUi.slice(mountIndex, mountIndex + 2200);
  const removeIndex = mountBody.indexOf("form.removeEventListener('submit', window.saveProduct)");
  const addIndex = mountBody.indexOf("form.addEventListener('submit', saveProductMaster, true)");
  assert.ok(removeIndex > -1, 'must drop the legacy public/admin.js saveProduct listener bound on the same #productForm');
  assert.ok(addIndex > -1);
  assert.ok(removeIndex < addIndex, 'the legacy listener must be removed before the new one is attached');
});

test('pimasatu toggle mode defaults to harga-per-satuan (comma-decimal capable), total field locked until toggled', async () => {
  const { qty, price, total, results, add, errors, getAddedLine } = await mountPimasatu({ amountMode: 'toggle' });

  results.fire('click', { target: { closest: () => ({ dataset: { result: '1' } }) } });
  assert.equal(price.value, '0.5', 'per-unit field must prefill from the Master Barang reference price, matching the classic behaviour kasir already knows');
  assert.equal(total.disabled, true, 'total field must start locked');
  assert.equal(price.disabled, false, 'per-unit field must start active');

  qty.value = '12000';
  price.value = '0,7';
  add.fire('click');

  assert.deepEqual(errors, []);
  const line = getAddedLine();
  assert.ok(line, 'line must be added, not rejected');
  assert.equal(line.unitAmount, 0.7, '"0,7" must parse as 0.7, not 0 or 1');
  assert.equal(Math.round(line.quantity * line.unitAmount), 8400, '12.000ml x Rp0,7 must total Rp8.400');
});

test('pimasatu toggle mode: clicking the green toggle activates the total field and locks harga per satuan', async () => {
  const { qty, price, total, amountToggle, results, add, errors, getAddedLine } = await mountPimasatu({ amountMode: 'toggle' });

  results.fire('click', { target: { closest: () => ({ dataset: { result: '1' } }) } });
  amountToggle.fire('click');
  assert.equal(total.disabled, false, 'total field must become active after the toggle is clicked');
  assert.equal(price.disabled, true, 'per-unit field must become locked after the toggle is clicked');

  qty.value = '16000';
  total.value = '8000';
  add.fire('click');

  assert.deepEqual(errors, []);
  const line = getAddedLine();
  assert.ok(line, 'line must be added from a whole-rupiah total, no comma/decimal needed');
  assert.equal(line.unitAmount, 0.5, 'Rp8.000 for 16.000ml must derive Rp0,5/ml automatically');
  assert.equal(Math.round(line.quantity * line.unitAmount), 8000, 'reconstructing qty x per-unit cost must land back on the exact entered total');

  // Adding a line resets the toggle back to the default (harga per satuan active).
  assert.equal(total.disabled, true, 'total field must lock again after the line is added');
  assert.equal(price.disabled, false, 'per-unit field must re-activate after the line is added');
});
