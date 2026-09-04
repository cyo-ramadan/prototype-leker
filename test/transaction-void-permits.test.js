import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/0027_transaction_void_permits.sql', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../src/transaction-void-permits.js', import.meta.url), 'utf8');
const executorSource = readFileSync(new URL('../src/transaction-correction-executor.js', import.meta.url), 'utf8');
const reversalSource = readFileSync(new URL('../src/accounting-pos-reversal.js', import.meta.url), 'utf8');
const reconciliationGuard = readFileSync(new URL('../src/accounting-reconciliation-guard.js', import.meta.url), 'utf8');
// The backlog predicate itself lives in the POS bridge, shared by the
// reconciliation endpoint and the workspace summary so the voided_at filter
// cannot be present in one and forgotten in the other.
const posBridge = readFileSync(new URL('../src/accounting-pos-bridge.js', import.meta.url), 'utf8');
const cashierUi = readFileSync(new URL('../public/cashier-transaction-void-permits.js', import.meta.url), 'utf8');
const managementUi = readFileSync(new URL('../public/management-transaction-void-permits.js', import.meta.url), 'utf8');
const contract = readFileSync(new URL('../contracts/transaction-void-permit-v1.md', import.meta.url), 'utf8');

test('transaction permit migration persists approval, execution, Accounting and source-state audit fields', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS approval_permits/);
  assert.match(migration, /subject_type IN \('SALE','PURCHASE','EXPENSE'\)/);
  assert.match(migration, /execution_status TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED'/);
  assert.match(migration, /accounting_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED'/);
  assert.match(migration, /ALTER TABLE sales ADD COLUMN voided_at TEXT/);
  assert.match(migration, /ALTER TABLE purchases ADD COLUMN voided_at TEXT/);
  assert.match(migration, /ALTER TABLE expenses ADD COLUMN voided_at TEXT/);
});

test('cashier request snapshots the transaction and Admin ACC routes to deterministic domain executor', () => {
  assert.match(apiSource, /requireDrawerOwner/);
  assert.match(apiSource, /subject_snapshot_json/);
  assert.match(apiSource, /approval_status = 'pending_approval'/);
  assert.match(apiSource, /executeTransactionCorrection/);
  assert.match(executorSource, /SALE_AUTO_PRODUCTION_CORRECTION_POLICY_REQUIRED/);
  assert.match(executorSource, /SALE_COST_SNAPSHOT_REQUIRED/);
  assert.match(executorSource, /PURCHASE_DOWNSTREAM_STOCK_EXISTS/);
  assert.match(executorSource, /SALE_VOID/);
  assert.match(executorSource, /PURCHASE_VOID/);
});

test('Accounting correction is an exact immutable reversal', () => {
  assert.match(reversalSource, /reversalOfJournalId: original\.journalId/);
  assert.match(reversalSource, /side: oppositeSide\(line\.side\)/);
  assert.match(reversalSource, /amountScaled: line\.amountScaled/);
  assert.match(reversalSource, /postAccountingJournal/);
});

test('manual Accounting reconciliation excludes source facts already marked corrected', () => {
  // Every fact type in the shared backlog predicate must exclude voided rows;
  // re-posting a deliberately voided transaction would resurrect it in the books.
  assert.equal((posBridge.match(/voided_at IS NULL/g) || []).length, 3);
  assert.match(reconciliationGuard, /SKIPPED_VOIDED/);
  assert.match(reconciliationGuard, /BUSINESS_FACT_VOIDED/);
});

test('cashier and management UI expose request and ACC-Reject lifecycle', () => {
  assert.match(cashierUi, /Ajukan Hapus/);
  assert.match(cashierUi, /reason/);
  assert.match(cashierUi, /pending approval/i);
  assert.match(managementUi, /ACC PERMIT/);
  assert.match(managementUi, /Reject/);
});

test('contract documents authorization, soft-delete, reversal and explicit HOLD behavior', () => {
  assert.match(contract, /soft-delete|soft delete/i);
  assert.match(contract, /Admin|Owner/);
  assert.match(contract, /reversal|pembalik/i);
  assert.match(contract, /HOLD/i);
  assert.match(contract, /Raport|KPI|integrity/i);
});
