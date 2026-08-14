import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ACCOUNTING_AMOUNT_SCALE } from '../src/accounting-ledger.js';
import { dispatchApprovedCashFlowToAccounting } from '../src/accounting-cash-flow-bridge.js';

const bridge = readFileSync(new URL('../src/accounting-cash-flow-bridge.js', import.meta.url), 'utf8');
const approval = readFileSync(new URL('../src/approval-queue.js', import.meta.url), 'utf8');
const presets = readFileSync(new URL('../contracts/accounting-flow-presets-v1.md', import.meta.url), 'utf8');
const migrationDir = new URL('../migrations/', import.meta.url);

function d1(sqlite) {
  return {
    prepare(sql) {
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
    },
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
  assert.match(bridge, /CASH_FLOW_DIRECTION_INVALID/);
});

test('approved cash flow posts once and returns the same journal on retry', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const store = sqlite.prepare(`SELECT id FROM stores ORDER BY id LIMIT 1`).get();
    const cashier = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1`).get(store.id);
    assert.ok(store?.id && cashier?.id);
    sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES ('drawer_cash_flow_test', ?, ?, 0, 'OPEN', '2026-08-14T01:00:00.000Z')`).run(store.id, cashier.id);
    const drawer = { id: 'drawer_cash_flow_test', cashier_id: cashier.id };
    const cashAccount = sqlite.prepare(`SELECT account_id FROM payment_methods WHERE store_id = ? AND code = 'CASH'`).get(store.id)?.account_id;
    const counterpart = sqlite.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = ? AND code = '3201'`).get(store.id)?.id;
    assert.ok(cashAccount && counterpart);

    sqlite.prepare(`INSERT INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description) VALUES ('cash_flow_in_test', ?, 'cash_flow_in', 'Arus Kas Masuk', 1, 0, 'Test')`).run(store.id);
    sqlite.prepare(`INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('cash_flow_in_dr_test', ?, 'cash_flow_in_test', 'Kas', 'DEBIT', 'payment_method', 10)`).run(store.id);
    sqlite.prepare(`INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order) VALUES ('cash_flow_in_cr_test', ?, 'cash_flow_in_test', 'Lawan Arus Kas', 'CREDIT', 'fixed_account', ?, 20)`).run(store.id, counterpart);

    const requestId = 'approval_cash_flow_test';
    const postedAt = '2026-08-14T01:30:00.000Z';
    sqlite.prepare(`INSERT INTO approval_requests (id, store_id, drawer_session_id, cashier_id, request_type, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'CASH_FLOW', '{}', ?, ?)`).run(requestId, store.id, drawer.id, drawer.cashier_id, postedAt, postedAt);
    sqlite.prepare(`INSERT INTO cash_ledger_entries (id, store_id, drawer_session_id, approval_request_id, direction, amount, description, note, posted_at, approved_by_role, approved_by_id) VALUES ('cash_ledger_test', ?, ?, ?, 'IN', 12500, 'Tambahan modal kas', '', ?, 'OWNER', 'owner_test')`).run(store.id, drawer.id, requestId, postedAt);
    sqlite.prepare(`UPDATE approval_requests SET approval_status = 'approved', posting_status = 'posted', approved_by_role = 'OWNER', approved_by_id = 'owner_test', approved_at = ?, posted_at = ?, updated_at = ? WHERE id = ?`).run(postedAt, postedAt, postedAt, requestId);

    const first = await dispatchApprovedCashFlowToAccounting(db, store.id, requestId);
    assert.equal(first.ok, true);
    assert.equal(first.status, 'POSTED');
    const lines = sqlite.prepare(`SELECT side, account_id, amount_scaled FROM accounting_journal_lines WHERE journal_id = ? ORDER BY line_number`).all(first.journalId);
    assert.deepEqual(lines.map(line => [line.side, line.account_id, line.amount_scaled]), [
      ['DEBIT', cashAccount, 12500 * ACCOUNTING_AMOUNT_SCALE],
      ['CREDIT', counterpart, 12500 * ACCOUNTING_AMOUNT_SCALE]
    ]);

    const retry = await dispatchApprovedCashFlowToAccounting(db, store.id, requestId);
    assert.equal(retry.ok, true);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.journalId, first.journalId);
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS count FROM accounting_journal_headers WHERE source_reference_id = ?`).get(`CASH_FLOW:${requestId}`).count, 1);
  } finally {
    sqlite.close();
  }
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
