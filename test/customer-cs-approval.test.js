import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCustomerMembershipApi } from '../src/customer-membership.js';
import { hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const adminUi = readFileSync(new URL('../public/admin-customers.js', import.meta.url), 'utf8');

class D1Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) { return statements.map(statement => statement.run()); }
}

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

function request(pathname, { store, token, method = 'GET', body } = {}) {
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

function seedRegistration(db, { id, storeId, username, customerName }) {
  db.prepare(`
    INSERT INTO customer_registration_requests (
      id, request_code, store_id, username, password_hash, customer_name,
      phone, email, status, created_at
    ) VALUES (?, ?, ?, ?, 'password-hash', ?, '', '', 'PENDING', CURRENT_TIMESTAMP)
  `).run(id, `REG-${id}`, storeId, username, customerName);
}

async function seedSession(db, { table, actorColumn, actorId, token }) {
  db.prepare(`
    INSERT INTO ${table} (token_hash, ${actorColumn}, created_at, expires_at)
    VALUES (?, ?, '2026-09-06T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(await hashCredential(token), actorId);
  return token;
}

async function seedCashierSession(db, storeId) {
  const cashier = db.prepare(`
    SELECT id, username, employee_name
    FROM cashiers
    WHERE store_id = ? AND is_active = 1
    ORDER BY id
    LIMIT 1
  `).get(storeId);
  assert.ok(cashier, `Kasir aktif wajib tersedia untuk ${storeId}`);
  const token = `customer-review-${cashier.id}`;
  await seedSession(db, {
    table: 'cashier_sessions',
    actorColumn: 'cashier_id',
    actorId: cashier.id,
    token
  });
  return { ...cashier, token };
}

async function review(env, { id, store, token, action, reason = '' }) {
  const pathname = `/api/admin/customer-requests/${encodeURIComponent(id)}`;
  return handleCustomerMembershipApi(request(pathname, {
    store,
    token,
    method: 'PATCH',
    body: { action, reason }
  }), env, pathname);
}

test('CS/Kasir can list, approve, and reject pending customer registrations in their own store', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const cashier = await seedCashierSession(db, 'store_001');
    seedRegistration(db, {
      id: 'request_cashier_approve',
      storeId: 'store_001',
      username: 'approved.by.cashier',
      customerName: 'Approved by Cashier'
    });
    seedRegistration(db, {
      id: 'request_cashier_reject',
      storeId: 'store_001',
      username: 'rejected.by.cashier',
      customerName: 'Rejected by Cashier'
    });

    const listPath = '/api/admin/customer-requests';
    const listResponse = await handleCustomerMembershipApi(
      request(listPath, { store: 'G001', token: cashier.token }),
      env,
      listPath
    );
    assert.equal(listResponse.status, 200);
    const listBody = await listResponse.json();
    assert.deepEqual(
      listBody.requests.map(item => item.id).sort(),
      ['request_cashier_approve', 'request_cashier_reject']
    );

    const approveResponse = await review(env, {
      id: 'request_cashier_approve',
      store: 'G001',
      token: cashier.token,
      action: 'APPROVE'
    });
    assert.equal(approveResponse.status, 200);
    const approved = db.prepare(`
      SELECT status, customer_id, reviewed_by
      FROM customer_registration_requests
      WHERE id = 'request_cashier_approve'
    `).get();
    assert.equal(approved.status, 'APPROVED');
    assert.ok(approved.customer_id);
    assert.equal(approved.reviewed_by, cashier.id);
    assert.equal(
      db.prepare('SELECT store_id FROM customers WHERE id = ?').get(approved.customer_id).store_id,
      'store_001'
    );

    const rejectResponse = await review(env, {
      id: 'request_cashier_reject',
      store: 'G001',
      token: cashier.token,
      action: 'REJECT',
      reason: 'Nomor WhatsApp tidak valid'
    });
    assert.equal(rejectResponse.status, 200);
    assert.deepEqual(
      { ...db.prepare(`
        SELECT status, rejection_reason, customer_id, reviewed_by
        FROM customer_registration_requests
        WHERE id = 'request_cashier_reject'
      `).get() },
      {
        status: 'REJECTED',
        rejection_reason: 'Nomor WhatsApp tidak valid',
        customer_id: null,
        reviewed_by: cashier.id
      }
    );
    assert.match(adminUi, /Admin Gerai atau CS\/Kasir gerai/);
  } finally {
    db.close();
  }
});

test('CS/Kasir is rejected with 403 when reviewing a registration from another store', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const cashier = await seedCashierSession(db, 'store_001');
    seedRegistration(db, {
      id: 'request_other_store',
      storeId: 'store_002',
      username: 'other.store.customer',
      customerName: 'Other Store Customer'
    });

    const response = await review(env, {
      id: 'request_other_store',
      store: 'G002',
      token: cashier.token,
      action: 'APPROVE'
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'CASHIER_STORE_SCOPE_MISMATCH');
    assert.deepEqual(
      { ...db.prepare(`
        SELECT status, customer_id, reviewed_by
        FROM customer_registration_requests
        WHERE id = 'request_other_store'
      `).get() },
      { status: 'PENDING', customer_id: null, reviewed_by: '' }
    );
  } finally {
    db.close();
  }
});

test('existing Admin Gerai and Owner customer-review authority remains unchanged', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    seedRegistration(db, {
      id: 'request_admin_approve',
      storeId: 'store_001',
      username: 'approved.by.admin',
      customerName: 'Approved by Admin'
    });
    seedRegistration(db, {
      id: 'request_owner_reject',
      storeId: 'store_002',
      username: 'rejected.by.owner',
      customerName: 'Rejected by Owner'
    });

    const adminToken = await seedSession(db, {
      table: 'store_admin_sessions',
      actorColumn: 'admin_id',
      actorId: 'admin_g001_bablil',
      token: 'customer-review-admin-token'
    });
    const ownerToken = await seedSession(db, {
      table: 'owner_sessions',
      actorColumn: 'owner_id',
      actorId: 'owner_primary',
      token: 'customer-review-owner-token'
    });

    assert.equal((await review(env, {
      id: 'request_admin_approve',
      store: 'G001',
      token: adminToken,
      action: 'APPROVE'
    })).status, 200);
    assert.equal((await review(env, {
      id: 'request_owner_reject',
      store: 'G002',
      token: ownerToken,
      action: 'REJECT',
      reason: 'Ditolak Owner'
    })).status, 200);

    assert.deepEqual(
      { ...db.prepare(`
        SELECT status, reviewed_by
        FROM customer_registration_requests
        WHERE id = 'request_admin_approve'
      `).get() },
      { status: 'APPROVED', reviewed_by: 'Bablil' }
    );
    assert.deepEqual(
      { ...db.prepare(`
        SELECT status, rejection_reason, reviewed_by
        FROM customer_registration_requests
        WHERE id = 'request_owner_reject'
      `).get() },
      { status: 'REJECTED', rejection_reason: 'Ditolak Owner', reviewed_by: 'Owner MAXI Leker' }
    );
  } finally {
    db.close();
  }
});
