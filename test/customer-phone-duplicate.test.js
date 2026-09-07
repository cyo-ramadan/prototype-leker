import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCustomerMembershipApi } from '../src/customer-membership.js';
import { hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);

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

function request(pathname, { store = 'G001', token, method = 'GET', body } = {}) {
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

function seedCustomer(db, {
  id = 'customer_existing_phone',
  storeId = 'store_001',
  customerCode = 'CUST-G001-PHONE-GUARD',
  username = 'existing.phone.customer',
  phone = '0812-3456-7890'
} = {}) {
  db.prepare(`
    INSERT INTO customers (
      id, store_id, customer_code, username, password_hash, customer_name,
      phone, email, notes, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'password-hash', 'Existing Phone Customer', ?, '', '', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(id, storeId, customerCode, username, phone);
}

function seedRegistration(db, {
  id = 'request_duplicate_phone',
  storeId = 'store_001',
  username = 'pending.duplicate.phone',
  phone = '+62 812 3456 7890'
} = {}) {
  db.prepare(`
    INSERT INTO customer_registration_requests (
      id, request_code, store_id, username, password_hash, customer_name,
      phone, email, status, created_at
    ) VALUES (?, ?, ?, ?, 'password-hash', 'Pending Duplicate Phone', ?, '', 'PENDING', CURRENT_TIMESTAMP)
  `).run(id, `REG-${id}`, storeId, username, phone);
}

async function seedCashierSession(db, storeId = 'store_001') {
  const cashier = db.prepare(`
    SELECT id
    FROM cashiers
    WHERE store_id = ? AND is_active = 1
    ORDER BY id
    LIMIT 1
  `).get(storeId);
  assert.ok(cashier, `Kasir aktif wajib tersedia untuk ${storeId}`);
  const token = `duplicate-phone-${cashier.id}`;
  db.prepare(`
    INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at)
    VALUES (?, ?, '2026-09-07T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(await hashCredential(token), cashier.id);
  return token;
}

test('registration rejects an equivalent WhatsApp number already present in Master Customer', async () => {
  const db = migratedDatabase();
  try {
    seedCustomer(db);
    const env = { DB: new D1Database(db) };
    const pathname = '/api/customer/register';
    const response = await handleCustomerMembershipApi(request(pathname, {
      method: 'POST',
      body: {
        customerName: 'Duplicate Phone Applicant',
        phone: '+62 812 3456 7890',
        email: '',
        username: 'duplicate.phone.applicant',
        password: 'secret123'
      }
    }), env, pathname);

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'Customer sudah terdaftar.',
      code: 'CUSTOMER_ALREADY_REGISTERED'
    });
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM customer_registration_requests WHERE username = 'duplicate.phone.applicant'`).get().count,
      0
    );
  } finally {
    db.close();
  }
});

test('approval rechecks duplicate WhatsApp number and keeps the request pending', async () => {
  const db = migratedDatabase();
  try {
    seedRegistration(db);
    seedCustomer(db);
    const token = await seedCashierSession(db);
    const env = { DB: new D1Database(db) };
    const pathname = '/api/admin/customer-requests/request_duplicate_phone';
    const response = await handleCustomerMembershipApi(request(pathname, {
      token,
      method: 'PATCH',
      body: { action: 'APPROVE' }
    }), env, pathname);

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'Customer sudah terdaftar.',
      code: 'CUSTOMER_ALREADY_REGISTERED'
    });
    assert.deepEqual(
      { ...db.prepare(`
        SELECT status, customer_id, reviewed_by
        FROM customer_registration_requests
        WHERE id = 'request_duplicate_phone'
      `).get() },
      { status: 'PENDING', customer_id: null, reviewed_by: '' }
    );
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS count FROM customers WHERE username = 'pending.duplicate.phone'`).get().count,
      0
    );
  } finally {
    db.close();
  }
});

test('empty phone remains optional and does not collide with empty Master Customer phone values', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const pathname = '/api/customer/register';
    const response = await handleCustomerMembershipApi(request(pathname, {
      method: 'POST',
      body: {
        customerName: 'No Phone Applicant',
        phone: '',
        email: '',
        username: 'no.phone.applicant',
        password: 'secret123'
      }
    }), env, pathname);

    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.request.status, 'PENDING');
  } finally {
    db.close();
  }
});
