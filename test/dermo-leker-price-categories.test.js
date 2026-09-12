import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migrationDir = new URL('../migrations/', import.meta.url);
const migration0084 = new URL('../migrations/0084_dermo_leker_price_categories.sql', import.meta.url);

const migrationFiles = readdirSync(migrationDir)
  .filter(name => /^\d{4}_.+\.sql$/.test(name))
  .sort();

const expectedDistribution = [
  ['leker1500', 1],
  ['leker2000', 8],
  ['leker3000', 7],
  ['leker4000', 7],
  ['leker5000', 18],
  ['leker8000', 15],
  ['leker10000', 9],
  ['leker15000', 1],
  ['leker20000', 3],
  ['leker25000', 3],
  ['leker40000', 1],
];

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of migrationFiles) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function assertPriceCategories(sqlite) {
  const rows = sqlite.prepare(`
    SELECT
      p.name,
      p.price,
      p.purchase_price,
      p.category
    FROM products p
    WHERE p.store_id = 'store_dermo'
      AND EXISTS (
        SELECT 1
        FROM manufacturing_recipes r
        WHERE r.store_id = 'store_dermo'
          AND r.output_product_id = p.id
          AND r.id LIKE 'dermo_leker_recipe_%'
          AND r.created_by_id = 'migration_0083'
      )
    ORDER BY p.name
  `).all();

  assert.equal(rows.length, 73, 'all 73 Dermo Leker products must be categorized');

  for (const row of rows) {
    const rupiah = row.price / 1000000;
    assert.equal(row.price, row.purchase_price, `${row.name} must preserve equal sale/purchase price`);
    assert.equal(row.category, `leker${rupiah}`, `${row.name} category must follow its selling price`);
  }

  assert.deepEqual(
    sqlite.prepare(`
      SELECT p.category, COUNT(*) AS total
      FROM products p
      WHERE p.store_id = 'store_dermo'
        AND EXISTS (
          SELECT 1
          FROM manufacturing_recipes r
          WHERE r.store_id = 'store_dermo'
            AND r.output_product_id = p.id
            AND r.id LIKE 'dermo_leker_recipe_%'
            AND r.created_by_id = 'migration_0083'
        )
      GROUP BY p.category
      ORDER BY CAST(SUBSTR(p.category, 6) AS INTEGER)
    `).all().map(row => [row.category, row.total]),
    expectedDistribution,
  );

  assert.deepEqual(
    sqlite.prepare(`
      SELECT name
      FROM categories
      WHERE store_id = 'store_dermo'
        AND name LIKE 'leker%'
        AND is_active = 1
      ORDER BY CAST(SUBSTR(name, 6) AS INTEGER)
    `).all().map(row => row.name),
    expectedDistribution.map(([name]) => name),
  );

  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
}

test('0084 categorizes Dermo Leker products by selling-price bucket', () => {
  const sqlite = freshDatabase();
  try {
    assertPriceCategories(sqlite);
  } finally {
    sqlite.close();
  }
});

test('0084 is idempotent when replayed after the full migration chain', () => {
  const sqlite = freshDatabase();
  try {
    sqlite.exec(readFileSync(migration0084, 'utf8'));
    assertPriceCategories(sqlite);
  } finally {
    sqlite.close();
  }
});
