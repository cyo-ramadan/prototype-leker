import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  ACCOUNTING_AMOUNT_SCALE,
  postAccountingJournal
} from '../src/accounting-ledger.js';
import {
  ACCOUNTING_POS_BRIDGE_CONTRACT,
  listPosPaymentMethods,
  resolvePosPaymentMethod,
  resolvePosFactToJournalCommand
} from '../src/accounting-pos-bridge.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const migration25 = readFileSync(new URL('../migrations/0025_accounting_pos_bridge.sql', import.meta.url), 'utf8');
const migration26 = readFileSync(new URL('../migrations/0026_accounting_six_decimal_precision.sql', import.meta.url), 'utf8');
const bridgeSource = readFileSync(new URL('../src/accounting-pos-bridge.js', import.meta.url), 'utf8');
const bridgeResponseSource = readFileSync(new URL('../src/accounting-pos-bridge-response.js', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../src/accounting-workspace.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
const bridgeUi = readFileSync(new URL('../public/admin-accounting-bridge-ui.js', import.meta.url), 'utf8');
const bridgeContract = readFileSync(new URL('../contracts/accounting-pos-bridge-v1.md', import.meta.url), 'utf8');
const workspaceContract = readFileSync(new URL('../contracts/accounting-workspace-v1.md', import.meta.url), 'utf8');
const architectureDecision = readFileSync(new URL('../adr/ADR-018-accounting-composition-host-and-pos-bridge.md', import.meta.url), 'utf8');

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

function setupMappings(sqlite) {
  const store = sqlite.prepare(`SELECT id, code, store_name FROM stores ORDER BY id LIMIT 1`).get();
  assert.ok(store);
  const account = code => sqlite.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = ? AND code = ?`).get(store.id, code)?.id;
  const kas = account('1101');
  const inventory = account('1301');
  const revenue = account('4101');
  const cogs = account('5101');
  const expense = account('6101');
  assert.ok(kas && inventory && revenue && cogs && expense);

  sqlite.prepare(`INSERT INTO product_kinds (id, store_id, code, name, is_active) VALUES (?, ?, 'PENTOL', 'Pentol', 1)`).run('kind_pentol', store.id);
  const seededMapping = sqlite.prepare(`SELECT inventory_account_id, cogs_account_id, revenue_account_id FROM item_categories WHERE store_id = ? AND product_kind_id = 'kind_pentol'`).get(store.id);
  assert.equal(seededMapping?.inventory_account_id, inventory);
  assert.equal(seededMapping?.cogs_account_id, cogs);
  assert.equal(seededMapping?.revenue_account_id, revenue);

  const category = code => sqlite.prepare(`SELECT id FROM transaction_categories WHERE store_id = ? AND code = ?`).get(store.id, code)?.id;
  const saleCategory = category('sale');
  const purchaseCategory = category('purchase_material');
  const operationalCategory = category('operational');
  assert.ok(saleCategory && purchaseCategory && operationalCategory);

  sqlite.prepare(`INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('sale_dr_payment', ?, ?, 'Pembayaran', 'DEBIT', 'payment_method', 10)`).run(store.id, saleCategory);
  sqlite.prepare(`INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('sale_cr_revenue', ?, ?, 'Penjualan', 'CREDIT', 'item_category_revenue', 20)`).run(store.id, saleCategory);
  const operationalRules = sqlite.prepare(`SELECT side, source_type, fixed_account_id FROM journal_rules WHERE store_id = ? AND transaction_category_id = ? ORDER BY sort_order`).all(store.id, operationalCategory);
  assert.deepEqual(operationalRules.map(rule => [rule.side, rule.source_type, rule.fixed_account_id || null]), [
    ['DEBIT', 'fixed_account', expense],
    ['CREDIT', 'payment_method', null]
  ]);

  return { store: { id: store.id, code: store.code, storeName: store.store_name }, saleCategory, kas, inventory, revenue, cogs, expense };
}

test('POS payment default comes from Accounting Settings and can be changed by admin configuration', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const store = sqlite.prepare(`SELECT id FROM stores ORDER BY id LIMIT 1`).get();
    let methods = await listPosPaymentMethods(db, store.id);
    assert.equal(methods.find(method => method.isDefault)?.code, 'CASH');
    assert.equal((await resolvePosPaymentMethod(db, store.id, '')).code, 'CASH');
    sqlite.prepare(`UPDATE payment_methods SET is_default = CASE WHEN code = 'PAYABLE' THEN 1 ELSE 0 END WHERE store_id = ?`).run(store.id);
    methods = await listPosPaymentMethods(db, store.id);
    assert.equal(methods.find(method => method.isDefault)?.code, 'PAYABLE');
    assert.equal((await resolvePosPaymentMethod(db, store.id, '')).code, 'PAYABLE');
  } finally { sqlite.close(); }
});

test('POS bridge resolves sale purchase and operational facts without POS-owned account decisions', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const setup = setupMappings(sqlite);
    assert.equal(ACCOUNTING_POS_BRIDGE_CONTRACT, 'MAXI_ACCOUNTING_POS_BRIDGE_V1');

    const sale = await resolvePosFactToJournalCommand(db, setup.store, {
      factType: 'SALE',
      factId: 'sale_demo',
      totalAmountMinor: 50000,
      paymentMethodCode: 'CASH',
      description: 'Penjualan demo',
      createdAt: '2026-08-13T02:00:00.000Z',
      itemLines: [{ productKindId: 'kind_pentol', productKindName: 'Pentol', lineAmountMinor: 50000, lineCogsScaled: 17500000000 }]
    });
    assert.equal(sale.ok, true);
    assert.deepEqual(sale.command.journalLines.map(line => [line.side, line.accountId, line.amountScaled]), [
      ['DEBIT', setup.kas, 50000 * ACCOUNTING_AMOUNT_SCALE],
      ['CREDIT', setup.revenue, 50000 * ACCOUNTING_AMOUNT_SCALE]
    ]);
    const posted = await postAccountingJournal(db, setup.store, sale.command);
    assert.equal(posted.ok, true);
    assert.equal(posted.journal.sourceSystem, 'LEKER_POS');

    const purchase = await resolvePosFactToJournalCommand(db, setup.store, {
      factType: 'PURCHASE',
      factId: 'purchase_demo',
      totalAmountMinor: 22000,
      paymentMethodCode: 'CASH',
      description: 'Beli bahan demo',
      createdAt: '2026-08-13T03:00:00.000Z',
      itemLines: [{ productKindId: 'kind_pentol', productKindName: 'Pentol', lineAmountMinor: 22000, lineCogsScaled: null }]
    });
    assert.equal(purchase.ok, true);
    assert.deepEqual(purchase.command.journalLines.map(line => [line.side, line.accountId, line.amountScaled]), [
      ['DEBIT', setup.inventory, 22000 * ACCOUNTING_AMOUNT_SCALE],
      ['CREDIT', setup.kas, 22000 * ACCOUNTING_AMOUNT_SCALE]
    ]);
    const postedPurchase = await postAccountingJournal(db, setup.store, purchase.command);
    assert.equal(postedPurchase.ok, true);
    const purchaseJournalLines = sqlite.prepare(`SELECT l.side, a.code AS account_code, l.amount_scaled FROM accounting_journal_lines l JOIN chart_of_accounts a ON a.id = l.account_id WHERE l.journal_id = ? ORDER BY l.line_number`).all(postedPurchase.journal.journalId);
    assert.deepEqual(purchaseJournalLines.map(line => ({ ...line })), [
      { side: 'DEBIT', account_code: '1301', amount_scaled: 22000 * ACCOUNTING_AMOUNT_SCALE },
      { side: 'CREDIT', account_code: '1101', amount_scaled: 22000 * ACCOUNTING_AMOUNT_SCALE }
    ]);

    const expense = await resolvePosFactToJournalCommand(db, setup.store, {
      factType: 'EXPENSE',
      factId: 'expense_demo',
      totalAmountMinor: 15000,
      paymentMethodCode: 'CASH',
      accountingComponentRuleId: null,
      description: 'Operasional demo',
      createdAt: '2026-08-13T04:00:00.000Z',
      itemLines: []
    });
    assert.equal(expense.ok, true, 'single fixed debit component may resolve without an explicit selection');
    assert.deepEqual(expense.command.journalLines.map(line => [line.side, line.accountId, line.amountScaled]), [
      ['DEBIT', setup.expense, 15000 * ACCOUNTING_AMOUNT_SCALE],
      ['CREDIT', setup.kas, 15000 * ACCOUNTING_AMOUNT_SCALE]
    ]);
  } finally {
    sqlite.close();
  }
});

test('sale COGS bridge posts exact six-decimal HPP and inventory journal lines', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  try {
    const setup = setupMappings(sqlite);
    sqlite.prepare(`INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('sale_dr_cogs', ?, ?, 'HPP', 'DEBIT', 'item_category_cogs', 30)`).run(setup.store.id, setup.saleCategory);
    sqlite.prepare(`INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('sale_cr_inventory', ?, ?, 'Persediaan', 'CREDIT', 'item_category_inventory', 40)`).run(setup.store.id, setup.saleCategory);
    const result = await resolvePosFactToJournalCommand(db, setup.store, {
      factType: 'SALE', factId: 'sale_cost', totalAmountMinor: 50000, paymentMethodCode: 'CASH',
      description: 'Penjualan dengan HPP', createdAt: '2026-08-13T02:00:00.000Z',
      itemLines: [{ productKindId: 'kind_pentol', productKindName: 'Pentol', lineAmountMinor: 50000, lineCogsScaled: 17500123456 }]
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.command.journalLines.map(line => [line.side, line.accountId, line.amountScaled]), [
      ['DEBIT', setup.kas, 50_000_000_000],
      ['CREDIT', setup.revenue, 50_000_000_000],
      ['DEBIT', setup.cogs, 17_500_123_456],
      ['CREDIT', setup.inventory, 17_500_123_456]
    ]);
    const posted = await postAccountingJournal(db, setup.store, result.command);
    assert.equal(posted.ok, true);
    assert.equal(posted.journal.lines.find(line => line.accountId === setup.cogs)?.amountExact, '17500.123456');
    assert.equal(posted.journal.lines.find(line => line.accountId === setup.inventory)?.amountExact, '17500.123456');
    const debit = posted.journal.lines.filter(line => line.side === 'DEBIT').reduce((sum, line) => sum + line.amountScaled, 0);
    const credit = posted.journal.lines.filter(line => line.side === 'CREDIT').reduce((sum, line) => sum + line.amountScaled, 0);
    assert.equal(debit, credit);
  } finally {
    sqlite.close();
  }
});

test('bridge migration stores delivery status not duplicate mapping and post-commit hook is non-destructive', () => {
  assert.match(migration25, /CREATE TABLE IF NOT EXISTS accounting_bridge_deliveries/);
  assert.match(migration25, /NEEDS_CONFIGURATION/);
  assert.doesNotMatch(migration25, /CREATE TABLE IF NOT EXISTS .*account.*mapping/i);
  assert.match(migration25, /accounting_component_rule_id/);
  assert.match(migration25, /Non Tunai \(Legacy\)/);
  assert.doesNotMatch(migration25, /\bREAL\b|\bFLOAT\b/i);
  assert.match(migration26, /amount_scaled INTEGER/);
  assert.doesNotMatch(migration26, /\bREAL\b|\bFLOAT\b/i);
  assert.doesNotMatch(bridgeSource, /INSERT INTO accounting_journal_headers|INSERT INTO accounting_journal_lines/);
  assert.match(bridgeSource, /postAccountingJournal/);
  assert.match(bridgeSource, /lineCogsScaled/);
  assert.match(bridgeSource, /SYSTEM_ADJUSTMENT_POLICY/);
  assert.doesNotMatch(bridgeSource, /NEEDS_COST_ROUNDING_POLICY/);
  assert.match(bridgeResponseSource, /Transaksi POS sudah tersimpan, tetapi delivery Accounting gagal/);
  assert.match(indexSource, /attachAccountingBridgeToCommittedResponse/);
  assert.match(adminHtml, /admin-accounting-bridge-ui\.js/);
  assert.match(bridgeUi, /Sync Transaksi POS/);
  assert.match(bridgeUi, /perlu setting/);
});

test('workspace route must not shadow the Accounting bridge routes', () => {
  assert.match(workspaceSource, /pathname\.startsWith\('\/api\/admin\/accounting\/bridge'\)/);
  const workspaceRoute = indexSource.indexOf('handleAccountingWorkspaceApi');
  const bridgeRoute = indexSource.indexOf('handleAccountingPosBridgeApi');
  const genericRoute = indexSource.indexOf("if (pathname.startsWith('/api/admin/')) return handleAdminApi");
  assert.ok(workspaceRoute >= 0 && workspaceRoute < bridgeRoute);
  assert.ok(bridgeRoute >= 0 && bridgeRoute < genericRoute);
});

test('active Accounting contracts document composition ownership and exact precision policy', () => {
  assert.match(workspaceContract, /actual Accounting work area|actual Accounting/i);
  assert.match(workspaceContract, /same Accounting journal store/i);
  assert.match(workspaceContract, /must not insert directly/i);
  assert.match(bridgeContract, /six|6 decimal|6 desimal/i);
  assert.match(bridgeContract, /Penyesuaian/i);
  assert.match(bridgeContract, /Rp100|100 rupiah/i);
  assert.doesNotMatch(bridgeContract, /NEEDS_COST_ROUNDING_POLICY/);
  assert.match(architectureDecision, /Accounting owns/);
  assert.match(architectureDecision, /Post-commit bridge/i);
});
