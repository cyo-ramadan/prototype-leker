import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierDrawerApi } from '../src/cashier-drawer.js';
import { hashCredential } from '../src/owner-auth.js';

// 2026-09-04, Bos Cyo (revisi kedua di hari yang sama -- menggantikan desain
// "entry manual + auto-permit ke Approval Queue" yang sempat dikirim
// sebelumnya): saldo awal laci sekarang read-only, melanjutkan saldo akhir
// laci sebelumnya di gerai yang sama -- server yang menentukan nilainya,
// bukan sekadar disembunyikan di UI (lihat src/cashier-drawer.js). Kalau kas
// fisik ternyata tidak cocok, itu dibahas kasir langsung dengan akuntan di
// luar sistem ini; akuntan yang bikin jurnalnya sendiri (jurnal manual, atau
// lewat permit Arus Kas yang sudah ada dan memang perlu ACC akuntan). Laci
// pertama di gerai (belum ada laci CLOSED sebelumnya) tetap manual, karena
// tidak ada "kemarin" untuk dilanjutkan.
//
// migration 0071 membongkar scaffolding Accounting (drawer_shortage/
// drawer_surplus) yang sempat ditambahkan migration 0070 untuk desain
// sebelumnya -- lihat migration itu sendiri untuk kenapa forward migration
// baru, bukan edit 0070 (CLAUDE.md invariant #7: migration yang sudah
// applied tidak boleh ditulis ulang).

const migrationDir = new URL('../migrations/', import.meta.url);
const cashierUi = readFileSync(new URL('../public/cashier.js', import.meta.url), 'utf8');
const migration0071 = readFileSync(new URL('../migrations/0071_drawer_opening_discrepancy_accounting_revert.sql', import.meta.url), 'utf8');

function d1(sqlite) {
  function prepared(sql) {
    const statement = sqlite.prepare(sql);
    return {
      bind(...args) {
        const boundArgs = args.map(value => (value instanceof ArrayBuffer ? new Uint8Array(value) : value));
        return {
          _statement: statement,
          _args: boundArgs,
          async first() { return statement.get(...boundArgs) || null; },
          async all() { return { results: statement.all(...boundArgs) }; },
          async run() {
            const result = statement.run(...boundArgs);
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
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function seedCashier(sqlite, storeId, { id = 'cashier_discrepancy_test', username = 'cashier_discrepancy_test' } = {}) {
  sqlite.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active) VALUES (?, ?, 'x', 'Kasir Diskrepansi Test', ?, 1)`)
    .run(id, username, storeId);
  const token = `discrepancy-cashier-${id}`;
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, '2026-09-04T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), id);
  sqlite.prepare(`
    INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status)
    VALUES (?, ?, ?, 'in', x'00', 'image/jpeg', '2026-09-04T00:00:00.000Z', 'OPEN')
  `).run(`att_${id}`, id, storeId);
  return { token, cashierId: id };
}

function seedClosedDrawer(sqlite, storeId, cashierId, closingAmount, { at = '2026-09-03T20:00:00.000Z' } = {}) {
  const id = `drawer_closed_${crypto.randomUUID()}`;
  sqlite.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, closing_amount, status, opened_at, closed_at)
    VALUES (?, ?, ?, 0, ?, 'CLOSED', ?, ?)
  `).run(id, storeId, cashierId, closingAmount, at, at);
  return id;
}

test('GET /api/cashier/drawer surfaces lastClosingAmount for the UI, null when there is no previous closed drawer', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const cashier = await seedCashier(sqlite, store.id);

    const beforeAny = await handleCashierDrawerApi(request('/api/cashier/drawer', { token: cashier.token }), env, '/api/cashier/drawer');
    assert.equal((await beforeAny.json()).lastClosingAmount, null, 'first-ever drawer for this store has no previous balance to continue');

    seedClosedDrawer(sqlite, store.id, cashier.cashierId, 250000);
    const afterClosed = await handleCashierDrawerApi(request('/api/cashier/drawer', { token: cashier.token }), env, '/api/cashier/drawer');
    assert.equal((await afterClosed.json()).lastClosingAmount, 250000);
  } finally {
    sqlite.close();
  }
});

test('opening a drawer with a previous CLOSED drawer continues its closing_amount server-side, ignoring whatever the client sends', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const cashier = await seedCashier(sqlite, store.id);
    seedClosedDrawer(sqlite, store.id, cashier.cashierId, 250000);

    // A buggy or malicious client sending a different value must not matter
    // -- the read-only field is enforced server-side, not just hidden in the UI.
    const res = await handleCashierDrawerApi(
      request('/api/cashier/drawer/open', { token: cashier.token, method: 'POST', body: { openingAmount: 999999 } }),
      env, '/api/cashier/drawer/open'
    );
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.drawer.openingAmount, 250000, 'server continues the previous closing_amount regardless of client input');

    const permits = sqlite.prepare(`SELECT COUNT(*) AS n FROM approval_requests`).get();
    assert.equal(permits.n, 0, 'no permit is ever auto-created for this anymore -- mismatches are handled by cashier and akuntan outside the system');
  } finally {
    sqlite.close();
  }
});

test('no previous closed drawer for the store keeps opening amount manual entry', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const cashier = await seedCashier(sqlite, store.id);

    const res = await handleCashierDrawerApi(
      request('/api/cashier/drawer/open', { token: cashier.token, method: 'POST', body: { openingAmount: 777000 } }),
      env, '/api/cashier/drawer/open'
    );
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.drawer.openingAmount, 777000, 'first drawer at this store has no prior balance to continue, so client entry is accepted');
  } finally {
    sqlite.close();
  }
});

test('opening amount is rejected only when there is no previous drawer and the client entry itself is invalid', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const cashier = await seedCashier(sqlite, store.id);

    const res = await handleCashierDrawerApi(
      request('/api/cashier/drawer/open', { token: cashier.token, method: 'POST', body: { openingAmount: -5 } }),
      env, '/api/cashier/drawer/open'
    );
    assert.equal(res.status, 400);
  } finally {
    sqlite.close();
  }
});

test('cashier open-drawer dialog renders the opening balance read-only when a previous closing amount exists', () => {
  assert.match(cashierUi, /state\.lastClosingAmount/);
  assert.match(cashierUi, /readonly disabled/);
  assert.doesNotMatch(cashierUi, /discrepancyPermit/, 'the retired auto-permit toast must not still be referenced');
});

test('migration 0071 drops the drawer_shortage/drawer_surplus scaffolding from migration 0070 without touching cash_flow or the shared Pendapatan Lainnya account', () => {
  assert.match(migration0071, /DROP TRIGGER IF EXISTS trg_stores_drawer_discrepancy_defaults_after_insert/);
  assert.match(migration0071, /DELETE FROM transaction_categories WHERE code IN \('drawer_shortage', 'drawer_surplus'\)/);
  assert.doesNotMatch(migration0071, /DELETE FROM chart_of_accounts/, 'coa_<store>_4202 is shared with cash_flow_in and must survive this revert');

  const sqlite = freshDatabase();
  try {
    // A brand new ACCOUNTING-edition store must no longer receive
    // drawer_shortage/drawer_surplus (the seed trigger was dropped), but must
    // still receive the normal cash_flow_in/out scaffolding untouched.
    sqlite.exec(`INSERT INTO stores (id, code, store_name, edition) VALUES ('store_0071_test', 'REV0071', '0071 Test', 'ACCOUNTING')`);
    const categories = sqlite.prepare(`SELECT code FROM transaction_categories WHERE store_id = 'store_0071_test' ORDER BY code`).all().map(r => r.code);
    assert.ok(!categories.includes('drawer_shortage'));
    assert.ok(!categories.includes('drawer_surplus'));
    assert.ok(categories.includes('cash_flow_in'));
    assert.ok(categories.includes('cash_flow_out'));

    const cashFlowRuleCount = sqlite.prepare(`
      SELECT COUNT(*) AS n FROM journal_rules jr
      JOIN transaction_categories tc ON tc.id = jr.transaction_category_id
      WHERE tc.store_id = 'store_0071_test' AND tc.code IN ('cash_flow_in', 'cash_flow_out')
    `).get();
    assert.equal(cashFlowRuleCount.n, 4);

    // A pre-existing store that was already seeded by migration 0070 (before
    // this revert) must have those rows cleaned up too.
    const leftovers = sqlite.prepare(`SELECT code FROM transaction_categories WHERE store_id = 'store_001' AND code IN ('drawer_shortage', 'drawer_surplus')`).all();
    assert.deepEqual(leftovers, []);
    const coa4202 = sqlite.prepare(`SELECT name FROM chart_of_accounts WHERE id = 'coa_store_001_4202'`).get();
    assert.equal(coa4202?.name, 'Pendapatan Lainnya', 'shared account survives, still used by cash_flow_in');
  } finally {
    sqlite.close();
  }
});
