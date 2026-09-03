import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { prepareSaleStockProduction } from '../src/stock-production.js';
import { validateDirectLines } from '../src/cashier-sales-tracking.js';

const cashierUi = readFileSync(new URL('../public/cashier.js', import.meta.url), 'utf8');
const cashierSalesOrdersUi = readFileSync(new URL('../public/cashier-sales-orders.js', import.meta.url), 'utf8');
const cashierPimasatuAdapters = readFileSync(new URL('../public/cashier-pimasatu-adapters.js', import.meta.url), 'utf8');
const dbMultistore = readFileSync(new URL('../src/db-multistore.js', import.meta.url), 'utf8');

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(sqlite, sql, params = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) { return new D1Statement(this.sqlite, this.sql, params); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.params) ?? null; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.params) }; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class D1Database {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new D1Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

// Builds a finished good linked to a recipe (1 unit output -> 2 units of a
// component, e.g. Es Teh Poci Jasmine <- Larutan Jasmine) out of two existing
// G001 seed products, so the recipe-link/Dadakan-default machinery under test
// runs against real schema shapes rather than a hand-rolled fixture.
function recipeLinkedFixture(sqlite) {
  const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001' LIMIT 1`).get();
  const [output, component] = sqlite.prepare(`
    SELECT p.id, p.base_unit_id FROM products p
    WHERE p.store_id = ? AND p.base_unit_id IS NOT NULL
    ORDER BY p.id LIMIT 2
  `).all(store.id);
  assert.ok(output && component && output.id !== component.id, 'G001 needs at least 2 seed products with a base unit');
  const cashier = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1`).get(store.id);

  sqlite.prepare(`UPDATE products SET is_active = 1, stock_tracking_enabled = 1 WHERE id = ? AND store_id = ?`)
    .run(component.id, store.id);
  sqlite.prepare(`
    INSERT INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
    VALUES (?, ?, 100, '2026-09-03T00:00:00.000Z')
    ON CONFLICT(store_id, product_id) DO UPDATE SET quantity = 100
  `).run(store.id, component.id);
  // Some pre-made finished-good stock too, so a Biasa (STOCK) sale of the
  // recipe-linked output product has something to sell from.
  sqlite.prepare(`
    INSERT INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
    VALUES (?, ?, 20, '2026-09-03T00:00:00.000Z')
    ON CONFLICT(store_id, product_id) DO UPDATE SET quantity = 20
  `).run(store.id, output.id);

  const recipeId = `recipe_sale_line_mode_${output.id}`;
  sqlite.prepare(`
    INSERT INTO manufacturing_recipes (id, store_id, output_product_id, output_unit_id, output_quantity, revision, status, created_at)
    VALUES (?, ?, ?, ?, 1, 1, 'ACTIVE', '2026-09-03T00:00:00.000Z')
  `).run(recipeId, store.id, output.id, output.base_unit_id);
  sqlite.prepare(`
    INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity)
    VALUES (?, ?, ?, ?, ?, 2)
  `).run(`recipe_component_${output.id}`, recipeId, store.id, component.id, component.base_unit_id);

  sqlite.prepare(`
    UPDATE products SET is_active = 1, linked_recipe_id = ?, recipe_link_enabled = 1, stock_tracking_enabled = 1
    WHERE id = ? AND store_id = ?
  `).run(recipeId, output.id, store.id);

  const drawerId = `drawer_sale_line_mode_${output.id}`;
  sqlite.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES (?, ?, ?, 0, 'OPEN', '2026-09-03T00:00:00.000Z')
  `).run(drawerId, store.id, cashier.id);

  return { storeId: store.id, drawerId, cashierId: cashier.id, outputProductId: Number(output.id), componentProductId: Number(component.id) };
}

test('a recipe-linked sale line defaults to Dadakan (no explicit mode) and auto-produces from the linked recipe', async () => {
  const sqlite = freshDatabase();
  try {
    const fixture = recipeLinkedFixture(sqlite);
    const db = new D1Database(sqlite);
    const lines = [{ productId: fixture.outputProductId, productName: 'Es Teh Poci Jasmine', unitPrice: 8000, quantity: 3, lineTotal: 24000, note: '' }];
    sqlite.prepare(`
      INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, customer_name, total_amount, created_at)
      VALUES ('sale_default_dadakan', ?, ?, ?, 'Budi', 24000, '2026-09-03T01:00:00.000Z')
    `).run(fixture.storeId, fixture.drawerId, fixture.cashierId);

    const result = await prepareSaleStockProduction(db, {
      storeId: fixture.storeId, drawerId: fixture.drawerId, cashierId: fixture.cashierId,
      saleId: 'sale_default_dadakan', lines, now: '2026-09-03T01:00:00.000Z'
    });
    assert.equal(result.ok, true);
    assert.equal(result.lines[0].productionMode, 'DADAKAN');
    assert.ok(result.lines[0].recipeId, 'expected a production run to be attached');
    assert.ok(result.lines[0].productionRunId);

    await db.batch(result.statements);
    const componentBalance = sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`)
      .get(fixture.storeId, fixture.componentProductId);
    // 3 units sold, recipe yields 1/batch -> 3 batches * 2 units/batch = 6 consumed from 100.
    assert.equal(componentBalance.quantity, 94);
    const run = sqlite.prepare(`SELECT status FROM production_runs WHERE store_id = ? AND drawer_session_id = ?`).get(fixture.storeId, fixture.drawerId);
    assert.equal(run.status, 'POSTED');
  } finally {
    sqlite.close();
  }
});

test('the same recipe-linked line sold Biasa (STOCK) skips auto-production and only touches its own tracked stock', async () => {
  const sqlite = freshDatabase();
  try {
    const fixture = recipeLinkedFixture(sqlite);
    const db = new D1Database(sqlite);
    const lines = [{
      productId: fixture.outputProductId, productName: 'Es Teh Poci Jasmine', unitPrice: 8000, quantity: 2, lineTotal: 16000, note: '',
      productionMode: 'STOCK'
    }];

    const result = await prepareSaleStockProduction(db, {
      storeId: fixture.storeId, drawerId: fixture.drawerId, cashierId: fixture.cashierId,
      saleId: 'sale_explicit_biasa', lines, now: '2026-09-03T02:00:00.000Z'
    });
    assert.equal(result.ok, true);
    assert.equal(result.lines[0].productionMode, 'STOCK');
    assert.equal(result.lines[0].recipeId, null);
    assert.equal(result.lines[0].productionRunId, null);

    await db.batch(result.statements);
    const componentBalance = sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`)
      .get(fixture.storeId, fixture.componentProductId);
    assert.equal(componentBalance.quantity, 100, 'Biasa fulfillment must never touch the linked recipe component stock');
    const outputBalance = sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`)
      .get(fixture.storeId, fixture.outputProductId);
    assert.equal(outputBalance.quantity, 18, 'Biasa fulfillment sells from the finished good\'s own pre-made stock');
    const runCount = sqlite.prepare(`SELECT COUNT(*) AS n FROM production_runs WHERE store_id = ? AND drawer_session_id = ?`).get(fixture.storeId, fixture.drawerId).n;
    assert.equal(runCount, 0);
  } finally {
    sqlite.close();
  }
});

test('requesting Dadakan for a product with no recipe link is rejected with a clear error', async () => {
  const sqlite = freshDatabase();
  try {
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001' LIMIT 1`).get();
    const product = sqlite.prepare(`SELECT id FROM products WHERE store_id = ? AND linked_recipe_id IS NULL ORDER BY id LIMIT 1`).get(store.id);
    const cashier = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1`).get(store.id);
    const drawerId = 'drawer_no_recipe_dadakan';
    sqlite.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES (?, ?, ?, 0, 'OPEN', '2026-09-03T00:00:00.000Z')
    `).run(drawerId, store.id, cashier.id);
    const db = new D1Database(sqlite);
    const lines = [{ productId: Number(product.id), productName: 'X', unitPrice: 1000, quantity: 1, lineTotal: 1000, note: '', productionMode: 'DADAKAN' }];

    const result = await prepareSaleStockProduction(db, {
      storeId: store.id, drawerId, cashierId: cashier.id, saleId: 'sale_bad_dadakan', lines, now: '2026-09-03T03:00:00.000Z'
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.match(result.error, /belum terhubung ke resep aktif/);
  } finally {
    sqlite.close();
  }
});

test('validateDirectLines threads the requested per-line productionMode from the HTTP body through to lines[]', () => {
  const products = [{ id: 1, name: 'Es Teh Poci Jasmine', price: 8000 }];
  const dadakan = validateDirectLines(products, [{ productId: 1, quantity: 2, productionMode: 'dadakan' }]);
  assert.equal(dadakan.ok, true);
  assert.equal(dadakan.lines[0].productionMode, 'DADAKAN');

  const biasa = validateDirectLines(products, [{ productId: 1, quantity: 2, productionMode: 'STOCK' }]);
  assert.equal(biasa.lines[0].productionMode, 'STOCK');

  const unspecified = validateDirectLines(products, [{ productId: 1, quantity: 2 }]);
  assert.equal(unspecified.lines[0].productionMode, null, 'no explicit mode -> prepareSaleStockProduction decides the default');

  const garbage = validateDirectLines(products, [{ productId: 1, quantity: 2, productionMode: 'sekali-sekali' }]);
  assert.equal(garbage.lines[0].productionMode, null, 'an unrecognized value is ignored, not trusted verbatim');
});

test('kasir menu carries recipeLinkEnabled and the Biasa/Dadakan toggle + productionMode are wired through both draft UIs', () => {
  assert.match(dbMultistore, /recipeLinkEnabled: Boolean\(row\.has_recipe_link\)/);

  assert.match(cashierUi, /function defaultProductionMode\(product\)/);
  assert.match(cashierUi, /function toggleDraftProductionMode\(productId\)/);
  assert.match(cashierUi, /function draftModeToggleHtml\(line\)/);
  assert.match(cashierUi, /data-draft-mode="\$\{line\.product\.id\}"/);
  assert.match(cashierUi, /productionMode: line\.productionMode/);

  assert.match(cashierSalesOrdersUi, /draftModeToggleHtml\(line\)/);
  assert.match(cashierSalesOrdersUi, /toggleDraftProductionMode\(Number\(button\.dataset\.draftMode\)\)/);
  assert.match(cashierSalesOrdersUi, /productionMode: line\.productionMode/);
  assert.match(cashierSalesOrdersUi, /productionMode: defaultProductionMode\(product\)/);

  assert.match(cashierPimasatuAdapters, /productionMode: current\?\.productionMode \?\? defaultProductionMode\(line\.item\)/);
});

// Pendem's real Dadakan recipes have 5-7 components in one recipe (larutan +
// cup + sedotan + lid + flavor powder), not just 1 -- this mirrors that shape
// to make sure the multi-component loop in productionRunStatements/
// loadRecipeComponents has no per-component-count edge case.
function multiComponentFixture(sqlite) {
  const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001' LIMIT 1`).get();
  const products = sqlite.prepare(`
    SELECT p.id, p.base_unit_id FROM products p
    WHERE p.store_id = ? AND p.base_unit_id IS NOT NULL
    ORDER BY p.id LIMIT 5
  `).all(store.id);
  assert.equal(products.length, 5, 'G001 needs at least 5 seed products with a base unit');
  const [output, ...components] = products;
  const cashier = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1`).get(store.id);

  for (const component of components) {
    sqlite.prepare(`UPDATE products SET is_active = 1, stock_tracking_enabled = 1 WHERE id = ? AND store_id = ?`)
      .run(component.id, store.id);
    sqlite.prepare(`
      INSERT INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
      VALUES (?, ?, 10000, '2026-09-03T00:00:00.000Z')
      ON CONFLICT(store_id, product_id) DO UPDATE SET quantity = 10000
    `).run(store.id, component.id);
  }

  const recipeId = `recipe_multi_component_${output.id}`;
  sqlite.prepare(`
    INSERT INTO manufacturing_recipes (id, store_id, output_product_id, output_unit_id, output_quantity, revision, status, created_at)
    VALUES (?, ?, ?, ?, 1, 1, 'ACTIVE', '2026-09-03T00:00:00.000Z')
  `).run(recipeId, store.id, output.id, output.base_unit_id);
  components.forEach((component, index) => {
    sqlite.prepare(`
      INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(`recipe_component_multi_${output.id}_${component.id}`, recipeId, store.id, component.id, component.base_unit_id, index + 1, index);
  });

  sqlite.prepare(`
    UPDATE products SET is_active = 1, linked_recipe_id = ?, recipe_link_enabled = 1, stock_tracking_enabled = 1
    WHERE id = ? AND store_id = ?
  `).run(recipeId, output.id, store.id);

  const drawerId = `drawer_multi_component_${output.id}`;
  sqlite.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES (?, ?, ?, 0, 'OPEN', '2026-09-03T00:00:00.000Z')
  `).run(drawerId, store.id, cashier.id);

  return { storeId: store.id, drawerId, cashierId: cashier.id, outputProductId: Number(output.id), componentIds: components.map(c => Number(c.id)) };
}

test('a Dadakan recipe with several components (Pendem-shaped: cup + sedotan + lid + larutan + bubuk) consumes every one of them correctly', async () => {
  const sqlite = freshDatabase();
  try {
    const fixture = multiComponentFixture(sqlite);
    const db = new D1Database(sqlite);
    const lines = [{ productId: fixture.outputProductId, productName: 'Es Teh Poci Jasmine', unitPrice: 8000, quantity: 4, lineTotal: 32000, note: '' }];
    sqlite.prepare(`
      INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, customer_name, total_amount, created_at)
      VALUES ('sale_multi_component', ?, ?, ?, 'Budi', 32000, '2026-09-03T01:00:00.000Z')
    `).run(fixture.storeId, fixture.drawerId, fixture.cashierId);

    const result = await prepareSaleStockProduction(db, {
      storeId: fixture.storeId, drawerId: fixture.drawerId, cashierId: fixture.cashierId,
      saleId: 'sale_multi_component', lines, now: '2026-09-03T01:00:00.000Z'
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.lines[0].productionMode, 'DADAKAN');

    await db.batch(result.statements);
    for (const componentId of fixture.componentIds) {
      const balance = sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`)
        .get(fixture.storeId, componentId);
      // batches = ceil(4 qty sold / 1 output per batch) = 4; each component's
      // quantity-per-batch is its own index+1 (1,2,3,4) -- every one of the 4
      // components must be consumed by exactly 4x its per-batch amount.
      const perBatch = fixture.componentIds.indexOf(componentId) + 1;
      assert.equal(balance.quantity, 10000 - 4 * perBatch);
    }
    const componentMovements = sqlite.prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE store_id = ? AND source_type = 'PRODUCTION_INPUT'`).get(fixture.storeId).n;
    assert.equal(componentMovements, fixture.componentIds.length);
  } finally {
    sqlite.close();
  }
});
