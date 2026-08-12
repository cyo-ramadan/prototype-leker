import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const posting = readFileSync(new URL('../src/operational-posting.js', import.meta.url), 'utf8');
const approval = readFileSync(new URL('../src/approval-queue.js', import.meta.url), 'utf8');
const drawerReport = readFileSync(new URL('../src/drawer-report.js', import.meta.url), 'utf8');
const cashierUi = readFileSync(new URL('../public/cashier-approval-actions.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0014_operational_posting_ledgers.sql', import.meta.url), 'utf8');
const contract = readFileSync(new URL('../contracts/operational-posting-v1.md', import.meta.url), 'utf8');

test('operational posting contract is versioned and defines immutable approval snapshots', () => {
  assert.match(contract, /Operational Posting Contract v1/);
  assert.match(contract, /immutable posting snapshot/);
  assert.match(contract, /ACC.*approve and post.*atomic database batch/is);
});

test('migration creates isolated idempotent cash inventory and asset ledgers', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS cash_ledger_entries/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS inventory_ledger_entries/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS inventory_stock_balances/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS asset_ledger_entries/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS asset_value_balances/);
  assert.match(migration, /approval_request_id TEXT NOT NULL UNIQUE/);
  assert.match(migration, /quantity INTEGER NOT NULL DEFAULT 0 CHECK \(quantity >= 0\)/);
  assert.match(migration, /total_amount INTEGER NOT NULL DEFAULT 0 CHECK \(total_amount >= 0\)/);
});

test('cash goods and asset staging payloads are normalized server-side', () => {
  assert.match(posting, /requestType === 'CASH_FLOW'/);
  assert.match(posting, /requestType === 'GOODS_FLOW'/);
  assert.match(posting, /requestType === 'ASSET'/);
  assert.match(posting, /SELECT id, name[\s\S]*FROM products[\s\S]*WHERE store_id = \? AND id = \?/);
  assert.match(approval, /normalizeApprovalPayload/);
});

test('ACC writes domain movement and approval posted state in one D1 batch', () => {
  assert.match(posting, /posting_status = 'posted'/);
  assert.match(posting, /INSERT INTO cash_ledger_entries/);
  assert.match(posting, /INSERT INTO inventory_ledger_entries/);
  assert.match(posting, /INSERT INTO asset_ledger_entries/);
  assert.match(posting, /INSERT OR IGNORE INTO inventory_stock_balances/);
  assert.match(posting, /SET quantity = quantity \+ \?/);
  assert.match(posting, /INSERT OR IGNORE INTO asset_value_balances/);
  assert.match(posting, /SET total_amount = total_amount \+ \?/);
  assert.match(approval, /await env\.DB\.batch\(statements\)/);
});

test('drawer expected cash includes only posted operational cash ledger entries', () => {
  assert.match(drawerReport, /FROM cash_ledger_entries/);
  assert.match(drawerReport, /operationalCashInTotal/);
  assert.match(drawerReport, /operationalCashOutTotal/);
  assert.match(drawerReport, /expectedCash = drawer\.openingAmount \+ realCashRevenue \+ cashInTotal \+ operationalCashInTotal/);
});

test('asset cashier form uses V1 direction and positive amount instead of optional reference value', () => {
  assert.match(cashierUi, /approvalAssetDirection/);
  assert.match(cashierUi, /INCREASE/);
  assert.match(cashierUi, /DECREASE/);
  assert.match(cashierUi, /approvalAssetAmount/);
  assert.doesNotMatch(cashierUi, /referenceValue/);
});
