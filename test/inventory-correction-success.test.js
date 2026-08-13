import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { executeTransactionCorrection } from '../src/transaction-correction-executor.js';

const migrationDir = new URL('../migrations/', import.meta.url);

function resultMeta(result) {
  return { success: true, meta: { changes: Number(result?.changes || 0) } };
}

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
            async run() { return resultMeta(statement.run(...args)); }
          };
        }
      };
    },
    async batch(items) {
      sqlite.exec('BEGIN');
      try {
        const results = items.map(item => resultMeta(item._statement.run(...item._args)));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function setup(sqlite) {
  const store = sqlite.prepare('SELECT id, code, store_name FROM stores ORDER BY id LIMIT 1').get();
  const cashier = sqlite.prepare('SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1').get(store.id);
  const product = sqlite.prepare(`
    SELECT p.id, p.name, p.base_unit_id, u.symbol
    FROM products p JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    WHERE p.store_id = ? AND p.base_unit_id IS NOT NULL ORDER BY p.id LIMIT 1
  `).get(store.id);
  const drawerId = `drawer_${crypto.randomUUID()}`;
  sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES (?, ?, ?, 0, 'OPEN', '2026-08-13T09:00:00.000Z')`).run(drawerId, store.id, cashier.id);
  return { store: { id: store.id, code: store.code, storeName: store.store_name }, cashierId: cashier.id, drawerId, product };
}

test('sale adjustment restores quantity and uses the historical cost snapshot', async () => {
  const sqlite = freshDb();
  try {
    const fx = setup(sqlite);
    sqlite.prepare('UPDATE products SET average_cost = 1500000 WHERE id = ? AND store_id = ?').run(fx.product.id, fx.store.id);
    sqlite.prepare(`INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, 3, '2026-08-13T09:10:00.000Z')`).run(fx.store.id, fx.product.id);
    const saleId = `sale_${crypto.randomUUID()}`;
    sqlite.prepare(`INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, customer_name, total_amount, note, created_at, payment_method) VALUES (?, ?, ?, ?, '', 20000, '', '2026-08-13T09:10:00.000Z', 'CASH')`).run(saleId, fx.store.id, fx.drawerId, fx.cashierId);
    sqlite.prepare(`INSERT INTO sale_items (id, sale_id, store_id, product_id, product_name, unit_price, quantity, line_total, unit_cost_snapshot, line_cogs) VALUES (?, ?, ?, ?, ?, 10000, 2, 20000, 1000000, 2000000)`).run(`line_${crypto.randomUUID()}`, saleId, fx.store.id, fx.product.id, fx.product.name);
    sqlite.prepare(`INSERT INTO stock_movements (id, source_key, store_id, product_id, product_name, unit_id, unit_symbol, direction, quantity, source_type, source_id, drawer_session_id, note, actor_role, actor_id, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'OUT', 2, 'SALE', ?, NULL, '', 'CASHIER', ?, '2026-08-13T09:10:00.000Z')`).run(`move_${crypto.randomUUID()}`, `SALE:${saleId}:${fx.product.id}`, fx.store.id, fx.product.id, fx.product.name, fx.product.base_unit_id, fx.product.symbol, saleId, fx.cashierId);

    const out = await executeTransactionCorrection(d1(sqlite), fx.store, { id: null, subjectType: 'SALE', subjectId: saleId, reason: 'Input salah' }, { role: 'ADMIN', id: 'admin_test' }, '2026-08-13T09:20:00.000Z');
    assert.equal(out.ok, true);
    assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?').get(fx.store.id, fx.product.id).quantity, 5);
    assert.equal(sqlite.prepare('SELECT average_cost FROM products WHERE id = ? AND store_id = ?').get(fx.product.id, fx.store.id).average_cost, 1300000);
    assert.ok(sqlite.prepare('SELECT voided_at FROM sales WHERE id = ?').get(saleId).voided_at);
  } finally {
    sqlite.close();
  }
});

test('purchase adjustment restores pre-purchase quantity and average cost when no later movement exists', async () => {
  const sqlite = freshDb();
  try {
    const fx = setup(sqlite);
    sqlite.prepare('UPDATE products SET average_cost = 2000000, last_purchase_price = 2000000, purchase_price = 2 WHERE id = ? AND store_id = ?').run(fx.product.id, fx.store.id);
    sqlite.prepare(`INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, 5, '2026-08-13T09:05:00.000Z')`).run(fx.store.id, fx.product.id);
    const purchaseId = `purchase_${crypto.randomUUID()}`;
    sqlite.prepare(`INSERT INTO purchases (id, store_id, drawer_session_id, cashier_id, description, total_amount, note, created_at, payment_method) VALUES (?, ?, ?, ?, 'Bahan', 10, '', '2026-08-13T09:05:00.000Z', 'CASH')`).run(purchaseId, fx.store.id, fx.drawerId, fx.cashierId);
    sqlite.prepare(`INSERT INTO purchase_items (id, purchase_id, store_id, product_id, product_name, unit_id, unit_symbol, quantity, line_total, unit_cost, average_cost_before, average_cost_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 5, 10, 2000000, 1000000, 2000000, '2026-08-13T09:05:00.000Z')`).run(`line_${crypto.randomUUID()}`, purchaseId, fx.store.id, fx.product.id, fx.product.name, fx.product.base_unit_id, fx.product.symbol);
    sqlite.prepare(`INSERT INTO stock_movements (id, source_key, store_id, product_id, product_name, unit_id, unit_symbol, direction, quantity, source_type, source_id, drawer_session_id, note, actor_role, actor_id, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'IN', 5, 'PURCHASE', ?, NULL, '', 'CASHIER', ?, '2026-08-13T09:05:00.000Z')`).run(`move_${crypto.randomUUID()}`, `PURCHASE:${purchaseId}:${fx.product.id}`, fx.store.id, fx.product.id, fx.product.name, fx.product.base_unit_id, fx.product.symbol, purchaseId, fx.cashierId);

    const out = await executeTransactionCorrection(d1(sqlite), fx.store, { id: null, subjectType: 'PURCHASE', subjectId: purchaseId, reason: 'Input salah' }, { role: 'ADMIN', id: 'admin_test' }, '2026-08-13T09:20:00.000Z');
    assert.equal(out.ok, true);
    assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?').get(fx.store.id, fx.product.id).quantity, 0);
    assert.equal(sqlite.prepare('SELECT average_cost FROM products WHERE id = ? AND store_id = ?').get(fx.product.id, fx.store.id).average_cost, 1000000);
    assert.ok(sqlite.prepare('SELECT voided_at FROM purchases WHERE id = ?').get(purchaseId).voided_at);
  } finally {
    sqlite.close();
  }
});
