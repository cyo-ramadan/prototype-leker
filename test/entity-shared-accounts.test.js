import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleEntitySharedAccountApi, postSharedAccountLedgerForPaymentMethod } from '../src/entity-shared-accounts.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-20: "central account shared per entity" -- satu Rekening
// Bersama per Entity, dipakai lintas store_id, komposisi per store_id, dan
// transfer antar store lewat in_transit -> completed dengan ledger sebagai
// source of truth. File ini membuktikan invarian yang diminta secara
// eksplisit: total = sum(store balances) + sum(in_transit), transfer tidak
// pernah mengubah total riil, dan race "complete transfer dua kali" tidak
// bisa dobel-mencatat.

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
      },
      // requireManagement's LEGACY_PIN fallback calls .first() directly
      // without .bind() first (no params needed) -- real D1 allows that,
      // this mock needs the same shape for tests that exercise "no valid
      // account at all" (falls through every auth branch to LEGACY_PIN).
      async first() { return statement.get() || null; },
      async all() { return { results: statement.all() }; },
      async run() {
        const result = statement.run();
        return { ...result, success: true, meta: { changes: result.changes } };
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

// Setiap store bawaan seed migration sudah punya Entity sendiri-sendiri
// (satu entity per gerai, lihat migrations/0039 dan 0052) -- untuk menguji
// "lebih dari satu store_id di bawah satu entity_id" seperti diminta Bos
// Cyo, dua gerai seed dipaksa berbagi SATU entity baru murni di dalam
// fixture test ini (tidak menyentuh makna entity_id di production).
function sharedEntityWithTwoStores(sqlite) {
  const stores = sqlite.prepare(`SELECT id, code FROM stores ORDER BY id LIMIT 2`).all();
  assert.equal(stores.length, 2, 'fixture butuh minimal dua gerai seed');
  const entityId = 'entity_shared_test';
  sqlite.prepare(`INSERT INTO entities (id, name) VALUES (?, 'Entity Shared Test')`).run(entityId);
  for (const store of stores) {
    sqlite.prepare(`UPDATE stores SET entity_id = ? WHERE id = ?`).run(entityId, store.id);
  }
  return { entityId, storeA: stores[0], storeB: stores[1] };
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
  const token = 'shared-account-owner-token';
  sqlite.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, '2026-09-20T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), owner.id);
  return { token, ownerId: owner.id };
}

async function storeAdminToken(sqlite, storeId, id) {
  const token = `shared-account-admin-${id}`;
  sqlite.prepare(`INSERT INTO store_admins (id, store_id, username, password_hash, display_name, is_active) VALUES (?, ?, ?, 'x', ?, 1)`)
    .run(id, storeId, id, id);
  sqlite.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, '2026-09-20T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), id);
  return token;
}

async function createSharedAccount(env, owner, entityId, storeCode, name = 'Rekening Maxi Malang') {
  const response = await handleEntitySharedAccountApi(
    request('/api/entity/shared-accounts', { token: owner, store: storeCode, method: 'POST', body: { name } }),
    env, '/api/entity/shared-accounts'
  );
  assert.equal(response.status, 201);
  return (await response.json()).account;
}

test('Owner creates a shared account for an entity and lists it', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const { entityId, storeA } = sharedEntityWithTwoStores(sqlite);
    const { token: owner } = await ownerToken(sqlite);

    const account = await createSharedAccount(env, owner, entityId, storeA.code);
    assert.ok(account.id);
    assert.equal(account.name, 'Rekening Maxi Malang');
    assert.equal(account.isActive, true);

    const list = await handleEntitySharedAccountApi(
      request('/api/entity/shared-accounts', { token: owner, store: storeA.code }),
      env, '/api/entity/shared-accounts'
    );
    const listBody = await list.json();
    assert.equal(listBody.accounts.length, 1);
  } finally {
    sqlite.close();
  }
});

test('Admin Gerai (LEGACY_PIN / no account) cannot manage or view shared accounts', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const { storeA } = sharedEntityWithTwoStores(sqlite);
    const response = await handleEntitySharedAccountApi(
      request('/api/admin/shared-accounts', { store: storeA.code }),
      env, '/api/admin/shared-accounts'
    );
    assert.equal(response.status, 401);
  } finally {
    sqlite.close();
  }
});

test('payment method auto-posting: Sale via a tagged shared account moves that store composition, untagged payment methods do nothing', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const { entityId, storeA } = sharedEntityWithTwoStores(sqlite);
    const { token: owner } = await ownerToken(sqlite);
    const account = await createSharedAccount(env, owner, entityId, storeA.code);

    sqlite.prepare(`INSERT INTO payment_methods (id, store_id, code, name, shared_account_id, is_active) VALUES ('pm_maxi', ?, 'MAXI', 'Maxi Malang', ?, 1)`)
      .run(storeA.id, account.id);
    // CASH sudah otomatis ter-seed per gerai (trigger default Accounting
    // Settings) -- pakai yang sudah ada, bukan insert duplikat, supaya tidak
    // melanggar UNIQUE(store_id, code).
    const existingCash = sqlite.prepare(`SELECT code FROM payment_methods WHERE store_id = ? AND code = 'CASH'`).get(storeA.id);
    assert.ok(existingCash, 'CASH must already be seeded for every store');

    const idViaShared = await postSharedAccountLedgerForPaymentMethod(db, {
      storeId: storeA.id, paymentMethodCode: 'MAXI', direction: 'IN', amount: 50000, sourceType: 'SALE', sourceId: 'sale_1', actorRole: 'SYSTEM', actorId: ''
    });
    assert.ok(idViaShared, 'a payment method tagged to a shared account must post a ledger row');

    const idViaCash = await postSharedAccountLedgerForPaymentMethod(db, {
      storeId: storeA.id, paymentMethodCode: 'CASH', direction: 'IN', amount: 75000, sourceType: 'SALE', sourceId: 'sale_2', actorRole: 'SYSTEM', actorId: ''
    });
    assert.equal(idViaCash, null, 'an untagged payment method must not post anything');

    const view = await handleEntitySharedAccountApi(
      request(`/api/entity/shared-accounts/${account.id}/view`, { token: owner, store: storeA.code }),
      env, `/api/entity/shared-accounts/${account.id}/view`
    );
    const viewBody = await view.json();
    assert.equal(viewBody.total, 50000, 'only the CASH sale must be excluded; MAXI-tagged sale counts');
    assert.equal(viewBody.storeBreakdown.find(row => row.storeId === storeA.id).balance, 50000);
  } finally {
    sqlite.close();
  }
});

test('payment method cannot be tagged to a shared account from a different entity (DB scope guard)', async () => {
  const sqlite = freshDatabase();
  try {
    const otherEntityAccountId = 'shared_acc_other_entity';
    sqlite.prepare(`INSERT INTO entities (id, name) VALUES ('entity_other', 'Other Entity')`).run();
    sqlite.prepare(`INSERT INTO entity_shared_accounts (id, entity_id, name) VALUES (?, 'entity_other', 'Rekening Entity Lain')`).run(otherEntityAccountId);
    const store = sqlite.prepare(`SELECT id FROM stores ORDER BY id LIMIT 1`).get();

    assert.throws(() => {
      sqlite.prepare(`INSERT INTO payment_methods (id, store_id, code, name, shared_account_id, is_active) VALUES ('pm_bad', ?, 'BAD', 'Bad', ?, 1)`)
        .run(store.id, otherEntityAccountId);
    }, /PAYMENT_METHOD_SHARED_ACCOUNT_SCOPE_MISMATCH/);
  } finally {
    sqlite.close();
  }
});

test('transfer create -> complete moves composition, never changes the real total, and matches the worked example from Bos Cyo', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const { entityId, storeA, storeB } = sharedEntityWithTwoStores(sqlite);
    const { token: owner } = await ownerToken(sqlite);
    const account = await createSharedAccount(env, owner, entityId, storeA.code);

    // Seed komposisi awal: A=300k, B=200k lewat ledger langsung (mensimulasikan
    // hasil transaksi masa lalu), total riil = 500k.
    const now = '2026-09-20T00:00:00.000Z';
    sqlite.prepare(`INSERT INTO entity_shared_account_ledger (id, shared_account_id, entity_id, store_id, direction, amount, source_type, source_id, created_at) VALUES ('l1', ?, ?, ?, 'IN', 300000, 'SALE', 's1', ?)`)
      .run(account.id, entityId, storeA.id, now);
    sqlite.prepare(`INSERT INTO entity_shared_account_ledger (id, shared_account_id, entity_id, store_id, direction, amount, source_type, source_id, created_at) VALUES ('l2', ?, ?, ?, 'IN', 200000, 'SALE', 's2', ?)`)
      .run(account.id, entityId, storeB.id, now);

    const adminA = await storeAdminToken(sqlite, storeA.id, 'admin_a');
    const adminB = await storeAdminToken(sqlite, storeB.id, 'admin_b');

    const create = await handleEntitySharedAccountApi(
      request(`/api/admin/shared-accounts/${account.id}/transfers`, { token: adminA, store: storeA.code, method: 'POST', body: { toStore: storeB.code, amount: 100000, reason: 'transfer barang' } }),
      env, `/api/admin/shared-accounts/${account.id}/transfers`
    );
    assert.equal(create.status, 201);
    const transfer = (await create.json()).transfer;
    assert.equal(transfer.status, 'IN_TRANSIT');

    const viewDuringTransit = await handleEntitySharedAccountApi(
      request(`/api/entity/shared-accounts/${account.id}/view`, { token: owner, store: storeA.code }),
      env, `/api/entity/shared-accounts/${account.id}/view`
    );
    const duringTransit = await viewDuringTransit.json();
    assert.equal(duringTransit.total, 500000, 'real total must never move because of a transfer');
    assert.equal(duringTransit.storeBreakdown.find(r => r.storeId === storeA.id).balance, 200000, 'A already down to 200k while in transit');
    assert.equal(duringTransit.storeBreakdown.find(r => r.storeId === storeB.id).balance, 200000, 'B not credited yet while in transit');
    assert.equal(duringTransit.inTransit.total, 100000);
    assert.equal(duringTransit.total, duringTransit.storeBreakdown.reduce((sum, row) => sum + row.balance, 0) + duringTransit.inTransit.total, 'invariant: total = sum(store balances) + sum(in_transit)');

    const complete = await handleEntitySharedAccountApi(
      request(`/api/admin/shared-accounts/${account.id}/transfers/${transfer.id}/complete`, { token: adminB, store: storeB.code, method: 'PATCH' }),
      env, `/api/admin/shared-accounts/${account.id}/transfers/${transfer.id}/complete`
    );
    assert.equal(complete.status, 200);

    const viewAfter = await handleEntitySharedAccountApi(
      request(`/api/entity/shared-accounts/${account.id}/view`, { token: owner, store: storeA.code }),
      env, `/api/entity/shared-accounts/${account.id}/view`
    );
    const after = await viewAfter.json();
    assert.equal(after.total, 500000);
    assert.equal(after.storeBreakdown.find(r => r.storeId === storeA.id).balance, 200000);
    assert.equal(after.storeBreakdown.find(r => r.storeId === storeB.id).balance, 300000, 'matches Bos Cyo worked example: B ends at 300k');
    assert.equal(after.inTransit.total, 0);
  } finally {
    sqlite.close();
  }
});

test('the destination store (not the source) must complete the transfer, and completing twice is rejected without double-crediting', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const { entityId, storeA, storeB } = sharedEntityWithTwoStores(sqlite);
    const { token: owner } = await ownerToken(sqlite);
    const account = await createSharedAccount(env, owner, entityId, storeA.code);
    const adminA = await storeAdminToken(sqlite, storeA.id, 'admin_a2');
    const adminB = await storeAdminToken(sqlite, storeB.id, 'admin_b2');

    const create = await handleEntitySharedAccountApi(
      request(`/api/admin/shared-accounts/${account.id}/transfers`, { token: adminA, store: storeA.code, method: 'POST', body: { toStore: storeB.code, amount: 40000 } }),
      env, `/api/admin/shared-accounts/${account.id}/transfers`
    );
    const transfer = (await create.json()).transfer;

    const wrongParty = await handleEntitySharedAccountApi(
      request(`/api/admin/shared-accounts/${account.id}/transfers/${transfer.id}/complete`, { token: adminA, store: storeA.code, method: 'PATCH' }),
      env, `/api/admin/shared-accounts/${account.id}/transfers/${transfer.id}/complete`
    );
    assert.equal(wrongParty.status, 403);
    assert.equal((await wrongParty.json()).code, 'TRANSFER_COMPLETE_FORBIDDEN');

    const first = await handleEntitySharedAccountApi(
      request(`/api/admin/shared-accounts/${account.id}/transfers/${transfer.id}/complete`, { token: adminB, store: storeB.code, method: 'PATCH' }),
      env, `/api/admin/shared-accounts/${account.id}/transfers/${transfer.id}/complete`
    );
    assert.equal(first.status, 200);

    const second = await handleEntitySharedAccountApi(
      request(`/api/admin/shared-accounts/${account.id}/transfers/${transfer.id}/complete`, { token: adminB, store: storeB.code, method: 'PATCH' }),
      env, `/api/admin/shared-accounts/${account.id}/transfers/${transfer.id}/complete`
    );
    assert.equal(second.status, 409);
    assert.equal((await second.json()).code, 'TRANSFER_ALREADY_COMPLETED');

    const ledgerCount = sqlite.prepare(`SELECT COUNT(*) AS count FROM entity_shared_account_ledger WHERE source_id = ?`).get(transfer.id).count;
    assert.equal(ledgerCount, 2, 'exactly one OUT leg and one IN leg -- the rejected second complete must not have inserted another ledger row');
  } finally {
    sqlite.close();
  }
});

test('Admin Gerai per-store view only exposes its own balance, not the whole entity composition', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const { entityId, storeA, storeB } = sharedEntityWithTwoStores(sqlite);
    const { token: owner } = await ownerToken(sqlite);
    const account = await createSharedAccount(env, owner, entityId, storeA.code);
    sqlite.prepare(`INSERT INTO entity_shared_account_ledger (id, shared_account_id, entity_id, store_id, direction, amount, source_type, source_id, created_at) VALUES ('lA', ?, ?, ?, 'IN', 10000, 'SALE', 'sA', '2026-09-20T00:00:00.000Z')`)
      .run(account.id, entityId, storeA.id);
    sqlite.prepare(`INSERT INTO entity_shared_account_ledger (id, shared_account_id, entity_id, store_id, direction, amount, source_type, source_id, created_at) VALUES ('lB', ?, ?, ?, 'IN', 999000, 'SALE', 'sB', '2026-09-20T00:00:00.000Z')`)
      .run(account.id, entityId, storeB.id);
    const adminA = await storeAdminToken(sqlite, storeA.id, 'admin_a3');

    const response = await handleEntitySharedAccountApi(
      request('/api/admin/shared-accounts', { token: adminA, store: storeA.code }),
      env, '/api/admin/shared-accounts'
    );
    const body = await response.json();
    assert.equal(body.accounts.length, 1);
    assert.equal(body.accounts[0].balance, 10000, 'Admin Gerai must only see its own store balance, never the sibling store total');
    assert.deepEqual(body.siblingStores.map(s => s.id), [storeB.id]);
  } finally {
    sqlite.close();
  }
});

test('negative balance is allowed (e.g. a debt-style shared account like "Hutang Bos Cyo") -- no abs(), no rejection', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const { entityId, storeA, storeB } = sharedEntityWithTwoStores(sqlite);
    const { token: owner } = await ownerToken(sqlite);
    const account = await createSharedAccount(env, owner, entityId, storeA.code, 'Hutang Bos Cyo');
    const adminA = await storeAdminToken(sqlite, storeA.id, 'admin_a4');

    const create = await handleEntitySharedAccountApi(
      request(`/api/admin/shared-accounts/${account.id}/transfers`, { token: adminA, store: storeA.code, method: 'POST', body: { toStore: storeB.code, amount: 50000 } }),
      env, `/api/admin/shared-accounts/${account.id}/transfers`
    );
    assert.equal(create.status, 201, 'transferring more than the current balance must not be blocked -- negative composition is a valid state');

    const view = await handleEntitySharedAccountApi(
      request(`/api/entity/shared-accounts/${account.id}/view`, { token: owner, store: storeA.code }),
      env, `/api/entity/shared-accounts/${account.id}/view`
    );
    const body = await view.json();
    assert.equal(body.storeBreakdown.find(r => r.storeId === storeA.id).balance, -50000);
  } finally {
    sqlite.close();
  }
});
