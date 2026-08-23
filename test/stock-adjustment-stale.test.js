import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleApprovalQueueApi } from '../src/approval-queue.js';
import { hashCredential } from '../src/owner-auth.js';
import { normalizeApprovalPayload } from '../src/operational-posting.js';

const migrationDir = new URL('../migrations/', import.meta.url);

function d1(sqlite) {
  const resultShape = result => ({
    success: true,
    meta: {
      changes: Number(result?.changes ?? 0),
      last_row_id: Number(result?.lastInsertRowid ?? 0)
    }
  });

  function prepared(sql) {
    const statement = sqlite.prepare(sql);
    const execute = args => ({
      _statement: statement,
      _args: args,
      async first() { return statement.get(...args) || null; },
      async all() { return { results: statement.all(...args) }; },
      async run() { return resultShape(statement.run(...args)); }
    });
    const direct = execute([]);
    return {
      ...direct,
      bind(...args) { return execute(args); }
    };
  }

  return {
    prepare: prepared,
    async batch(boundStatements) {
      sqlite.exec('BEGIN');
      try {
        const results = boundStatements.map(item => resultShape(item._statement.run(...item._args)));
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
  const store = sqlite.prepare('SELECT id FROM stores ORDER BY id LIMIT 1').get();
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
    SET is_active = 1, stock_tracking_enabled = 1, average_cost = 1250001
    WHERE store_id = ? AND id = ?
  `).run(store.id, product.id);
  sqlite.prepare(`
    INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
    VALUES (?, ?, 10, CURRENT_TIMESTAMP)
  `).run(store.id, product.id);
  return { storeId: store.id, productId: Number(product.id) };
}

async function ownerToken(sqlite) {
  const owner = sqlite.prepare('SELECT id FROM owner_accounts WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  assert.ok(owner?.id);
  const token = 'stock-adjustment-stale-owner-token';
  sqlite.prepare(`
    INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at)
    VALUES (?, ?, '2026-08-23T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(await hashCredential(token), owner.id);
  return token;
}

test('ACC rejects stale Stock Adjustment with readable 409 and leaves newer stock untouched', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const fixture = stockFixture(sqlite);
    const staged = await normalizeApprovalPayload(db, fixture.storeId, 'GOODS_FLOW', {
      purpose: 'STOCK_ADJUSTMENT',
      productId: fixture.productId,
      targetQuantity: 7,
      reason: 'Hitung fisik sebelum stok bergerak'
    });
    assert.equal(staged.ok, true);
    assert.equal(staged.payload.currentQuantitySnapshot, 10);

    const cashier = sqlite.prepare('SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1').get(fixture.storeId);
    assert.ok(cashier?.id);
    const drawerId = 'drawer_stock_adjustment_stale';
    sqlite.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES (?, ?, ?, 0, 'OPEN', '2026-08-23T01:00:00.000Z')
    `).run(drawerId, fixture.storeId, cashier.id);

    const requestId = 'approval_stock_adjustment_stale';
    sqlite.prepare(`
      INSERT INTO approval_requests (
        id, store_id, drawer_session_id, cashier_id, request_type,
        approval_status, posting_status, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'GOODS_FLOW', 'pending_approval', 'unposted', ?, '2026-08-23T01:01:00.000Z', '2026-08-23T01:01:00.000Z')
    `).run(requestId, fixture.storeId, drawerId, cashier.id, JSON.stringify(staged.payload));

    sqlite.prepare(`
      UPDATE inventory_stock_balances
      SET quantity = 12, updated_at = CURRENT_TIMESTAMP
      WHERE store_id = ? AND product_id = ?
    `).run(fixture.storeId, fixture.productId);

    const token = await ownerToken(sqlite);
    const pathname = `/api/management/approval-requests/${requestId}`;
    const response = await handleApprovalQueueApi(new Request(`https://example.test${pathname}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ decision: 'ACC', note: 'ACC setelah stok bergerak' })
    }), { DB: db }, pathname);

    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, 'STOCK_ADJUSTMENT_STALE');
    assert.equal(body.snapshotQuantity, 10);
    assert.equal(body.actualQuantity, 12);
    assert.match(body.error, /stok berubah dari 10 menjadi 12/i);
    assert.match(body.error, /ajukan ulang/i);
    assert.equal(body.request.approvalStatus, 'rejected');
    assert.equal(body.request.postingStatus, 'unposted');
    assert.match(body.request.postingBlockReason, /^STOCK_ADJUSTMENT_STALE:/);

    const balance = sqlite.prepare(`
      SELECT quantity
      FROM inventory_stock_balances
      WHERE store_id = ? AND product_id = ?
    `).get(fixture.storeId, fixture.productId);
    assert.equal(balance.quantity, 12);

    const movement = sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM stock_movements
      WHERE store_id = ? AND source_id = ?
    `).get(fixture.storeId, requestId);
    assert.equal(movement.count, 0);

    const product = sqlite.prepare(`
      SELECT average_cost
      FROM products
      WHERE store_id = ? AND id = ?
    `).get(fixture.storeId, fixture.productId);
    assert.equal(product.average_cost, 1250001);
  } finally {
    sqlite.close();
  }
});
