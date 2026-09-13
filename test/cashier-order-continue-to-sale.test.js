import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../public/cashier-sales-orders.js', import.meta.url), 'utf8');

test('a completed order card offers "Teruskan ke Penjualan", reusing the existing draft snapshot', () => {
  const rowsStart = ui.indexOf('function orderHistoryRows');
  const rowsEnd = ui.indexOf('function ', rowsStart + 1);
  const rowsBody = ui.slice(rowsStart, rowsEnd);
  assert.match(rowsBody, /order\.status === 'COMPLETED' \? `<button[^`]*data-teruskan-order="\$\{esc\(order\.id\)\}"[^`]*Teruskan ke Penjualan/);
});

test('rejected (CANCELLED) order rows do not get the continue-to-sale button', () => {
  const rowsStart = ui.indexOf('function orderHistoryRows');
  const rowsEnd = ui.indexOf('function ', rowsStart + 1);
  const rowsBody = ui.slice(rowsStart, rowsEnd);
  const ternaryMatch = rowsBody.match(/order\.status === 'COMPLETED' \? `([^`]*)` : ''/);
  assert.ok(ternaryMatch, 'expected the continue button to be gated behind a COMPLETED-only ternary');
});

test('clicking "Teruskan ke Penjualan" reuses snapshotOrderToDraft instead of a new submit path', () => {
  assert.match(ui, /data-teruskan-order\]'\)\.forEach\(button => \{\s*button\.onclick = \(\) => \{\s*const order = \(state\.orders \|\| \[\]\)\.find\(candidate => String\(candidate\.id\) === button\.dataset\.teruskanOrder\);\s*if \(order\) snapshotOrderToDraft\(order\);/);
});

test('finishing a sale that started from "Teruskan ke Penjualan" lands back on the Pesanan tab, not the empty Penjualan screen', () => {
  const fnStart = ui.indexOf('async function processTrackedSale');
  const fnEnd = ui.indexOf('\n  }', fnStart);
  const fnBody = ui.slice(fnStart, fnEnd);
  assert.match(fnBody, /const cameFromOrder = Boolean\(draftOriginOrderId\);/, 'must capture the order-origin flag before draftOriginOrderId is cleared');
  assert.match(fnBody, /if \(cameFromOrder\) setMode\('orders'\);/, 'must switch back to the orders tab when the sale came from an order');
  // the flag must be read BEFORE the reset, or it always evaluates to false
  assert.ok(fnBody.indexOf('const cameFromOrder') < fnBody.indexOf('draftOriginOrderId = null'));
});
