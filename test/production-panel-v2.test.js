import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolveProductionInventoryTransfer } from '../src/accounting-warehouse-production-bridge.js';
import { prepareManualProductionV2 } from '../src/warehouse-production.js';
import { missingRequiredColumns } from '../scripts/verify-remote-schema.mjs';

const migrationDir = new URL('../migrations/', import.meta.url);
const migration = readFileSync(new URL('../migrations/0039_flexible_manual_production.sql', import.meta.url), 'utf8');
const warehouseProduction = readFileSync(new URL('../src/warehouse-production.js', import.meta.url), 'utf8');
const cashierProduction = readFileSync(new URL('../src/cashier-production.js', import.meta.url), 'utf8');
const accountingBridge = readFileSync(new URL('../src/accounting-warehouse-production-bridge.js', import.meta.url), 'utf8');
const productionUi = readFileSync(new URL('../public/cashier-production-v2.js', import.meta.url), 'utf8');
const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');
const OLD_MATERIAL_COST_SCALED = 1_500_001;
const NEW_MATERIAL_COST_SCALED = 2_750_003;

function d1(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...args) {
          return {
            _statement: statement,
            _args: args,
            async first() { return statement.get(...args) || null; },
            async all() { return { results: statement.all(...args) }; },
            async run() { return statement.run(...args); }
          };
        }
      };
    },
    async batch(boundStatements) {
      sqlite.exec('BEGIN');
      try {
        const results = boundStatements.map(item => item._statement.run(...item._args));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function productionFixture(sqlite) {
  const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001' LIMIT 1`).get();
  assert.ok(store?.id);
  const products = sqlite.prepare(`
    SELECT id, name
    FROM products
    WHERE store_id = ?
    ORDER BY id
    LIMIT 2
  `).all(store.id);
  assert.equal(products.length, 2);
  const [output, material] = products;
  const unit = sqlite.prepare(`SELECT id FROM units WHERE store_id = ? AND code = 'PCS'`).get(store.id);
  const finishedType = sqlite.prepare(`SELECT id FROM item_types WHERE store_id = ? AND code = 'FINISHED_GOOD'`).get(store.id);
  const rawType = sqlite.prepare(`SELECT id FROM item_types WHERE store_id = ? AND code = 'RAW_MATERIAL'`).get(store.id);
  const cashier = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1`).get(store.id);
  assert.ok(unit?.id && finishedType?.id && rawType?.id && cashier?.id);

  sqlite.prepare(`
    UPDATE products
    SET is_active = 1, stock_tracking_enabled = 1, item_type_id = ?, base_unit_id = ?, average_cost = 0
    WHERE store_id = ? AND id = ?
  `).run(finishedType.id, unit.id, store.id, output.id);
  sqlite.prepare(`
    UPDATE products
    SET is_active = 1, stock_tracking_enabled = 1, item_type_id = ?, base_unit_id = ?, average_cost = ?
    WHERE store_id = ? AND id = ?
  `).run(rawType.id, unit.id, OLD_MATERIAL_COST_SCALED, store.id, material.id);
  sqlite.prepare(`INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, 0, CURRENT_TIMESTAMP)`)
    .run(store.id, output.id);
  sqlite.prepare(`INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, 100, CURRENT_TIMESTAMP)`)
    .run(store.id, material.id);

  const drawerId = 'drawer_temporal_production_test';
  sqlite.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES (?, ?, ?, 0, 'OPEN', '2026-08-20T08:00:00.000Z')
  `).run(drawerId, store.id, cashier.id);

  const recipeId = 'recipe_temporal_hpp_v1';
  sqlite.prepare(`
    INSERT INTO manufacturing_recipes (
      id, store_id, output_product_id, output_unit_id, output_quantity, revision,
      status, notes, created_by_role, created_by_id, created_at
    ) VALUES (?, ?, ?, ?, 2, 1, 'ACTIVE', 'Temporal HPP v1', 'ADMIN', 'admin_test', '2026-08-20T08:01:00.000Z')
  `).run(recipeId, store.id, output.id, unit.id);
  sqlite.prepare(`
    INSERT INTO manufacturing_recipe_components (
      id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order
    ) VALUES ('recipe_component_temporal_v1', ?, ?, ?, ?, 3, 10)
  `).run(recipeId, store.id, material.id, unit.id);

  return {
    storeId: store.id,
    drawerId,
    cashierId: cashier.id,
    outputProductId: Number(output.id),
    materialProductId: Number(material.id),
    unitId: unit.id,
    recipeId
  };
}

test('same inventory account produces no accounting movement', () => {
  const result = resolveProductionInventoryTransfer('inventory_all', [
    { inventoryAccountId: 'inventory_all', totalCostScaled: 12_000_000 },
    { inventoryAccountId: 'inventory_all', totalCostScaled: 8_000_000 }
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.accountingChange, 'NONE_SAME_INVENTORY_ACCOUNT');
  assert.equal(result.transferAmountScaled, 0);
  assert.deepEqual(result.journalLines, []);
});

test('different material inventory accounts transfer only the differing value into finished goods', () => {
  const result = resolveProductionInventoryTransfer('inventory_finished', [
    { inventoryAccountId: 'inventory_raw', totalCostScaled: 12_000_000 },
    { inventoryAccountId: 'inventory_raw', totalCostScaled: 8_000_000 },
    { inventoryAccountId: 'inventory_finished', totalCostScaled: 5_000_000 },
    { inventoryAccountId: 'inventory_packaging', totalCostScaled: 3_000_000 }
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.accountingChange, 'INVENTORY_ACCOUNT_TRANSFER');
  assert.equal(result.transferAmountScaled, 23_000_000);
  assert.deepEqual(result.journalLines, [
    { accountId: 'inventory_finished', side: 'DEBIT', amountScaled: 23_000_000, description: 'Persediaan hasil produksi' },
    { accountId: 'inventory_raw', side: 'CREDIT', amountScaled: 20_000_000, description: 'Persediaan bahan produksi' },
    { accountId: 'inventory_packaging', side: 'CREDIT', amountScaled: 3_000_000, description: 'Persediaan bahan produksi' }
  ]);
});

test('production execution snapshots actual facts without mutating Recipe Master', () => {
  assert.match(migration, /template_modified INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /output_product_kind_id TEXT/);
  assert.match(migration, /component_product_kind_id TEXT/);
  assert.match(warehouseProduction, /prepareManualProductionV2/);
  assert.match(warehouseProduction, /templateMatchesActual/);
  assert.match(warehouseProduction, /production_run_components/);
  assert.match(warehouseProduction, /PRODUCTION_INPUT/);
  assert.match(warehouseProduction, /PRODUCTION_OUTPUT/);
  assert.match(warehouseProduction, /hpp_total_scaled/);
  assert.match(warehouseProduction, /hpp_per_unit_scaled/);
  assert.match(warehouseProduction, /UPDATE products[\s\S]*average_cost/);
  assert.doesNotMatch(warehouseProduction, /UPDATE manufacturing_recipes/);
  assert.doesNotMatch(warehouseProduction, /UPDATE manufacturing_recipe_components/);
});

test('posted production HPP and exact recipe revision stay immutable after material cost changes', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const fixture = productionFixture(sqlite);
    const first = await prepareManualProductionV2(db, {
      storeId: fixture.storeId,
      drawerId: fixture.drawerId,
      cashierId: fixture.cashierId,
      outputProductId: fixture.outputProductId,
      recipeId: fixture.recipeId,
      outputQuantity: 2,
      components: [{ productId: fixture.materialProductId, quantity: 3 }],
      now: '2026-08-20T08:02:00.000Z'
    });
    assert.equal(first.ok, true);
    await db.batch(first.statements);

    const firstRunBeforeChange = sqlite.prepare(`
      SELECT recipe_id, recipe_revision, hpp_total_scaled, hpp_per_unit_scaled,
             typeof(hpp_total_scaled) AS total_type, typeof(hpp_per_unit_scaled) AS unit_type
      FROM production_runs
      WHERE id = ?
    `).get(first.run.id);
    const firstComponentBeforeChange = sqlite.prepare(`
      SELECT unit_cost_snapshot_scaled, total_cost_snapshot_scaled,
             typeof(unit_cost_snapshot_scaled) AS unit_type,
             typeof(total_cost_snapshot_scaled) AS total_type
      FROM production_run_components
      WHERE production_run_id = ? AND component_product_id = ?
    `).get(first.run.id, fixture.materialProductId);
    assert.deepEqual({ ...firstRunBeforeChange }, {
      recipe_id: fixture.recipeId,
      recipe_revision: 1,
      hpp_total_scaled: OLD_MATERIAL_COST_SCALED * 3,
      hpp_per_unit_scaled: 2_250_002,
      total_type: 'integer',
      unit_type: 'integer'
    });
    assert.deepEqual({ ...firstComponentBeforeChange }, {
      unit_cost_snapshot_scaled: OLD_MATERIAL_COST_SCALED,
      total_cost_snapshot_scaled: OLD_MATERIAL_COST_SCALED * 3,
      unit_type: 'integer',
      total_type: 'integer'
    });

    sqlite.prepare(`UPDATE products SET average_cost = ? WHERE store_id = ? AND id = ?`)
      .run(NEW_MATERIAL_COST_SCALED, fixture.storeId, fixture.materialProductId);
    sqlite.prepare(`UPDATE manufacturing_recipes SET status = 'ARCHIVED', archived_at = ? WHERE id = ?`)
      .run('2026-08-20T08:03:00.000Z', fixture.recipeId);
    const recipeV2Id = 'recipe_temporal_hpp_v2';
    sqlite.prepare(`
      INSERT INTO manufacturing_recipes (
        id, store_id, output_product_id, output_unit_id, output_quantity, revision,
        status, notes, created_by_role, created_by_id, created_at
      ) VALUES (?, ?, ?, ?, 2, 2, 'ACTIVE', 'Temporal HPP v2', 'ADMIN', 'admin_test', '2026-08-20T08:03:00.000Z')
    `).run(recipeV2Id, fixture.storeId, fixture.outputProductId, fixture.unitId);
    sqlite.prepare(`
      INSERT INTO manufacturing_recipe_components (
        id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order
      ) VALUES ('recipe_component_temporal_v2', ?, ?, ?, ?, 4, 10)
    `).run(recipeV2Id, fixture.storeId, fixture.materialProductId, fixture.unitId);

    const second = await prepareManualProductionV2(db, {
      storeId: fixture.storeId,
      drawerId: fixture.drawerId,
      cashierId: fixture.cashierId,
      outputProductId: fixture.outputProductId,
      recipeId: recipeV2Id,
      outputQuantity: 2,
      components: [{ productId: fixture.materialProductId, quantity: 4 }],
      now: '2026-08-20T08:04:00.000Z'
    });
    assert.equal(second.ok, true);
    await db.batch(second.statements);

    const firstRunAfterChange = sqlite.prepare(`
      SELECT recipe_id, recipe_revision, hpp_total_scaled, hpp_per_unit_scaled
      FROM production_runs
      WHERE id = ?
    `).get(first.run.id);
    assert.deepEqual({ ...firstRunAfterChange }, {
      recipe_id: fixture.recipeId,
      recipe_revision: 1,
      hpp_total_scaled: OLD_MATERIAL_COST_SCALED * 3,
      hpp_per_unit_scaled: 2_250_002
    });
    assert.deepEqual({ ...sqlite.prepare(`
      SELECT unit_cost_snapshot_scaled, total_cost_snapshot_scaled
      FROM production_run_components
      WHERE production_run_id = ? AND component_product_id = ?
    `).get(first.run.id, fixture.materialProductId) }, {
      unit_cost_snapshot_scaled: OLD_MATERIAL_COST_SCALED,
      total_cost_snapshot_scaled: OLD_MATERIAL_COST_SCALED * 3
    });

    const secondRun = sqlite.prepare(`
      SELECT recipe_id, recipe_revision, hpp_total_scaled, hpp_per_unit_scaled,
             typeof(hpp_total_scaled) AS total_type, typeof(hpp_per_unit_scaled) AS unit_type
      FROM production_runs
      WHERE id = ?
    `).get(second.run.id);
    assert.deepEqual({ ...secondRun }, {
      recipe_id: recipeV2Id,
      recipe_revision: 2,
      hpp_total_scaled: NEW_MATERIAL_COST_SCALED * 4,
      hpp_per_unit_scaled: 5_500_006,
      total_type: 'integer',
      unit_type: 'integer'
    });
    assert.deepEqual(sqlite.prepare(`
      SELECT recipe_id, quantity
      FROM manufacturing_recipe_components
      WHERE recipe_id IN (?, ?)
      ORDER BY recipe_id
    `).all(fixture.recipeId, recipeV2Id).map(row => ({ ...row })), [
      { recipe_id: fixture.recipeId, quantity: 3 },
      { recipe_id: recipeV2Id, quantity: 4 }
    ]);
  } finally {
    sqlite.close();
  }
});

test('cashier Production Panel V2 is editable and dynamically adds material rows', () => {
  assert.match(cashierHtml, /cashier-production-v2\.css/);
  assert.match(cashierHtml, /cashier-production-v2\.js/);
  assert.match(productionUi, /Hasil produksi/);
  assert.match(productionUi, /Qty hasil/);
  assert.match(productionUi, /Recipe \/ BOM acuan/);
  assert.match(productionUi, /Bahan baku aktual/);
  assert.match(productionUi, /Tambah bahan/);
  assert.match(productionUi, /componentDraft\.push/);
  assert.match(productionUi, /componentDraft\.splice/);
  assert.match(productionUi, /tidak mengubah Master Recipe/);
  assert.match(productionUi, /outputQuantity, recipeId, components/);
});

test('production commit dispatches Warehouse accounting bridge after stock batch', () => {
  assert.match(cashierProduction, /await env\.DB\.batch\(prepared\.statements\)/);
  assert.match(cashierProduction, /dispatchWarehouseProductionAccountingFact/);
  assert.match(accountingBridge, /producer_module = 'WAREHOUSE'/);
  assert.match(accountingBridge, /fact_type = 'PRODUCTION'/);
  assert.match(accountingBridge, /code = 'wh_production'/);
  assert.match(accountingBridge, /sourceSystem: 'LEKER_WAREHOUSE'/);
  assert.match(accountingBridge, /postAccountingJournal/);
});

test('deployment schema gate requires Production V2 snapshot columns', () => {
  const readyPayload = [{ results: [
    { name: 'production_runs', sql: 'CREATE TABLE production_runs (template_modified INTEGER, output_product_kind_id TEXT, output_product_kind_code TEXT, output_product_kind_name TEXT)' },
    { name: 'production_run_components', sql: 'CREATE TABLE production_run_components (component_product_kind_id TEXT, component_product_kind_code TEXT, component_product_kind_name TEXT)' }
  ] }];
  assert.deepEqual(missingRequiredColumns(readyPayload), []);

  const stalePayload = [{ results: [
    { name: 'production_runs', sql: 'CREATE TABLE production_runs (template_modified INTEGER)' },
    { name: 'production_run_components', sql: 'CREATE TABLE production_run_components (component_product_kind_id TEXT)' }
  ] }];
  assert.deepEqual(missingRequiredColumns(stalePayload), [
    'production_runs.output_product_kind_id',
    'production_runs.output_product_kind_code',
    'production_runs.output_product_kind_name',
    'production_run_components.component_product_kind_code',
    'production_run_components.component_product_kind_name'
  ]);
});
