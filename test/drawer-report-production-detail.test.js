import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildDrawerReport } from '../src/drawer-report.js';

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(result.changes || 0) } };
  }
}

class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) { return statements.map(statement => statement.run()); }
}

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

function productWithBaseUnit(db, excludeId) {
  return db.prepare(`
    SELECT p.id, p.name, u.id AS unit_id, u.symbol AS unit_symbol
    FROM products p
    JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    WHERE p.store_id = 'store_001' AND (? IS NULL OR p.id != ?)
    ORDER BY p.id LIMIT 1
  `).get(excludeId ?? null, excludeId ?? null);
}

function seedProductionFixture(db, { drawerId, status = 'POSTED' }) {
  const cashier = db.prepare("SELECT id FROM cashiers WHERE store_id = 'store_001' AND is_active = 1 ORDER BY id LIMIT 1").get();
  const outputProduct = productWithBaseUnit(db, null);
  const componentProduct = productWithBaseUnit(db, outputProduct.id);

  const existingActive = db.prepare(`
    SELECT id, revision FROM manufacturing_recipes
    WHERE store_id = 'store_001' AND output_product_id = ? AND status = 'ACTIVE'
  `).get(outputProduct.id);
  const revision = existingActive ? existingActive.revision + 1 : 1;
  const recipeStatus = existingActive ? 'ARCHIVED' : 'ACTIVE';

  const recipeId = `recipe_${drawerId}`;
  db.prepare(`
    INSERT INTO manufacturing_recipes (id, store_id, output_product_id, output_unit_id, output_quantity, revision, status, created_at)
    VALUES (?, 'store_001', ?, ?, 1, ?, ?, '2026-09-03T00:00:00.000Z')
  `).run(recipeId, outputProduct.id, outputProduct.unit_id, revision, recipeStatus);

  const runId = `run_${drawerId}`;
  db.prepare(`
    INSERT INTO production_runs (
      id, store_id, drawer_session_id, mode, output_product_id, output_product_name,
      output_unit_id, output_unit_symbol, recipe_id, recipe_revision, batches,
      output_quantity_per_batch, total_output_quantity, status, created_by_role, created_by_id, created_at
    ) VALUES (?, 'store_001', ?, 'MANUAL', ?, ?, ?, ?, ?, 1, 1, 5, 5, ?, 'CASHIER', ?, '2026-09-03T06:00:00.000Z')
  `).run(runId, drawerId, outputProduct.id, outputProduct.name, outputProduct.unit_id, outputProduct.unit_symbol, recipeId, status, cashier.id);

  db.prepare(`
    INSERT INTO production_run_components (
      id, production_run_id, store_id, component_product_id, component_product_name,
      component_unit_id, component_unit_symbol, quantity_per_batch, total_quantity
    ) VALUES (?, ?, 'store_001', ?, ?, ?, ?, 2, 2)
  `).run(`comp_${drawerId}`, runId, componentProduct.id, componentProduct.name, componentProduct.unit_id, componentProduct.unit_symbol);

  return { cashierId: cashier.id, outputProduct, componentProduct };
}

test('drawer report surfaces production (MASAK) detail for the drawer session it belongs to', async () => {
  const db = migratedDatabase();
  try {
    const cashier = db.prepare("SELECT id FROM cashiers WHERE store_id = 'store_001' AND is_active = 1 ORDER BY id LIMIT 1").get();
    db.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES ('drawer_masak_a', 'store_001', ?, 100000, 'OPEN', '2026-09-03T00:00:00.000Z')
    `).run(cashier.id);
    const { outputProduct, componentProduct } = seedProductionFixture(db, { drawerId: 'drawer_masak_a' });

    const report = await buildDrawerReport(new D1Database(db), 'store_001', 'drawer_masak_a');
    assert.ok(report, 'expected a report for the seeded drawer session');
    assert.equal(report.sections.cooking.length, 1);
    const [row] = report.sections.cooking;
    assert.ok(row.result.includes(outputProduct.name), `expected result to mention ${outputProduct.name}, got: ${row.result}`);
    assert.ok(row.result.includes(outputProduct.unit_symbol), `expected result to mention unit ${outputProduct.unit_symbol}, got: ${row.result}`);
    assert.ok(row.material.includes(componentProduct.name), `expected material to mention ${componentProduct.name}, got: ${row.material}`);
  } finally {
    db.close();
  }
});

test('drawer report excludes production runs from other drawer sessions and cancelled runs', async () => {
  const db = migratedDatabase();
  try {
    const cashier = db.prepare("SELECT id FROM cashiers WHERE store_id = 'store_001' AND is_active = 1 ORDER BY id LIMIT 1").get();
    db.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, closing_amount, status, opened_at, closed_at)
      VALUES ('drawer_masak_other', 'store_001', ?, 100000, 100000, 'CLOSED', '2026-09-02T23:00:00.000Z', '2026-09-02T23:30:00.000Z')
    `).run(cashier.id);
    db.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES ('drawer_masak_target', 'store_001', ?, 100000, 'OPEN', '2026-09-03T00:00:00.000Z')
    `).run(cashier.id);

    seedProductionFixture(db, { drawerId: 'drawer_masak_other' });
    seedProductionFixture(db, { drawerId: 'drawer_masak_target', status: 'CANCELLED' });

    const report = await buildDrawerReport(new D1Database(db), 'store_001', 'drawer_masak_target');
    assert.ok(report);
    assert.equal(report.sections.cooking.length, 0, 'neither a different drawer session nor a CANCELLED run should appear');
  } finally {
    db.close();
  }
});
