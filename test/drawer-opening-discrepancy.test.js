import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierDrawerApi } from '../src/cashier-drawer.js';
import { handleApprovalQueueApi } from '../src/approval-queue.js';
import { hashCredential } from '../src/owner-auth.js';

// 2026-09-04, Bos Cyo: saldo awal laci tetap boleh di-entry manual (bukan
// dikunci read-only dari saldo akhir kemarin), tapi kalau tidak cocok dengan
// saldo akhir laci sebelumnya di gerai itu, langsung buat permit ke Approval
// Queue yang sudah ada supaya Admin/Owner tahu -- laci tetap kebuka baik ada
// selisih atau tidak, tidak pernah diblokir oleh ini.

const migrationDir = new URL('../migrations/', import.meta.url);
const managementUi = readFileSync(new URL('../public/management-approval-queue.js', import.meta.url), 'utf8');
const cashierUi = readFileSync(new URL('../public/cashier.js', import.meta.url), 'utf8');

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

async function ownerToken(sqlite) {
  const owner = sqlite.prepare('SELECT id FROM owner_accounts ORDER BY id LIMIT 1').get();
  const token = 'drawer-discrepancy-owner-token';
  sqlite.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, '2026-09-04T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), owner.id);
  return { token, ownerId: owner.id };
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

test('opening amount matching the last closed drawer creates no discrepancy permit', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const cashier = await seedCashier(sqlite, store.id);
    seedClosedDrawer(sqlite, store.id, cashier.cashierId, 250000);

    const res = await handleCashierDrawerApi(
      request('/api/cashier/drawer/open', { token: cashier.token, method: 'POST', body: { openingAmount: 250000 } }),
      env, '/api/cashier/drawer/open'
    );
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.discrepancyPermit, null);

    const permits = sqlite.prepare(`SELECT COUNT(*) AS n FROM approval_requests`).get();
    assert.equal(permits.n, 0);
  } finally {
    sqlite.close();
  }
});

test('opening amount mismatched from the last closed drawer opens the drawer anyway and auto-creates a pending permit', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const cashier = await seedCashier(sqlite, store.id);
    const previousDrawerId = seedClosedDrawer(sqlite, store.id, cashier.cashierId, 250000);

    const res = await handleCashierDrawerApi(
      request('/api/cashier/drawer/open', { token: cashier.token, method: 'POST', body: { openingAmount: 200000 } }),
      env, '/api/cashier/drawer/open'
    );
    assert.equal(res.status, 201, 'drawer must open regardless of the mismatch -- never blocked');
    const body = await res.json();
    assert.ok(body.drawer, 'drawer really opened');
    assert.deepEqual(body.discrepancyPermit, {
      previousDrawerId, expectedAmount: 250000, enteredAmount: 200000, difference: -50000
    });

    const permitRow = sqlite.prepare(`SELECT request_type, approval_status, posting_status, payload_json, drawer_session_id FROM approval_requests`).get();
    assert.equal(permitRow.request_type, 'CASH_FLOW');
    assert.equal(permitRow.approval_status, 'pending_approval');
    assert.equal(permitRow.posting_status, 'unposted');
    assert.equal(permitRow.drawer_session_id, body.drawer.id);
    const payload = JSON.parse(permitRow.payload_json);
    assert.equal(payload.purpose, 'DRAWER_OPENING_DISCREPANCY');
    assert.equal(payload.difference, -50000);
  } finally {
    sqlite.close();
  }
});

test('no previous closed drawer for the store means no comparison and no permit', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const cashier = await seedCashier(sqlite, store.id);

    const res = await handleCashierDrawerApi(
      request('/api/cashier/drawer/open', { token: cashier.token, method: 'POST', body: { openingAmount: 999999 } }),
      env, '/api/cashier/drawer/open'
    );
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.discrepancyPermit, null);
  } finally {
    sqlite.close();
  }
});

test('ACC on a surplus discrepancy posts immediately: Debit Kas / Credit the pre-seeded Pendapatan Lainnya account', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id, edition FROM stores WHERE code = 'G001'`).get();
    assert.equal(store.edition, 'ACCOUNTING', 'this test assumes G001 is the Accounting-edition example store');
    const cashier = await seedCashier(sqlite, store.id);
    seedClosedDrawer(sqlite, store.id, cashier.cashierId, 250000);
    const { token: owner } = await ownerToken(sqlite);

    const openRes = await handleCashierDrawerApi(
      request('/api/cashier/drawer/open', { token: cashier.token, method: 'POST', body: { openingAmount: 300000 } }),
      env, '/api/cashier/drawer/open'
    );
    const openBody = await openRes.json();
    assert.ok(openBody.discrepancyPermit);
    assert.equal(openBody.discrepancyPermit.difference, 50000, 'entered more than expected -- a surplus');

    const permitId = sqlite.prepare(`SELECT id FROM approval_requests LIMIT 1`).get().id;
    const accRes = await handleApprovalQueueApi(
      request(`/api/management/approval-requests/${permitId}`, { token: owner, method: 'PATCH', body: { decision: 'ACC' } }),
      env, `/api/management/approval-requests/${permitId}`
    );
    assert.equal(accRes.status, 200);
    const accBody = await accRes.json();
    assert.equal(accBody.ok, true);
    assert.equal(accBody.request.approvalStatus, 'approved');
    assert.equal(accBody.request.postingStatus, 'posted');
    assert.equal(accBody.accounting.ok, true);
    assert.equal(accBody.accounting.status, 'POSTED');
    assert.ok(accBody.accounting.journalId);

    const ledgerCount = sqlite.prepare(`SELECT COUNT(*) AS n FROM cash_ledger_entries`).get();
    assert.equal(ledgerCount.n, 0, 'the drawer\'s own cash_ledger_entries never gets a phantom row for this -- the fact is read straight from the permit');

    const lines = sqlite.prepare(`
      SELECT l.side, l.amount_scaled, a.code AS account_code
      FROM accounting_journal_lines l
      JOIN chart_of_accounts a ON a.id = l.account_id
      WHERE l.journal_id = ?
      ORDER BY l.side
    `).all(accBody.accounting.journalId);
    const credit = lines.find(line => line.side === 'CREDIT');
    const debit = lines.find(line => line.side === 'DEBIT');
    assert.equal(credit.account_code, '4202', 'surplus credits the existing Pendapatan Lainnya account');
    assert.equal(debit.amount_scaled, credit.amount_scaled);
  } finally {
    sqlite.close();
  }
});

test('ACC on a shortage discrepancy needs Beban Uang Hilang configured first, then posts once Owner attaches an account', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const cashier = await seedCashier(sqlite, store.id);
    seedClosedDrawer(sqlite, store.id, cashier.cashierId, 250000);
    const { token: owner } = await ownerToken(sqlite);

    const openRes = await handleCashierDrawerApi(
      request('/api/cashier/drawer/open', { token: cashier.token, method: 'POST', body: { openingAmount: 200000 } }),
      env, '/api/cashier/drawer/open'
    );
    const openBody = await openRes.json();
    assert.equal(openBody.discrepancyPermit.difference, -50000, 'entered less than expected -- a shortage');

    const permitId = sqlite.prepare(`SELECT id FROM approval_requests LIMIT 1`).get().id;
    const firstAcc = await handleApprovalQueueApi(
      request(`/api/management/approval-requests/${permitId}`, { token: owner, method: 'PATCH', body: { decision: 'ACC' } }),
      env, `/api/management/approval-requests/${permitId}`
    );
    const firstAccBody = await firstAcc.json();
    assert.equal(firstAccBody.request.approvalStatus, 'approved', 'the permit itself is decided even while Accounting still needs configuration');
    assert.equal(firstAccBody.accounting.ok, false);
    assert.equal(firstAccBody.accounting.status, 'NEEDS_CONFIGURATION');
    assert.equal(firstAccBody.accounting.code, 'NEEDS_MAPPING', 'only the Kas leg is pre-seeded -- journal_rules forbids a fixed_account row with no account, so the expense leg genuinely does not exist yet');

    // Owner now creates the account and its journal_rule together -- this is
    // exactly what Setting Akuntansi's existing account+rule editor already
    // supports (src/accounting-settings.js), simulated directly here.
    const categoryId = sqlite.prepare(`SELECT id FROM transaction_categories WHERE store_id = ? AND code = 'drawer_shortage'`).get(store.id).id;
    sqlite.prepare(`INSERT INTO chart_of_accounts (id, store_id, code, name, type, subtype, is_active) VALUES (?, ?, '6105', 'Beban Uang Hilang', 'EXPENSE', 'OTHER_EXPENSE', 1)`)
      .run(`coa_${store.id}_6105`, store.id);
    sqlite.prepare(`
      INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, is_default, sort_order)
      VALUES (?, ?, ?, 'Beban Uang Hilang', 'DEBIT', 'fixed_account', ?, 1, 20)
    `).run(`jrule_${store.id}_drawer_shortage_expense`, store.id, categoryId, `coa_${store.id}_6105`);

    const retry = await handleApprovalQueueApi(
      request(`/api/management/approval-requests/${permitId}/accounting-sync`, { token: owner, method: 'POST' }),
      env, `/api/management/approval-requests/${permitId}/accounting-sync`
    );
    assert.equal(retry.status, 200);
    const retryBody = await retry.json();
    assert.equal(retryBody.accounting.ok, true);
    assert.equal(retryBody.accounting.status, 'POSTED');

    const lines = sqlite.prepare(`
      SELECT l.side, a.code AS account_code
      FROM accounting_journal_lines l
      JOIN chart_of_accounts a ON a.id = l.account_id
      WHERE l.journal_id = ?
      ORDER BY l.side
    `).all(retryBody.accounting.journalId);
    const debit = lines.find(line => line.side === 'DEBIT');
    assert.equal(debit.account_code, '6105', 'shortage debits whatever account the Owner attached to Beban Uang Hilang');
  } finally {
    sqlite.close();
  }
});

test('management approval queue UI labels and summarizes the discrepancy permit distinctly from a real Arus Kas request', () => {
  assert.match(managementUi, /'DRAWER_OPENING_DISCREPANCY'\) return 'SELISIH SALDO AWAL LACI'/);
  assert.match(managementUi, /payload\.purpose === 'DRAWER_OPENING_DISCREPANCY'\) \{\s*\n\s*return `Saldo awal dientry/);
});

test('cashier open-drawer dialog surfaces the discrepancy as a non-blocking toast', () => {
  assert.match(cashierUi, /result\.discrepancyPermit/);
  assert.match(cashierUi, /permit otomatis dikirim ke Admin\/Owner/);
});

test('migration 0070 registers drawer_shortage/drawer_surplus gated to ACCOUNTING edition, pre-seeds only what the journal_rules CHECK constraint allows', () => {
  const migration = readFileSync(new URL('../migrations/0070_drawer_opening_discrepancy_accounting.sql', import.meta.url), 'utf8');
  assert.match(migration, /'drawer_shortage'.*FROM stores WHERE edition = 'ACCOUNTING'/);
  assert.match(migration, /'drawer_surplus'.*FROM stores WHERE edition = 'ACCOUNTING'/);
  assert.match(migration, /WHEN NEW\.edition = 'ACCOUNTING'/);
  assert.match(migration, /'_drawer_surplus_other_income'.*'coa_' \|\| id \|\| '_4202'/);
  // The fixed_account leg for drawer_shortage must NOT be pre-seeded with a
  // null account -- journal_rules' CHECK constraint forbids
  // source_type='fixed_account' rows without a fixed_account_id, and
  // INSERT OR IGNORE would silently drop such a row rather than error,
  // which is exactly the bug this migration was rewritten to avoid.
  assert.doesNotMatch(migration, /drawer_shortage_expense/);
});
