import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleApprovalQueueApi } from '../src/approval-queue.js';
import { hashCredential } from '../src/owner-auth.js';
import { normalizeApprovalPayload } from '../src/operational-posting.js';

const migrationDir = new URL('../migrations/', import.meta.url);

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
          async run() {
            const result = statement.run(...args);
            return { ...result, success: true, meta: { changes: result.changes } };
          }
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

test('ACC endpoint rejects stale Stock Adjustment and returns cashier-readable reason', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const store = sqlite.prepare('SELECT id FROM stores ORDER BY id LIMIT 1').get();
    const product = sqlite.prepare(`
      SELECT id, base_unit_id
      FROM products
      WHERE store_id = ? AND base_unit_id IS NOT NULL
      ORDER BY id
      LIMIT 1
    `).get(store.id);
    assert.ok(product?.id);

    sqlite.prepare(`
      UPDATE products
      SET is_active = 1, stock_tracking_enabled = 1, average_cost = 1250001
      WHERE store_id = ? AND id = ?
    `).run(store.id, product.id);
    sqlite.prepare(`
      INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
      VALUES (?, ?, 10, CURRENT_TIMESTAMP)
    `).run(store.id, product.id);

    const normalized = await normalizeApprovalPayload(db, store.id, 'GOODS_FLOW', {
      purpose: 'STOCK_ADJUSTMENT',
      productId: Number(product.id),
      targetQuantity: 7,
      reason: 'Hasil hitung fisik'
    });
    assert.equal(normalized.ok, true);
    assert.equal(normalized.payload.currentQuantitySnapshot, 10);

    const cashier = sqlite.prepare('SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1').get(store.id);
    assert.ok(cashier?.id);
    const drawerId = 'drawer_stale_endpoint';
    sqlite.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES (?, ?, ?, 0, 'OPEN', '2026-08-23T04:20:00.000Z')
    `).run(drawerId, store.id, cashier.id);

    const requestId = 'approval_stale_endpoint';
    sqlite.prepare(`
      INSERT INTO approval_requests (
        id, store_id, drawer_session_id, cashier_id, request_type,
        approval_status, posting_status, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'GOODS_FLOW', 'pending_approval', 'unposted', ?, '2026-08-23T04:21:00.000Z', '2026-08-23T04:21:00.000Z')
    `).run(requestId, store.id, drawerId, cashier.id, JSON.stringify(normalized.payload));

    sqlite.prepare(`
      UPDATE inventory_stock_balances
      SET quantity = 12, updated_at = CURRENT_TIMESTAMP
      WHERE store_id = ? AND product_id = ?
    `).run(store.id, product.id);

    const token = 'stock-adjustment-owner-test-token';
    const tokenHash = await hashCredential(token);
    sqlite.prepare(`
      INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at)
      VALUES (?, 'owner_primary', '2026-08-23T04:22:00.000Z', '2099-01-01T00:00:00.000Z')
    `).run(tokenHash);

    const pathname = `/api/management/approval-requests/${requestId}`;
    const request = new Request(`https://example.test${pathname}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ decision: 'ACC', note: 'ACC stok fisik' })
    });
    const response = await handleApprovalQueueApi(request, { DB: db }, pathname);
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.code, 'STOCK_ADJUSTMENT_STALE');
    assert.equal(body.snapshotQuantity, 10);
    assert.equal(body.actualQuantity, 12);
    assert.match(body.error, /stok berubah dari 10 menjadi 12/i);
    assert.match(body.error, /ajukan ulang/i);
    assert.equal(body.request.approvalStatus, 'rejected');
    assert.equal(body.request.postingStatus, 'unposted');
    assert.match(body.request.postingBlockReason, /STOCK_ADJUSTMENT_STALE/);
    assert.match(body.request.decisionNote, /snapshot 10 menjadi 12/i);

    const balance = sqlite.prepare(`
      SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?
    `).get(store.id, product.id);
    assert.equal(balance.quantity, 12);
    const movements = sqlite.prepare(`
      SELECT COUNT(*) AS count FROM stock_movements WHERE source_id = ?
    `).get(requestId);
    assert.equal(movements.count, 0);
  } finally {
    sqlite.close();
  }
});
