import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  buildOperationalPostingStatements,
  listStockAdjustmentOptions,
  normalizeApprovalPayload
} from '../src/operational-posting.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const approvalApiSource = readFileSync(new URL('../src/approval-queue.js', import.meta.url), 'utf8');
const cashierUiSource = readFileSync(new URL('../public/cashier-approval-actions.js', import.meta.url), 'utf8');
const managementUiSource = readFileSync(new URL('../public/management-approval-queue.js', import.meta.url), 'utf8');
const contractV1Source = readFileSync(new URL('../contracts/stock-adjustment-v1.md', import.meta.url), 'utf8');
const contractV2Source = readFileSync(new URL('../contracts/stock-adjustment-v2.md', import.meta.url), 'utf8');
const OLD_COST_SCALED = 1_250_001;
const NEW_COST_SCALED = 2_750_003;

function d1(sqlite) {
  function prepared(sql) {
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
  }
  return {
    prepare: prepared,
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

function stockFixture(sqlite) {
  const store = sqlite.prepare(`SELECT id FROM stores ORDER BY id LIMIT 1`).get();
  assert.ok(store?.id);
  const product = sqlite.prepare(`
    SELECT id, name, base_unit_id
    FROM products
    WHERE store_id = ? AND base_unit_id IS NOT NULL
    ORDER BY id
    LIMIT 1
  `).get(store.id);
  assert.ok(product?.id);
  sqlite.prepare(`
    UPDATE products
    SET is_active = 1, stock_tracking_enabled = 1, average_cost = ?
    WHERE store_id = ? AND id = ?
  `).run(OLD_COST_SCALED, store.id, product.id);
  sqlite.prepare(`INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, 10, CURRENT_TIMESTAMP)`).run(store.id, product.id);
  return {
    storeId: store.id,
    productId: Number(product.id),
    productName: product.name,
    unitId: product.base_unit_id,
    averageCostScaled: OLD_COST_SCALED
  };
}

test('Stock Adjustment stages target semantics and snapshots current stock on the server', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const fixture = stockFixture(sqlite);
    const options = await listStockAdjustmentOptions(db, fixture.storeId);
    const option = options.find(item => item.productId === fixture.productId);
    assert.ok(option);
    assert.equal(option.currentQuantity, 10);

    const normalized = await normalizeApprovalPayload(db, fixture.storeId, 'GOODS_FLOW', {
      purpose: 'STOCK_ADJUSTMENT',
      productId: fixture.productId,
      targetQuantity: 7,
      reason: 'Hasil hitung fisik',
      note: 'Rak bahan'
    });
    assert.equal(normalized.ok, true);
    assert.deepEqual(normalized.payload, {
      purpose: 'STOCK_ADJUSTMENT',
      productId: fixture.productId,
      productName: fixture.productName,
      unitId: fixture.unitId,
      unitSymbol: option.unitSymbol,
      currentQuantitySnapshot: 10,
      targetQuantity: 7,
      direction: 'OUT',
      quantity: 3,
      unitCostSnapshotScaled: fixture.averageCostScaled,
      totalCostSnapshotScaled: fixture.averageCostScaled * 3,
      reason: 'Hasil hitung fisik',
      note: 'Rak bahan'
    });

    const withoutReason = await normalizeApprovalPayload(db, fixture.storeId, 'GOODS_FLOW', {
      purpose: 'STOCK_ADJUSTMENT', productId: fixture.productId, targetQuantity: 8
    });
    assert.equal(withoutReason.ok, true);
    assert.equal(withoutReason.payload.reason, '');

    const noOp = await normalizeApprovalPayload(db, fixture.storeId, 'GOODS_FLOW', {
      purpose: 'STOCK_ADJUSTMENT', productId: fixture.productId, targetQuantity: 10, reason: 'cek'
    });
    assert.equal(noOp.ok, false);
    assert.match(noOp.error, /tidak ada penyesuaian/i);

    const negative = await normalizeApprovalPayload(db, fixture.storeId, 'GOODS_FLOW', {
      purpose: 'STOCK_ADJUSTMENT', productId: fixture.productId, targetQuantity: -1, reason: 'cek'
    });
    assert.equal(negative.ok, false);

    sqlite.prepare(`UPDATE products SET average_cost = ? WHERE store_id = ? AND id = ?`)
      .run(Number.MAX_SAFE_INTEGER, fixture.storeId, fixture.productId);
    const costOverflow = await normalizeApprovalPayload(db, fixture.storeId, 'GOODS_FLOW', {
      purpose: 'STOCK_ADJUSTMENT', productId: fixture.productId, targetQuantity: 8, reason: 'cek overflow'
    });
    assert.equal(costOverflow.ok, false);
    assert.match(costOverflow.error, /integer aman/i);
  } finally {
    sqlite.close();
  }
});

test('Stock Adjustment keeps staged HPP immutable and a later request snapshots the new HPP', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const fixture = stockFixture(sqlite);
    const normalized = await normalizeApprovalPayload(db, fixture.storeId, 'GOODS_FLOW', {
      purpose: 'STOCK_ADJUSTMENT', productId: fixture.productId, targetQuantity: 7, reason: 'Hasil stok fisik'
    });
    assert.equal(normalized.ok, true);

    const cashier = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1`).get(fixture.storeId);
    assert.ok(cashier?.id);
    const drawerId = 'drawer_stock_adjustment_test';
    sqlite.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES (?, ?, ?, 0, 'OPEN', '2026-08-13T10:00:00.000Z')
    `).run(drawerId, fixture.storeId, cashier.id);

    const requestId = 'approval_stock_adjustment_test';
    sqlite.prepare(`
      INSERT INTO approval_requests (
        id, store_id, drawer_session_id, cashier_id, request_type,
        approval_status, posting_status, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'GOODS_FLOW', 'pending_approval', 'unposted', ?, '2026-08-13T10:01:00.000Z', '2026-08-13T10:01:00.000Z')
    `).run(requestId, fixture.storeId, drawerId, cashier.id, JSON.stringify(normalized.payload));

    sqlite.prepare(`UPDATE products SET average_cost = ? WHERE store_id = ? AND id = ?`)
      .run(NEW_COST_SCALED, fixture.storeId, fixture.productId);

    const request = {
      id: requestId,
      storeId: fixture.storeId,
      drawerSessionId: drawerId,
      requestType: 'GOODS_FLOW',
      payload: normalized.payload
    };
    await db.batch(buildOperationalPostingStatements(db, request, {
      approverRole: 'ADMIN', approverId: 'admin_test', now: '2026-08-13T10:02:00.000Z', note: 'ACC hitung fisik'
    }));

    const balance = sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`).get(fixture.storeId, fixture.productId);
    assert.equal(balance.quantity, 7);
    const movement = sqlite.prepare(`
      SELECT source_key, source_type, direction, quantity, note
      FROM stock_movements
      WHERE store_id = ? AND source_id = ?
    `).get(fixture.storeId, requestId);
    assert.equal(movement.source_type, 'STOCK_ADJUSTMENT');
    assert.equal(movement.source_key, `STOCK_ADJUSTMENT:${requestId}`);
    assert.equal(movement.direction, 'OUT');
    assert.equal(movement.quantity, 3);
    assert.match(movement.note, /10 -> 7/);
    assert.match(movement.note, /Hasil stok fisik/);

    const approval = sqlite.prepare(`SELECT approval_status, posting_status FROM approval_requests WHERE id = ?`).get(requestId);
    assert.equal(approval.approval_status, 'approved');
    assert.equal(approval.posting_status, 'posted');

    const persistedPayload = JSON.parse(sqlite.prepare(`SELECT payload_json FROM approval_requests WHERE id = ?`).get(requestId).payload_json);
    assert.equal(persistedPayload.unitCostSnapshotScaled, OLD_COST_SCALED);
    assert.equal(persistedPayload.totalCostSnapshotScaled, OLD_COST_SCALED * 3);

    const productAfterPosting = sqlite.prepare(`SELECT average_cost, typeof(average_cost) AS cost_type FROM products WHERE store_id = ? AND id = ?`)
      .get(fixture.storeId, fixture.productId);
    assert.equal(productAfterPosting.average_cost, NEW_COST_SCALED);
    assert.equal(productAfterPosting.cost_type, 'integer');

    const later = await normalizeApprovalPayload(db, fixture.storeId, 'GOODS_FLOW', {
      purpose: 'STOCK_ADJUSTMENT', productId: fixture.productId, targetQuantity: 8, reason: 'Hitung fisik berikutnya'
    });
    assert.equal(later.ok, true);
    assert.equal(later.payload.currentQuantitySnapshot, 7);
    assert.equal(later.payload.quantity, 1);
    assert.equal(later.payload.unitCostSnapshotScaled, NEW_COST_SCALED);
    assert.equal(later.payload.totalCostSnapshotScaled, NEW_COST_SCALED);

    const legacyRequestId = 'approval_stock_adjustment_legacy_v1';
    const legacyPayload = {
      purpose: 'STOCK_ADJUSTMENT',
      productId: fixture.productId,
      productName: fixture.productName,
      unitId: fixture.unitId,
      unitSymbol: normalized.payload.unitSymbol,
      currentQuantitySnapshot: 7,
      targetQuantity: 6,
      direction: 'OUT',
      quantity: 1,
      reason: 'Legacy V1',
      note: ''
    };
    sqlite.prepare(`
      INSERT INTO approval_requests (
        id, store_id, drawer_session_id, cashier_id, request_type,
        approval_status, posting_status, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'GOODS_FLOW', 'pending_approval', 'unposted', ?, '2026-08-13T10:03:00.000Z', '2026-08-13T10:03:00.000Z')
    `).run(legacyRequestId, fixture.storeId, drawerId, cashier.id, JSON.stringify(legacyPayload));
    await db.batch(buildOperationalPostingStatements(db, {
      id: legacyRequestId,
      storeId: fixture.storeId,
      drawerSessionId: drawerId,
      requestType: 'GOODS_FLOW',
      payload: legacyPayload
    }, {
      approverRole: 'ADMIN', approverId: 'admin_test', now: '2026-08-13T10:04:00.000Z', note: 'ACC legacy'
    }));
    assert.equal(sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`)
      .get(fixture.storeId, fixture.productId).quantity, 6);
    assert.deepEqual(
      JSON.parse(sqlite.prepare(`SELECT payload_json FROM approval_requests WHERE id = ?`).get(legacyRequestId).payload_json),
      legacyPayload
    );
    assert.equal(sqlite.prepare(`SELECT average_cost FROM products WHERE store_id = ? AND id = ?`)
      .get(fixture.storeId, fixture.productId).average_cost, NEW_COST_SCALED);
  } finally {
    sqlite.close();
  }
});

test('Stock Adjustment exposes stale-snapshot, temporal HPP, and approval UX guards', () => {
  assert.match(approvalApiSource, /STOCK_ADJUSTMENT_STALE/);
  assert.match(approvalApiSource, /currentQuantitySnapshot/);
  assert.match(approvalApiSource, /approval_status = 'rejected'/);
  assert.match(cashierUiSource, /\/api\/cashier\/stock-adjustment\/options/);
  assert.match(cashierUiSource, /purpose: 'STOCK_ADJUSTMENT'/);
  assert.match(cashierUiSource, /Target stok fisik/);
  assert.match(managementUiSource, /STOCK ADJUSTMENT/);
  assert.match(managementUiSource, /stale/);
  assert.match(contractV1Source, /target quantity/i);
  assert.match(contractV1Source, /STOCK_ADJUSTMENT_STALE/);
  assert.match(contractV2Source, /unitCostSnapshotScaled/);
  assert.match(contractV2Source, /totalCostSnapshotScaled/);
  assert.match(contractV2Source, /does not write `products\.average_cost`/i);
  assert.match(contractV2Source, /legacy V1/i);
});
