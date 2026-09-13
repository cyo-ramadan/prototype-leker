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
