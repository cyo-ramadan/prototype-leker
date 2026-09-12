import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migrationDir = new URL('../migrations/', import.meta.url);
const migrationFiles = readdirSync(migrationDir)
  .filter(name => /^\d{4}_.+\.sql$/.test(name))
  .sort();

const expectedDistribution = [
  ['2K', 9],
  ['3K', 7],
  ['4K', 7],
  ['5K', 18],
  ['Special', 32],
];

const legacyBuckets = [
  'leker1500', 'leker2000', 'leker3000', 'leker4000', 'leker5000',
  'leker8000', 'leker10000', 'leker15000', 'leker20000',
  'leker25000', 'leker40000',
];

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of migrationFiles) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function dermoLekerRows(sqlite) {
  return sqlite.prepare(`
    SELECT p.name, p.price, p.purchase_price, p.category
    FROM products p
    WHERE p.store_id = 'store_dermo'
      AND EXISTS (
        SELECT 1
        FROM manufacturing_recipes r
        WHERE r.store_id = p.store_id
          AND r.output_product_id = p.id
          AND r.id LIKE 'dermo_leker_recipe_%'
          AND r.created_by_id = 'migration_0083'
      )
    ORDER BY p.name
  `).all();
}

test('0085 creates proper Dermo Leker parent-child categories and remaps all 73 products', () => {
  const sqlite = freshDatabase();
  try {
    const parentColumn = sqlite.prepare(`PRAGMA table_info(categories)`).all()
      .find(column => column.name === 'parent_category_id');
    assert.ok(parentColumn, 'categories must expose parent_category_id');

    const parent = sqlite.prepare(`
      SELECT id, parent_category_id, is_active
      FROM categories
      WHERE store_id = 'store_dermo' AND name = 'Leker'
    `).get();
    assert.ok(parent, 'Dermo Leker parent category must exist');
    assert.equal(parent.parent_category_id, null);
    assert.equal(parent.is_active, 1);

    assert.deepEqual(
      sqlite.prepare(`
        SELECT name, display_order
        FROM categories
        WHERE store_id = 'store_dermo'
          AND parent_category_id = ?
          AND is_active = 1
        ORDER BY display_order, id
      `).all(parent.id).map(row => [row.name, row.display_order]),
      [
        ['2K', 1],
        ['3K', 2],
        ['4K', 3],
        ['5K', 4],
        ['Special', 5],
      ],
    );

    const rows = dermoLekerRows(sqlite);
    assert.equal(rows.length, 73);
    for (const row of rows) {
      const rupiah = row.price / 1000000;
      const expected = rupiah <= 2000
        ? '2K'
        : rupiah === 3000
          ? '3K'
          : rupiah === 4000
            ? '4K'
            : rupiah === 5000
              ? '5K'
              : 'Special';
      assert.equal(row.category, expected, `${row.name} category`);
      assert.equal(row.price, row.purchase_price, `${row.name} must preserve equal sale/purchase price`);
    }

    assert.deepEqual(
      sqlite.prepare(`
        SELECT p.category, COUNT(*) AS total
        FROM products p
        WHERE p.store_id = 'store_dermo'
          AND EXISTS (
            SELECT 1
            FROM manufacturing_recipes r
            WHERE r.store_id = p.store_id
              AND r.output_product_id = p.id
              AND r.id LIKE 'dermo_leker_recipe_%'
              AND r.created_by_id = 'migration_0083'
          )
        GROUP BY p.category
        ORDER BY CASE p.category
          WHEN '2K' THEN 1
          WHEN '3K' THEN 2
          WHEN '4K' THEN 3
          WHEN '5K' THEN 4
          WHEN 'Special' THEN 5
          ELSE 99
        END
      `).all().map(row => [row.category, row.total]),
      expectedDistribution,
    );

    assert.deepEqual(
      sqlite.prepare(`
        SELECT name
        FROM categories
        WHERE store_id = 'store_dermo'
          AND name IN (${legacyBuckets.map(() => '?').join(', ')})
          AND is_active <> 0
      `).all(...legacyBuckets),
      [],
      'legacy exact-price buckets must be inactive after regrouping',
    );

    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    sqlite.close();
  }
});

test('category hierarchy rejects a parent from another store', () => {
  const sqlite = freshDatabase();
  try {
    const dermoParent = sqlite.prepare(`
      SELECT id FROM categories WHERE store_id = 'store_dermo' AND name = 'Leker'
    `).get();
    assert.ok(dermoParent);

    assert.throws(
      () => sqlite.prepare(`
        INSERT INTO categories (store_id, name, parent_category_id)
        VALUES ('store_001', 'Cross Store Child Test', ?)
      `).run(dermoParent.id),
      /category parent must belong to same store/i,
    );
  } finally {
    sqlite.close();
  }
});
