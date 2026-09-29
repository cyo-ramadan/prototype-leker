import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildOperationalPostingStatements, normalizeApprovalPayload } from '../src/operational-posting.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const workspaceServer = readFileSync(new URL('../src/cashier-workspace.js', import.meta.url), 'utf8');
const workspaceUi = readFileSync(new URL('../public/cashier-workspace.js', import.meta.url), 'utf8');
const approvalActionsUi = readFileSync(new URL('../public/cashier-approval-actions.js', import.meta.url), 'utf8');
const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');

test('cashier workspace and Arus Barang dialog are wired to offer Rekening Bersama as an optional field', () => {
  assert.match(workspaceServer, /listActiveSharedAccountsForStore/);
  assert.match(workspaceServer, /sharedAccounts/);
  assert.match(workspaceUi, /state\.sharedAccounts = payload\.sharedAccounts/);
  assert.match(approvalActionsUi, /approvalGoodsSharedAccount/);
  assert.match(approvalActionsUi, /Tidak dikaitkan/);
  assert.match(cashierHtml, /cashier-workspace\.js\?v=[\w.-]+/);
  assert.match(cashierHtml, /cashier-approval-actions\.js\?v=[\w.-]+/);
});

// Bos Cyo, 2026-09-21: "kalo ada yang gerai kirim barang berarti pilihnya
// kan arus keluar, maka debetnya barang dan efeknya ada kredit khusus gerai
// itu ke rekening bersama. pun untuk sebaliknya apabila arus barang masuk
// yang credit adalah rekening bersamanya nya" -- dan "semuanya tetap harus
// di luar Akuntansi". Jadi Arus Barang (BUKAN Penyesuaian Stok) yang
// ditandai ke satu Rekening Bersama (opsional, dipilih kasir sendiri di
// form) memindahkan saldo Rekening Bersama gerai itu senilai HPP (average_
// cost * qty), dengan polaritas SENGAJA terbalik dari transfer manual di
// Branch Admin: gerai yang melepas barang (arus keluar) di-KREDIT (naik),
// gerai yang menerima barang (arus masuk) di-DEBIT (turun) -- dua kejadian
// yang beda makna (barang jalan, bukan realokasi saldo sesuka admin).

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
          async run() { return statement.run(...args); }
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

// Dua gerai seed dipaksa berbagi satu entity baru, sama seperti fixture di
// test/entity-shared-accounts.test.js -- gerai seed masing-masing sudah
// punya entity sendiri-sendiri (migrations 0039/0052).
function fixture(sqlite, { averageCostScaled = 1_500_000 } = {}) {
  const stores = sqlite.prepare(`SELECT id, code FROM stores ORDER BY id LIMIT 2`).all();
  assert.equal(stores.length, 2, 'fixture butuh minimal dua gerai seed');
  const entityId = 'entity_goods_flow_test';
  sqlite.prepare(`INSERT INTO entities (id, name) VALUES (?, 'Entity Goods Flow Test')`).run(entityId);
  for (const store of stores) {
    sqlite.prepare(`UPDATE stores SET entity_id = ? WHERE id = ?`).run(entityId, store.id);
  }
  const [storeA, storeB] = stores;

  const accountId = 'shared_acc_goods_flow_test';
  sqlite.prepare(`INSERT INTO entity_shared_accounts (id, entity_id, name) VALUES (?, ?, 'Rekening Maxi Malang')`).run(accountId, entityId);

  const otherEntityAccountId = 'shared_acc_other_entity_goods_flow';
  sqlite.prepare(`INSERT INTO entities (id, name) VALUES ('entity_goods_flow_other', 'Other Entity')`).run();
  sqlite.prepare(`INSERT INTO entity_shared_accounts (id, entity_id, name) VALUES (?, 'entity_goods_flow_other', 'Rekening Entity Lain')`).run(otherEntityAccountId);

  const product = sqlite.prepare(`
    SELECT id, name, base_unit_id FROM products WHERE store_id = ? AND base_unit_id IS NOT NULL ORDER BY id LIMIT 1
  `).get(storeA.id);
  assert.ok(product?.id);
  sqlite.prepare(`UPDATE products SET is_active = 1, stock_tracking_enabled = 1, average_cost = ? WHERE store_id = ? AND id = ?`)
    .run(averageCostScaled, storeA.id, product.id);
  sqlite.prepare(`INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, 50, CURRENT_TIMESTAMP)`).run(storeA.id, product.id);

  const cashier = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1`).get(storeA.id);
  assert.ok(cashier?.id);
  const drawerId = 'drawer_goods_flow_test';
  sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES (?, ?, ?, 0, 'OPEN', '2026-09-21T10:00:00.000Z')`)
    .run(drawerId, storeA.id, cashier.id);

  return { entityId, storeA, storeB, accountId, otherEntityAccountId, productId: Number(product.id), productName: product.name, drawerId };
}

function approvalRow({ id, storeId, drawerSessionId, payload, createdAt = '2026-09-21T10:01:00.000Z' }) {
  return { id, storeId, drawerSessionId, requestType: 'GOODS_FLOW', payload, createdAt };
}

test('normalizeApprovalPayload computes shared-account valuation from HPP for a tagged Arus Barang, and rejects mismatched/invalid cases', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const f = fixture(sqlite, { averageCostScaled: 1_500_000 });

    // Tanpa sharedAccountId sama sekali -- perilaku lama, tidak berubah.
    const untagged = await normalizeApprovalPayload(db, f.storeA.id, 'GOODS_FLOW', {
      productId: f.productId, direction: 'OUT', quantity: 3
    });
    assert.equal(untagged.ok, true);
    assert.equal('sharedAccountId' in untagged.payload, false);

    // Ditandai ke Rekening Bersama entity yang benar: HPP 1.5/unit * 1 qty = Rp1.5 -> half-up jadi Rp2.
    const tagged = await normalizeApprovalPayload(db, f.storeA.id, 'GOODS_FLOW', {
      productId: f.productId, direction: 'OUT', quantity: 1, sharedAccountId: f.accountId
    });
    assert.equal(tagged.ok, true);
    assert.equal(tagged.payload.sharedAccountId, f.accountId);
    assert.equal(tagged.payload.sharedAccountEntityId, f.entityId);
    assert.equal(tagged.payload.unitCostSnapshotScaled, 1_500_000);
    assert.equal(tagged.payload.totalCostSnapshotScaled, 1_500_000);
    assert.equal(tagged.payload.sharedAccountAmount, 2, 'Rp1.5 half-up harus jadi Rp2, bukan dibulatkan ke bawah');

    // Rekening Bersama milik entity lain -- ditolak (isolasi entity, mirror trigger scope guard payment_methods).
    const wrongEntity = await normalizeApprovalPayload(db, f.storeA.id, 'GOODS_FLOW', {
      productId: f.productId, direction: 'OUT', quantity: 1, sharedAccountId: f.otherEntityAccountId
    });
    assert.equal(wrongEntity.ok, false);
    assert.match(wrongEntity.error, /bukan milik entity/i);

    // Rekening Bersama nonaktif -- ditolak.
    sqlite.prepare(`UPDATE entity_shared_accounts SET is_active = 0 WHERE id = ?`).run(f.accountId);
    const inactive = await normalizeApprovalPayload(db, f.storeA.id, 'GOODS_FLOW', {
      productId: f.productId, direction: 'OUT', quantity: 1, sharedAccountId: f.accountId
    });
    assert.equal(inactive.ok, false);
    sqlite.prepare(`UPDATE entity_shared_accounts SET is_active = 1 WHERE id = ?`).run(f.accountId);

    // HPP kosong (average_cost = 0) -- ditolak dengan pesan jelas, bukan diam-diam posting Rp0.
    sqlite.prepare(`UPDATE products SET average_cost = 0 WHERE store_id = ? AND id = ?`).run(f.storeA.id, f.productId);
    const zeroCost = await normalizeApprovalPayload(db, f.storeA.id, 'GOODS_FLOW', {
      productId: f.productId, direction: 'OUT', quantity: 1, sharedAccountId: f.accountId
    });
    assert.equal(zeroCost.ok, false);
    assert.match(zeroCost.error, /HPP barang ini masih kosong/i);
  } finally {
    sqlite.close();
  }
});

test('ACC Arus Barang KELUAR credits the sending store in the shared account (inverted polarity), matching Bos Cyo\'s confirmation', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const f = fixture(sqlite, { averageCostScaled: 2_000_000_000 });
    const normalized = await normalizeApprovalPayload(db, f.storeA.id, 'GOODS_FLOW', {
      productId: f.productId, direction: 'OUT', quantity: 5, sharedAccountId: f.accountId, note: 'kirim ke gerai lain'
    });
    assert.equal(normalized.ok, true);
    assert.equal(normalized.payload.sharedAccountAmount, 10000, 'HPP Rp2.000/unit * 5 qty = Rp10.000');

    const requestId = 'approval_goods_flow_out_test';
    sqlite.prepare(`
      INSERT INTO approval_requests (id, store_id, drawer_session_id, cashier_id, request_type, approval_status, posting_status, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, (SELECT id FROM cashiers WHERE store_id = ? LIMIT 1), 'GOODS_FLOW', 'pending_approval', 'unposted', ?, '2026-09-21T10:01:00.000Z', '2026-09-21T10:01:00.000Z')
    `).run(requestId, f.storeA.id, f.drawerId, f.storeA.id, JSON.stringify(normalized.payload));

    const requestRow = approvalRow({ id: requestId, storeId: f.storeA.id, drawerSessionId: f.drawerId, payload: normalized.payload });
    await db.batch(buildOperationalPostingStatements(db, requestRow, {
      approverRole: 'ADMIN', approverId: 'admin_test', now: '2026-09-21T10:02:00.000Z', note: 'ACC'
    }));

    // Stok fisik tetap berkurang seperti biasa (efek Arus Barang yang lama, tidak berubah).
    const stock = sqlite.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?`).get(f.storeA.id, f.productId);
    assert.equal(stock.quantity, 45);

    const ledgerRow = sqlite.prepare(`SELECT * FROM entity_shared_account_ledger WHERE source_type = 'GOODS_FLOW' AND source_id = ?`).get(requestId);
    assert.ok(ledgerRow, 'ACC harus menulis satu baris ledger Rekening Bersama');
    assert.equal(ledgerRow.store_id, f.storeA.id);
    assert.equal(ledgerRow.direction, 'IN', 'Arus Keluar barang -> gerai pengirim di-KREDIT (saldo naik), bukan di-debit');
    assert.equal(ledgerRow.amount, 10000);
    assert.equal(ledgerRow.entity_id, f.entityId);

    const balance = sqlite.prepare(`
      SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END), 0) AS balance
      FROM entity_shared_account_ledger WHERE shared_account_id = ? AND store_id = ?
    `).get(f.accountId, f.storeA.id);
    assert.equal(balance.balance, 10000, 'gerai yang melepas barang naik saldonya di Rekening Bersama');
  } finally {
    sqlite.close();
  }
});

test('ACC Arus Barang MASUK debits the receiving store in the shared account', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const f = fixture(sqlite, { averageCostScaled: 2_000_000_000 });
    const normalized = await normalizeApprovalPayload(db, f.storeA.id, 'GOODS_FLOW', {
      productId: f.productId, direction: 'IN', quantity: 5, sharedAccountId: f.accountId, note: 'terima dari gerai lain'
    });
    assert.equal(normalized.ok, true);

    const requestId = 'approval_goods_flow_in_test';
    sqlite.prepare(`
      INSERT INTO approval_requests (id, store_id, drawer_session_id, cashier_id, request_type, approval_status, posting_status, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, (SELECT id FROM cashiers WHERE store_id = ? LIMIT 1), 'GOODS_FLOW', 'pending_approval', 'unposted', ?, '2026-09-21T10:01:00.000Z', '2026-09-21T10:01:00.000Z')
    `).run(requestId, f.storeA.id, f.drawerId, f.storeA.id, JSON.stringify(normalized.payload));

    const requestRow = approvalRow({ id: requestId, storeId: f.storeA.id, drawerSessionId: f.drawerId, payload: normalized.payload });
    await db.batch(buildOperationalPostingStatements(db, requestRow, {
      approverRole: 'ADMIN', approverId: 'admin_test', now: '2026-09-21T10:02:00.000Z', note: 'ACC'
    }));

    const ledgerRow = sqlite.prepare(`SELECT * FROM entity_shared_account_ledger WHERE source_type = 'GOODS_FLOW' AND source_id = ?`).get(requestId);
    assert.ok(ledgerRow);
    assert.equal(ledgerRow.direction, 'OUT', 'Arus Masuk barang -> gerai penerima di-DEBIT (saldo turun)');
    assert.equal(ledgerRow.amount, 10000);
  } finally {
    sqlite.close();
  }
});

test('a plain Arus Barang without sharedAccountId never touches entity_shared_account_ledger', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const f = fixture(sqlite, { averageCostScaled: 2_000_000 });
    const normalized = await normalizeApprovalPayload(db, f.storeA.id, 'GOODS_FLOW', {
      productId: f.productId, direction: 'OUT', quantity: 5
    });
    assert.equal(normalized.ok, true);

    const requestId = 'approval_goods_flow_plain_test';
    sqlite.prepare(`
      INSERT INTO approval_requests (id, store_id, drawer_session_id, cashier_id, request_type, approval_status, posting_status, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, (SELECT id FROM cashiers WHERE store_id = ? LIMIT 1), 'GOODS_FLOW', 'pending_approval', 'unposted', ?, '2026-09-21T10:01:00.000Z', '2026-09-21T10:01:00.000Z')
    `).run(requestId, f.storeA.id, f.drawerId, f.storeA.id, JSON.stringify(normalized.payload));

    const requestRow = approvalRow({ id: requestId, storeId: f.storeA.id, drawerSessionId: f.drawerId, payload: normalized.payload });
    await db.batch(buildOperationalPostingStatements(db, requestRow, {
      approverRole: 'ADMIN', approverId: 'admin_test', now: '2026-09-21T10:02:00.000Z', note: 'ACC'
    }));

    const count = sqlite.prepare(`SELECT COUNT(*) AS n FROM entity_shared_account_ledger WHERE source_type = 'GOODS_FLOW'`).get().n;
    assert.equal(count, 0);
  } finally {
    sqlite.close();
  }
});
