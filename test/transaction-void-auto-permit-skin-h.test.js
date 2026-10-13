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

function request(token, body) {
  return new Request('https://example.test/api/cashier/transaction-void/permits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function fixture({ skin = 'H', autoPermit = true, suffix = 'h' } = {}) {
  const sqlite = freshDatabase();
  const store = sqlite.prepare(`
    SELECT s.id, et.tenant_id
    FROM stores s
    JOIN entity_tenancy et ON et.entity_id = s.entity_id AND et.effective_to IS NULL
    WHERE s.code = 'G001'
  `).get();
  sqlite.prepare(`
    INSERT INTO tenant_policy_settings (tenant_id, setting_key, setting_value, updated_by_role, updated_by_id)
    VALUES (?, 'ui_skin', ?, 'OWNER', 'owner_auto_void_test')
    ON CONFLICT (tenant_id, setting_key) DO UPDATE SET setting_value = excluded.setting_value
  `).run(store.tenant_id, skin);
  if (autoPermit) {
    sqlite.prepare(`
      INSERT INTO store_approval_settings
        (store_id, auto_permit_enabled, enabled_by_role, enabled_by_id, enabled_at, updated_at)
      VALUES (?, 1, 'OWNER', 'owner_auto_void_test', '2026-10-13T00:00:00.000Z', '2026-10-13T00:00:00.000Z')
    `).run(store.id);
  }

  const cashierId = `cashier_auto_void_${suffix}`;
  sqlite.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active) VALUES (?, ?, 'x', 'Kasir Auto Void', ?, 1)`)
    .run(cashierId, cashierId, store.id);
  const token = `token-auto-void-${suffix}`;
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, '2026-10-13T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), cashierId);
  const drawerId = `drawer_auto_void_${suffix}`;
  sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES (?, ?, ?, 0, 'OPEN', '2026-10-13T00:00:00.000Z')`)
    .run(drawerId, store.id, cashierId);
  const saleId = `sale_auto_void_${suffix}`;
  sqlite.prepare(`INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, customer_name, total_amount, created_at) VALUES (?, ?, ?, ?, 'Budi', 25000, '2026-10-13T00:01:00.000Z')`)
    .run(saleId, store.id, drawerId, cashierId);
  return { sqlite, env: { DB: d1(sqlite) }, token, saleId };
}

async function submit(f) {
  const response = await handleTransactionVoidPermitApi(
    request(f.token, { subjectType: 'SALE', subjectId: f.saleId, reason: 'Salah entry' }),
    f.env,
    '/api/cashier/transaction-void/permits'
  );
  return { response, body: await response.json() };
}

test('Skin H with Auto Permit immediately executes the canonical transaction reversal', async () => {
  const f = await fixture();
  try {
    const { response, body } = await submit(f);
    assert.equal(response.status, 201);
    assert.equal(body.autoPermit, true);
    assert.equal(body.executed, true);
    assert.equal(body.permit.approvalStatus, 'approved');
    assert.equal(body.permit.executionStatus, 'EXECUTED');
    assert.equal(body.permit.approvedByRole, 'AUTO_PERMIT');
    assert.equal(body.permit.approvedById, 'owner_auto_void_test');
    assert.ok(f.sqlite.prepare('SELECT voided_at FROM sales WHERE id = ?').get(f.saleId).voided_at);
  } finally {
    f.sqlite.close();
  }
});

test('the same Auto Permit setting does not auto-void outside Skin H', async () => {
  const f = await fixture({ skin: '0', suffix: 'normal' });
  try {
    const { response, body } = await submit(f);
    assert.equal(response.status, 201);
    assert.equal(body.autoPermit, false);
    assert.equal(body.permit.approvalStatus, 'pending_approval');
    assert.equal(body.permit.executionStatus, 'NOT_ATTEMPTED');
    assert.equal(f.sqlite.prepare('SELECT voided_at FROM sales WHERE id = ?').get(f.saleId).voided_at, null);
  } finally {
    f.sqlite.close();
  }
});

test('Skin H still waits for review when the store Auto Permit toggle is off', async () => {
  const f = await fixture({ autoPermit: false, suffix: 'off' });
  try {
    const { response, body } = await submit(f);
    assert.equal(response.status, 201);
    assert.equal(body.autoPermit, false);
    assert.equal(body.permit.approvalStatus, 'pending_approval');
    assert.equal(f.sqlite.prepare('SELECT voided_at FROM sales WHERE id = ?').get(f.saleId).voided_at, null);
  } finally {
    f.sqlite.close();
  }
});
