import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createAccountingAccount, getAccountingJournal, postAccountingJournal } from '../src/accounting-ledger.js';
import { executeTransactionCorrection } from '../src/transaction-correction-executor.js';
import { buildDrawerReport } from '../src/drawer-report.js';

const migrationDir = new URL('../migrations/', import.meta.url);

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

function baseFixture(sqlite) {
  const store = sqlite.prepare('SELECT id, code, store_name FROM stores ORDER BY id LIMIT 1').get();
  const cashier = sqlite.prepare('SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1').get(store.id);
  assert.ok(store?.id && cashier?.id);
  const drawerId = `drawer_correction_${crypto.randomUUID()}`;
  sqlite.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES (?, ?, ?, 100000, 'OPEN', '2026-08-13T10:00:00.000Z')
  `).run(drawerId, store.id, cashier.id);
  return { store: { id: store.id, code: store.code, storeName: store.store_name }, cashierId: cashier.id, drawerId };
}

test('approved CASH expense correction soft-deletes source, restores drawer expectation, and posts exact Accounting reversal', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const fixture = baseFixture(sqlite);
    const expenseId = `expense_test_${crypto.randomUUID()}`;
    sqlite.prepare(`
      INSERT INTO expenses (id, store_id, drawer_session_id, cashier_id, description, amount, created_at, payment_method)
      VALUES (?, ?, ?, ?, 'Gas operasional', 10000, '2026-08-13T10:10:00.000Z', 'CASH')
    `).run(expenseId, fixture.store.id, fixture.drawerId, fixture.cashierId);

    const debit = await createAccountingAccount(db, fixture.store, { accountName: 'Beban Test', accountType: 'EXPENSE' });
    const credit = await createAccountingAccount(db, fixture.store, { accountName: 'Kas Test', accountType: 'ASSET' });
    assert.equal(debit.ok, true); assert.equal(credit.ok, true);
    const amountScaled = 10000 * 1_000_000;
    const original = await postAccountingJournal(db, fixture.store, {
      businessDate: '2026-08-13', occurredAt: '2026-08-13T10:10:00.000Z',
      sourceSystem: 'LEKER_POS', sourceReferenceId: `EXPENSE:${expenseId}`,
      correlationId: expenseId, idempotencyKey: `LEKER_POS:${fixture.store.id}:EXPENSE:${expenseId}`,
      description: 'Gas operasional',
      journalLines: [
        { accountId: debit.accountId, side: 'DEBIT', amountScaled, description: 'Beban' },
        { accountId: credit.accountId, side: 'CREDIT', amountScaled, description: 'Kas' }
      ]
    });
    assert.equal(original.ok, true);
    sqlite.prepare(`
      INSERT INTO accounting_bridge_deliveries (
        id, store_id, producer_module, fact_type, fact_id, transaction_category_code,
        status, journal_id, attempts, last_attempt_at
      ) VALUES (?, ?, 'POS', 'EXPENSE', ?, 'operational', 'POSTED', ?, 1, '2026-08-13T10:10:01.000Z')
    `).run(`delivery_${crypto.randomUUID()}`, fixture.store.id, expenseId, original.journal.journalId);

    const before = await buildDrawerReport(db, fixture.store.id, fixture.drawerId);
    assert.equal(before.totals.expectedCash, 90000);

    const result = await executeTransactionCorrection(db, fixture.store, {
      id: `permit_${crypto.randomUUID()}`, subjectType: 'EXPENSE', subjectId: expenseId, reason: 'Salah entry'
    }, { role: 'ADMIN', id: 'admin_test' }, '2026-08-13T10:20:00.000Z');
    assert.equal(result.ok, true);
    assert.equal(result.accounting.accountingStatus, 'REVERSED');

    const source = sqlite.prepare('SELECT voided_at, void_reason FROM expenses WHERE id = ?').get(expenseId);
    assert.equal(source.void_reason, 'Salah entry');
    assert.ok(source.voided_at);
    const after = await buildDrawerReport(db, fixture.store.id, fixture.drawerId);
    assert.equal(after.totals.expectedCash, 100000);

    const reversal = await getAccountingJournal(db, fixture.store.id, result.accounting.reversalJournalId);
    assert.equal(reversal.reversalOfJournalId, original.journal.journalId);
    assert.equal(reversal.lines[0].amountScaled, original.journal.lines[0].amountScaled);
    assert.equal(reversal.lines[1].amountScaled, original.journal.lines[1].amountScaled);
    assert.equal(reversal.lines[0].side, 'CREDIT');
    assert.equal(reversal.lines[1].side, 'DEBIT');
  } finally {
    sqlite.close();
  }
});

test('purchase correction HOLDs without mutation when a later stock movement depends on the purchased item', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const fixture = baseFixture(sqlite);
    const product = sqlite.prepare(`
      SELECT p.id, p.name, p.base_unit_id, u.symbol
      FROM products p JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
      WHERE p.store_id = ? AND p.base_unit_id IS NOT NULL ORDER BY p.id LIMIT 1
    `).get(fixture.store.id);
    assert.ok(product?.id);
    sqlite.prepare('UPDATE products SET average_cost = 2000000 WHERE id = ? AND store_id = ?').run(product.id, fixture.store.id);
    sqlite.prepare(`INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, 5, '2026-08-13T10:05:00.000Z')`).run(fixture.store.id, product.id);

    const purchaseId = `purchase_test_${crypto.randomUUID()}`;
    sqlite.prepare(`
      INSERT INTO purchases (id, store_id, drawer_session_id, cashier_id, description, total_amount, note, created_at, payment_method)
      VALUES (?, ?, ?, ?, 'Bahan test', 10, '', '2026-08-13T10:05:00.000Z', 'CASH')
    `).run(purchaseId, fixture.store.id, fixture.drawerId, fixture.cashierId);
    sqlite.prepare(`
      INSERT INTO purchase_items (
        id, purchase_id, store_id, product_id, product_name, unit_id, unit_symbol,
        quantity, line_total, unit_cost, average_cost_before, average_cost_after, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 5, 10, 2000000, 1000000, 2000000, '2026-08-13T10:05:00.000Z')
    `).run(`purchase_item_${crypto.randomUUID()}`, purchaseId, fixture.store.id, product.id, product.name, product.base_unit_id, product.symbol);
    sqlite.prepare(`
      INSERT INTO stock_movements (
        id, source_key, store_id, product_id, product_name, unit_id, unit_symbol,
        direction, quantity, source_type, source_id, drawer_session_id, note,
        actor_role, actor_id, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OUT', 1, 'SALE', 'later_sale', ?, '', 'CASHIER', ?, '2026-08-13T10:06:00.000Z')
    `).run(`stock_move_${crypto.randomUUID()}`, `SALE:later:${product.id}`, fixture.store.id, product.id, product.name, product.base_unit_id, product.symbol, fixture.drawerId, fixture.cashierId);

    const result = await executeTransactionCorrection(db, fixture.store, {
      id: `permit_${crypto.randomUUID()}`, subjectType: 'PURCHASE', subjectId: purchaseId, reason: 'Salah beli'
    }, { role: 'ADMIN', id: 'admin_test' }, '2026-08-13T10:20:00.000Z');
    assert.equal(result.ok, false);
    assert.equal(result.status, 'HOLD');
    assert.equal(result.code, 'PURCHASE_DOWNSTREAM_STOCK_EXISTS');
    const purchase = sqlite.prepare('SELECT voided_at FROM purchases WHERE id = ?').get(purchaseId);
    const balance = sqlite.prepare('SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?').get(fixture.store.id, product.id);
    assert.equal(purchase.voided_at, null);
    assert.equal(balance.quantity, 5);
  } finally {
    sqlite.close();
  }
});
