import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleRodaPuterApi, selectWeightedReward } from '../src/roda-puter.js';
import { handleVoucherApi } from '../src/voucher.js';
import { hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const rodaSource = readFileSync(new URL('../src/roda-puter.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const adminUi = readFileSync(new URL('../public/admin-voucher.js', import.meta.url), 'utf8');
const cashierUi = readFileSync(new URL('../public/cashier.js', import.meta.url), 'utf8');
const customerUi = readFileSync(new URL('../public/customer.js', import.meta.url), 'utf8');

class D1Statement {
  constructor(sqlite, sql, params = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.params = params;
  }

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

async function cashierToken(sqlite, cashierId = 'cashier_wowo') {
  const token = `roda-cashier-${crypto.randomUUID()}`;
  sqlite.prepare(`
    INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at)
    VALUES (?, ?, '2026-09-07T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(await hashCredential(token), cashierId);
  return token;
}

async function createVoucherMaster(env, token) {
  const pathname = '/api/admin/vouchers';
  const response = await handleVoucherApi(request(pathname, {
    token,
    store: 'G001',
    method: 'POST',
    body: {
      name: 'Hadiah Member Baru',
      activeFrom: '2000-01-01',
      activeUntil: '2099-12-31',
      usageQuota: 100,
      productIds: [1, 2]
    }
  }), env, pathname);
  const payload = await response.json();
  assert.equal(response.status, 201, payload.error);
  return payload.voucher;
}

async function saveCampaign(env, token, masterId, weights = [2500, 7500]) {
  const pathname = '/api/admin/roda-puter';
  const response = await handleRodaPuterApi(request(pathname, {
    token,
    store: 'G001',
    method: 'PUT',
    body: {
      rewards: [
        { voucherMasterId: masterId, productId: 1, weightBasisPoints: weights[0] },
        { voucherMasterId: masterId, productId: 2, weightBasisPoints: weights[1] }
      ]
    }
  }), env, pathname);
  return { response, payload: await response.json() };
}

function approveNewMember(sqlite, customerId = 'customer_g001_fufu', cashierId = 'cashier_wowo') {
  const id = `registration_roda_${customerId}`;
  sqlite.prepare(`
    INSERT INTO customer_registration_requests (
      id, request_code, store_id, username, password_hash, customer_name,
      status, customer_id, created_at, reviewed_at, reviewed_by
    )
    SELECT ?, ?, store_id, ?, 'hash', customer_name,
           'APPROVED', id, '2026-09-07T00:30:00.000Z',
           '2026-09-07T00:31:00.000Z', ?
    FROM customers WHERE id = ?
  `).run(id, `REG-RODA-${customerId}`, `roda.${customerId}`, cashierId, customerId);
  return id;
}

async function fixture() {
  const sqlite = freshDatabase();
  const env = { DB: new D1Database(sqlite) };
  const owner = await ownerToken(sqlite);
  const cashier = await cashierToken(sqlite);
  const master = await createVoucherMaster(env, owner);
  const configured = await saveCampaign(env, owner, master.id);
  assert.equal(configured.response.status, 200, configured.payload.error);
  return { sqlite, env, owner, cashier, master, campaign: configured.payload.campaign };
}

test('weighted selector obeys exact deterministic basis-point boundaries and rejects totals other than 100%', () => {
  const rewards = [
    { id: 'small', weightBasisPoints: 2500 },
    { id: 'large', weightBasisPoints: 7500 }
  ];
  assert.equal(selectWeightedReward(rewards, 0).reward.id, 'small');
  assert.equal(selectWeightedReward(rewards, 0.2499).reward.id, 'small');
  assert.equal(selectWeightedReward(rewards, 0.25).reward.id, 'large');
  assert.equal(selectWeightedReward(rewards, 0.999999).reward.id, 'large');
  const invalid = selectWeightedReward([
    { id: 'a', weightBasisPoints: 6000 },
    { id: 'b', weightBasisPoints: 3999 }
  ], 0.1);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'RODA_PUTER_WEIGHT_TOTAL_UNRESOLVED');
  assert.equal(invalid.totalWeightBasisPoints, 9999);
});

test('Admin config is fail-closed unless total is exactly 100%, then exposes only configured rewards', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const owner = await ownerToken(sqlite);
    const master = await createVoucherMaster(env, owner);
    const invalid = await saveCampaign(env, owner, master.id, [5000, 4999]);
    assert.equal(invalid.response.status, 409);
    assert.equal(invalid.payload.code, 'RODA_PUTER_WEIGHT_TOTAL_UNRESOLVED');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM roda_puter_campaigns').get().count, 0);

    const valid = await saveCampaign(env, owner, master.id, [2500, 7500]);
    assert.equal(valid.response.status, 200, valid.payload.error);
    assert.equal(valid.payload.campaign.totalWeightBasisPoints, 10000);
    assert.deepEqual(valid.payload.campaign.rewards.map(reward => ({
      productId: reward.productId,
      weightBasisPoints: reward.weightBasisPoints
    })), [
      { productId: 1, weightBasisPoints: 2500 },
      { productId: 2, weightBasisPoints: 7500 }
    ]);

    const pathname = '/api/roda-puter/rewards';
    const response = await handleRodaPuterApi(
      request(pathname, { store: 'G001' }), env, pathname, { random: () => 0 }
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.campaign.rewards.map(reward => reward.productId), [1, 2]);
    assert.equal(payload.campaign.rewards.some(reward => reward.productId === 3), false);
  } finally {
    sqlite.close();
  }
});

test('demo endpoint can spin repeatedly with controlled RNG and never creates a Voucher Instance', async () => {
  const { sqlite, env, campaign } = await fixture();
  try {
    const pathname = '/api/roda-puter/demo';
    const before = sqlite.prepare('SELECT COUNT(*) AS count FROM voucher_instances').get().count;
    for (const [sample, expectedReward] of [[0.1, campaign.rewards[0].id], [0.9, campaign.rewards[1].id], [0.2, campaign.rewards[0].id]]) {
      const response = await handleRodaPuterApi(
        request(pathname, { store: 'G001', method: 'POST' }),
        env,
        pathname,
        { random: () => sample }
      );
      const payload = await response.json();
      assert.equal(response.status, 200, payload.error);
      assert.equal(payload.mode, 'DEMO');
      assert.equal(payload.voucherCreated, false);
      assert.equal(payload.reward.id, expectedReward);
    }
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM voucher_instances').get().count, before);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM roda_puter_official_spins').get().count, 0);
  } finally {
    sqlite.close();
  }
});

test('official spin requires a valid CS session and one approved member can receive exactly one canonical Voucher', async () => {
  const { sqlite, env, cashier, campaign } = await fixture();
  try {
    const pathname = '/api/cashier/roda-puter/official';
    approveNewMember(sqlite);

    const unauthorized = await handleRodaPuterApi(
      request(pathname, { method: 'POST', body: { customerId: 'customer_g001_fufu' } }),
      env,
      pathname,
      { random: () => 0.9 }
    );
    assert.equal(unauthorized.status, 403);
    assert.equal((await unauthorized.json()).code, 'RODA_PUTER_CASHIER_REQUIRED');

    const first = await handleRodaPuterApi(
      request(pathname, {
        token: cashier,
        method: 'POST',
        body: { customerId: 'customer_g001_fufu' }
      }),
      env,
      pathname,
      { random: () => 0.9 }
    );
    const firstPayload = await first.json();
    assert.equal(first.status, 201, firstPayload.error);
    assert.equal(firstPayload.mode, 'OFFICIAL');
    assert.equal(firstPayload.voucherCreated, true);
    assert.equal(firstPayload.reward.id, campaign.rewards[1].id);
    assert.equal(firstPayload.voucher.customerId, 'customer_g001_fufu');
    assert.equal(firstPayload.voucher.distributedByCashierId, 'cashier_wowo');
    assert.deepEqual({ ...sqlite.prepare(`
      SELECT customer_id, performed_by_cashier_id, voucher_instance_id, random_basis_points
      FROM roda_puter_official_spins
    `).get() }, {
      customer_id: 'customer_g001_fufu',
      performed_by_cashier_id: 'cashier_wowo',
      voucher_instance_id: firstPayload.voucher.id,
      random_basis_points: 9000
    });
    assert.equal(sqlite.prepare(`
      SELECT COUNT(*) AS count FROM voucher_instances WHERE id = ? AND customer_id = ?
    `).get(firstPayload.voucher.id, 'customer_g001_fufu').count, 1);

    const second = await handleRodaPuterApi(
      request(pathname, {
        token: cashier,
        method: 'POST',
        body: { customerId: 'customer_g001_fufu' }
      }),
      env,
      pathname,
      { random: () => 0.1 }
    );
    const secondPayload = await second.json();
    assert.equal(second.status, 409);
    assert.equal(secondPayload.code, 'RODA_PUTER_OFFICIAL_ALREADY_USED');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM roda_puter_official_spins').get().count, 1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM voucher_instances').get().count, 1);
  } finally {
    sqlite.close();
  }
});

test('official spin rejects another CS and customers not freshly approved by that CS', async () => {
  const { sqlite, env } = await fixture();
  try {
    approveNewMember(sqlite);
    const otherCashier = await cashierToken(sqlite, 'cashier_wiwi');
    const pathname = '/api/cashier/roda-puter/official';
    const response = await handleRodaPuterApi(
      request(pathname, {
        token: otherCashier,
        method: 'POST',
        body: { customerId: 'customer_g001_fufu' }
      }),
      env,
      pathname,
      { random: () => 0.1 }
    );
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.code, 'RODA_PUTER_CUSTOMER_NOT_APPROVED_BY_CASHIER');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM voucher_instances').get().count, 0);
  } finally {
    sqlite.close();
  }
});

test('Roda routing and UI keep demo/official paths visibly separate and reuse the Voucher builder', () => {
  assert.match(indexSource, /handleRodaPuterApi/);
  assert.match(rodaSource, /prepareVoucherInstanceDistribution/);
  assert.doesNotMatch(rodaSource, /INSERT INTO voucher_instances/i);
  assert.match(adminUi, /Total wajib tepat 100%/);
  assert.match(adminUi, /\/api\/admin\/roda-puter/);
  assert.match(customerUi, /MODE COBA-COBA · NO VOUCHER/);
  assert.match(customerUi, /\/api\/roda-puter\/demo/);
  assert.match(cashierUi, /MODE RESMI · 1× SAJA/);
  assert.match(cashierUi, /\/api\/cashier\/roda-puter\/official/);
});
