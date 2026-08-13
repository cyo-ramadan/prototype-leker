import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  calculateNormalBalance,
  createAccountingAccount,
  getBalanceSheet,
  getGeneralLedger,
  getProfitLoss,
  listAccountingAccounts,
  postAccountingJournal,
  validateJournalLines
} from '../src/accounting-ledger.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const migration24 = readFileSync(new URL('../migrations/0024_accounting_workspace.sql', import.meta.url), 'utf8');
const workspaceApi = readFileSync(new URL('../src/accounting-workspace.js', import.meta.url), 'utf8');
const workspaceUi = readFileSync(new URL('../public/admin-accounting-workspace.js', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

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

test('journal validation is exact and balanced', () => {
  const allowed = new Set(['a1', 'a2']);
  assert.deepEqual(validateJournalLines([
    { accountId: 'a1', side: 'DEBIT', amountMinor: 12500 },
    { accountId: 'a2', side: 'CREDIT', amountMinor: 12500 }
  ], allowed).ok, true);
  const unbalanced = validateJournalLines([
    { accountId: 'a1', side: 'DEBIT', amountMinor: 12500 },
    { accountId: 'a2', side: 'CREDIT', amountMinor: 12000 }
  ], allowed);
  assert.equal(unbalanced.ok, false);
  assert.equal(unbalanced.code, 'UNBALANCED_JOURNAL');
  assert.equal(calculateNormalBalance('ASSET', 150, 20), 130);
  assert.equal(calculateNormalBalance('REVENUE', 20, 150), 130);
});

test('Accounting workspace posts immutable journals and reports only requested periods', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  const store = { id: 'store_001', code: 'G001', storeName: 'Gerai 001' };
  try {
    const createdOne = await createAccountingAccount(db, store, { accountName: 'Bank BCA', accountType: 'ASSET', subtype: 'BANK' });
    const createdTwo = await createAccountingAccount(db, store, { accountName: 'Beban Internet', accountType: 'EXPENSE' });
    assert.equal(createdOne.accountCode, 'ACC-000001');
    assert.equal(createdTwo.accountCode, 'ACC-000002');

    const accounts = await listAccountingAccounts(db, store.id);
    const byCode = new Map(accounts.map(account => [account.accountCode, account]));
    const kas = byCode.get('1101');
    const modal = byCode.get('3101');
    const sales = byCode.get('4101');
    const expense = byCode.get('6101');
    assert.ok(kas && modal && sales && expense);

    const julyExpense = await postAccountingJournal(db, store, {
      businessDate: '2026-07-20',
      sourceSystem: 'MANUAL',
      sourceReferenceId: 'july-expense',
      correlationId: 'july-expense',
      idempotencyKey: 'manual:july-expense',
      description: 'Beban Juli',
      journalLines: [
        { accountId: expense.accountId, side: 'DEBIT', amountMinor: 10000 },
        { accountId: kas.accountId, side: 'CREDIT', amountMinor: 10000 }
      ]
    });
    assert.equal(julyExpense.ok, true);

    const capital = await postAccountingJournal(db, store, {
      businessDate: '2026-08-01',
      sourceSystem: 'MANUAL',
      sourceReferenceId: 'capital',
      correlationId: 'capital',
      idempotencyKey: 'manual:capital',
      description: 'Modal',
      journalLines: [
        { accountId: kas.accountId, side: 'DEBIT', amountMinor: 100000 },
        { accountId: modal.accountId, side: 'CREDIT', amountMinor: 100000 }
      ]
    });
    assert.equal(capital.ok, true);
    assert.equal(capital.journal.journalNumber, 'JRN-000002');

    const revenue = await postAccountingJournal(db, store, {
      businessDate: '2026-08-10',
      sourceSystem: 'LEKER_POS',
      sourceReferenceId: 'sale_001',
      correlationId: 'sale_001',
      idempotencyKey: 'pos:sale_001',
      description: 'Penjualan',
      journalLines: [
        { accountId: kas.accountId, side: 'DEBIT', amountMinor: 50000 },
        { accountId: sales.accountId, side: 'CREDIT', amountMinor: 50000 }
      ]
    });
    assert.equal(revenue.ok, true);
    assert.equal(revenue.journal.journalNumber, 'JRN-000003');

    const duplicate = await postAccountingJournal(db, store, {
      businessDate: '2026-08-10',
      sourceSystem: 'LEKER_POS',
      sourceReferenceId: 'sale_001',
      correlationId: 'sale_001',
      idempotencyKey: 'pos:sale_001',
      description: 'Penjualan',
      journalLines: [
        { accountId: kas.accountId, side: 'DEBIT', amountMinor: 50000 },
        { accountId: sales.accountId, side: 'CREDIT', amountMinor: 50000 }
      ]
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.journal.journalId, revenue.journal.journalId);

    const august = await getProfitLoss(db, store.id, '2026-08-01', '2026-08-31');
    assert.equal(august.totalRevenueMinor, 50000);
    assert.equal(august.totalExpenseMinor, 0, 'July expense must not leak into August P&L');
    assert.equal(august.netIncomeMinor, 50000);

    const ledger = await getGeneralLedger(db, store.id, kas.accountId, '2026-08-01', '2026-08-31');
    assert.equal(ledger.openingBalanceMinor, -10000);
    assert.equal(ledger.closingBalanceMinor, 140000);

    const balanceSheet = await getBalanceSheet(db, store.id, '2026-08-31');
    assert.equal(balanceSheet.totalAssetsMinor, 140000);
    assert.equal(balanceSheet.currentEarningsMinor, 40000);
    assert.equal(balanceSheet.totalLiabilitiesAndEquityMinor, 140000);
    assert.equal(balanceSheet.isBalanced, true);

    assert.throws(() => sqlite.prepare(`UPDATE accounting_journal_headers SET description = 'ubah' WHERE id = ?`).run(revenue.journal.journalId), /POSTED_JOURNAL_IMMUTABLE/);
    assert.throws(() => sqlite.prepare(`DELETE FROM accounting_journal_lines WHERE journal_id = ?`).run(revenue.journal.journalId), /POSTED_JOURNAL_IMMUTABLE/);
  } finally {
    sqlite.close();
  }
});

test('Accounting workspace schema and UI preserve module boundary', () => {
  assert.match(migration24, /accounting_journal_headers/);
  assert.match(migration24, /accounting_journal_lines/);
  assert.match(migration24, /POSTED_JOURNAL_IMMUTABLE/);
  assert.match(migration24, /amount_minor INTEGER/);
  assert.doesNotMatch(migration24, /\bREAL\b|\bFLOAT\b/i);
  assert.match(workspaceApi, /MAXI_ACCOUNTING_WORKSPACE_V1/);
  assert.match(workspaceApi, /AUTO_UNIQUE_SERVER_SEQUENCE/);
  assert.match(workspaceUi, /Data Akun/);
  assert.match(workspaceUi, /Buat Jurnal/);
  assert.match(workspaceUi, /Data Jurnal/);
  assert.match(workspaceUi, /Buku Besar/);
  assert.match(workspaceUi, /Rugi Laba/);
  assert.match(workspaceUi, /Neraca/);
  assert.match(workspaceUi, /Manual/);
  assert.match(workspaceUi, /POS/);
  assert.match(adminHtml, /admin-accounting-workspace\.js/);
  const workspaceRoute = indexSource.indexOf('handleAccountingWorkspaceApi');
  const genericRoute = indexSource.indexOf("if (pathname.startsWith('/api/admin/')) return handleAdminApi");
  assert.ok(workspaceRoute >= 0 && workspaceRoute < genericRoute);
});
