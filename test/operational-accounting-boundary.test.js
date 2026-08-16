import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierOperationalExpenseApi } from '../src/cashier-operational-expense.js';
import { hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const accountingTables = new Set([
  'journal_rules',
  'chart_of_accounts',
  'accounting_account_refs',
  'transaction_accounting_mappings'
]);

class D1Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(result.changes || 0) } };
  }
}

class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) { return statements.map(statement => statement.run()); }
}

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

function foreignKeyTargets(db, table) {
  return db.prepare(`PRAGMA foreign_key_list(${table})`).all().map(row => String(row.table));
}

test('Operasional tables have no direct foreign key into Accounting-domain tables', () => {
  const db = migratedDatabase();
  try {
    for (const table of ['expenses', 'cost_types']) {
      const forbidden = foreignKeyTargets(db, table).filter(target => accountingTables.has(target));
      assert.deepEqual(forbidden, [], `${table} must not FK directly into Accounting`);
    }

    const expenseColumns = new Set(db.prepare('PRAGMA table_info(expenses)').all().map(row => row.name));
    assert.ok(expenseColumns.has('accounting_component_rule_id'), 'legacy selector remains as rollback evidence');
    const recovery = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='operational_accounting_boundary_recovery_0038'").get();
    assert.ok(recovery, 'reversible migration must keep explicit recovery evidence');
  } finally {
    db.close();
  }
});

test('expense creation writes business fact and snapshot without an Accounting rule selector', async () => {
  const db = migratedDatabase();
  try {
    const cashier = db.prepare("SELECT id, store_id FROM cashiers WHERE store_id = 'store_001' AND is_active = 1 ORDER BY id LIMIT 1").get();
    assert.ok(cashier, 'G001 cashier seed required');
    const costMaster = db.prepare("SELECT id FROM cost_masters WHERE store_id = 'store_001' AND is_active = 1 ORDER BY id LIMIT 1").get();
    assert.ok(costMaster, 'G001 Cost Master seed required');

    const token = 'operational-boundary-test-token';
    const tokenHash = await hashCredential(token);
    db.prepare('INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, cashier.id, '2026-08-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z');
    db.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES ('drawer_operational_boundary', ?, ?, 100000, 'OPEN', '2026-08-17T00:00:00.000Z')
    `).run(cashier.store_id, cashier.id);

    const request = new Request('https://example.test/api/cashier/expenses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        paymentMethod: 'CASH',
        items: [{ costMasterId: costMaster.id, quantity: 2, unitAmount: 5000 }]
      })
    });

    const response = await handleCashierOperationalExpenseApi(request, { DB: new D1Database(db) }, '/api/cashier/expenses');
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.businessEvent, 'EXPENSE');
    assert.equal(body.transactionCategoryCode, 'operational');
    assert.equal(body.totalAmount, 10000);

    const expense = db.prepare('SELECT amount, payment_method, accounting_component_rule_id FROM expenses WHERE id = ?').get(body.id);
    assert.equal(Number(expense.amount), 10000);
    assert.equal(expense.payment_method, 'CASH');
    assert.equal(expense.accounting_component_rule_id, null);

    const snapshot = db.prepare(`
      SELECT business_event, transaction_category_code, payment_method_code
      FROM transaction_accounting_snapshots
      WHERE store_id = ? AND source_type = 'EXPENSE' AND source_id = ?
    `).get(cashier.store_id, body.id);
    assert.equal(snapshot.business_event, 'EXPENSE');
    assert.equal(snapshot.transaction_category_code, 'operational');
    assert.equal(snapshot.payment_method_code, 'CASH');
  } finally {
    db.close();
  }
});

test('expenses and purchases share the same post-commit Accounting Bridge lane', () => {
  const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const expenseHandler = readFileSync(new URL('../src/cashier-operational-expense.js', import.meta.url), 'utf8');
  const purchaseHandler = readFileSync(new URL('../src/cashier-purchase.js', import.meta.url), 'utf8');

  assert.match(index, /pathname === '\/api\/cashier\/purchases'[\s\S]*attachAccountingBridgeToCommittedResponse\(purchaseResponse, env, 'PURCHASE'\)/);
  assert.match(index, /pathname === '\/api\/cashier\/expenses'[\s\S]*attachAccountingBridgeToCommittedResponse\(purchaseResponse, env, 'EXPENSE'\)/);
  assert.match(expenseHandler, /buildTransactionAccountingSnapshot/);
  assert.match(purchaseHandler, /buildTransactionAccountingSnapshot/);
  assert.doesNotMatch(expenseHandler, /accounting_journal_headers|accounting_journal_lines|postAccountingJournal|journal_rules/);
  assert.doesNotMatch(purchaseHandler, /accounting_journal_headers|accounting_journal_lines|postAccountingJournal|journal_rules/);
});
