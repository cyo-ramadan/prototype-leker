import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleApprovalQueueApi } from '../src/approval-queue.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-19: "kalo sampe skema 1 barang 1 permit diganti aja, yang
// diajukan ya yg satu transaksi, kalo ga cukup ditulis di kartu ya kasih aja
// tombol detil" -- one Stock Opname form (several barang with a difference)
// now submits and gets decided as ONE unit instead of N independent permits.
// This file covers the new orchestration: batch submit is all-or-nothing on
// validation, and group ACC/Reject is all-or-nothing on staleness/decision --
// each item is still its own approval_requests row (the UNIQUE constraint on
// inventory_ledger_entries.approval_request_id rules out merging rows), only
// the submit/decide entry points are grouped by payload.sessionId.

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

function request(pathname, { token, method = 'GET', body, store } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store) url.searchParams.set('store', store);
  return new Request(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function ownerToken(sqlite) {
  const owner = sqlite.prepare('SELECT id FROM owner_accounts ORDER BY id LIMIT 1').get();
  const token = 'stock-batch-owner-token';
  sqlite.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, '2026-09-19T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), owner.id);
  return { token, ownerId: owner.id };
}

async function storeAdminToken(sqlite, storeId, { id = 'admin_stock_batch_test', username = 'admin_stock_batch_test' } = {}) {
  const token = `stock-batch-admin-${id}`;
  sqlite.prepare(`INSERT INTO store_admins (id, store_id, username, password_hash, display_name, is_active) VALUES (?, ?, ?, 'x', 'Admin Stock Batch Test', 1)`)
    .run(id, storeId, username);
  sqlite.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, '2026-09-19T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), id);
  return { token, adminId: id };
}

async function cashierWithOpenDrawer(sqlite, storeId, { id = 'cashier_stock_batch_test', username = 'cashier_stock_batch_test' } = {}) {
  sqlite.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active) VALUES (?, ?, 'x', 'Kasir Stock Batch Test', ?, 1)`)
    .run(id, username, storeId);
  const token = `stock-batch-cashier-${id}`;
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, '2026-09-19T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), id);
  const drawerId = `drawer_${id}`;
  sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES (?, ?, ?, 0, 'OPEN', '2026-09-19T00:00:00.000Z')`)
    .run(drawerId, storeId, id);
  return { token, cashierId: id, drawerId };
}

function twoTrackedProducts(sqlite, storeId) {
  const products = sqlite.prepare(`
    SELECT id FROM products WHERE store_id = ? AND base_unit_id IS NOT NULL ORDER BY id LIMIT 2
  `).all(storeId);
  assert.equal(products.length, 2, 'fixture store must have at least two trackable products');
  const [a, b] = products;
  for (const product of [a, b]) {
    sqlite.prepare(`UPDATE products SET is_active = 1, stock_tracking_enabled = 1, average_cost = 1000000 WHERE store_id = ? AND id = ?`)
      .run(storeId, product.id);
  }
  sqlite.prepare(`INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, 10, CURRENT_TIMESTAMP)`).run(storeId, a.id);
  sqlite.prepare(`INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, 20, CURRENT_TIMESTAMP)`).run(storeId, b.id);
  return { productAId: Number(a.id), productBId: Number(b.id) };
}

async function submitBatch(env, cashier, items) {
  return handleApprovalQueueApi(
    request('/api/cashier/approval-requests/stock-adjustment-batch', { token: cashier.token, method: 'POST', body: { items } }),
    env, '/api/cashier/approval-requests/stock-adjustment-batch'
  );
}

test('batch submit is atomic: one invalid item fails the whole submission, no row created for either', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const { productAId, productBId } = twoTrackedProducts(sqlite, store.id);
    const cashier = await cashierWithOpenDrawer(sqlite, store.id);

    const response = await submitBatch(env, cashier, [
      { productId: productAId, targetQuantity: 7 },
      { productId: productBId, targetQuantity: -1 }
    ]);
    assert.equal(response.status, 400);

    const count = sqlite.prepare(`SELECT COUNT(*) AS count FROM approval_requests`).get().count;
    assert.equal(count, 0, 'no row may be inserted when any item in the batch fails validation');
  } finally {
    sqlite.close();
  }
});

test('batch submit rejects a duplicate productId within the same submission', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const { productAId } = twoTrackedProducts(sqlite, store.id);
    const cashier = await cashierWithOpenDrawer(sqlite, store.id);

    const response = await submitBatch(env, cashier, [
      { productId: productAId, targetQuantity: 7 },
      { productId: productAId, targetQuantity: 5 }
    ]);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /lebih dari sekali/);

    const count = sqlite.prepare(`SELECT COUNT(*) AS count FROM approval_requests`).get().count;
    assert.equal(count, 0);
  } finally {
    sqlite.close();
  }
});

test('batch submit succeeds as one session: both rows share sessionId and stay pending until one decision', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const { productAId, productBId } = twoTrackedProducts(sqlite, store.id);
    const cashier = await cashierWithOpenDrawer(sqlite, store.id);

    const response = await submitBatch(env, cashier, [
      { productId: productAId, targetQuantity: 7, reason: 'hitung fisik A' },
      { productId: productBId, targetQuantity: 25, reason: 'hitung fisik B' }
    ]);
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.ok(body.sessionId);
    assert.equal(body.requests.length, 2);
    for (const item of body.requests) {
      assert.equal(item.approvalStatus, 'pending_approval');
      assert.equal(item.postingStatus, 'unposted');
      assert.equal(item.payload.sessionId, body.sessionId);
    }

    const balanceA = sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`).get(store.id, productAId);
    assert.equal(balanceA.quantity, 10, 'stock must not move while the session is still pending');
  } finally {
    sqlite.close();
  }
});

test('group ACC posts every item in the session atomically in one decision', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const { productAId, productBId } = twoTrackedProducts(sqlite, store.id);
    const cashier = await cashierWithOpenDrawer(sqlite, store.id);
    const { token: owner } = await ownerToken(sqlite);

    const submit = await submitBatch(env, cashier, [
      { productId: productAId, targetQuantity: 7 },
      { productId: productBId, targetQuantity: 25 }
    ]);
    const { sessionId } = await submit.json();

    const decidePathname = `/api/management/approval-requests/session/${sessionId}`;
    const decide = await handleApprovalQueueApi(
      request(decidePathname, { token: owner, method: 'PATCH', body: { decision: 'ACC' } }),
      env, decidePathname
    );
    assert.equal(decide.status, 200);
    const decideBody = await decide.json();
    assert.equal(decideBody.posted, true);
    assert.equal(decideBody.requests.length, 2);
    assert.ok(decideBody.requests.every(item => item.approvalStatus === 'approved' && item.postingStatus === 'posted'));

    const balanceA = sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`).get(store.id, productAId);
    const balanceB = sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`).get(store.id, productBId);
    assert.equal(balanceA.quantity, 7);
    assert.equal(balanceB.quantity, 25);
  } finally {
    sqlite.close();
  }
});

test('group ACC is all-or-nothing: one stale item in the session rejects the whole session, nothing posts', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const { productAId, productBId } = twoTrackedProducts(sqlite, store.id);
    const cashier = await cashierWithOpenDrawer(sqlite, store.id);
    const { token: owner } = await ownerToken(sqlite);

    const submit = await submitBatch(env, cashier, [
      { productId: productAId, targetQuantity: 7 },
      { productId: productBId, targetQuantity: 25 }
    ]);
    const { sessionId } = await submit.json();

    // Product A's stock changes after submission (another transaction moved
    // it) -- the snapshot taken at submit time (10) no longer matches.
    sqlite.prepare(`UPDATE inventory_stock_balances SET quantity = 12, updated_at = CURRENT_TIMESTAMP WHERE store_id = ? AND product_id = ?`)
      .run(store.id, productAId);

    const decidePathname = `/api/management/approval-requests/session/${sessionId}`;
    const decide = await handleApprovalQueueApi(
      request(decidePathname, { token: owner, method: 'PATCH', body: { decision: 'ACC' } }),
      env, decidePathname
    );
    assert.equal(decide.status, 409);
    const decideBody = await decide.json();
    assert.equal(decideBody.code, 'STOCK_ADJUSTMENT_STALE');
    assert.equal(decideBody.requests.length, 2);
    assert.ok(decideBody.requests.every(item => item.approvalStatus === 'rejected' && item.postingStatus === 'unposted'), 'the whole session must bounce back together, not just the stale item');

    const balanceA = sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`).get(store.id, productAId);
    const balanceB = sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`).get(store.id, productBId);
    assert.equal(balanceA.quantity, 12, 'product A keeps its live (changed) balance, not the stale snapshot');
    assert.equal(balanceB.quantity, 20, 'product B must NOT have posted even though its own snapshot was still fresh');

    const movements = sqlite.prepare(`SELECT COUNT(*) AS count FROM stock_movements WHERE store_id = ?`).get(store.id);
    assert.equal(movements.count, 0);
  } finally {
    sqlite.close();
  }
});

test('group Reject bounces every item in the session at once', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const { productAId, productBId } = twoTrackedProducts(sqlite, store.id);
    const cashier = await cashierWithOpenDrawer(sqlite, store.id);
    const { token: owner } = await ownerToken(sqlite);

    const submit = await submitBatch(env, cashier, [
      { productId: productAId, targetQuantity: 7 },
      { productId: productBId, targetQuantity: 25 }
    ]);
    const { sessionId } = await submit.json();

    const decidePathname = `/api/management/approval-requests/session/${sessionId}`;
    const decide = await handleApprovalQueueApi(
      request(decidePathname, { token: owner, method: 'PATCH', body: { decision: 'REJECT', note: 'Tidak sesuai' } }),
      env, decidePathname
    );
    assert.equal(decide.status, 200);
    const decideBody = await decide.json();
    assert.equal(decideBody.posted, false);
    assert.ok(decideBody.requests.every(item => item.approvalStatus === 'rejected' && item.postingStatus === 'unposted'));

    const balanceA = sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`).get(store.id, productAId);
    assert.equal(balanceA.quantity, 10, 'rejecting a session must not touch stock');
  } finally {
    sqlite.close();
  }
});

test('group decide 404s for an unknown session, and an Admin Gerai from another store cannot decide it either', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const storeG001 = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const storeG002 = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G002'`).get();
    const { productAId, productBId } = twoTrackedProducts(sqlite, storeG001.id);
    const cashier = await cashierWithOpenDrawer(sqlite, storeG001.id);
    const { token: outOfStoreAdmin } = await storeAdminToken(sqlite, storeG002.id, { id: 'admin_other_store', username: 'admin_other_store' });

    const missing = await handleApprovalQueueApi(
      request('/api/management/approval-requests/session/session_does_not_exist', { token: outOfStoreAdmin, store: 'G002', method: 'PATCH', body: { decision: 'ACC' } }),
      env, '/api/management/approval-requests/session/session_does_not_exist'
    );
    assert.equal(missing.status, 404);

    const submit = await submitBatch({ DB: db }, cashier, [
      { productId: productAId, targetQuantity: 7 },
      { productId: productBId, targetQuantity: 25 }
    ]);
    const { sessionId } = await submit.json();

    const decidePathname = `/api/management/approval-requests/session/${sessionId}`;
    const crossStore = await handleApprovalQueueApi(
      request(decidePathname, { token: outOfStoreAdmin, store: 'G002', method: 'PATCH', body: { decision: 'ACC' } }),
      env, decidePathname
    );
    assert.equal(crossStore.status, 404, 'an Admin Gerai from a different store must not even see this session exists');
  } finally {
    sqlite.close();
  }
});
