import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleTransactionVoidPermitApi } from '../src/transaction-void-permits.js';
import { hashCredential } from '../src/owner-auth.js';

// Production had 6 permits stuck exactly at approval_status='approved' +
// execution_status='NOT_ATTEMPTED' with empty execution_code/detail -- the
// shape a client disconnect leaves behind when it happens between the ACC
// write and the finalize write, since those are two separate statements
// rather than one atomic batch. This file proves the RETRY_EXECUTION path
// recovers that exact stuck shape without re-deciding or double-applying
// the correction.

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
        const results = boundStatements.map(item => {
          const result = item._statement.run(...item._args);
          return { ...result, success: true, meta: { changes: result.changes } };
        });
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

function request(pathname, { token, method = 'GET', body } = {}) {
  return new Request(`https://example.test${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function storeAdminToken(sqlite, storeId, { id = 'admin_void_retry_test' } = {}) {
  const token = `void-retry-admin-${id}`;
  sqlite.prepare(`INSERT INTO store_admins (id, store_id, username, password_hash, display_name, is_active) VALUES (?, ?, ?, 'x', 'Admin Retry Test', 1)`)
    .run(id, storeId, id);
  sqlite.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, '2026-09-14T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), id);
  return { token };
}

function seedStuckSalePermit(sqlite, storeId, drawerId, cashierId) {
  const saleId = `sale_void_retry_test`;
  sqlite.prepare(`
    INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, customer_name, total_amount, created_at)
    VALUES (?, ?, ?, ?, 'Budi', 25000, '2026-09-01T07:00:00.000Z')
  `).run(saleId, storeId, drawerId, cashierId);

  const permitId = 'permit_void_retry_test';
  sqlite.prepare(`
    INSERT INTO approval_permits (
      id, store_id, drawer_session_id, cashier_id, permit_type,
      subject_type, subject_id, subject_snapshot_json, reason,
      approval_status, execution_status, execution_code, execution_detail,
      approved_by_role, approved_by_id, requested_at, updated_at, decided_at
    ) VALUES (?, ?, ?, ?, 'TRANSACTION_VOID', 'SALE', ?, '{}', 'Salah entry',
      'approved', 'NOT_ATTEMPTED', '', '', 'ADMIN', 'admin_void_retry_test',
      '2026-09-01T07:00:02.000Z', '2026-09-01T07:00:05.000Z', '2026-09-01T07:00:05.000Z')
  `).run(permitId, storeId, drawerId, cashierId, saleId);
  return { saleId, permitId };
}

test('RETRY_EXECUTION recovers a permit stuck at approved/NOT_ATTEMPTED and actually voids the sale', async () => {
  const sqlite = freshDatabase();
  try {
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const cashierId = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? LIMIT 1`).get(store.id).id;
    const drawerId = 'drawer_void_retry_test';
    sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES (?, ?, ?, 0, 'OPEN', '2026-09-01T06:00:00.000Z')`)
      .run(drawerId, store.id, cashierId);
    const { saleId, permitId } = seedStuckSalePermit(sqlite, store.id, drawerId, cashierId);
    const { token } = await storeAdminToken(sqlite, store.id);
    const env = { DB: d1(sqlite) };

    assert.equal(sqlite.prepare(`SELECT voided_at FROM sales WHERE id = ?`).get(saleId).voided_at, null, 'sale must still be active before retry');

    const response = await handleTransactionVoidPermitApi(
      request(`/api/management/transaction-void-permits/${permitId}`, { token, method: 'PATCH', body: { decision: 'RETRY_EXECUTION' } }),
      env,
      `/api/management/transaction-void-permits/${permitId}`
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.executed, true);
    assert.equal(body.permit.executionStatus, 'EXECUTED');

    const sale = sqlite.prepare(`SELECT voided_at, void_permit_id FROM sales WHERE id = ?`).get(saleId);
    assert.ok(sale.voided_at, 'retry must actually run the correction, not just flip the status');
    assert.equal(sale.void_permit_id, permitId);
  } finally {
    sqlite.close();
  }
});

test('RETRY_EXECUTION is idempotent when the sale was already voided by an earlier partial attempt', async () => {
  const sqlite = freshDatabase();
  try {
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const cashierId = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? LIMIT 1`).get(store.id).id;
    const drawerId = 'drawer_void_retry_idempotent_test';
    sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES (?, ?, ?, 0, 'OPEN', '2026-09-01T06:00:00.000Z')`)
      .run(drawerId, store.id, cashierId);
    const { saleId, permitId } = seedStuckSalePermit(sqlite, store.id, drawerId, cashierId);
    // Simulate the sale-voiding half already having completed before the
    // disconnect, exactly like the production rows this fix targets.
    sqlite.prepare(`UPDATE sales SET voided_at = ?, voided_by_role = 'ADMIN', voided_by_id = 'admin_void_retry_test', void_reason = 'Salah entry', void_permit_id = ? WHERE id = ?`)
      .run('2026-09-01T07:00:04.000Z', permitId, saleId);
    const { token } = await storeAdminToken(sqlite, store.id, { id: 'admin_void_retry_idempotent' });
    const env = { DB: d1(sqlite) };

    const response = await handleTransactionVoidPermitApi(
      request(`/api/management/transaction-void-permits/${permitId}`, { token, method: 'PATCH', body: { decision: 'RETRY_EXECUTION' } }),
      env,
      `/api/management/transaction-void-permits/${permitId}`
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.executed, true);
    assert.equal(body.permit.executionStatus, 'EXECUTED');
  } finally {
    sqlite.close();
  }
});

test('RETRY_EXECUTION is refused for a still-pending or already-fully-executed permit', async () => {
  const sqlite = freshDatabase();
  try {
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const cashierId = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? LIMIT 1`).get(store.id).id;
    const drawerId = 'drawer_void_retry_guard_test';
    sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES (?, ?, ?, 0, 'OPEN', '2026-09-01T06:00:00.000Z')`)
      .run(drawerId, store.id, cashierId);
    const { permitId } = seedStuckSalePermit(sqlite, store.id, drawerId, cashierId);
    sqlite.prepare(`UPDATE approval_permits SET approval_status = 'pending_approval' WHERE id = ?`).run(permitId);
    const { token } = await storeAdminToken(sqlite, store.id, { id: 'admin_void_retry_guard' });
    const env = { DB: d1(sqlite) };

    const stillPending = await handleTransactionVoidPermitApi(
      request(`/api/management/transaction-void-permits/${permitId}`, { token, method: 'PATCH', body: { decision: 'RETRY_EXECUTION' } }),
      env,
      `/api/management/transaction-void-permits/${permitId}`
    );
    assert.equal(stillPending.status, 409);

    sqlite.prepare(`UPDATE approval_permits SET approval_status = 'approved', execution_status = 'EXECUTED' WHERE id = ?`).run(permitId);
    const alreadyExecuted = await handleTransactionVoidPermitApi(
      request(`/api/management/transaction-void-permits/${permitId}`, { token, method: 'PATCH', body: { decision: 'RETRY_EXECUTION' } }),
      env,
      `/api/management/transaction-void-permits/${permitId}`
    );
    assert.equal(alreadyExecuted.status, 409);
  } finally {
    sqlite.close();
  }
});
