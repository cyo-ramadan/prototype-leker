import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleTransactionVoidPermitApi } from '../src/transaction-void-permits.js';
import { hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);

function d1(sqlite) {
  function prepared(sql) {
    const statement = sqlite.prepare(sql);
    return {
      bind(...args) {
        return {
          async first() { return statement.get(...args) || null; },
          async all() { return { results: statement.all(...args) }; },
          async run() {
            const result = statement.run(...args);
            return { success: true, meta: { changes: result.changes } };
          }
        };
      }
    };
  }
  return { prepare: prepared };
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

async function cashierWithOpenDrawer(sqlite, storeId, { id = 'cashier_void_cancel_test' } = {}) {
  sqlite.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active) VALUES (?, ?, 'x', 'Kasir Cancel Test', ?, 1)`)
    .run(id, id, storeId);
  const token = `void-cancel-cashier-${id}`;
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, '2026-09-14T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), id);
  const drawerId = `drawer_${id}`;
  sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES (?, ?, ?, 0, 'OPEN', '2026-09-14T00:00:00.000Z')`)
    .run(drawerId, storeId, id);
  return { token, cashierId: id, drawerId };
}

test('a cashier can withdraw its own pending permit, but not one it does not own or one already decided', async () => {
  const sqlite = freshDatabase();
  try {
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const otherStore = sqlite.prepare(`SELECT id FROM stores WHERE id != ? LIMIT 1`).get(store.id);
    const cashier = await cashierWithOpenDrawer(sqlite, store.id);
    const otherCashier = await cashierWithOpenDrawer(sqlite, otherStore.id, { id: 'cashier_void_cancel_other' });
    const env = { DB: d1(sqlite) };

    const saleId = 'sale_void_cancel_test';
    sqlite.prepare(`
      INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, customer_name, total_amount, created_at)
      VALUES (?, ?, ?, ?, 'Budi', 25000, '2026-09-14T00:00:00.000Z')
    `).run(saleId, store.id, cashier.drawerId, cashier.cashierId);

    const created = await handleTransactionVoidPermitApi(
      request('/api/cashier/transaction-void/permits', { token: cashier.token, method: 'POST', body: { subjectType: 'SALE', subjectId: saleId, reason: 'Salah entry' } }),
      env, '/api/cashier/transaction-void/permits'
    );
    assert.equal(created.status, 201);
    const permitId = (await created.json()).permit.id;

    const forbidden = await handleTransactionVoidPermitApi(
      request(`/api/cashier/transaction-void/permits/${permitId}`, { token: otherCashier.token, method: 'DELETE' }),
      env, `/api/cashier/transaction-void/permits/${permitId}`
    );
    assert.equal(forbidden.status, 409, 'a different cashier must never cancel someone else\'s request');

    const cancelled = await handleTransactionVoidPermitApi(
      request(`/api/cashier/transaction-void/permits/${permitId}`, { token: cashier.token, method: 'DELETE' }),
      env, `/api/cashier/transaction-void/permits/${permitId}`
    );
    assert.equal(cancelled.status, 200);
    const cancelledBody = await cancelled.json();
    assert.equal(cancelledBody.permit.approvalStatus, 'rejected');
    assert.equal(cancelledBody.permit.approvedByRole, 'CASHIER_SELF');

    const cancelAgain = await handleTransactionVoidPermitApi(
      request(`/api/cashier/transaction-void/permits/${permitId}`, { token: cashier.token, method: 'DELETE' }),
      env, `/api/cashier/transaction-void/permits/${permitId}`
    );
    assert.equal(cancelAgain.status, 409, 'a permit no longer pending must not be cancellable again');

    const requestedAgain = await handleTransactionVoidPermitApi(
      request('/api/cashier/transaction-void/permits', { token: cashier.token, method: 'POST', body: { subjectType: 'SALE', subjectId: saleId, reason: 'Coba lagi' } }),
      env, '/api/cashier/transaction-void/permits'
    );
    assert.equal(requestedAgain.status, 201, 'after a self-cancel the same subject must be requestable again');
  } finally {
    sqlite.close();
  }
});
