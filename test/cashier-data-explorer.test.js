import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierDataApi } from '../src/cashier-data-explorer.js';
import { hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const stockExplorerUi = readFileSync(new URL('../public/cashier-data-explorer.js', import.meta.url), 'utf8');

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
    return { meta: { changes: Number(result.changes || 0) } };
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

async function cashierToken(db, storeId) {
  const cashier = db.prepare('SELECT id FROM cashiers WHERE store_id = ? AND is_active = 1 ORDER BY id LIMIT 1').get(storeId);
  const token = `cashier-data-token-${storeId}`;
  const tokenHash = await hashCredential(token);
  db.prepare(`
    INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at)
    VALUES (?, ?, '2026-08-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
  `).run(tokenHash, cashier.id);
  return { token, cashierId: cashier.id };
}

function openDrawer(db, id, storeId, cashierId) {
  db.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES (?, ?, ?, 100000, 'OPEN', '2026-08-17T00:00:00.000Z')
  `).run(id, storeId, cashierId);
}

function request(pathname, { token, params = '' } = {}) {
  return new Request(`https://example.test${pathname}${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}

test('Kasir Data Transaksi sees its own store sale, scoped without a client-supplied store param', async () => {
  const db = migratedDatabase();
  try {
    const { token, cashierId } = await cashierToken(db, 'store_001');
    const { cashierId: cashierIdG002 } = await cashierToken(db, 'store_002');
    openDrawer(db, 'drawer_g001_test', 'store_001', cashierId);
    openDrawer(db, 'drawer_g002_test', 'store_002', cashierIdG002);
    db.prepare(`
      INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, customer_name, total_amount, created_at)
      VALUES ('sale_g001_test', 'store_001', 'drawer_g001_test', ?, 'Budi', 25000, '2026-08-17T09:00:00.000Z')
    `).run(cashierId);
    db.prepare(`
      INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, customer_name, total_amount, created_at)
      VALUES ('sale_g002_test', 'store_002', 'drawer_g002_test', ?, 'Sinta', 30000, '2026-08-17T09:00:00.000Z')
    `).run(cashierIdG002);

    const env = { DB: new D1Database(db) };
    const response = await handleCashierDataApi(
      request('/api/cashier/data/transactions', { token }),
      env,
      '/api/cashier/data/transactions'
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    const ids = body.transactions.map(item => item.id);
    assert.ok(ids.includes('sale_g001_test'), 'must see its own store sale');
    assert.ok(!ids.includes('sale_g002_test'), 'must never see another store sale even without a store param');
  } finally {
    db.close();
  }
});

test('Kasir Data Stok reuses the same balance/movement query as Admin, scoped to its own store', async () => {
  const db = migratedDatabase();
  try {
    const product = db.prepare("SELECT id FROM products WHERE store_id = 'store_001' LIMIT 1").get();
    assert.ok(product, 'G001 seed product required');
    const { token } = await cashierToken(db, 'store_001');
    const env = { DB: new D1Database(db) };

    const balances = await handleCashierDataApi(request('/api/cashier/data/stock', { token }), env, '/api/cashier/data/stock');
    assert.equal(balances.status, 200);
    const balancesBody = await balances.json();
    assert.ok(balancesBody.stocks.some(row => row.productId === product.id));

    const movements = await handleCashierDataApi(
      request(`/api/cashier/data/stock/${product.id}/movements`, { token }),
      env,
      `/api/cashier/data/stock/${product.id}/movements`
    );
    assert.equal(movements.status, 200);
    const movementsBody = await movements.json();
    assert.equal(movementsBody.product.productId, product.id);
  } finally {
    db.close();
  }
});

test('Kasir Data endpoints require a cashier session and are read-only', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const unauthorized = await handleCashierDataApi(request('/api/cashier/data/transactions'), env, '/api/cashier/data/transactions');
    assert.equal(unauthorized.status, 401);

    const { token } = await cashierToken(db, 'store_001');
    const write = await handleCashierDataApi(
      new Request('https://example.test/api/cashier/data/transactions', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }),
      env,
      '/api/cashier/data/transactions'
    );
    assert.equal(write.status, 405);
  } finally {
    db.close();
  }
});

test('Kasir Data Transaksi filter STOCK_ADJUSTMENTS isolates purpose=STOCK_ADJUSTMENT GOODS_FLOW rows from plain Arus Barang and Produksi', async () => {
  const db = migratedDatabase();
  try {
    const { token, cashierId } = await cashierToken(db, 'store_001');
    const drawerId = 'drawer_filter_test';
    openDrawer(db, drawerId, 'store_001', cashierId);

    db.prepare(`
      INSERT INTO approval_requests (id, store_id, drawer_session_id, cashier_id, request_type, approval_status, posting_status, payload_json, created_at, updated_at)
      VALUES ('approval_stock_adj_filter_test', 'store_001', ?, ?, 'GOODS_FLOW', 'pending_approval', 'unposted', ?, '2026-09-14T09:00:00.000Z', '2026-09-14T09:00:00.000Z')
    `).run(drawerId, cashierId, JSON.stringify({ purpose: 'STOCK_ADJUSTMENT', productName: 'Larutan Gula', direction: 'OUT', quantity: 5 }));
    db.prepare(`
      INSERT INTO approval_requests (id, store_id, drawer_session_id, cashier_id, request_type, approval_status, posting_status, payload_json, created_at, updated_at)
      VALUES ('approval_plain_goods_flow_filter_test', 'store_001', ?, ?, 'GOODS_FLOW', 'pending_approval', 'unposted', ?, '2026-09-14T09:01:00.000Z', '2026-09-14T09:01:00.000Z')
    `).run(drawerId, cashierId, JSON.stringify({ productName: 'Gula', direction: 'IN', quantity: 10 }));

    const env = { DB: new D1Database(db) };
    const stockAdjResponse = await handleCashierDataApi(
      request('/api/cashier/data/transactions', { token, params: '?filter=STOCK_ADJUSTMENTS' }), env, '/api/cashier/data/transactions'
    );
    const stockAdjBody = await stockAdjResponse.json();
    assert.equal(stockAdjBody.transactions.length, 1);
    assert.equal(stockAdjBody.transactions[0].id, 'approval_stock_adj_filter_test');

    const inventoryResponse = await handleCashierDataApi(
      request('/api/cashier/data/transactions', { token, params: '?filter=INVENTORY' }), env, '/api/cashier/data/transactions'
    );
    const inventoryBody = await inventoryResponse.json();
    const inventoryIds = inventoryBody.transactions.map(item => item.id);
    assert.ok(inventoryIds.includes('approval_plain_goods_flow_filter_test'));
    assert.ok(!inventoryIds.includes('approval_stock_adj_filter_test'), 'INVENTORY must not also show STOCK_ADJUSTMENT rows now that they have their own filter');
  } finally {
    db.close();
  }
});

test('Kasir Data Transaksi supports searching by ID or description, and a limit as small as 5', async () => {
  const db = migratedDatabase();
  try {
    const { token, cashierId } = await cashierToken(db, 'store_001');
    const drawerId = 'drawer_search_test';
    openDrawer(db, drawerId, 'store_001', cashierId);
    db.prepare(`
      INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, customer_name, total_amount, created_at)
      VALUES ('sale_search_needle_test', 'store_001', ?, ?, 'Sigma Boy', 25000, '2026-09-14T09:02:00.000Z')
    `).run(drawerId, cashierId);
    for (let i = 0; i < 5; i += 1) {
      db.prepare(`
        INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, customer_name, total_amount, created_at)
        VALUES (?, 'store_001', ?, ?, 'Budi', 15000, ?)
      `).run(`sale_other_test_${i}`, drawerId, cashierId, `2026-09-14T09:0${3 + i}:00.000Z`);
    }

    const env = { DB: new D1Database(db) };
    const byId = await handleCashierDataApi(
      request('/api/cashier/data/transactions', { token, params: '?q=sale_search_needle_test' }), env, '/api/cashier/data/transactions'
    );
    const byIdBody = await byId.json();
    assert.deepEqual(byIdBody.transactions.map(item => item.id), ['sale_search_needle_test']);

    const byDescription = await handleCashierDataApi(
      request('/api/cashier/data/transactions', { token, params: '?q=Sigma%20Boy' }), env, '/api/cashier/data/transactions'
    );
    const byDescriptionBody = await byDescription.json();
    assert.deepEqual(byDescriptionBody.transactions.map(item => item.id), ['sale_search_needle_test']);

    const tinyPage = await handleCashierDataApi(
      request('/api/cashier/data/transactions', { token, params: '?limit=5' }), env, '/api/cashier/data/transactions'
    );
    const tinyPageBody = await tinyPage.json();
    assert.equal(tinyPageBody.transactions.length, 5, 'a limit of 5 must not be clamped up to the old floor of 10 (6 sales exist, so a floor of 10 would return all 6)');
    assert.equal(tinyPageBody.hasMore, true);
  } finally {
    db.close();
  }
});

test('Kasir Data Stok panel is search-first: no full catalog list until the kasir types a query', () => {
  assert.doesNotMatch(stockExplorerUi, /!query \|\|/, 'an empty search must not fall through to matching every item');
  assert.match(stockExplorerUi, /if \(!query\) \{/);
  assert.match(stockExplorerUi, /Ketik nama barang untuk mencari saldo stok\./);
});

test('Kasir Data Transaksi detail reuses Admin transaction-detail logic, scoped to its own store', async () => {
  const db = migratedDatabase();
  try {
    const { token, cashierId } = await cashierToken(db, 'store_001');
    const { cashierId: cashierIdG002 } = await cashierToken(db, 'store_002');
    openDrawer(db, 'drawer_g001_detail_test', 'store_001', cashierId);
    openDrawer(db, 'drawer_g002_detail_test', 'store_002', cashierIdG002);

    const payload = {
      purpose: 'STOCK_ADJUSTMENT', productId: 1, productName: 'Larutan Gula',
      unitId: 1, unitSymbol: 'ml', currentQuantitySnapshot: 100, targetQuantity: 80,
      direction: 'OUT', quantity: 20, note: 'Tumpah saat produksi'
    };
    db.prepare(`
      INSERT INTO approval_requests (
        id, store_id, drawer_session_id, cashier_id, request_type,
        approval_status, posting_status, payload_json, created_at, updated_at
      ) VALUES ('approval_g001_detail_test', 'store_001', 'drawer_g001_detail_test', ?, 'GOODS_FLOW', 'pending_approval', 'unposted', ?, '2026-09-14T08:52:00.000Z', '2026-09-14T08:52:00.000Z')
    `).run(cashierId, JSON.stringify(payload));
    db.prepare(`
      INSERT INTO approval_requests (
        id, store_id, drawer_session_id, cashier_id, request_type,
        approval_status, posting_status, payload_json, created_at, updated_at
      ) VALUES ('approval_g002_detail_test', 'store_002', 'drawer_g002_detail_test', ?, 'GOODS_FLOW', 'pending_approval', 'unposted', ?, '2026-09-14T08:52:00.000Z', '2026-09-14T08:52:00.000Z')
    `).run(cashierIdG002, JSON.stringify(payload));

    const env = { DB: new D1Database(db) };
    const own = await handleCashierDataApi(
      request('/api/cashier/data/transactions/detail/GOODS_FLOW/approval_g001_detail_test', { token }),
      env,
      '/api/cashier/data/transactions/detail/GOODS_FLOW/approval_g001_detail_test'
    );
    assert.equal(own.status, 200);
    const ownBody = await own.json();
    assert.equal(ownBody.detail.payload.purpose, 'STOCK_ADJUSTMENT');
    assert.equal(ownBody.detail.payload.productName, 'Larutan Gula');
    assert.equal(ownBody.detail.approvalStatus, 'pending_approval');

    const other = await handleCashierDataApi(
      request('/api/cashier/data/transactions/detail/GOODS_FLOW/approval_g002_detail_test', { token }),
      env,
      '/api/cashier/data/transactions/detail/GOODS_FLOW/approval_g002_detail_test'
    );
    assert.equal(other.status, 404, 'a kasir must never fetch another store transaction detail');
  } finally {
    db.close();
  }
});

test('Kasir Data Transaksi UI shows an ID, a Detail button per row, and labels stock-adjustment GOODS_FLOW rows distinctly', () => {
  assert.match(stockExplorerUi, /class="cashier-tx-id">\$\{escapeHtml\(String\(row\.id\)\)\}/);
  assert.match(stockExplorerUi, /row\.drawerSessionId/);
  assert.match(stockExplorerUi, /data-cashier-tx-detail-id/);
  assert.match(stockExplorerUi, />Detail</);
  assert.match(stockExplorerUi, /purpose === 'STOCK_ADJUSTMENT'.*return 'Penyesuaian Stok'/);
});

test('Kasir Data Transaksi is table-based with sortable headers, a page-size selector, and a search box', () => {
  assert.match(stockExplorerUi, /<table class="cashier-tx-table">/);
  assert.match(stockExplorerUi, /data-sort-key="occurredAt"/);
  assert.match(stockExplorerUi, /data-sort-key="cashierName"/);
  assert.match(stockExplorerUi, /cashierDataLimit/);
  assert.match(stockExplorerUi, /cashierDataSearch/);
  assert.match(stockExplorerUi, /'Penyesuaian Stok'\]/);
});
