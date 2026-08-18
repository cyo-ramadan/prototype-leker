import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  buildOperationalPostingStatements,
  listStockAdjustmentOptions,
  normalizeApprovalPayload
} from '../src/operational-posting.js';
import {
  prepareStockAdjustmentRows,
  selectStockAdjustmentProduct,
  stockAdjustmentDifference,
  updateStockAdjustmentActualQuantity
} from '../public/stock-adjustment-pilatu.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const approvalApiSource = readFileSync(new URL('../src/approval-queue.js', import.meta.url), 'utf8');
const cashierUiSource = readFileSync(new URL('../public/cashier-approval-actions.js', import.meta.url), 'utf8');
const managementUiSource = readFileSync(new URL('../public/management-approval-queue.js', import.meta.url), 'utf8');
const contractSource = readFileSync(new URL('../contracts/stock-adjustment-v1.md', import.meta.url), 'utf8');

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
  sqlite.prepare(`UPDATE products SET is_active = 1, stock_tracking_enabled = 1 WHERE store_id = ? AND id = ?`).run(store.id, product.id);
  sqlite.prepare(`INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, 10, CURRENT_TIMESTAMP)`).run(store.id, product.id);
  return { storeId: store.id, productId: Number(product.id), productName: product.name, unitId: product.base_unit_id };
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
      reason: 'Hasil hitung fisik',
      note: 'Rak bahan'
    });

    const noOp = await normalizeApprovalPayload(db, fixture.storeId, 'GOODS_FLOW', {
      purpose: 'STOCK_ADJUSTMENT', productId: fixture.productId, targetQuantity: 10, reason: 'cek'
    });
    assert.equal(noOp.ok, false);
    assert.match(noOp.error, /tidak ada penyesuaian/i);

    const negative = await normalizeApprovalPayload(db, fixture.storeId, 'GOODS_FLOW', {
      purpose: 'STOCK_ADJUSTMENT', productId: fixture.productId, targetQuantity: -1, reason: 'cek'
    });
    assert.equal(negative.ok, false);
  } finally {
    sqlite.close();
  }
});

test('approved Stock Adjustment reuses canonical balance and stock_movements with explicit source type', async () => {
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
  } finally {
    sqlite.close();
  }
});

test('PILATU stock adjustment keeps Mineral when Margarin is selected next', () => {
  const mineral = { productId: 101, productName: 'Mineral', currentQuantity: 12, unitSymbol: 'PCS' };
  const margarin = { productId: 102, productName: 'Margarin', currentQuantity: 7, unitSymbol: 'PCS' };

  let rows = selectStockAdjustmentProduct([], mineral);
  rows = updateStockAdjustmentActualQuantity(rows, mineral.productId, '10');
  rows = selectStockAdjustmentProduct(rows, margarin);

  assert.deepEqual(rows.map(row => row.productName), ['Margarin', 'Mineral']);
  assert.equal(rows[1].actualQuantity, '10');

  rows = updateStockAdjustmentActualQuantity(rows, margarin.productId, '9');
  assert.equal(stockAdjustmentDifference(rows[0]), 2);
  assert.equal(stockAdjustmentDifference(rows[1]), -2);

  rows = selectStockAdjustmentProduct(rows, mineral);
  assert.deepEqual(rows.map(row => row.productName), ['Mineral', 'Margarin']);
  assert.equal(rows[0].actualQuantity, '10');

  const prepared = prepareStockAdjustmentRows(rows);
  assert.deepEqual(prepared.map(row => ({ name: row.productName, target: row.targetQuantity, difference: row.difference })), [
    { name: 'Mineral', target: 10, difference: -2 },
    { name: 'Margarin', target: 9, difference: 2 }
  ]);
});

test('Stock Adjustment exposes stale-snapshot, PILATU and approval UX guards', () => {
  assert.match(approvalApiSource, /STOCK_ADJUSTMENT_STALE/);
  assert.match(approvalApiSource, /currentQuantitySnapshot/);
  assert.match(approvalApiSource, /approval_status = 'rejected'/);
  assert.match(cashierUiSource, /\/api\/cashier\/stock-adjustment\/options/);
  assert.match(cashierUiSource, /import\('\/stock-adjustment-pilatu\.js'\)/);
  assert.match(cashierUiSource, /Cari barang/);
  assert.match(cashierUiSource, /Qty Tercatat/);
  assert.match(cashierUiSource, /Qty Sebenarnya/);
  assert.match(cashierUiSource, />HPP</);
  assert.match(cashierUiSource, /Selisih/);
  assert.match(cashierUiSource, /selectStockAdjustmentProduct\(selectedRows, product\)/);
  assert.match(cashierUiSource, /for \(const row of changed\)/);
  assert.doesNotMatch(cashierUiSource, /id="stockAdjustmentProduct"/);
  assert.match(cashierUiSource, /purpose: 'STOCK_ADJUSTMENT'/);
  assert.match(managementUiSource, /STOCK ADJUSTMENT/);
  assert.match(managementUiSource, /stale/);
  assert.match(contractSource, /target quantity/i);
  assert.match(contractSource, /STOCK_ADJUSTMENT_STALE/);
  assert.match(contractSource, /quantity only/i);
});
