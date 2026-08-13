import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bridge = readFileSync(new URL('../src/accounting-cash-flow-bridge.js', import.meta.url), 'utf8');
const approval = readFileSync(new URL('../src/approval-queue.js', import.meta.url), 'utf8');
const presets = readFileSync(new URL('../contracts/accounting-flow-presets-v1.md', import.meta.url), 'utf8');

test('approved cash flow resolves Accounting presets without inventing a second mapping registry', () => {
  assert.match(bridge, /MAXI_ACCOUNTING_CASH_FLOW_BRIDGE_V1/);
  assert.match(bridge, /cash_flow_in/);
  assert.match(bridge, /cash_flow_out/);
  assert.match(bridge, /source_type === 'payment_method'/);
  assert.match(bridge, /source_type === 'fixed_account'/);
  assert.match(bridge, /code = 'CASH'/);
  assert.doesNotMatch(bridge, /CREATE TABLE|account_mapping/i);
  assert.match(presets, /cash_flow_in/);
  assert.match(presets, /cash_flow_out/);
});

test('cash flow bridge posts exact scaled journal values through the Accounting engine', () => {
  assert.match(bridge, /ACCOUNTING_AMOUNT_SCALE/);
  assert.match(bridge, /postAccountingJournal/);
  assert.match(bridge, /amountScaled/);
  assert.match(bridge, /LEKER_POS:CASH_FLOW:/);
  assert.match(bridge, /accounting_bridge_deliveries/);
  assert.match(bridge, /NEEDS_CONFIGURATION/);
});

test('operational ACC commits first and Accounting delivery runs post-commit with idempotent retry', () => {
  const commitIndex = approval.indexOf('await env.DB.batch(statements)');
  const deliveryIndex = approval.indexOf('cashFlowAccountingAfterCommit(env, postedRequest)');
  assert.ok(commitIndex >= 0, 'operational batch commit must exist');
  assert.ok(deliveryIndex > commitIndex, 'Accounting delivery must happen only after operational commit');
  assert.match(approval, /\/accounting-sync\$/);
  assert.match(approval, /dispatchApprovedCashFlowToAccounting/);
  assert.match(approval, /Accounting menunggu konfigurasi \/ retry/);
});

test('goods flow remains outside the cash flow Accounting dispatcher', () => {
  assert.doesNotMatch(bridge, /GOODS_FLOW/);
  assert.doesNotMatch(bridge, /goods_flow_in|goods_flow_out/);
});
