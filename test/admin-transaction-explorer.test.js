import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCOUNTING_BRIDGE_CONTRACT, accountingReferenceForTransaction } from '../src/accounting-bridge-seam.js';

const explorer = readFileSync(new URL('../src/admin-transactions.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/admin-transactions-ui.js', import.meta.url), 'utf8');
const contract = readFileSync(new URL('../contracts/admin-transaction-explorer-v1.md', import.meta.url), 'utf8');
const bridgeContract = readFileSync(new URL('../contracts/accounting-bridge-seam-v1.md', import.meta.url), 'utf8');

test('admin explorer aggregates operational facts without taking source ownership', () => {
  assert.match(explorer, /FROM sales s/);
  assert.match(explorer, /FROM purchases p/);
  assert.match(explorer, /FROM expenses e/);
  assert.match(explorer, /FROM other_income i/);
  assert.match(explorer, /FROM approval_requests a/);
  assert.match(contract, /operational read model/i);
  assert.match(contract, /sourceReference/);
});

test('transaction explorer is bounded and cursor-paginated', () => {
  assert.match(explorer, /Math\.min\(100, Math\.max\(10, requestedLimit\)\)/);
  assert.match(explorer, /occurred_at DESC, id DESC/);
  assert.match(explorer, /nextCursor/);
  assert.match(ui, /Muat lagi/);
  assert.match(ui, /loadTransactions\(\{ reset: true \}\)/);
});

test('accounting bridge remains a seam only and never journals inside Prototype Leker', () => {
  assert.equal(ACCOUNTING_BRIDGE_CONTRACT, 'MAXI_ACCOUNTING_BUSINESS_FACT_V1');
  const ref = accountingReferenceForTransaction({ id: 'sale_1', kind: 'SALE', status: 'posted' });
  assert.equal(ref.eligible, true);
  assert.equal(ref.syncStatus, 'NOT_CONNECTED');
  assert.equal(ref.journalReference, null);
  assert.match(bridgeContract, /must never write directly to the Accounting database/i);
  assert.match(bridgeContract, /general ledger \/ buku besar/i);
  assert.match(bridgeContract, /balance sheet \/ neraca/i);
});

test('unposted operational facts are not eligible for Accounting', () => {
  const pending = accountingReferenceForTransaction({ id: 'approval_1', kind: 'CASH_FLOW', status: 'pending_approval/unposted' });
  const posted = accountingReferenceForTransaction({ id: 'approval_1', kind: 'CASH_FLOW', status: 'approved/posted' });
  assert.equal(pending.eligible, false);
  assert.equal(pending.syncStatus, 'NOT_POSTABLE');
  assert.equal(posted.eligible, true);
  assert.equal(posted.factType, 'CASH_FLOW_POSTED');
});

test('admin UI communicates Accounting ownership instead of exposing debit credit editor', () => {
  assert.match(ui, /Accounting module tetap terpisah/);
  assert.match(ui, /Journal entry, COA, buku besar, neraca, laba rugi/);
  assert.doesNotMatch(ui, /debitAmount|creditAmount|journalLineEditor/);
});
