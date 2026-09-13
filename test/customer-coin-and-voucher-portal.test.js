import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCustomerApi } from '../src/customers.js';
import { handleCustomerMembershipApi } from '../src/customer-membership.js';
import { hashCredential } from '../src/owner-auth.js';
import { getJakartaBusinessDate } from '../src/time.js';

// 2026-09-13, permintaan Bos Cyo: portal customer harus menampilkan Poin,
// Voucher, dan Coin (baru). Coin dikasih manual oleh Admin -- lewat aksi per
// pelanggan, atau lewat notifikasi (ulang tahun hari ini / member baru
// di-ACC) yang tombolnya terkunci sekali dipakai per kejadian.

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
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

async function seedSession(db, { table, actorColumn, actorId, token }) {
  db.prepare(`
    INSERT INTO ${table} (token_hash, ${actorColumn}, created_at, expires_at)
    VALUES (?, ?, '2026-09-06T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(await hashCredential(token), actorId);
  return token;
}

function seedCustomer(db, { id, storeId = 'store_001', name = 'Pelanggan Uji', birthDate = '' }) {
  db.prepare(`
    INSERT INTO customers (id, store_id, customer_code, customer_name, phone, email, notes, birth_date, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, '', '', '', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(id, storeId, `CUST-${id}`, name, birthDate);
}

async function seedCustomerSession(db, customerId, token) {
  db.prepare(`
    INSERT INTO customer_sessions (token_hash, customer_id, created_at, expires_at)
    VALUES (?, ?, '2026-09-06T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(await hashCredential(token), customerId);
}

async function adminToken(db) {
  return seedSession(db, { table: 'store_admin_sessions', actorColumn: 'admin_id', actorId: 'admin_g001_bablil', token: 'coin-admin-token' });
}

function coinBalance(db, customerId) {
  return db.prepare('SELECT COALESCE(SUM(coins_delta), 0) AS balance FROM customer_coin_ledger WHERE customer_id = ?').get(customerId).balance;
}

test('Admin can grant Coin to a customer, and the customer portal sees the new balance', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    seedCustomer(db, { id: 'cust_coin_manual' });
    const admin = await adminToken(db);
    const customerToken = 'coin-customer-token';
    await seedCustomerSession(db, 'cust_coin_manual', customerToken);

    const grantPath = '/api/admin/customers/cust_coin_manual/coins';
    const grantResponse = await handleCustomerApi(
      request(grantPath, { store: 'G001', token: admin, method: 'POST', body: { amount: 3, notes: 'Bonus promo' } }),
      env, grantPath
    );
    assert.equal(grantResponse.status, 201, JSON.stringify(await grantResponse.clone().json()));
    assert.equal((await grantResponse.json()).coins, 3);
    assert.equal(coinBalance(db, 'cust_coin_manual'), 3);

    const coinsPath = '/api/customer/coins';
    const coinsResponse = await handleCustomerMembershipApi(
      request(coinsPath, { store: 'G001', token: customerToken }), env, coinsPath
    );
    assert.equal(coinsResponse.status, 200);
    assert.equal((await coinsResponse.json()).coins, 3);
  } finally {
    db.close();
  }
});

test('birthday-today alert appears once and locks after Coin is granted for it', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const todayMonthDay = getJakartaBusinessDate().slice(5);
    seedCustomer(db, { id: 'cust_birthday', name: 'Ulang Tahun Hari Ini', birthDate: `1990-${todayMonthDay}` });
    seedCustomer(db, { id: 'cust_not_birthday', name: 'Bukan Hari Ini', birthDate: '1990-01-01' });
    const admin = await adminToken(db);

    const alertsPath = '/api/admin/customers/coin-alerts';
    const firstAlerts = await (await handleCustomerApi(
      request(alertsPath, { store: 'G001', token: admin }), env, alertsPath
    )).json();
    const entry = firstAlerts.birthdays.find(item => item.customerId === 'cust_birthday');
    assert.ok(entry, 'expected the birthday customer to appear in the alert list');
    assert.equal(entry.alreadyGranted, false);
    assert.ok(!firstAlerts.birthdays.some(item => item.customerId === 'cust_not_birthday'));

    const grantPath = `/api/admin/customers/${entry.customerId}/coins`;
    const grant = await handleCustomerApi(
      request(grantPath, { store: 'G001', token: admin, method: 'POST', body: { amount: 1, occasion: entry.occasion, referenceId: entry.referenceId } }),
      env, grantPath
    );
    assert.equal(grant.status, 201);

    const secondAlerts = await (await handleCustomerApi(
      request(alertsPath, { store: 'G001', token: admin }), env, alertsPath
    )).json();
    assert.equal(secondAlerts.birthdays.find(item => item.customerId === 'cust_birthday').alreadyGranted, true);

    const repeatGrant = await handleCustomerApi(
      request(grantPath, { store: 'G001', token: admin, method: 'POST', body: { amount: 1, occasion: entry.occasion, referenceId: entry.referenceId } }),
      env, grantPath
    );
    assert.equal(repeatGrant.status, 409);
    assert.equal(coinBalance(db, 'cust_birthday'), 1, 'must not double-grant the same birthday occasion');
  } finally {
    db.close();
  }
});

test('new-member alert appears after ACC and locks after Coin is granted for it', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    seedCustomer(db, { id: 'cust_new_member', name: 'Member Baru' });
    db.prepare(`
      INSERT INTO customer_registration_requests (
        id, request_code, store_id, username, password_hash, customer_name, status, customer_id, reviewed_at, reviewed_by, created_at
      ) VALUES ('req_new_member', 'REG-NEW', 'store_001', 'membernew', 'hash', 'Member Baru', 'APPROVED', 'cust_new_member', CURRENT_TIMESTAMP, 'admin_g001_bablil', CURRENT_TIMESTAMP)
    `).run();
    const admin = await adminToken(db);

    const alertsPath = '/api/admin/customers/coin-alerts';
    const alerts = await (await handleCustomerApi(request(alertsPath, { store: 'G001', token: admin }), env, alertsPath)).json();
    const entry = alerts.newMembers.find(item => item.customerId === 'cust_new_member');
    assert.ok(entry, 'expected the newly-approved member to appear in the alert list');
    assert.equal(entry.referenceId, 'req_new_member');
    assert.equal(entry.alreadyGranted, false);

    const grantPath = `/api/admin/customers/${entry.customerId}/coins`;
    const grant = await handleCustomerApi(
      request(grantPath, { store: 'G001', token: admin, method: 'POST', body: { amount: 2, occasion: 'NEW_MEMBER', referenceId: entry.referenceId } }),
      env, grantPath
    );
    assert.equal(grant.status, 201, JSON.stringify(await grant.clone().json()));
    assert.equal(coinBalance(db, 'cust_new_member'), 2);

    const alertsAfter = await (await handleCustomerApi(request(alertsPath, { store: 'G001', token: admin }), env, alertsPath)).json();
    assert.equal(alertsAfter.newMembers.find(item => item.customerId === 'cust_new_member').alreadyGranted, true);
  } finally {
    db.close();
  }
});

test('a NEW_MEMBER grant referencing a registration request that is not APPROVED for that customer is rejected', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    seedCustomer(db, { id: 'cust_fake_member' });
    db.prepare(`
      INSERT INTO customer_registration_requests (id, request_code, store_id, username, password_hash, customer_name, status, created_at)
      VALUES ('req_pending', 'REG-PEND', 'store_001', 'pendinguser', 'hash', 'Pending', 'PENDING', CURRENT_TIMESTAMP)
    `).run();
    const admin = await adminToken(db);
    const grantPath = '/api/admin/customers/cust_fake_member/coins';
    const grant = await handleCustomerApi(
      request(grantPath, { store: 'G001', token: admin, method: 'POST', body: { amount: 1, occasion: 'NEW_MEMBER', referenceId: 'req_pending' } }),
      env, grantPath
    );
    assert.equal(grant.status, 404);
    assert.equal(coinBalance(db, 'cust_fake_member'), 0);
  } finally {
    db.close();
  }
});

test('customer portal voucher list reflects real voucher_instances, code and product name included', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    seedCustomer(db, { id: 'cust_voucher_view' });
    const customerToken = 'voucher-customer-token';
    await seedCustomerSession(db, 'cust_voucher_view', customerToken);

    const product = db.prepare(`
      SELECT p.id FROM products p WHERE p.store_id = 'store_001' AND p.is_active = 1 ORDER BY p.id LIMIT 1
    `).get();
    const cashier = db.prepare(`SELECT id FROM cashiers WHERE store_id = 'store_001' LIMIT 1`).get();
    const storeEntityId = db.prepare(`SELECT entity_id FROM stores WHERE id = 'store_001'`).get().entity_id;
    db.prepare(`
      INSERT INTO voucher_masters (id, store_id, entity_id, name, active_from, active_until, usage_quota, created_by_role, created_by_id, created_at, updated_at)
      VALUES ('vm_test', 'store_001', ?, 'Kupon Roda Puter', '2026-01-01', '2099-01-01', 1, 'ADMIN', 'admin_g001_bablil', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(storeEntityId);
    db.prepare(`INSERT INTO voucher_master_products (voucher_master_id, store_id, product_id, created_at) VALUES ('vm_test', 'store_001', ?, CURRENT_TIMESTAMP)`).run(product.id);
    db.prepare(`
      INSERT INTO voucher_instances (
        id, code, voucher_master_id, master_store_id, store_id, entity_id, customer_id, customer_name_snapshot,
        distributed_store_id, distributed_by_cashier_id, status, distributed_at, updated_at
      ) VALUES ('vi_test', 'VC-TEST-01', 'vm_test', 'store_001', 'store_001', ?, 'cust_voucher_view', 'Pelanggan Uji',
        'store_001', ?, 'UNUSED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(storeEntityId, cashier.id);

    const vouchersPath = '/api/customer/vouchers';
    const response = await handleCustomerMembershipApi(request(vouchersPath, { store: 'G001', token: customerToken }), env, vouchersPath);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.vouchers.length, 1);
    assert.equal(payload.vouchers[0].code, 'VC-TEST-01');
    assert.equal(payload.vouchers[0].status, 'UNUSED');
    assert.equal(payload.vouchers[0].products[0].id, product.id);
  } finally {
    db.close();
  }
});
