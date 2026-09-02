import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const purchase = readFileSync(new URL('../src/cashier-purchase.js', import.meta.url), 'utf8');
const production = readFileSync(new URL('../src/manufacture-costing.js', import.meta.url), 'utf8');
const correction = readFileSync(new URL('../src/transaction-correction-executor.js', import.meta.url), 'utf8');
const adminApi = readFileSync(new URL('../src/admin-stock.js', import.meta.url), 'utf8');
const adminUi = readFileSync(new URL('../public/admin-stock.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0061_product_average_cost_history.sql', import.meta.url), 'utf8');

test('Purchase average_cost writer appends its before/after snapshot without changing the formula', () => {
  assert.equal((purchase.match(/SET\s+average_cost\s*=/g) || []).length, 1);
  assert.match(purchase, /average_cost_before, average_cost_after/);
  assert.match(purchase, /'PURCHASE', 'PURCHASE', purchase_id/);
  assert.match(purchase, /CASE WHEN COALESCE\(b\.quantity, 0\) <= 0 THEN \?/);
});

test('Production average_cost writer appends the exact same moving-average result', () => {
  assert.equal((production.match(/SET\s+average_cost\s*=/g) || []).length, 1);
  assert.equal((production.match(/INSERT INTO product_average_cost_history/g) || []).length, 1);
  assert.match(production, /'PRODUCTION', 'PRODUCTION_RUN', \?, \?/);
});

test('Sale correction average_cost writer appends a SALE_VOID correction entry', () => {
  assert.match(correction, /'CORRECTION', 'SALE_VOID', \?, \?/);
  assert.match(correction, /previous_average_cost_scaled, new_average_cost_scaled/);
});

test('Purchase correction average_cost writer appends its immutable before/after reversal', () => {
  assert.match(correction, /item\.average_cost_after,\s*item\.average_cost_before/);
  assert.match(correction, /'CORRECTION', 'PURCHASE_VOID'/);
  assert.equal((correction.match(/SET\s+average_cost\s*=/g) || []).length, 2);
  assert.equal((correction.match(/INSERT INTO product_average_cost_history/g) || []).length, 2);
});

test('HPP history is append-only, store scoped, and Admin shows five latest with date filters', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS product_average_cost_history/);
  assert.match(migration, /store_id TEXT NOT NULL/);
  assert.doesNotMatch(`${purchase}\n${production}\n${correction}`, /UPDATE\s+product_average_cost_history|DELETE\s+FROM\s+product_average_cost_history/);
  assert.match(adminApi, /product_average_cost_history/);
  assert.match(adminApi, /WHERE store_id = \? AND product_id = \?/);
  assert.match(adminApi, /url\.searchParams\.get\('limit'\) \|\| 5/);
  assert.match(adminUi, /Histori HPP/);
  assert.match(adminUi, /url\.searchParams\.set\('limit', '5'\)/);
  assert.match(adminUi, /adminCostHistoryFrom/);
  assert.match(adminUi, /adminCostHistoryTo/);
});
