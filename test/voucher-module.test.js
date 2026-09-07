import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleVoucherApi, prepareVoucherInstanceDistribution } from '../src/voucher.js';
import { hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const voucherSource = readFileSync(new URL('../src/voucher.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const cashierUi = readFileSync(new URL('../public/cashier.js', import.meta.url), 'utf8');
const adminUi = readFileSync(new URL('../public/admin-voucher.js', import.meta.url), 'utf8');

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

const invoke = (env, pathname, options) => handleVoucherApi(request(pathname, options), env, pathname);

async function ownerToken(sqlite) {
  const token = `voucher-owner-${crypto.randomUUID()}`;
  sqlite.prepare(`
    INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at)
    VALUES (?, 'owner_primary', '2026-09-06T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(await hashCredential(token));
  return token;
}

async function cashierToken(sqlite, cashierId = 'cashier_wowo') {
  const token = `voucher-cashier-${crypto.randomUUID()}`;
  sqlite.prepare(`
    INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at)
    VALUES (?, ?, '2026-09-06T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(await hashCredential(token), cashierId);
  return token;
}

function prepareTrackedProduct(sqlite, { productId = 1, quantity = 10, averageCost = 2_500_000 } = {}) {
  const product = sqlite.prepare(`SELECT id, store_id, item_type_id FROM products WHERE id = ? AND store_id = 'store_001'`).get(productId);
  assert.ok(product?.item_type_id);
  sqlite.prepare(`UPDATE item_types SET track_stock = 1, can_sell = 1 WHERE id = ? AND store_id = ?`)
    .run(product.item_type_id, product.store_id);
  sqlite.prepare(`
    UPDATE products
    SET is_active = 1, stock_tracking_enabled = 1, average_cost = ?, linked_recipe_id = NULL
    WHERE id = ? AND store_id = ?
  `).run(averageCost, productId, product.store_id);
  sqlite.prepare(`
    INSERT INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
    VALUES (?, ?, ?, '2026-09-06T00:00:00.000Z')
    ON CONFLICT(store_id, product_id) DO UPDATE SET quantity = excluded.quantity
  `).run(product.store_id, productId, quantity);
  return { productId, storeId: product.store_id, averageCost };
}

function openDrawer(sqlite, cashierId = 'cashier_wowo') {
  const id = `drawer_voucher_${crypto.randomUUID()}`;
  sqlite.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES (?, 'store_001', ?, 0, 'OPEN', '2026-09-06T01:00:00.000Z')
  `).run(id, cashierId);
  return id;
}

async function createMaster(env, token, overrides = {}) {
  const response = await invoke(env, '/api/admin/vouchers', {
    token,
    store: 'G001',
    method: 'POST',
    body: {
      name: 'Voucher Leker Pilihan',
      activeFrom: '2000-01-01',
      activeUntil: '2099-12-31',
      usageQuota: 5,
      productIds: [1, 2],
      ...overrides
    }
  });
  const payload = await response.json();
  assert.equal(response.status, 201, payload.error);
  return payload.voucher;
}

async function distribute(env, token, masterId, customerId) {
  const response = await invoke(env, '/api/cashier/vouchers/distribute', {
    token,
    method: 'POST',
    body: { masterId, customerId }
  });
  return { response, payload: await response.json() };
}

async function redeem(env, token, voucherId, customerId, productId = 1) {
  const response = await invoke(env, '/api/cashier/vouchers/redeem', {
    token,
    method: 'POST',
    body: { voucherId, customerId, productId }
  });
  return { response, payload: await response.json() };
}

async function operationalFixture(sqlite, { edition = 'LITE', quota = 5 } = {}) {
  sqlite.prepare(`UPDATE stores SET edition = ? WHERE id = 'store_001'`).run(edition);
  prepareTrackedProduct(sqlite);
  openDrawer(sqlite);
  const env = { DB: new D1Database(sqlite) };
  const admin = await ownerToken(sqlite);
  const cashier = await cashierToken(sqlite);
  const master = await createMaster(env, admin, { usageQuota: quota });
  return { env, admin, cashier, master };
}

test('migration 0076 keeps Voucher operational while seeding bridge accounts only for ACCOUNTING stores', () => {
  const sqlite = freshDatabase();
  try {
    for (const table of ['voucher_masters', 'voucher_master_products', 'voucher_instances', 'voucher_redemptions']) {
      assert.ok(sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table));
    }
    const amounts = sqlite.prepare(`PRAGMA table_info(voucher_redemptions)`).all()
      .filter(column => ['unit_cost_snapshot_scaled', 'total_cost_snapshot_scaled'].includes(column.name));
    assert.deepEqual(amounts.map(column => String(column.type).toUpperCase()), ['INTEGER', 'INTEGER']);

    const accounts = sqlite.prepare(`
      SELECT code, name, type, subtype
      FROM chart_of_accounts
      WHERE store_id = 'store_001' AND code IN ('1304', '6105')
      ORDER BY code
    `).all();
    assert.deepEqual(accounts.map(account => ({ ...account })), [
      { code: '1304', name: 'Persediaan - Vocer Promosi', type: 'ASSET', subtype: 'INVENTORY' },
      { code: '6105', name: 'Beban Promosi', type: 'EXPENSE', subtype: 'PROMOTIONAL_EXPENSE' }
    ]);
    assert.equal(sqlite.prepare(`
      SELECT COUNT(*) AS count FROM transaction_categories WHERE store_id = 'store_ikan01' AND code = 'voucher_redemption'
    `).get().count, 0);
    assert.equal(sqlite.prepare(`
      SELECT COUNT(*) AS count FROM transaction_categories WHERE code = 'voucher_redemption'
    `).get().count, 0);
  } finally { sqlite.close(); }
});

test('Admin CRUD Master Voucher preserves date range and exact Master Barang choices', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: new D1Database(sqlite) };
    const token = await ownerToken(sqlite);
    const created = await createMaster(env, token, {
      name: 'September Ceria',
      activeFrom: '2026-09-01',
      activeUntil: '2026-09-30',
      usageQuota: 20,
      productIds: [1, 2]
    });
    assert.equal(created.name, 'September Ceria');
    assert.deepEqual(created.products.map(product => product.id), [1, 2]);

    const updatedResponse = await invoke(env, `/api/admin/vouchers/${created.id}`, {
      token,
      store: 'G001',
      method: 'PATCH',
      body: {
        name: 'September Ceria Revisi',
        activeFrom: '2026-09-02',
        activeUntil: '2026-10-15',
        usageQuota: 25,
        productIds: [2]
      }
    });
    const updated = await updatedResponse.json();
    assert.equal(updatedResponse.status, 200, updated.error);
    assert.equal(updated.voucher.name, 'September Ceria Revisi');
    assert.equal(updated.voucher.activeFrom, '2026-09-02');
    assert.equal(updated.voucher.activeUntil, '2026-10-15');
    assert.deepEqual(updated.voucher.products.map(product => product.id), [2]);

    const listResponse = await invoke(env, '/api/admin/vouchers', { token, store: 'G001' });
    const list = await listResponse.json();
    assert.ok(list.products.some(product => product.id === 2), 'picker reads the existing Master Barang');
    assert.equal(list.vouchers.find(voucher => voucher.id === created.id).usageQuota, 25);

    const deletedResponse = await invoke(env, `/api/admin/vouchers/${created.id}`, { token, store: 'G001', method: 'DELETE' });
    assert.deepEqual(await deletedResponse.json(), { ok: true, deleted: true });
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM voucher_masters WHERE id = ?').get(created.id).count, 0);
  } finally { sqlite.close(); }
});

test('Voucher instance belongs to exactly one shared-scope customer and another customer gets 403', async () => {
  const sqlite = freshDatabase();
  try {
    const { env, cashier, master } = await operationalFixture(sqlite);
    const issued = await distribute(env, cashier, master.id, 'customer_g001_fufu');
    assert.equal(issued.response.status, 201, issued.payload.error);
    assert.equal(issued.payload.voucher.customerId, 'customer_g001_fufu');
    assert.equal(issued.payload.voucher.distributedByCashierId, 'cashier_wowo');

    const stolen = await redeem(env, cashier, issued.payload.voucher.id, 'customer_g001_fafa');
    assert.equal(stolen.response.status, 403);
    assert.equal(stolen.payload.code, 'VOUCHER_CUSTOMER_MISMATCH');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM voucher_redemptions').get().count, 0);
  } finally { sqlite.close(); }
});

test('canonical Voucher Instance builder stays write-free until its statement joins the caller transaction', async () => {
  const sqlite = freshDatabase();
  try {
    const { env, master } = await operationalFixture(sqlite);
    const before = sqlite.prepare('SELECT COUNT(*) AS count FROM voucher_instances').get().count;
    const prepared = await prepareVoucherInstanceDistribution(env.DB, {
      masterId: master.id,
      masterStoreId: 'store_001',
      customerId: 'customer_g001_fufu',
      distributedStoreId: 'store_001',
      distributedStoreCode: 'G001',
      distributedByCashierId: 'cashier_wowo',
      businessDate: '2026-09-07',
      now: '2026-09-07T10:00:00.000Z'
    });
    assert.equal(prepared.ok, true, prepared.error);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM voucher_instances').get().count, before);
    assert.equal(prepared.voucher.masterId, master.id);
    assert.equal(prepared.voucher.customerId, 'customer_g001_fufu');
    assert.equal(prepared.voucher.distributedByCashierId, 'cashier_wowo');

    await env.DB.batch([prepared.statement]);
    assert.deepEqual({ ...sqlite.prepare(`
      SELECT id, voucher_master_id, customer_id, distributed_by_cashier_id, status
      FROM voucher_instances WHERE id = ?
    `).get(prepared.voucher.id) }, {
      id: prepared.voucher.id,
      voucher_master_id: master.id,
      customer_id: 'customer_g001_fufu',
      distributed_by_cashier_id: 'cashier_wowo',
      status: 'UNUSED'
    });
  } finally { sqlite.close(); }
});

test('LITE redemption uses the exact Sale stock engine and creates no Accounting journal', async () => {
  const sqlite = freshDatabase();
  try {
    const { env, cashier, master } = await operationalFixture(sqlite, { edition: 'LITE' });
    const issued = await distribute(env, cashier, master.id, 'customer_g001_fufu');
    const journalCountBefore = Number(sqlite.prepare('SELECT COUNT(*) AS count FROM accounting_journal_headers').get().count);
    const result = await redeem(env, cashier, issued.payload.voucher.id, 'customer_g001_fufu', 1);
    assert.equal(result.response.status, 201, result.payload.error);
    assert.equal(result.payload.redemption.unitCostSnapshotScaled, 2_500_000);
    assert.equal(sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = 'store_001' AND product_id = 1`).get().quantity, 9);

    const movement = sqlite.prepare(`
      SELECT source_key, source_type, source_id, direction, quantity
      FROM stock_movements WHERE source_id = ? AND product_id = 1
    `).get(result.payload.redemption.id);
    assert.deepEqual({ ...movement }, {
      source_key: `SALE:${result.payload.redemption.id}:1`,
      source_type: 'SALE',
      source_id: result.payload.redemption.id,
      direction: 'OUT',
      quantity: 1
    });
    assert.equal(Number(sqlite.prepare('SELECT COUNT(*) AS count FROM accounting_journal_headers').get().count), journalCountBefore);
  } finally { sqlite.close(); }
});

test('expired and quota-exhausted vouchers are both rejected at redemption', async () => {
  const sqlite = freshDatabase();
  try {
    const { env, cashier, master } = await operationalFixture(sqlite, { quota: 1 });
    const first = await distribute(env, cashier, master.id, 'customer_g001_fufu');
    const second = await distribute(env, cashier, master.id, 'customer_g001_fufu');
    const used = await redeem(env, cashier, first.payload.voucher.id, 'customer_g001_fufu');
    assert.equal(used.response.status, 201, used.payload.error);
    const exhausted = await redeem(env, cashier, second.payload.voucher.id, 'customer_g001_fufu');
    assert.equal(exhausted.response.status, 409);
    assert.equal(exhausted.payload.code, 'VOUCHER_NOT_REDEEMABLE');

    const otherMaster = await createMaster(env, await ownerToken(sqlite), { name: 'Akan Kadaluarsa', usageQuota: 2 });
    const expiring = await distribute(env, cashier, otherMaster.id, 'customer_g001_fafa');
    sqlite.prepare(`UPDATE voucher_masters SET active_from = '1999-01-01', active_until = '2000-01-01' WHERE id = ?`).run(otherMaster.id);
    const expired = await redeem(env, cashier, expiring.payload.voucher.id, 'customer_g001_fafa');
    assert.equal(expired.response.status, 409);
    assert.equal(expired.payload.code, 'VOUCHER_NOT_REDEEMABLE');
  } finally { sqlite.close(); }
});

test('ACCOUNTING redemption posts balanced promotion expense, never revenue', async () => {
  const sqlite = freshDatabase();
  try {
    const { env, cashier, master } = await operationalFixture(sqlite, { edition: 'ACCOUNTING' });
    const issued = await distribute(env, cashier, master.id, 'customer_g001_fufu');
    const result = await redeem(env, cashier, issued.payload.voucher.id, 'customer_g001_fufu');
    assert.equal(result.response.status, 201, result.payload.error);
    const lines = sqlite.prepare(`
      SELECT l.side, l.amount_scaled, a.name, a.type
      FROM accounting_journal_headers h
      JOIN accounting_journal_lines l ON l.journal_id = h.id AND l.store_id = h.store_id
      JOIN chart_of_accounts a ON a.id = l.account_id AND a.store_id = l.store_id
      WHERE h.source_system = 'VOUCHER' AND h.source_reference_id = ?
      ORDER BY l.line_number
    `).all(result.payload.redemption.id);
    assert.deepEqual(lines.map(line => ({ ...line })), [
      { side: 'DEBIT', amount_scaled: 2_500_000, name: 'Beban Promosi', type: 'EXPENSE' },
      { side: 'CREDIT', amount_scaled: 2_500_000, name: 'Persediaan - Vocer Promosi', type: 'ASSET' }
    ]);
    assert.equal(lines.some(line => line.type === 'REVENUE'), false);
  } finally { sqlite.close(); }
});

test('Voucher routing and both Admin/Kasir surfaces are wired without a second stock or Accounting engine', () => {
  assert.match(indexSource, /handleVoucherApi/);
  assert.match(indexSource, /admin-voucher\.js/);
  assert.match(voucherSource, /prepareSaleStockProduction/);
  assert.match(voucherSource, /postVoucherRedemptionJournal/);
  assert.doesNotMatch(voucherSource, /INSERT INTO (?:inventory_stock_balances|stock_movements)/i);
  assert.doesNotMatch(voucherSource, /postAccountingJournal/);
  assert.match(adminUi, /Pilih barang dari Master Barang/);
  assert.match(adminUi, /\/api\/admin\/vouchers/);
  assert.match(cashierUi, /\/api\/cashier\/vouchers\/distribute/);
  assert.match(cashierUi, /\/api\/cashier\/vouchers\/redeem/);
});
