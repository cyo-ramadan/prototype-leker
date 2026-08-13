import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { executeTransactionCorrection } from '../src/transaction-correction-executor.js';

const migrationDir = new URL('../migrations/', import.meta.url);

function d1Result(result) {
  return { success: true, meta: { changes: Number(result?.changes || 0) } };
}

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
          async run() { return d1Result(statement.run(...args)); }
        };
      }
    };
  }
  return {
    prepare: prepared,
    async batch(boundStatements) {
      sqlite.exec('BEGIN');
      try {
        const results = boundStatements.map(item => d1Result(item._statement.run(...item._args)));
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

function fixture(sqlite) {
  const store = sqlite.prepare('SELECT id, code, store_name FROM stores ORDER BY id LIMIT 1').get();
  const cashier = sqlite.prepare('SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1').get(store.id);
  const product = sqlite.prepare(`
    SELECT p.id, p.name, p.base_unit_id, u.symbol
    FROM products p
    JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    WHERE p.store_id = ? AND p.base_unit_id IS NOT NULL
    ORDER BY p.id
    LIMIT 1
  `).get(store.id);
  assert.ok(store?.id && cashier?.id && product?.id);
  const drawerId = `drawer_success_${crypto.randomUUID()}`;
  sqlite.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES (?, ?, ?, 100000, 'OPEN', '2026-08-13T09:00:00.000Z')
  `).run(drawerId, store.id, cashier.id);
  return {
    store: { id: store.id, code: store.code, storeName: store.store_name },
    cashierId: cashier.id,
    drawerId,
    product
  };
}

function permit(sqlite, fx, subjectType, subjectId, reason) {
  const id = `permit_${crypto.randomUUID()}`;
  sqlite.prepare(`
    INSERT INTO approval_permits (
      id, store_id, drawer_session_id, cashier_id, permit_type,
      subject_type, subject_id, subject_snapshot_json, reason,
      approval_status, execution_status, requested_at, updated_at,
      decided_at, approved_by_role, approved_by_id
    ) VALUES (?, ?, ?, ?, 'TRANSACTION_VOID', ?, ?, '{}', ?, 'approved', 'NOT_ATTEMPTED',
              '2026-08-13T09:18:00.000Z', '2026-08-13T09:18:00.000Z',
              '2026-08-13T09:19:00.000Z', 'ADMIN', 'admin_test')
  `).run(id, fx.store.id, fx.drawerId, fx.cashierId, subjectType, subjectId, reason);
  return id;
}

test('regular stock Sale correction returns quantity using original COGS snapshot and preserves source history', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const fx = fixture(sqlite);
    sqlite.prepare(`
      UPDATE products
      SET average_cost = 1500000, cost_updated_at = '2026-08-13T09:10:00.000Z'
      WHERE id = ? AND store_id = ?
    `).run(fx.product.id, fx.store.id);
    sqlite.prepare(`
      INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
      VALUES (?, ?, 3, '2026-08-13T09:10:00.000Z')
    `).run(fx.store.id, fx.product.id);

    const saleId = `sale_success_${crypto.randomUUID()}`;
    sqlite.prepare(`
      INSERT INTO sales (
        id, store_id, drawer_session_id, cashier_id, customer_name,
        total_amount, note, created_at, payment_method
      ) VALUES (?, ?, ?, ?, 'Walk-in', 20000, '', '2026-08-13T09:10:00.000Z', 'CASH')
    `).run(saleId, fx.store.id, fx.drawerId, fx.cashierId);
    sqlite.prepare(`
      INSERT INTO sale_items (
        id, sale_id, store_id, product_id, product_name,
        unit_price, quantity, line_total, unit_cost_snapshot, line_cogs
      ) VALUES (?, ?, ?, ?, ?, 10000, 2, 20000, 1000000, 2000000)
    `).run(`sale_item_${crypto.randomUUID()}`, saleId, fx.store.id, fx.product.id, fx.product.name);
    sqlite.prepare(`
      INSERT INTO stock_movements (
        id, source_key, store_id, product_id, product_name, unit_id, unit_symbol,
        direction, quantity, source_type, source_id, drawer_session_id, note,
        actor_role, actor_id, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OUT', 2, 'SALE', ?, ?, '', 'CASHIER', ?, '2026-08-13T09:10:00.000Z')
    `).run(
      `stock_move_${crypto.randomUUID()}`,
      `SALE:${saleId}:${fx.product.id}`,
      fx.store.id,
      fx.product.id,
      fx.product.name,
      fx.product.base_unit_id,
      fx.product.symbol,
      saleId,
      fx.drawerId,
      fx.cashierId
    );

    const permitId = permit(sqlite, fx, 'SALE', saleId, 'Salah transaksi');
    const result = await executeTransactionCorrection(db, fx.store, {
      id: permitId,
      subjectType: 'SALE',
      subjectId: saleId,
      reason: 'Salah transaksi'
    }, { role: 'ADMIN', id: 'admin_test' }, '2026-08-13T09:20:00.000Z');

    assert.equal(result.ok, true);
    assert.equal(result.accounting.accountingStatus, 'NOT_REQUIRED');
    const source = sqlite.prepare('SELECT voided_at, void_permit_id FROM sales WHERE id = ?').get(saleId);
    assert.ok(source.voided_at);
    assert.equal(source.void_permit_id, permitId);
    const balance = sqlite.prepare('SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?').get(fx.store.id, fx.product.id);
    assert.equal(balance.quantity, 5);
    const product = sqlite.prepare('SELECT average_cost FROM products WHERE id = ? AND store_id = ?').get(fx.product.id, fx.store.id);
    assert.equal(product.average_cost, 1300000);
    const correctionMovement = sqlite.prepare(`
      SELECT direction, quantity, source_type
      FROM stock_movements
      WHERE store_id = ? AND product_id = ? AND source_type = 'SALE_VOID' AND source_id = ?
    `).get(fx.store.id, fx.product.id, saleId);
    assert.deepEqual(correctionMovement, { direction: 'IN', quantity: 2, source_type: 'SALE_VOID' });
    const originalMovement = sqlite.prepare(`SELECT COUNT(*) AS count FROM stock_movements WHERE store_id = ? AND source_type = 'SALE' AND source_id = ?`).get(fx.store.id, saleId);
    assert.equal(originalMovement.count, 1);
  } finally {
    sqlite.close();
  }
});

test('Purchase correction without downstream dependency restores stock and pre-purchase Average Cost', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const fx = fixture(sqlite);
    sqlite.prepare(`
      UPDATE products
      SET average_cost = 2000000, last_purchase_price = 2000000,
          purchase_price = 2, last_purchase_at = '2026-08-13T09:05:00.000Z',
          cost_updated_at = '2026-08-13T09:05:00.000Z'
      WHERE id = ? AND store_id = ?
    `).run(fx.product.id, fx.store.id);
    sqlite.prepare(`
      INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
      VALUES (?, ?, 5, '2026-08-13T09:05:00.000Z')
    `).run(fx.store.id, fx.product.id);

    const purchaseId = `purchase_success_${crypto.randomUUID()}`;
    sqlite.prepare(`
      INSERT INTO purchases (
        id, store_id, drawer_session_id, cashier_id, description,
        total_amount, note, created_at, payment_method
      ) VALUES (?, ?, ?, ?, 'Bahan test', 10, '', '2026-08-13T09:05:00.000Z', 'CASH')
    `).run(purchaseId, fx.store.id, fx.drawerId, fx.cashierId);
    sqlite.prepare(`
      INSERT INTO purchase_items (
        id, purchase_id, store_id, product_id, product_name, unit_id, unit_symbol,
        quantity, line_total, unit_cost, average_cost_before, average_cost_after, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 5, 10, 2000000, 1000000, 2000000, '2026-08-13T09:05:00.000Z')
    `).run(
      `purchase_item_${crypto.randomUUID()}`,
      purchaseId,
      fx.store.id,
      fx.product.id,
      fx.product.name,
      fx.product.base_unit_id,
      fx.product.symbol
    );
    sqlite.prepare(`
      INSERT INTO stock_movements (
        id, source_key, store_id, product_id, product_name, unit_id, unit_symbol,
        direction, quantity, source_type, source_id, drawer_session_id, note,
        actor_role, actor_id, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'IN', 5, 'PURCHASE', ?, ?, '', 'CASHIER', ?, '2026-08-13T09:05:00.000Z')
    `).run(
      `stock_move_${crypto.randomUUID()}`,
      `PURCHASE:${purchaseId}:${fx.product.id}`,
      fx.store.id,
      fx.product.id,
      fx.product.name,
      fx.product.base_unit_id,
      fx.product.symbol,
      purchaseId,
      fx.drawerId,
      fx.cashierId
    );

    const permitId = permit(sqlite, fx, 'PURCHASE', purchaseId, 'Salah pembelian');
    const result = await executeTransactionCorrection(db, fx.store, {
      id: permitId,
      subjectType: 'PURCHASE',
      subjectId: purchaseId,
      reason: 'Salah pembelian'
    }, { role: 'ADMIN', id: 'admin_test' }, '2026-08-13T09:20:00.000Z');

    assert.equal(result.ok, true);
    assert.equal(result.accounting.accountingStatus, 'NOT_REQUIRED');
    const source = sqlite.prepare('SELECT voided_at, void_permit_id FROM purchases WHERE id = ?').get(purchaseId);
    assert.ok(source.voided_at);
    assert.equal(source.void_permit_id, permitId);
    const balance = sqlite.prepare('SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?').get(fx.store.id, fx.product.id);
    assert.equal(balance.quantity, 0);
    const product = sqlite.prepare(`SELECT average_cost, last_purchase_price, purchase_price FROM products WHERE id = ? AND store_id = ?`).get(fx.product.id, fx.store.id);
    assert.equal(product.average_cost, 1000000);
    assert.equal(product.last_purchase_price, 0);
    assert.equal(product.purchase_price, 0);
    const correctionMovement = sqlite.prepare(`
      SELECT direction, quantity, source_type
      FROM stock_movements
      WHERE store_id = ? AND product_id = ? AND source_type = 'PURCHASE_VOID' AND source_id = ?
    `).get(fx.store.id, fx.product.id, purchaseId);
    assert.deepEqual(correctionMovement, { direction: 'OUT', quantity: 5, source_type: 'PURCHASE_VOID' });
  } finally {
    sqlite.close();
  }
});
