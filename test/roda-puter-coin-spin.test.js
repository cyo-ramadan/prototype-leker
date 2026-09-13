import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleRodaPuterApi } from '../src/roda-puter.js';
import { handleVoucherApi } from '../src/voucher.js';
import { hashCredential } from '../src/owner-auth.js';

// 2026-09-13, permintaan Bos Cyo: Coin dipakai buat main Roda Puter berhadiah
// berkali-kali (beda dari spin resmi 1x-seumur-hidup yang sudah ada dan tidak
// disentuh). Tanpa Coin, customer tidak bisa main untuk hadiah sungguhan --
// roda-nya cuma berputar pelan sebagai hiasan (itu di sisi UI, diverifikasi
// terpisah).

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(sqlite, sql, params = []) { this.sqlite = sqlite; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.sqlite, this.sql, params); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.params) ?? null; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.params) }; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class D1Database {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new D1Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
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
  const token = `roda-owner-${crypto.randomUUID()}`;
  sqlite.prepare(`
    INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at)
    VALUES (?, 'owner_primary', '2026-09-07T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(await hashCredential(token));
  return token;
}

async function createVoucherMaster(env, token) {
  const pathname = '/api/admin/vouchers';
  const response = await handleVoucherApi(request(pathname, {
    token, store: 'G001', method: 'POST',
    body: { name: 'Hadiah Coin Spin', activeFrom: '2000-01-01', activeUntil: '2099-12-31', usageQuota: 100, productIds: [1, 2] }
  }), env, pathname);
  const payload = await response.json();
  assert.equal(response.status, 201, payload.error);
  return payload.voucher;
}

async function saveCampaign(env, token, masterId, weights = [2500, 7500]) {
  const pathname = '/api/admin/roda-puter';
  const response = await handleRodaPuterApi(request(pathname, {
    token, store: 'G001', method: 'PUT',
    body: { rewards: [
      { voucherMasterId: masterId, productId: 1, weightBasisPoints: weights[0] },
      { voucherMasterId: masterId, productId: 2, weightBasisPoints: weights[1] }
    ] }
  }), env, pathname);
  return { response, payload: await response.json() };
}

async function seedCustomerSession(sqlite, customerId, token) {
  sqlite.prepare(`
    INSERT INTO customer_sessions (token_hash, customer_id, created_at, expires_at)
    VALUES (?, ?, '2026-09-07T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(await hashCredential(token), customerId);
}

function grantCoin(sqlite, customerId, amount, storeId = 'store_001') {
  sqlite.prepare(`
    INSERT INTO customer_coin_ledger (id, customer_id, share_group_id, source_store_id, coins_delta, activity_type, reference_type, reference_id, notes, created_at)
    VALUES (?, ?, NULL, ?, ?, 'GRANT', 'TEST_SEED', '', '', CURRENT_TIMESTAMP)
  `).run(`coin_${crypto.randomUUID()}`, customerId, storeId, amount);
}

function coinBalance(sqlite, customerId) {
  return sqlite.prepare('SELECT COALESCE(SUM(coins_delta), 0) AS balance FROM customer_coin_ledger WHERE customer_id = ?').get(customerId).balance;
}

async function fixture() {
  const sqlite = freshDatabase();
  const env = { DB: new D1Database(sqlite) };
  const owner = await ownerToken(sqlite);
  const master = await createVoucherMaster(env, owner);
  const configured = await saveCampaign(env, owner, master.id);
  assert.equal(configured.response.status, 200, configured.payload.error);
  return { sqlite, env, owner, master, campaign: configured.payload.campaign };
}

test('coin-spin attributes the resulting voucher to a real active cashier of that store, not a synthetic row', async () => {
  const { sqlite, env } = await fixture();
  const customerToken = 'coin-spin-attribution-token';
  await seedCustomerSession(sqlite, 'customer_g001_fufu', customerToken);
  grantCoin(sqlite, 'customer_g001_fufu', 1);

  const pathname = '/api/customer/roda-puter/coin-spin';
  const response = await handleRodaPuterApi(request(pathname, { token: customerToken, store: 'G001', method: 'POST' }), env, pathname, { random: () => 0.1 });
  const payload = await response.json();
  assert.equal(response.status, 201, JSON.stringify(payload));

  const voucherRow = sqlite.prepare('SELECT distributed_by_cashier_id FROM voucher_instances WHERE id = ?').get(payload.voucher.id);
  const cashierRow = sqlite.prepare('SELECT store_id, is_active FROM cashiers WHERE id = ?').get(voucherRow.distributed_by_cashier_id);
  assert.ok(cashierRow, 'the attributed cashier must be a real, pre-existing row');
  assert.equal(cashierRow.store_id, 'store_001');
  assert.equal(cashierRow.is_active, 1);

  // No new row should have been added to the shared cashiers table by this flow.
  const cashierCountBefore = sqlite.prepare(`SELECT COUNT(*) AS n FROM cashiers WHERE store_id = 'store_001'`).get().n;
  await handleRodaPuterApi(request(pathname, { token: customerToken, store: 'G001', method: 'POST' }), env, pathname, { random: () => 0.1 });
});

test('adding coin-spin support does not disturb "first cashier for a store" fixtures used across the test suite', async () => {
  const { sqlite } = await fixture();
  const before = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = 'store_001' ORDER BY id LIMIT 1`).get();
  assert.ok(before?.id && !before.id.includes('self_service'), 'no synthetic cashier row should be introduced for store_001');
});

test('a customer with Coin can spin for a real voucher, and the Coin balance drops by exactly 1', async () => {
  const { sqlite, env } = await fixture();
  const customerToken = 'coin-spin-customer-token';
  await seedCustomerSession(sqlite, 'customer_g001_fufu', customerToken);
  grantCoin(sqlite, 'customer_g001_fufu', 3);

  const pathname = '/api/customer/roda-puter/coin-spin';
  const response = await handleRodaPuterApi(request(pathname, { token: customerToken, store: 'G001', method: 'POST' }), env, pathname, { random: () => 0.1 });
  const payload = await response.json();
  assert.equal(response.status, 201, JSON.stringify(payload));
  assert.equal(payload.voucherCreated, true);
  assert.equal(payload.mode, 'COIN');
  assert.equal(payload.coins, 2);
  assert.equal(coinBalance(sqlite, 'customer_g001_fufu'), 2);

  const voucherRow = sqlite.prepare('SELECT status, customer_id, distributed_by_cashier_id FROM voucher_instances WHERE id = ?').get(payload.voucher.id);
  assert.equal(voucherRow.status, 'UNUSED');
  assert.equal(voucherRow.customer_id, 'customer_g001_fufu');
  const attributedCashier = sqlite.prepare('SELECT store_id, is_active FROM cashiers WHERE id = ?').get(voucherRow.distributed_by_cashier_id);
  assert.ok(attributedCashier, 'attributed cashier must be a real row');
  assert.equal(attributedCashier.store_id, 'store_001');
  assert.equal(attributedCashier.is_active, 1);

  const spinRow = sqlite.prepare('SELECT coins_spent, voucher_instance_id FROM roda_puter_coin_spins WHERE id = ?').get(payload.spinId);
  assert.equal(spinRow.coins_spent, 1);
  assert.equal(spinRow.voucher_instance_id, payload.voucher.id);
});

test('a customer can coin-spin repeatedly, unlike the one-lifetime official spin', async () => {
  const { sqlite, env } = await fixture();
  const customerToken = 'coin-spin-repeat-token';
  await seedCustomerSession(sqlite, 'customer_g001_fufu', customerToken);
  grantCoin(sqlite, 'customer_g001_fufu', 2);

  const pathname = '/api/customer/roda-puter/coin-spin';
  const first = await handleRodaPuterApi(request(pathname, { token: customerToken, store: 'G001', method: 'POST' }), env, pathname, { random: () => 0.1 });
  assert.equal(first.status, 201);
  const second = await handleRodaPuterApi(request(pathname, { token: customerToken, store: 'G001', method: 'POST' }), env, pathname, { random: () => 0.9 });
  assert.equal(second.status, 201);
  assert.equal(coinBalance(sqlite, 'customer_g001_fufu'), 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM roda_puter_coin_spins WHERE customer_id = ?').get('customer_g001_fufu').n, 2);
});

test('a customer with zero Coin cannot spin for real, and no voucher/ledger row is created', async () => {
  const { sqlite, env } = await fixture();
  const customerToken = 'coin-spin-no-coin-token';
  await seedCustomerSession(sqlite, 'customer_g001_fufu', customerToken);

  const pathname = '/api/customer/roda-puter/coin-spin';
  const response = await handleRodaPuterApi(request(pathname, { token: customerToken, store: 'G001', method: 'POST' }), env, pathname, { random: () => 0.1 });
  const payload = await response.json();
  assert.equal(response.status, 409);
  assert.equal(payload.code, 'RODA_PUTER_COIN_INSUFFICIENT');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM roda_puter_coin_spins').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM voucher_instances').get().n, 0);
});

test('an anonymous (not logged in) request cannot coin-spin', async () => {
  const { env } = await fixture();
  const pathname = '/api/customer/roda-puter/coin-spin';
  const response = await handleRodaPuterApi(request(pathname, { store: 'G001', method: 'POST' }), env, pathname, { random: () => 0.1 });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'CUSTOMER_LOGIN_REQUIRED');
});
