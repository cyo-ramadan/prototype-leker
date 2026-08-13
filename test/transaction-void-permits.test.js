import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/0027_transaction_void_permits.sql', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/transaction-void-permits.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const cashierUi = readFileSync(new URL('../public/cashier-transaction-void-permits.js', import.meta.url), 'utf8');
const managementUi = readFileSync(new URL('../public/management-transaction-void-permits.js', import.meta.url), 'utf8');
const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');

test('transaction correction permits extend approval capability without destructive transaction writes', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS approval_permits/);
  assert.match(migration, /permit_type IN \('TRANSACTION_VOID'\)/);
  assert.match(migration, /subject_type IN \('SALE','PURCHASE','EXPENSE'\)/);
  assert.match(migration, /idx_approval_permits_one_pending_void/);
  assert.doesNotMatch(api, /DELETE\s+FROM\s+(sales|purchases|expenses)/i);
  assert.doesNotMatch(api, /UPDATE\s+(sales|purchases|expenses)\s+SET/i);
});

test('cashier permit request is drawer scoped and snapshots the existing transaction', () => {
  assert.match(api, /requireDrawerOwner/);
  assert.match(api, /transactionSubject/);
  assert.match(api, /subject_snapshot_json/);
  assert.match(api, /VOID_PERMIT_ALREADY_OPEN/);
  assert.match(api, /\/api\/cashier\/transaction-void\/candidates/);
  assert.match(api, /\/api\/cashier\/transaction-void\/permits/);
  assert.match(cashierUi, /transactionVoidPermitBtn/);
  assert.match(cashierUi, /AJUKAN PERMIT/);
  assert.match(cashierHtml, /cashier-transaction-void-permits\.js/);
});

test('management ACC and reject live inside the approval surface and unresolved executors fail visibly', () => {
  assert.match(api, /decision.*ACC.*REJECT/s);
  assert.match(api, /SALE_REVERSAL_CONTRACT_REQUIRED/);
  assert.match(api, /PURCHASE_COST_REVERSAL_CONTRACT_REQUIRED/);
  assert.match(api, /EXPENSE_REVERSAL_EXECUTOR_PENDING/);
  assert.match(api, /execution_status = 'HOLD'/);
  assert.match(managementUi, /ACC PERMIT/);
  assert.match(managementUi, /voidPermitPendingBadge/);
  assert.match(adminHtml, /management-approval-queue\.js/);
  assert.match(adminHtml, /management-transaction-void-permits\.js/);
});

test('permit API is routed before generic admin and cashier fallbacks', () => {
  assert.match(index, /handleTransactionVoidPermitApi/);
  const permitPos = index.indexOf('const permitResponse = await handleTransactionVoidPermitApi');
  const genericAdminPos = index.indexOf("if (pathname.startsWith('/api/admin/'))");
  assert.ok(permitPos >= 0 && genericAdminPos > permitPos);
});
