import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  ACCOUNTING_AMOUNT_SCALE,
  SYSTEM_ADJUSTMENT_POLICY,
  SYSTEM_ADJUSTMENT_TOLERANCE_SCALED,
  calculateNormalBalance,
  createAccountingAccount,
  getBalanceSheet,
  getGeneralLedger,
  getProfitLoss,
  listAccountingAccounts,
  parseRupiahAmountToScaled,
  postAccountingJournal,
  scaledAmountToExactString,
  validateJournalLines
} from '../src/accounting-ledger.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const migration24 = readFileSync(new URL('../migrations/0024_accounting_workspace.sql', import.meta.url), 'utf8');
const migration26 = readFileSync(new URL('../migrations/0026_accounting_six_decimal_precision.sql', import.meta.url), 'utf8');
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

test('journal precision is exact to six decimals and rounds half-up beyond scale', () => {
  assert.equal(ACCOUNTING_AMOUNT_SCALE, 1_000_000);
  assert.equal(parseRupiahAmountToScaled('17500.1234564'), 17500123456);
  assert.equal(parseRupiahAmountToScaled('17500.1234565'), 17500123457);
  assert.equal(parseRupiahAmountToScaled('0.0000004'), null, 'values rounded to zero are not valid positive journal amounts');
  assert.equal(parseRupiahAmountToScaled('0.0000005'), 1);
  assert.equal(scaledAmountToExactString(17500123456), '17500.123456');

  const allowed = new Set(['a1', 'a2']);
  const exact = validateJournalLines([
    { accountId: 'a1', side: 'DEBIT', amountExact: '12500.123456' },
    { accountId: 'a2', side: 'CREDIT', amountExact: '12500.123456' }
  ], allowed);
  assert.equal(exact.ok, true);
  assert.equal(exact.totalDebitScaled, 12500123456);

  const unbalanced = validateJournalLines([
    { accountId: 'a1', side: 'DEBIT', amountMinor: 12500 },
    { accountId: 'a2', side: 'CREDIT', amountMinor: 12000 }
  ], allowed);
  assert.equal(unbalanced.ok, false);
  assert.equal(unbalanced.code, 'UNBALANCED_JOURNAL');
  assert.equal(calculateNormalBalance('ASSET', 150, 20), 130);
  assert.equal(calculateNormalBalance('REVENUE', 20, 150), 130);
});

test('system journal auto-adjusts through Penyesuaian up to Rp100 but manual journal never does', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  const store = { id: 'store_001', code: 'G001', storeName: 'Gerai 001' };
  try {
    const accounts = await listAccountingAccounts(db, store.id);
    const kas = accounts.find(account => account.accountCode === '1101');
    const sales = accounts.find(account => account.accountCode === '4101');
    const adjustment = accounts.find(account => account.subtype === 'ROUNDING_ADJUSTMENT');
    assert.ok(kas && sales && adjustment);
    assert.equal(adjustment.accountName, 'Penyesuaian');
    assert.equal(adjustment.accountType, 'EQUITY');
    assert.equal(adjustment.isSystemManaged, true);
    assert.equal(SYSTEM_ADJUSTMENT_TOLERANCE_SCALED, 100_000_000);

    const posted = await postAccountingJournal(db, store, {
      businessDate: '2026-08-13',
      sourceSystem: 'LEKER_POS',
      sourceReferenceId: 'adjust-100',
      correlationId: 'adjust-100',
      idempotencyKey: 'adjust-100',
      description: 'Test toleransi Rp100',
      systemAdjustmentPolicy: SYSTEM_ADJUSTMENT_POLICY,
      journalLines: [
        { accountId: kas.accountId, side: 'DEBIT', amountExact: '1000' },
        { accountId: sales.accountId, side: 'CREDIT', amountExact: '900' }
      ]
    });
    assert.equal(posted.ok, true);
    const adjustmentLine = posted.journal.lines.find(line => line.isSystemGenerated);
    assert.ok(adjustmentLine);
    assert.equal(adjustmentLine.accountId, adjustment.accountId);
    assert.equal(adjustmentLine.side, 'CREDIT');
    assert.equal(adjustmentLine.amountExact, '100');
    assert.equal(adjustmentLine.description, 'Penyesuaian');

    const over = await postAccountingJournal(db, store, {
      businessDate: '2026-08-13',
      sourceSystem: 'LEKER_POS',
      sourceReferenceId: 'adjust-over',
      correlationId: 'adjust-over',
      idempotencyKey: 'adjust-over',
      description: 'Lewat toleransi',
      systemAdjustmentPolicy: SYSTEM_ADJUSTMENT_POLICY,
      journalLines: [
        { accountId: kas.accountId, side: 'DEBIT', amountExact: '1000' },
        { accountId: sales.accountId, side: 'CREDIT', amountExact: '899.999999' }
      ]
    });
    assert.equal(over.ok, false);
    assert.equal(over.code, 'UNBALANCED_JOURNAL_OUTSIDE_TOLERANCE');
    assert.equal(over.differenceScaled, 100_000_001);

    const manual = await postAccountingJournal(db, store, {
      businessDate: '2026-08-13',
      sourceSystem: 'MANUAL',
      sourceReferenceId: 'manual-unbalanced',
      correlationId: 'manual-unbalanced',
      idempotencyKey: 'manual-unbalanced',
      description: 'Manual harus exact',
      systemAdjustmentPolicy: SYSTEM_ADJUSTMENT_POLICY,
      journalLines: [
        { accountId: kas.accountId, side: 'DEBIT', amountExact: '1000' },
        { accountId: sales.accountId, side: 'CREDIT', amountExact: '999.999999' }
      ]
    });
    assert.equal(manual.ok, false);
    assert.equal(manual.code, 'UNBALANCED_JOURNAL');
  } finally {
    sqlite.close();
  }
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
      businessDate: '2026-07-20', sourceSystem: 'MANUAL', sourceReferenceId: 'july-expense', correlationId: 'july-expense',
      idempotencyKey: 'manual:july-expense', description: 'Beban Juli',
      journalLines: [
        { accountId: expense.accountId, side: 'DEBIT', amountMinor: 10000 },
        { accountId: kas.accountId, side: 'CREDIT', amountMinor: 10000 }
      ]
    });
    assert.equal(julyExpense.ok, true);

    const capital = await postAccountingJournal(db, store, {
      businessDate: '2026-08-01', sourceSystem: 'MANUAL', sourceReferenceId: 'capital', correlationId: 'capital',
      idempotencyKey: 'manual:capital', description: 'Modal',
      journalLines: [
        { accountId: kas.accountId, side: 'DEBIT', amountMinor: 100000 },
        { accountId: modal.accountId, side: 'CREDIT', amountMinor: 100000 }
      ]
    });
    assert.equal(capital.ok, true);
    assert.equal(capital.journal.journalNumber, 'JRN-000002');

    const revenue = await postAccountingJournal(db, store, {
      businessDate: '2026-08-10', sourceSystem: 'LEKER_POS', sourceReferenceId: 'sale_001', correlationId: 'sale_001',
      idempotencyKey: 'pos:sale_001', description: 'Penjualan',
      journalLines: [
        { accountId: kas.accountId, side: 'DEBIT', amountMinor: 50000 },
        { accountId: sales.accountId, side: 'CREDIT', amountMinor: 50000 }
      ]
    });
    assert.equal(revenue.ok, true);
    assert.equal(revenue.journal.journalNumber, 'JRN-000003');

    const duplicate = await postAccountingJournal(db, store, {
      businessDate: '2026-08-10', sourceSystem: 'LEKER_POS', sourceReferenceId: 'sale_001', correlationId: 'sale_001',
      idempotencyKey: 'pos:sale_001', description: 'Penjualan',
      journalLines: [
        { accountId: kas.accountId, side: 'DEBIT', amountMinor: 50000 },
        { accountId: sales.accountId, side: 'CREDIT', amountMinor: 50000 }
      ]
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.journal.journalId, revenue.journal.journalId);

    const august = await getProfitLoss(db, store.id, '2026-08-01', '2026-08-31');
    assert.equal(august.totalRevenueScaled, 50000 * ACCOUNTING_AMOUNT_SCALE);
    assert.equal(august.totalExpenseScaled, 0, 'July expense must not leak into August P&L');
    assert.equal(august.netIncomeScaled, 50000 * ACCOUNTING_AMOUNT_SCALE);

    const ledger = await getGeneralLedger(db, store.id, kas.accountId, '2026-08-01', '2026-08-31');
    assert.equal(ledger.openingBalanceScaled, -10000 * ACCOUNTING_AMOUNT_SCALE);
    assert.equal(ledger.closingBalanceScaled, 140000 * ACCOUNTING_AMOUNT_SCALE);

    const balanceSheet = await getBalanceSheet(db, store.id, '2026-08-31');
    assert.equal(balanceSheet.totalAssetsScaled, 140000 * ACCOUNTING_AMOUNT_SCALE);
    assert.equal(balanceSheet.currentEarningsScaled, 40000 * ACCOUNTING_AMOUNT_SCALE);
    assert.equal(balanceSheet.totalLiabilitiesAndEquityScaled, 140000 * ACCOUNTING_AMOUNT_SCALE);
    assert.equal(balanceSheet.isBalanced, true);

    assert.throws(() => sqlite.prepare(`UPDATE accounting_journal_headers SET description = 'ubah' WHERE id = ?`).run(revenue.journal.journalId), /POSTED_JOURNAL_IMMUTABLE/);
    assert.throws(() => sqlite.prepare(`DELETE FROM accounting_journal_lines WHERE journal_id = ?`).run(revenue.journal.journalId), /POSTED_JOURNAL_IMMUTABLE/);
  } finally {
    sqlite.close();
  }
});

test('Accounting workspace schema and UI preserve module boundary and exact precision', () => {
  assert.match(migration24, /accounting_journal_headers/);
  assert.match(migration26, /amount_scaled INTEGER/);
  assert.match(migration26, /ROUNDING_ADJUSTMENT/);
  assert.match(migration26, /Penyesuaian/);
  assert.match(migration26, /is_system_generated/);
  assert.doesNotMatch(migration26, /\bREAL\b|\bFLOAT\b/i);
  assert.match(workspaceApi, /MAXI_ACCOUNTING_WORKSPACE_V1/);
  assert.match(workspaceApi, /AUTO_UNIQUE_SERVER_SEQUENCE/);
  assert.match(workspaceUi, /Data Akun/);
  assert.match(workspaceUi, /Buat Jurnal/);
  assert.match(workspaceUi, /Data Jurnal/);
  assert.match(workspaceUi, /Buku Besar/);
  assert.match(workspaceUi, /Rugi Laba/);
  assert.match(workspaceUi, /Neraca/);
  assert.match(workspaceUi, /0\.000001/);
  assert.match(workspaceUi, /Auto Penyesuaian Rp100/);
  assert.match(adminHtml, /admin-accounting-workspace\.js/);
  const workspaceRoute = indexSource.indexOf('handleAccountingWorkspaceApi');
  const genericRoute = indexSource.indexOf("if (pathname.startsWith('/api/admin/')) return handleAdminApi");
  assert.ok(workspaceRoute >= 0 && workspaceRoute < genericRoute);
});
