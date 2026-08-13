import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCOUNTING_BRIDGE_CONTRACT, accountingReferenceForTransaction } from '../src/accounting-bridge-seam.js';

const explorer = readFileSync(new URL('../src/admin-transactions.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/admin-transactions-ui.js', import.meta.url), 'utf8');
const contract = readFileSync(new URL('../contracts/admin-transaction-explorer-v1.md', import.meta.url), 'utf8');
const bridgeContract = readFileSync(new URL('../contracts/accounting-bridge-seam-v1.md', import.meta.url), 'utf8');
const activeBridgeContract = readFileSync(new URL('../contracts/accounting-pos-bridge-v1.md', import.meta.url), 'utf8');


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

test('SALE PURCHASE and EXPENSE expose active Accounting bridge delivery instead of legacy NOT_CONNECTED', () => {
  assert.match(explorer, /MAXI_ACCOUNTING_POS_BRIDGE_V1|ACCOUNTING_POS_BRIDGE_CONTRACT/);
  assert.match(explorer, /accounting_bridge_deliveries/);
  assert.match(explorer, /journalReference: delivery\?\.journal_id/);
  assert.match(explorer, /syncStatus: delivery\?\.status \|\| 'NOT_ATTEMPTED'/);
  assert.match(activeBridgeContract, /POSTED/);
  assert.match(activeBridgeContract, /NEEDS_CONFIGURATION/);
  assert.match(activeBridgeContract, /Data Jurnal|journal/i);
});

test('legacy business-fact seam remains only for fact kinds not yet migrated to active bridge', () => {
  assert.equal(ACCOUNTING_BRIDGE_CONTRACT, 'MAXI_ACCOUNTING_BUSINESS_FACT_V1');
  const pending = accountingReferenceForTransaction({ id: 'approval_1', kind: 'CASH_FLOW', status: 'pending_approval/unposted' });
  const posted = accountingReferenceForTransaction({ id: 'approval_1', kind: 'CASH_FLOW', status: 'approved/posted' });
  assert.equal(pending.eligible, false);
  assert.equal(pending.syncStatus, 'NOT_POSTABLE');
  assert.equal(posted.eligible, true);
  assert.equal(posted.factType, 'CASH_FLOW_POSTED');
  assert.match(bridgeContract, /SUPERSEDED/);
  assert.match(bridgeContract, /SALE\/PURCHASE\/EXPENSE/);
});

test('transaction explorer stays operational and does not expose a debit credit journal editor', () => {
  assert.match(ui, /Jurnal tetap domain Accounting/);
  assert.doesNotMatch(ui, /debitAmount|creditAmount|journalLineEditor/);
});
