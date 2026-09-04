import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleApprovalQueueApi } from '../src/approval-queue.js';
import { hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const approvalQueueSource = readFileSync(new URL('../src/approval-queue.js', import.meta.url), 'utf8');
const managementUi = readFileSync(new URL('../public/management-approval-queue.js', import.meta.url), 'utf8');

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
  const token = 'auto-permit-owner-token';
  sqlite.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, '2026-09-04T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), owner.id);
  return { token, ownerId: owner.id };
}

async function storeAdminToken(sqlite, storeId, { id = 'admin_auto_permit_test', username = 'admin_auto_permit_test' } = {}) {
  const token = `auto-permit-admin-${id}`;
  sqlite.prepare(`INSERT INTO store_admins (id, store_id, username, password_hash, display_name, is_active) VALUES (?, ?, ?, 'x', 'Admin Auto Permit Test', 1)`)
    .run(id, storeId, username);
  sqlite.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, '2026-09-04T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), id);
  return { token, adminId: id };
}

async function entityAdminToken(sqlite, entityId, { id = 'entity_admin_auto_permit_test', username = 'entity_admin_auto_permit_test' } = {}) {
  sqlite.prepare(`INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active) VALUES (?, ?, ?, 'x', 'Entity Admin Auto Permit Test', 1)`)
    .run(id, entityId, username);
  const token = `auto-permit-entity-admin-${id}`;
  sqlite.prepare(`INSERT INTO entity_admin_sessions (token_hash, entity_admin_id, created_at, expires_at) VALUES (?, ?, '2026-09-04T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), id);
  return { token, entityAdminId: id };
}

async function cashierWithOpenDrawer(sqlite, storeId, { id = 'cashier_auto_permit_test', username = 'cashier_auto_permit_test' } = {}) {
  sqlite.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active) VALUES (?, ?, 'x', 'Kasir Auto Permit Test', ?, 1)`)
    .run(id, username, storeId);
  const token = `auto-permit-cashier-${id}`;
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, '2026-09-04T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), id);
  const drawerId = `drawer_${id}`;
  sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES (?, ?, ?, 0, 'OPEN', '2026-09-04T00:00:00.000Z')`)
    .run(drawerId, storeId, id);
  return { token, cashierId: id, drawerId };
}

test('Auto Permit is off by default: cashier submission stays pending_approval/unposted, exactly like before this feature', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const product = sqlite.prepare(`SELECT id FROM products WHERE store_id = ? AND base_unit_id IS NOT NULL ORDER BY id LIMIT 1`).get(store.id);
    const cashier = await cashierWithOpenDrawer(sqlite, store.id);

    const response = await handleApprovalQueueApi(
      request('/api/cashier/approval-requests', {
        token: cashier.token, method: 'POST',
        body: { requestType: 'GOODS_FLOW', payload: { productId: product.id, direction: 'IN', quantity: 5 } }
      }),
      env, '/api/cashier/approval-requests'
    );
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.request.approvalStatus, 'pending_approval');
    assert.equal(body.request.postingStatus, 'unposted');
    assert.equal(body.autoPermit, undefined);

    const balance = sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`).get(store.id, product.id);
    assert.equal(balance ?? null, null, 'stock must not move while the request is still pending');
  } finally {
    sqlite.close();
  }
});

test('Owner enabling Auto Permit stamps accountability, and a cashier submission afterwards posts immediately with AUTO_PERMIT pointing back at the Owner', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const product = sqlite.prepare(`SELECT id FROM products WHERE store_id = ? AND base_unit_id IS NOT NULL ORDER BY id LIMIT 1`).get(store.id);
    const { token: owner, ownerId } = await ownerToken(sqlite);

    const before = await handleApprovalQueueApi(request('/api/management/approval-settings', { token: owner, store: 'G001' }), env, '/api/management/approval-settings');
    assert.equal(before.status, 200);
    const beforeBody = await before.json();
    assert.equal(beforeBody.settings.autoPermitEnabled, false);

    const enable = await handleApprovalQueueApi(
      request('/api/management/approval-settings', { token: owner, store: 'G001', method: 'PATCH', body: { enabled: true } }),
      env, '/api/management/approval-settings'
    );
    assert.equal(enable.status, 200);
    const enableBody = await enable.json();
    assert.equal(enableBody.settings.autoPermitEnabled, true);
    assert.equal(enableBody.settings.enabledByRole, 'OWNER');
    assert.equal(enableBody.settings.enabledById, ownerId);
    assert.ok(enableBody.settings.enabledAt);

    const cashier = await cashierWithOpenDrawer(sqlite, store.id);
    const submit = await handleApprovalQueueApi(
      request('/api/cashier/approval-requests', {
        token: cashier.token, method: 'POST',
        body: { requestType: 'GOODS_FLOW', payload: { productId: product.id, direction: 'IN', quantity: 7 } }
      }),
      env, '/api/cashier/approval-requests'
    );
    assert.equal(submit.status, 201);
    const submitBody = await submit.json();
    assert.equal(submitBody.request.approvalStatus, 'approved');
    assert.equal(submitBody.request.postingStatus, 'posted');
    assert.equal(submitBody.request.approvedByRole, 'AUTO_PERMIT');
    assert.equal(submitBody.request.approvedById, ownerId, 'auto-approved rows must trace back to the account that enabled the toggle, not the cashier');
    assert.deepEqual(submitBody.autoPermit, { attempted: true, posted: true });

    const balance = sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`).get(store.id, product.id);
    assert.equal(balance.quantity, 7, 'the real stock effect must have posted, not just the row status');

    const ledgerActor = sqlite.prepare(`SELECT approved_by_role, approved_by_id FROM inventory_ledger_entries WHERE approval_request_id = ?`).get(submitBody.request.id);
    assert.equal(ledgerActor.approved_by_role, 'AUTO_PERMIT');
    assert.equal(ledgerActor.approved_by_id, ownerId);
  } finally {
    sqlite.close();
  }
});

test('a posting failure under Auto Permit (insufficient stock) leaves the row pending_approval, not rejected or lost', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const product = sqlite.prepare(`SELECT id FROM products WHERE store_id = ? AND base_unit_id IS NOT NULL ORDER BY id LIMIT 1`).get(store.id);
    const { token: owner } = await ownerToken(sqlite);
    await handleApprovalQueueApi(
      request('/api/management/approval-settings', { token: owner, store: 'G001', method: 'PATCH', body: { enabled: true } }),
      env, '/api/management/approval-settings'
    );

    const cashier = await cashierWithOpenDrawer(sqlite, store.id);
    const submit = await handleApprovalQueueApi(
      request('/api/cashier/approval-requests', {
        token: cashier.token, method: 'POST',
        body: { requestType: 'GOODS_FLOW', payload: { productId: product.id, direction: 'OUT', quantity: 999 } }
      }),
      env, '/api/cashier/approval-requests'
    );
    assert.equal(submit.status, 201, 'submission itself always succeeds -- only the auto-posting attempt can fail');
    const submitBody = await submit.json();
    assert.equal(submitBody.request.approvalStatus, 'pending_approval');
    assert.equal(submitBody.request.postingStatus, 'unposted');
    assert.equal(submitBody.autoPermit.attempted, true);
    assert.equal(submitBody.autoPermit.posted, false);
    assert.match(submitBody.autoPermit.reason, /stok tidak cukup/i);

    const stillThere = sqlite.prepare(`SELECT approval_status, posting_status FROM approval_requests WHERE id = ?`).get(submitBody.request.id);
    assert.equal(stillThere.approval_status, 'pending_approval');
    assert.equal(stillThere.posting_status, 'unposted');
  } finally {
    sqlite.close();
  }
});

test('approval-settings enforces the same store scope as approval-requests: Admin Gerai cannot toggle another store', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const storeG001 = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const storeG002 = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G002'`).get();
    const { token: adminG001 } = await storeAdminToken(sqlite, storeG001.id);

    const ownScope = await handleApprovalQueueApi(request('/api/management/approval-settings', { token: adminG001, store: 'G001' }), env, '/api/management/approval-settings');
    assert.equal(ownScope.status, 200);

    const otherScope = await handleApprovalQueueApi(
      request('/api/management/approval-settings', { token: adminG001, store: 'G002', method: 'PATCH', body: { enabled: true } }),
      env, '/api/management/approval-settings'
    );
    assert.equal(otherScope.status, 403);

    const untouchedByOtherAdmin = sqlite.prepare(`SELECT auto_permit_enabled FROM store_approval_settings WHERE store_id = ?`).get(storeG002.id);
    assert.equal(untouchedByOtherAdmin ?? null, null);
  } finally {
    sqlite.close();
  }
});

test('an Admin Gerai enabling Auto Permit for its own store stamps ADMIN, distinct from OWNER', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G002'`).get();
    const { token: admin, adminId } = await storeAdminToken(sqlite, store.id);

    const enable = await handleApprovalQueueApi(
      request('/api/management/approval-settings', { token: admin, store: 'G002', method: 'PATCH', body: { enabled: true } }),
      env, '/api/management/approval-settings'
    );
    assert.equal(enable.status, 200);
    const enableBody = await enable.json();
    assert.equal(enableBody.settings.enabledByRole, 'ADMIN');
    assert.equal(enableBody.settings.enabledById, adminId);

    const disable = await handleApprovalQueueApi(
      request('/api/management/approval-settings', { token: admin, store: 'G002', method: 'PATCH', body: { enabled: false } }),
      env, '/api/management/approval-settings'
    );
    const disableBody = await disable.json();
    assert.equal(disableBody.settings.autoPermitEnabled, false);
    assert.equal(disableBody.settings.enabledByRole, 'ADMIN', 'turning it off must not erase who last turned it on');
    assert.equal(disableBody.settings.enabledById, adminId);
  } finally {
    sqlite.close();
  }
});

test('Entity Admin can enable Auto Permit for a store inside its own Entity, and is rejected outside it', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const galeh = sqlite.prepare(`SELECT id FROM stores WHERE code = 'IKAN01'`).get();
    const { token, entityAdminId } = await entityAdminToken(sqlite, 'ENT-GALEH');

    const inEntity = await handleApprovalQueueApi(
      request('/api/management/approval-settings', { token, store: 'IKAN01', method: 'PATCH', body: { enabled: true } }),
      env, '/api/management/approval-settings'
    );
    assert.equal(inEntity.status, 200);
    const inEntityBody = await inEntity.json();
    assert.equal(inEntityBody.settings.enabledByRole, 'ENTITY_ADMIN');
    assert.equal(inEntityBody.settings.enabledById, entityAdminId);

    const outsideEntity = await handleApprovalQueueApi(
      request('/api/management/approval-settings', { token, store: 'G001', method: 'PATCH', body: { enabled: true } }),
      env, '/api/management/approval-settings'
    );
    assert.equal(outsideEntity.status, 403);
    const outsideBody = await outsideEntity.json();
    assert.equal(outsideBody.code, 'ENTITY_ADMIN_STORE_SCOPE_MISMATCH');

    const g001Settings = sqlite.prepare(`SELECT auto_permit_enabled FROM store_approval_settings WHERE store_id = ?`).get(
      sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get().id
    );
    assert.equal(g001Settings ?? null, null, 'the out-of-entity store must be untouched');
  } finally {
    sqlite.close();
  }
});

test('Auto Permit and the management ACC decision share one posting function -- no duplicated implementation', () => {
  const totalOccurrences = (approvalQueueSource.match(/applyAccDecision\(/g) || []).length;
  const applyAccDecisionDefined = (approvalQueueSource.match(/async function applyAccDecision\(/g) || []).length;
  assert.equal(applyAccDecisionDefined, 1, 'applyAccDecision must be defined exactly once');
  assert.equal(totalOccurrences - applyAccDecisionDefined, 2, 'applyAccDecision must be called from exactly two places: the cashier Auto Permit path and the management ACC decision');
  assert.equal(
    (approvalQueueSource.match(/buildOperationalPostingStatements\(/g) || []).length,
    1,
    'buildOperationalPostingStatements must only be invoked once, from inside applyAccDecision -- never duplicated at a second call site'
  );
});

test('Auto Permit UI toggle is wired into the per-store Admin panel only, not the Owner cross-store view', () => {
  assert.match(managementUi, /autoPermitToggle/);
  assert.match(managementUi, /\/api\/management\/approval-settings/);
  assert.match(managementUi, /confirm\(/);
  const mountBranchAdminBody = managementUi.split('function mountBranchAdmin()')[1]?.split('function mountOwner()')[0] || '';
  const mountOwnerBody = managementUi.split('function mountOwner()')[1] || '';
  assert.match(mountBranchAdminBody, /autoPermitToggle/);
  assert.doesNotMatch(mountOwnerBody, /autoPermitToggle/);
});
