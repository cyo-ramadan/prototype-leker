import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migrationDir = new URL('../migrations/', import.meta.url);

function tableColumns(db, table) {
  return new Map(db.prepare(`PRAGMA table_info(${table})`).all().map(row => [row.name, String(row.type || '').toUpperCase()]));
}

test('all migrations apply in order on a fresh SQLite database', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    const files = readdirSync(migrationDir)
      .filter(name => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    assert.ok(files.length >= 21, 'expected the complete migration history through 0021');

    for (const file of files) {
      const sql = readFileSync(new URL(file, migrationDir), 'utf8');
      assert.doesNotThrow(() => db.exec(sql), `migration ${file} must apply to a fresh database`);
    }

    const productColumns = tableColumns(db, 'products');
    assert.equal(productColumns.get('product_kind_id'), 'TEXT');
    assert.equal(productColumns.get('average_cost'), 'INTEGER');
    assert.equal(productColumns.get('last_purchase_price'), 'INTEGER');

    const purchaseItemColumns = tableColumns(db, 'purchase_items');
    assert.equal(purchaseItemColumns.get('product_id'), 'INTEGER');
    assert.equal(purchaseItemColumns.get('quantity'), 'INTEGER');
    assert.equal(purchaseItemColumns.get('line_total'), 'INTEGER');
    assert.equal(purchaseItemColumns.get('unit_cost'), 'INTEGER');
    assert.equal(purchaseItemColumns.get('average_cost_before'), 'INTEGER');
    assert.equal(purchaseItemColumns.get('average_cost_after'), 'INTEGER');

    const saleItemColumns = tableColumns(db, 'sale_items');
    assert.equal(saleItemColumns.get('unit_cost_snapshot'), 'INTEGER');
    assert.equal(saleItemColumns.get('line_cogs'), 'INTEGER');

    const expenseColumns = tableColumns(db, 'expenses');
    assert.equal(expenseColumns.get('quantity'), 'TEXT');

    const productionRunColumns = tableColumns(db, 'production_runs');
    assert.equal(productionRunColumns.get('hpp_total_scaled'), 'INTEGER');
    assert.equal(productionRunColumns.get('hpp_per_unit_scaled'), 'INTEGER');

    const productionComponentColumns = tableColumns(db, 'production_run_components');
    assert.equal(productionComponentColumns.get('unit_cost_snapshot_scaled'), 'INTEGER');
    assert.equal(productionComponentColumns.get('total_cost_snapshot_scaled'), 'INTEGER');

    const kindColumns = tableColumns(db, 'product_kinds');
    assert.equal(kindColumns.get('id'), 'TEXT');
    assert.equal(kindColumns.get('code'), 'TEXT');
    assert.equal(kindColumns.get('is_active'), 'INTEGER');
  } finally {
    db.close();
  }
});
