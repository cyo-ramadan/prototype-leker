import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/0041_g001_production_tracking_reconciliation.sql', import.meta.url), 'utf8');

test('G001 production reconciliation is store-scoped and only enables tracking for active recipe roles', () => {
  assert.match(migration, /code\s*=\s*'G001'/, 'repair must stay scoped to G001');
  assert.equal((migration.match(/SET stock_tracking_enabled\s*=\s*1/g) || []).length, 2);
  assert.match(migration, /r\.status\s*=\s*'ACTIVE'/, 'only active recipes may drive the repair');
  assert.match(migration, /t\.can_produce/, 'output repair must respect Item Type production permission');
  assert.match(migration, /t\.can_consume/, 'component repair must respect Item Type consumption permission');
  assert.match(migration, /t\.track_stock/, 'repair must respect Item Type stock semantics');
});

test('G001 production reconciliation does not invent stock, Recipe, Item Type, costing, or Accounting data', () => {
  assert.doesNotMatch(migration, /UPDATE\s+inventory_stock_balances/i);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+inventory_stock_balances/i);
  assert.doesNotMatch(migration, /UPDATE\s+item_types/i);
  assert.doesNotMatch(migration, /UPDATE\s+manufacturing_recipes/i);
  assert.doesNotMatch(migration, /UPDATE\s+manufacturing_recipe_components/i);
  assert.doesNotMatch(migration, /accounting_journal_(?:headers|lines)/i);
  assert.doesNotMatch(migration, /average_cost\s*=/i);
});
