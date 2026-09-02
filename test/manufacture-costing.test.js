import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildProductionCostingStatements, saleHppSnapshotSelect } from '../src/manufacture-costing.js';

const manufactureCosting = readFileSync(new URL('../src/manufacture-costing.js', import.meta.url), 'utf8');
const stockProduction = readFileSync(new URL('../src/stock-production.js', import.meta.url), 'utf8');
const warehouseProduction = readFileSync(new URL('../src/warehouse-production.js', import.meta.url), 'utf8');
const cashierSalesTracking = readFileSync(new URL('../src/cashier-sales-tracking.js', import.meta.url), 'utf8');

function d1(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...args) {
          return { _statement: statement, _args: args };
        }
      };
    }
  };
}

function costingFixture(currentStock) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE production_runs (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      total_output_quantity INTEGER NOT NULL,
      hpp_total_scaled INTEGER,
      hpp_per_unit_scaled INTEGER
    );
    CREATE TABLE production_run_components (
      production_run_id TEXT NOT NULL,
      total_cost_snapshot_scaled INTEGER NOT NULL
    );
    CREATE TABLE products (
      id INTEGER NOT NULL,
      store_id TEXT NOT NULL,
      average_cost INTEGER NOT NULL,
      cost_updated_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (id, store_id)
    );
    CREATE TABLE inventory_stock_balances (
      store_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      PRIMARY KEY (store_id, product_id)
    );
    CREATE TABLE product_average_cost_history (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      previous_average_cost_scaled INTEGER NOT NULL,
      new_average_cost_scaled INTEGER NOT NULL,
      change_reason TEXT NOT NULL,
      reference_type TEXT NOT NULL,
      reference_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    INSERT INTO production_runs (id, store_id, total_output_quantity)
    VALUES ('run-1', 'store-1', 2);
    INSERT INTO production_run_components (production_run_id, total_cost_snapshot_scaled)
    VALUES ('run-1', 2000001), ('run-1', 3000002);
    INSERT INTO products (id, store_id, average_cost)
    VALUES (7, 'store-1', 1000001);
    INSERT INTO inventory_stock_balances (store_id, product_id, quantity)
    VALUES ('store-1', 7, ${currentStock});
  `);
  return sqlite;
}

function applyCosting(sqlite) {
  const statements = buildProductionCostingStatements(d1(sqlite), {
    runId: 'run-1',
    storeId: 'store-1',
    outputProductId: 7,
    outputQuantity: 2,
    now: '2026-08-21T08:00:00.000Z'
  });
  sqlite.exec('BEGIN');
  try {
    for (const statement of statements) statement._statement.run(...statement._args);
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

test('legacy and V2 production callers delegate their shared HPP writer to Manufaktur', () => {
  assert.match(stockProduction, /import \{ buildProductionCostingStatements \} from '\.\/manufacture-costing\.js'/);
  assert.match(warehouseProduction, /import \{ buildProductionCostingStatements \} from '\.\/manufacture-costing\.js'/);
  assert.match(stockProduction, /buildProductionCostingStatements\(db/);
  assert.match(warehouseProduction, /buildProductionCostingStatements\(db/);
  assert.doesNotMatch(stockProduction, /UPDATE products/);
  assert.doesNotMatch(warehouseProduction, /UPDATE products/);
  assert.equal((manufactureCosting.match(/UPDATE products/g) || []).length, 1);
  assert.match(manufactureCosting, /SET average_cost = CASE/);
});

test('Sale reads its immutable HPP snapshot through the Manufaktur seam', () => {
  assert.equal(saleHppSnapshotSelect(), 'p.average_cost, p.average_cost * ?');
  assert.match(cashierSalesTracking, /import \{ saleHppSnapshotSelect \} from '\.\/manufacture-costing\.js'/);
  assert.match(cashierSalesTracking, /\$\{saleHppSnapshotSelect\(\)\}/);
  assert.doesNotMatch(cashierSalesTracking, /p\.average_cost/);
  assert.match(manufactureCosting, /saleHppSnapshotSelect/);
});

test('shared production costing preserves exact scaled HPP and moving-average rounding', () => {
  const sqlite = costingFixture(3);
  try {
    applyCosting(sqlite);
    assert.deepEqual({ ...sqlite.prepare(`
      SELECT hpp_total_scaled, hpp_per_unit_scaled,
             typeof(hpp_total_scaled) AS total_type,
             typeof(hpp_per_unit_scaled) AS unit_type
      FROM production_runs WHERE id = 'run-1'
    `).get() }, {
      hpp_total_scaled: 5_000_003,
      hpp_per_unit_scaled: 2_500_002,
      total_type: 'integer',
      unit_type: 'integer'
    });
    assert.deepEqual({ ...sqlite.prepare(`
      SELECT average_cost, cost_updated_at, typeof(average_cost) AS cost_type
      FROM products WHERE id = 7 AND store_id = 'store-1'
    `).get() }, {
      average_cost: 1_600_001,
      cost_updated_at: '2026-08-21T08:00:00.000Z',
      cost_type: 'integer'
    });
    assert.deepEqual({ ...sqlite.prepare(`
      SELECT previous_average_cost_scaled, new_average_cost_scaled, change_reason, reference_type, reference_id
      FROM product_average_cost_history
    `).get() }, {
      previous_average_cost_scaled: 1_000_001,
      new_average_cost_scaled: 1_600_001,
      change_reason: 'PRODUCTION',
      reference_type: 'PRODUCTION_RUN',
      reference_id: 'run-1'
    });
  } finally {
    sqlite.close();
  }
});

test('shared production costing preserves the zero-stock HPP bootstrap rule', () => {
  const sqlite = costingFixture(0);
  try {
    applyCosting(sqlite);
    assert.equal(sqlite.prepare(`
      SELECT average_cost FROM products WHERE id = 7 AND store_id = 'store-1'
    `).get().average_cost, 2_500_002);
    assert.equal(sqlite.prepare(`SELECT new_average_cost_scaled FROM product_average_cost_history`).get().new_average_cost_scaled, 2_500_002);
  } finally {
    sqlite.close();
  }
});
