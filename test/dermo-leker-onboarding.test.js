import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migrationDir = new URL('../migrations/', import.meta.url);
const migration0083 = new URL('../migrations/0083_dermo_leker_catalog_and_recipes.sql', import.meta.url);

const migrationFiles = readdirSync(migrationDir)
  .filter(name => /^\d{4}_.+\.sql$/.test(name))
  .sort();

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of migrationFiles) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function assertDermoLekerState(sqlite) {
  const adonan = sqlite.prepare(`
    SELECT p.id, p.price, p.purchase_price, p.stock_tracking_enabled,
           u.code AS unit_code
    FROM products p
    JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    WHERE p.store_id = 'store_dermo' AND p.name = 'Adonan Leker'
  `).get();

  assert.ok(adonan, 'Dermo must have Adonan Leker');
  assert.equal(adonan.unit_code, 'RUPIAH');
  assert.equal(adonan.price, 1000000);
  assert.equal(adonan.purchase_price, 1000000);
  assert.equal(adonan.stock_tracking_enabled, 1);

  const recipes = sqlite.prepare(`
    SELECT
      r.id AS recipe_id,
      r.output_quantity,
      r.created_by_role,
      r.created_by_id,
      p.id AS product_id,
      p.name AS product_name,
      p.price,
      p.purchase_price,
      p.production_mode,
      p.recipe_link_enabled,
      p.linked_recipe_id,
      c.quantity AS adonan_rupiah,
      c.component_unit_id,
      a.base_unit_id AS adonan_unit_id
    FROM manufacturing_recipes r
    JOIN products p
      ON p.id = r.output_product_id AND p.store_id = r.store_id
    JOIN manufacturing_recipe_components c
      ON c.recipe_id = r.id AND c.store_id = r.store_id
    JOIN products a
      ON a.id = c.component_product_id AND a.store_id = c.store_id
    WHERE r.store_id = 'store_dermo'
      AND r.id LIKE 'dermo_leker_recipe_%'
      AND r.status = 'ACTIVE'
      AND a.name = 'Adonan Leker'
    ORDER BY r.id
  `).all();

  assert.equal(recipes.length, 73, '0083 must provision exactly 73 active Dermo Leker recipes');

  for (const row of recipes) {
    assert.equal(row.output_quantity, 1, `${row.product_name} output quantity`);
    assert.equal(row.price, row.purchase_price, `${row.product_name} Harga Jual must equal Harga Beli`);
    assert.equal(row.price, row.adonan_rupiah * 1000000, `${row.product_name} scaled price must match recipe nominal`);
    assert.equal(row.production_mode, 'DADAKAN', `${row.product_name} must use DADAKAN production`);
    assert.equal(row.recipe_link_enabled, 1, `${row.product_name} recipe link must be enabled`);
    assert.equal(row.linked_recipe_id, row.recipe_id, `${row.product_name} must link its active 0083 recipe`);
    assert.equal(row.component_unit_id, row.adonan_unit_id, `${row.product_name} component unit must match Adonan base unit`);
    assert.equal(row.created_by_role, 'SYSTEM');
    assert.equal(row.created_by_id, 'migration_0083');
  }

  assert.equal(
    sqlite.prepare(`
      SELECT COUNT(*) AS n
      FROM manufacturing_recipes
      WHERE store_id <> 'store_dermo' AND id LIKE 'dermo_leker_recipe_%'
    `).get().n,
    0,
    '0083 recipe ids must never leak to another store',
  );
  assert.equal(
    sqlite.prepare(`
      SELECT COUNT(*) AS n
      FROM products
      WHERE store_id <> 'store_dermo' AND name = 'Adonan Leker'
    `).get().n,
    0,
    '0083 Adonan Leker must remain Dermo-scoped',
  );

  assert.equal(
    sqlite.prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE store_id = 'store_dermo'`).get().n,
    0,
    'master-data onboarding must not fabricate stock movements',
  );
  assert.equal(
    sqlite.prepare(`SELECT COUNT(*) AS n FROM inventory_stock_balances WHERE store_id = 'store_dermo'`).get().n,
    0,
    'master-data onboarding must not fabricate stock balances',
  );
  assert.equal(
    sqlite.prepare(`SELECT COUNT(*) AS n FROM production_runs WHERE store_id = 'store_dermo'`).get().n,
    0,
    'master-data onboarding must not fabricate production history',
  );

  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
}

test('0083 provisions Dermo Leker catalog with equal sale/purchase prices and Dadakan recipes', () => {
  const sqlite = freshDatabase();
  try {
    assertDermoLekerState(sqlite);
  } finally {
    sqlite.close();
  }
});

test('0083 is idempotent when replayed after the full migration chain', () => {
  const sqlite = freshDatabase();
  try {
    sqlite.exec(readFileSync(migration0083, 'utf8'));
    assertDermoLekerState(sqlite);
  } finally {
    sqlite.close();
  }
});
