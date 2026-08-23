import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/cashier-operational-expense.js', import.meta.url), 'utf8');

test('operational quantity remains expense metadata without inventory writes', () => {
  assert.match(source, /INSERT INTO expenses[\s\S]*quantity[\s\S]*VALUES/);
  assert.equal(source.includes('stock_movements'), false);
  assert.equal(source.includes('inventory_stock_balances'), false);
});
