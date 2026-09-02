import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { listPurchaseOptions, purchaseItemStatements } from '../src/cashier-purchase.js';
import { prepareSaleStockProduction } from '../src/stock-production.js';
import { listManualProductionOptionsV2, prepareManualProductionV2 } from '../src/warehouse-production.js';
import {
  buildOperationalPostingStatements,
  listStockAdjustmentOptions,
  normalizeApprovalPayload
} from '../src/operational-posting.js';

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

function activeProductFixture(sqlite, suffix) {
  const product = sqlite.prepare(`
    SELECT p.id, p.store_id, p.name, p.base_unit_id, u.symbol AS unit_symbol
    FROM products p
    JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    WHERE p.store_id = 'store_001'
    ORDER BY p.id
    LIMIT 1
  `).get();
  const cashier = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1`).get(product?.store_id);
  assert.ok(product?.id && product?.base_unit_id && cashier?.id, 'G001 product and cashier fixture must exist');

  const itemTypeId = `item_type_warehouse_${suffix}`;
  sqlite.prepare(`
    INSERT INTO item_types (
      id, store_id, code, name, can_sell, can_purchase, can_produce, can_consume, track_stock, is_active
    ) VALUES (?, ?, ?, ?, 1, 1, 1, 1, 0, 1)
  `).run(itemTypeId, product.store_id, `WAREHOUSE_${suffix.toUpperCase()}`, `Warehouse ${suffix}`);
  sqlite.prepare(`
    UPDATE products
    SET is_active = 1, item_type_id = ?, stock_tracking_enabled = 0,
        production_mode = 'STOCK', linked_recipe_id = NULL,
        points_per_unit = 5, average_cost = 100000000
    WHERE id = ? AND store_id = ?
  `).run(itemTypeId, product.id, product.store_id);
  sqlite.prepare(`
    INSERT INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
    VALUES (?, ?, 0, '2026-08-21T00:00:00.000Z')
    ON CONFLICT(store_id, product_id) DO UPDATE SET quantity = 0
  `).run(product.store_id, product.id);

  const drawerId = `drawer_warehouse_${suffix}`;
  sqlite.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES (?, ?, ?, 0, 'OPEN', '2026-08-21T00:00:00.000Z')
  `).run(drawerId, product.store_id, cashier.id);
  return {
    ...product,
    productId: Number(product.id),
    cashierId: cashier.id,
    drawerId,
    itemTypeId
  };
}

function insertPurchaseHeader(sqlite, fixture, purchaseId, totalAmount) {
  sqlite.prepare(`
    INSERT INTO purchases (
      id, store_id, drawer_session_id, cashier_id, supplier_id,
      description, total_amount, note, created_at, payment_method
    ) VALUES (?, ?, ?, ?, NULL, 'Warehouse toggle test', ?, '', '2026-08-21T01:00:00.000Z', 'CASH')
  `).run(purchaseId, fixture.store_id, fixture.drawerId, fixture.cashierId, totalAmount);
}

function insertApproval(sqlite, fixture, requestId, payload) {
  sqlite.prepare(`
    INSERT INTO approval_requests (
      id, store_id, drawer_session_id, cashier_id, request_type,
      approval_status, posting_status, payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'GOODS_FLOW', 'pending_approval', 'unposted', ?,
              '2026-08-21T05:00:00.000Z', '2026-08-21T05:00:00.000Z')
  `).run(requestId, fixture.store_id, fixture.drawerId, fixture.cashierId, JSON.stringify(payload));
}

function operationalRequest(fixture, id, payload) {
  return {
    id,
    storeId: fixture.store_id,
    drawerSessionId: fixture.drawerId,
    requestType: 'GOODS_FLOW',
    payload
  };
}

test('warehouse_enabled defaults on for existing and new stores and only accepts 0/1', () => {
  const sqlite = freshDatabase();
  try {
    const column = sqlite.prepare(`PRAGMA table_info(stores)`).all().find(row => row.name === 'warehouse_enabled');
    assert.equal(String(column?.type).toUpperCase(), 'INTEGER');
    assert.equal(Number(column?.notnull), 1);
    assert.equal(String(column?.dflt_value), '1');
    // Scoped to Leker's own original gerai, not "every row in the table": a
    // tenant onboarded later (e.g. a LITE-edition store) may legitimately set
    // warehouse_enabled=0 explicitly. That is a deliberate choice per store,
    // not a broken default -- the default itself is proven below by inserting
    // a store that omits the column entirely.
    assert.deepEqual(
      sqlite.prepare(`SELECT DISTINCT warehouse_enabled FROM stores WHERE code IN ('G001', 'G002', 'M002')`)
        .all().map(row => Number(row.warehouse_enabled)),
      [1]
    );

    sqlite.prepare(`INSERT INTO stores (id, code, store_name) VALUES ('store_toggle_default', 'TOGGLE', 'Toggle Default')`).run();
    assert.equal(
      sqlite.prepare(`SELECT warehouse_enabled FROM stores WHERE id = 'store_toggle_default'`).get().warehouse_enabled,
      1
    );
    assert.throws(
      () => sqlite.prepare(`UPDATE stores SET warehouse_enabled = 2 WHERE id = 'store_toggle_default'`).run(),
      /CHECK constraint failed/i
    );
  } finally {
    sqlite.close();
  }
});

test('Warehouse off lets Sale succeed at zero untracked stock; Warehouse on keeps the insufficient-stock guard', async () => {
  const sqlite = freshDatabase();
  try {
    const fixture = activeProductFixture(sqlite, 'sale');
    const db = new D1Database(sqlite);
    const lines = [{
      productId: fixture.productId,
      productName: fixture.name,
      unitPrice: 12000,
      quantity: 3,
      lineTotal: 36000,
      note: ''
    }];

    sqlite.prepare(`UPDATE stores SET warehouse_enabled = 0 WHERE id = ?`).run(fixture.store_id);
    const disabled = await prepareSaleStockProduction(db, {
      storeId: fixture.store_id,
      drawerId: fixture.drawerId,
      cashierId: fixture.cashierId,
      saleId: 'sale_warehouse_disabled',
      lines,
      now: '2026-08-21T02:00:00.000Z'
    });
    assert.equal(disabled.ok, true);
    assert.equal(disabled.totalPoints, 15);
    assert.equal(disabled.statements.length, 0);
    assert.deepEqual(
      disabled.lines.map(line => ({ pointsPerUnit: line.pointsPerUnit, linePoints: line.linePoints })),
      [{ pointsPerUnit: 5, linePoints: 15 }]
    );

    sqlite.prepare(`UPDATE stores SET warehouse_enabled = 1 WHERE id = ?`).run(fixture.store_id);
    sqlite.prepare(`UPDATE item_types SET track_stock = 1 WHERE id = ?`).run(fixture.itemTypeId);
    sqlite.prepare(`UPDATE products SET stock_tracking_enabled = 1 WHERE id = ? AND store_id = ?`)
      .run(fixture.productId, fixture.store_id);
    const enabled = await prepareSaleStockProduction(db, {
      storeId: fixture.store_id,
      drawerId: fixture.drawerId,
      cashierId: fixture.cashierId,
      saleId: 'sale_warehouse_enabled',
      lines,
      now: '2026-08-21T02:01:00.000Z'
    });
    assert.equal(enabled.ok, true);
    assert.equal(enabled.statements.length, 3);
    await assert.rejects(() => db.batch(enabled.statements), /CHECK constraint failed/i);
    assert.equal(
      sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`)
        .get(fixture.store_id, fixture.productId).quantity,
      0
    );
  } finally {
    sqlite.close();
  }
});

test('Warehouse off lets Purchase select untracked goods without changing its weighted HPP formula', async () => {
  const sqlite = freshDatabase();
  try {
    const fixture = activeProductFixture(sqlite, 'purchase_off');
    const db = new D1Database(sqlite);
    sqlite.prepare(`UPDATE stores SET warehouse_enabled = 0 WHERE id = ?`).run(fixture.store_id);
    sqlite.prepare(`UPDATE inventory_stock_balances SET quantity = 7 WHERE store_id = ? AND product_id = ?`)
      .run(fixture.store_id, fixture.productId);

    const option = (await listPurchaseOptions(db, fixture.store_id)).find(item => item.productId === fixture.productId);
    assert.ok(option, 'active purchasable product must stay selectable when Warehouse is off');
    insertPurchaseHeader(sqlite, fixture, 'purchase_warehouse_disabled', 900);
    const movementCountBefore = Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM stock_movements`).get().count);
    const statements = purchaseItemStatements(db, {
      purchaseId: 'purchase_warehouse_disabled',
      storeId: fixture.store_id,
      drawerId: fixture.drawerId,
      cashierId: fixture.cashierId,
      item: { ...option, quantity: 3, lineTotal: 900, unitCostScaled: 300000000 },
      now: '2026-08-21T03:00:00.000Z',
      warehouseEnabled: false
    });
    assert.equal(statements.length, 3);
    await db.batch(statements);

    const purchaseItem = sqlite.prepare(`
      SELECT average_cost_before, average_cost_after, unit_cost
      FROM purchase_items WHERE purchase_id = ? AND product_id = ?
    `).get('purchase_warehouse_disabled', fixture.productId);
    assert.deepEqual({ ...purchaseItem }, {
      average_cost_before: 100000000,
      average_cost_after: 160000000,
      unit_cost: 300000000
    });
    assert.equal(sqlite.prepare(`SELECT average_cost FROM products WHERE id = ?`).get(fixture.productId).average_cost, 160000000);
    assert.deepEqual({ ...sqlite.prepare(`
      SELECT previous_average_cost_scaled, new_average_cost_scaled, change_reason, reference_id
      FROM product_average_cost_history WHERE product_id = ?
    `).get(fixture.productId) }, {
      previous_average_cost_scaled: 100000000,
      new_average_cost_scaled: 160000000,
      change_reason: 'PURCHASE',
      reference_id: 'purchase_warehouse_disabled'
    });
    assert.equal(
      sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`)
        .get(fixture.store_id, fixture.productId).quantity,
      7
    );
    assert.equal(Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM stock_movements`).get().count), movementCountBefore);
  } finally {
    sqlite.close();
  }
});

test('Warehouse on keeps Purchase stock tracking and weighted-average behavior unchanged', async () => {
  const sqlite = freshDatabase();
  try {
    const fixture = activeProductFixture(sqlite, 'purchase_on');
    const db = new D1Database(sqlite);
    sqlite.prepare(`UPDATE item_types SET track_stock = 1 WHERE id = ?`).run(fixture.itemTypeId);
    sqlite.prepare(`UPDATE products SET stock_tracking_enabled = 1 WHERE id = ? AND store_id = ?`)
      .run(fixture.productId, fixture.store_id);
    sqlite.prepare(`UPDATE inventory_stock_balances SET quantity = 7 WHERE store_id = ? AND product_id = ?`)
      .run(fixture.store_id, fixture.productId);

    const option = (await listPurchaseOptions(db, fixture.store_id)).find(item => item.productId === fixture.productId);
    assert.ok(option);
    insertPurchaseHeader(sqlite, fixture, 'purchase_warehouse_enabled', 900);
    const statements = purchaseItemStatements(db, {
      purchaseId: 'purchase_warehouse_enabled',
      storeId: fixture.store_id,
      drawerId: fixture.drawerId,
      cashierId: fixture.cashierId,
      item: { ...option, quantity: 3, lineTotal: 900, unitCostScaled: 300000000 },
      now: '2026-08-21T03:01:00.000Z',
      warehouseEnabled: true
    });
    assert.equal(statements.length, 6);
    await db.batch(statements);

    assert.equal(sqlite.prepare(`SELECT average_cost FROM products WHERE id = ?`).get(fixture.productId).average_cost, 160000000);
    assert.equal(
      sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`)
        .get(fixture.store_id, fixture.productId).quantity,
      10
    );
    const movement = sqlite.prepare(`SELECT direction, quantity, source_type FROM stock_movements WHERE source_id = ?`)
      .get('purchase_warehouse_enabled');
    assert.deepEqual({ ...movement }, { direction: 'IN', quantity: 3, source_type: 'PURCHASE' });
  } finally {
    sqlite.close();
  }
});

test('Warehouse off lets Production run at zero untracked stock; Warehouse on keeps tracking and stock guards', async () => {
  const sqlite = freshDatabase();
  try {
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001' LIMIT 1`).get();
    const products = sqlite.prepare(`
      SELECT id, name, base_unit_id
      FROM products
      WHERE store_id = ? AND base_unit_id IS NOT NULL
      ORDER BY id
      LIMIT 2
    `).all(store?.id);
    const cashier = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1`).get(store?.id);
    assert.equal(products.length, 2);
    assert.ok(cashier?.id);
    const [output, material] = products;

    sqlite.prepare(`
      INSERT INTO item_types (id, store_id, code, name, can_sell, can_purchase, can_produce, can_consume, track_stock, is_active)
      VALUES ('item_type_warehouse_output', ?, 'WAREHOUSE_OUTPUT', 'Warehouse Output', 1, 1, 1, 0, 0, 1)
    `).run(store.id);
    sqlite.prepare(`
      INSERT INTO item_types (id, store_id, code, name, can_sell, can_purchase, can_produce, can_consume, track_stock, is_active)
      VALUES ('item_type_warehouse_material', ?, 'WAREHOUSE_MATERIAL', 'Warehouse Material', 0, 1, 0, 1, 0, 1)
    `).run(store.id);
    sqlite.prepare(`
      UPDATE products SET is_active = 1, item_type_id = 'item_type_warehouse_output', stock_tracking_enabled = 0, average_cost = 0
      WHERE store_id = ? AND id = ?
    `).run(store.id, output.id);
    sqlite.prepare(`
      UPDATE products SET is_active = 1, item_type_id = 'item_type_warehouse_material', stock_tracking_enabled = 0, average_cost = 1500000
      WHERE store_id = ? AND id = ?
    `).run(store.id, material.id);
    for (const product of [output, material]) {
      sqlite.prepare(`
        INSERT INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
        VALUES (?, ?, 0, '2026-08-21T04:00:00.000Z')
        ON CONFLICT(store_id, product_id) DO UPDATE SET quantity = 0
      `).run(store.id, product.id);
    }
    sqlite.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES ('drawer_warehouse_production', ?, ?, 0, 'OPEN', '2026-08-21T04:00:00.000Z')
    `).run(store.id, cashier.id);
    sqlite.prepare(`
      UPDATE manufacturing_recipes
      SET status = 'ARCHIVED', archived_at = '2026-08-21T03:59:00.000Z'
      WHERE store_id = ? AND output_product_id = ? AND status = 'ACTIVE'
    `).run(store.id, output.id);
    const nextRevision = Number(sqlite.prepare(`
      SELECT COALESCE(MAX(revision), 0) + 1 AS revision
      FROM manufacturing_recipes WHERE store_id = ? AND output_product_id = ?
    `).get(store.id, output.id).revision);
    sqlite.prepare(`
      INSERT INTO manufacturing_recipes (
        id, store_id, output_product_id, output_unit_id, output_quantity, revision,
        status, notes, created_by_role, created_by_id, created_at
      ) VALUES ('recipe_warehouse_toggle', ?, ?, ?, 2, ?, 'ACTIVE', '', 'ADMIN', 'admin_test', '2026-08-21T04:00:00.000Z')
    `).run(store.id, output.id, output.base_unit_id, nextRevision);
    sqlite.prepare(`
      INSERT INTO manufacturing_recipe_components (
        id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order
      ) VALUES ('recipe_component_warehouse_toggle', 'recipe_warehouse_toggle', ?, ?, ?, 3, 10)
    `).run(store.id, material.id, material.base_unit_id);

    const db = new D1Database(sqlite);
    sqlite.prepare(`UPDATE stores SET warehouse_enabled = 0 WHERE id = ?`).run(store.id);
    const disabledOptions = await listManualProductionOptionsV2(db, store.id);
    assert.ok(disabledOptions.products.some(product => product.productId === Number(output.id)));
    assert.ok(disabledOptions.materials.some(product => product.productId === Number(material.id)));
    const movementCountBefore = Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM stock_movements`).get().count);
    const disabled = await prepareManualProductionV2(db, {
      storeId: store.id,
      drawerId: 'drawer_warehouse_production',
      cashierId: cashier.id,
      outputProductId: Number(output.id),
      recipeId: 'recipe_warehouse_toggle',
      batches: 1,
      now: '2026-08-21T04:01:00.000Z'
    });
    assert.equal(disabled.ok, true);
    await db.batch(disabled.statements);
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS count FROM production_runs WHERE id = ?`).get(disabled.run.id).count, 1);
    assert.equal(Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM stock_movements`).get().count), movementCountBefore);
    for (const product of [output, material]) {
      assert.equal(
        sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`)
          .get(store.id, product.id).quantity,
        0
      );
    }

    sqlite.prepare(`UPDATE stores SET warehouse_enabled = 1 WHERE id = ?`).run(store.id);
    const enabledUntrackedOptions = await listManualProductionOptionsV2(db, store.id);
    assert.equal(enabledUntrackedOptions.products.some(product => product.productId === Number(output.id)), false);
    const enabledUntracked = await prepareManualProductionV2(db, {
      storeId: store.id,
      drawerId: 'drawer_warehouse_production',
      cashierId: cashier.id,
      outputProductId: Number(output.id),
      recipeId: 'recipe_warehouse_toggle',
      batches: 1,
      now: '2026-08-21T04:02:00.000Z'
    });
    assert.equal(enabledUntracked.ok, false);
    assert.equal(enabledUntracked.status, 409);

    sqlite.prepare(`UPDATE item_types SET track_stock = 1 WHERE id IN ('item_type_warehouse_output', 'item_type_warehouse_material')`).run();
    sqlite.prepare(`UPDATE products SET stock_tracking_enabled = 1 WHERE store_id = ? AND id IN (?, ?)`)
      .run(store.id, output.id, material.id);
    const enabled = await prepareManualProductionV2(db, {
      storeId: store.id,
      drawerId: 'drawer_warehouse_production',
      cashierId: cashier.id,
      outputProductId: Number(output.id),
      recipeId: 'recipe_warehouse_toggle',
      batches: 1,
      now: '2026-08-21T04:03:00.000Z'
    });
    assert.equal(enabled.ok, true);
    await assert.rejects(() => db.batch(enabled.statements), /CHECK constraint failed/i);
  } finally {
    sqlite.close();
  }
});

test('Warehouse off lets Operational posting succeed at zero untracked stock; Warehouse on keeps rejection', async () => {
  const sqlite = freshDatabase();
  try {
    const fixture = activeProductFixture(sqlite, 'operational');
    const db = new D1Database(sqlite);
    sqlite.prepare(`UPDATE stores SET warehouse_enabled = 0 WHERE id = ?`).run(fixture.store_id);

    const options = await listStockAdjustmentOptions(db, fixture.store_id);
    assert.ok(options.some(product => product.productId === fixture.productId));
    const adjustment = await normalizeApprovalPayload(db, fixture.store_id, 'GOODS_FLOW', {
      purpose: 'STOCK_ADJUSTMENT',
      productId: fixture.productId,
      targetQuantity: 5,
      reason: 'Hasil stok fisik'
    });
    assert.equal(adjustment.ok, true);
    assert.equal(adjustment.payload.warehouseEnabled, false);
    insertApproval(sqlite, fixture, 'approval_warehouse_adjustment', adjustment.payload);
    const adjustmentStatements = buildOperationalPostingStatements(
      db,
      operationalRequest(fixture, 'approval_warehouse_adjustment', adjustment.payload),
      { approverRole: 'ADMIN', approverId: 'admin_test', now: '2026-08-21T05:01:00.000Z' }
    );
    assert.equal(adjustmentStatements.length, 1);
    await db.batch(adjustmentStatements);

    const outbound = await normalizeApprovalPayload(db, fixture.store_id, 'GOODS_FLOW', {
      productId: fixture.productId,
      direction: 'OUT',
      quantity: 1,
      note: 'Barang keluar tanpa Warehouse'
    });
    assert.equal(outbound.ok, true);
    assert.equal(outbound.payload.warehouseEnabled, false);
    insertApproval(sqlite, fixture, 'approval_warehouse_out', outbound.payload);
    const outboundStatements = buildOperationalPostingStatements(
      db,
      operationalRequest(fixture, 'approval_warehouse_out', outbound.payload),
      { approverRole: 'ADMIN', approverId: 'admin_test', now: '2026-08-21T05:02:00.000Z' }
    );
    assert.equal(outboundStatements.length, 1);
    await db.batch(outboundStatements);
    assert.equal(
      sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`)
        .get(fixture.store_id, fixture.productId).quantity,
      0
    );
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS count FROM inventory_ledger_entries WHERE product_id = ?`).get(fixture.productId).count, 0);
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS count FROM stock_movements WHERE product_id = ?`).get(fixture.productId).count, 0);
    assert.deepEqual(
      { ...sqlite.prepare(`SELECT approval_status, posting_status FROM approval_requests WHERE id = ?`)
        .get('approval_warehouse_out') },
      { approval_status: 'approved', posting_status: 'posted' }
    );

    sqlite.prepare(`UPDATE stores SET warehouse_enabled = 1 WHERE id = ?`).run(fixture.store_id);
    assert.equal((await listStockAdjustmentOptions(db, fixture.store_id)).some(product => product.productId === fixture.productId), false);
    sqlite.prepare(`UPDATE products SET stock_tracking_enabled = 1 WHERE id = ? AND store_id = ?`)
      .run(fixture.productId, fixture.store_id);
    const enabledOutbound = await normalizeApprovalPayload(db, fixture.store_id, 'GOODS_FLOW', {
      productId: fixture.productId,
      direction: 'OUT',
      quantity: 1,
      note: 'Barang keluar dengan Warehouse'
    });
    assert.equal(enabledOutbound.ok, true);
    assert.equal(Object.hasOwn(enabledOutbound.payload, 'warehouseEnabled'), false);
    insertApproval(sqlite, fixture, 'approval_warehouse_out_enabled', enabledOutbound.payload);
    const enabledStatements = buildOperationalPostingStatements(
      db,
      operationalRequest(fixture, 'approval_warehouse_out_enabled', enabledOutbound.payload),
      { approverRole: 'ADMIN', approverId: 'admin_test', now: '2026-08-21T05:03:00.000Z' }
    );
    assert.equal(enabledStatements.length, 5);
    await assert.rejects(() => db.batch(enabledStatements), /CHECK constraint failed/i);
  } finally {
    sqlite.close();
  }
});
