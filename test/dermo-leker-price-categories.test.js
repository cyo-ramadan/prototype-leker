import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migrationDir = new URL('../migrations/', import.meta.url);
const migration0084Name = '0084_dermo_leker_price_categories.sql';
const migration0084 = new URL(`../migrations/${migration0084Name}`, import.meta.url);

// This test proves migration 0084's historical state. Later migrations may
// intentionally evolve those categories, so replay only through 0084 here.
const migrationFiles = readdirSync(migrationDir)
  .filter(name => /^\d{4}_.+\.sql$/.test(name) && name <= migration0084Name)
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
    assert.equal(row.price, row.purchase_price, `${row.name} Harga Jual must equal Harga Beli`);
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
        AND name GLOB 'leker[0-9]*'
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

test('0084 is idempotent when replayed after the migration chain through 0084', () => {
  const sqlite = freshDatabase();
  try {
    sqlite.exec(readFileSync(migration0084, 'utf8'));
    assertPriceCategories(sqlite);
  } finally {
    sqlite.close();
  }
});
