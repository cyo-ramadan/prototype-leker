import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ACCOUNTING_AMOUNT_SCALE, postAccountingJournal } from '../src/accounting-ledger.js';
import { resolvePosFactToJournalCommand } from '../src/accounting-pos-bridge.js';

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

function expenseFact(overrides = {}) {
  return {
    factType: 'EXPENSE',
    factId: 'expense_choice_test',
    totalAmountMinor: 15000,
    paymentMethodCode: 'CASH',
    accountingComponentRuleId: null,
    description: 'Operasional choice group',
    createdAt: '2026-08-20T02:00:00.000Z',
    itemLines: [],
    choiceSelections: [],
    ...overrides
  };
}

function setupChoiceGroup(sqlite, { secondOption = true, defaultCode = '' } = {}) {
  const store = sqlite.prepare('SELECT id, code, store_name FROM stores ORDER BY id LIMIT 1').get();
  assert.ok(store?.id);
  const operational = sqlite.prepare(`
    SELECT c.id AS category_id, r.id AS rule_id
    FROM transaction_categories c
    JOIN journal_rules r ON r.transaction_category_id = c.id AND r.store_id = c.store_id
    WHERE c.store_id = ? AND c.code = 'operational'
      AND r.side = 'DEBIT' AND r.source_type = 'fixed_account' AND r.is_active = 1
    ORDER BY r.sort_order, r.id LIMIT 1
  `).get(store.id);
  assert.ok(operational?.rule_id);
  const expenseAccount = sqlite.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = ? AND code = '6101' AND is_active = 1`).get(store.id)?.id;
  assert.ok(expenseAccount);
  const secondAccount = 'coa_choice_second';
  sqlite.prepare(`
    INSERT INTO chart_of_accounts (id, store_id, code, name, type, subtype, is_active, review_required, created_at, updated_at)
    VALUES (?, ?, '6199', 'Beban Choice Kedua', 'EXPENSE', '', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(secondAccount, store.id);
  const groupId = 'choice_group_operational';
  sqlite.prepare(`
    INSERT INTO accounting_choice_groups (id, store_id, code, name, is_active)
    VALUES (?, ?, 'BEBAN_TETAP', 'Beban Tetap', 1)
  `).run(groupId, store.id);
  sqlite.prepare(`
    INSERT INTO accounting_choice_options (id, choice_group_id, store_id, code, name, account_id, is_default, sort_order, is_active)
    VALUES ('choice_listrik', ?, ?, 'LISTRIK', 'Listrik', ?, ?, 10, 1)
  `).run(groupId, store.id, expenseAccount, defaultCode === 'LISTRIK' ? 1 : 0);
  if (secondOption) {
    sqlite.prepare(`
      INSERT INTO accounting_choice_options (id, choice_group_id, store_id, code, name, account_id, is_default, sort_order, is_active)
      VALUES ('choice_gaji', ?, ?, 'GAJI', 'Gaji', ?, ?, 20, 1)
    `).run(groupId, store.id, secondAccount, defaultCode === 'GAJI' ? 1 : 0);
  }
  sqlite.prepare(`
    UPDATE journal_rules
    SET source_type = 'choice_group', fixed_account_id = NULL, choice_group_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND store_id = ?
  `).run(groupId, operational.rule_id, store.id);
  return {
    store: { id: store.id, code: store.code, storeName: store.store_name },
    categoryId: operational.category_id,
    ruleId: operational.rule_id,
    groupId,
    expenseAccount,
    secondAccount
  };
}

test('choice group resolves explicit selection and journal persists provenance', async () => {
  const sqlite = freshDatabase();
  try {
    const setup = setupChoiceGroup(sqlite);
    const db = d1(sqlite);
    const resolved = await resolvePosFactToJournalCommand(db, setup.store, expenseFact({
      choiceSelections: [{ groupCode: 'BEBAN_TETAP', optionCode: 'LISTRIK' }]
    }));
    assert.equal(resolved.ok, true);
    const debit = resolved.command.journalLines.find(line => line.side === 'DEBIT');
    assert.equal(debit.accountId, setup.expenseAccount);
    assert.equal(debit.choiceGroupCode, 'BEBAN_TETAP');
    assert.equal(debit.choiceOptionCode, 'LISTRIK');

    const posted = await postAccountingJournal(db, setup.store, resolved.command);
    assert.equal(posted.ok, true);
    const postedDebit = posted.journal.lines.find(line => line.side === 'DEBIT');
    assert.equal(postedDebit.choiceGroupCode, 'BEBAN_TETAP');
    assert.equal(postedDebit.choiceOptionCode, 'LISTRIK');
    const raw = sqlite.prepare(`SELECT choice_group_code, choice_option_code FROM accounting_journal_lines WHERE journal_id = ? AND side = 'DEBIT'`).get(posted.journal.journalId);
    assert.deepEqual({ ...raw }, { choice_group_code: 'BEBAN_TETAP', choice_option_code: 'LISTRIK' });
  } finally { sqlite.close(); }
});

test('choice group uses single active option when no selection is supplied', async () => {
  const sqlite = freshDatabase();
  try {
    const setup = setupChoiceGroup(sqlite, { secondOption: false });
    const resolved = await resolvePosFactToJournalCommand(d1(sqlite), setup.store, expenseFact());
    assert.equal(resolved.ok, true);
    const debit = resolved.command.journalLines.find(line => line.side === 'DEBIT');
    assert.equal(debit.choiceOptionCode, 'LISTRIK');
  } finally { sqlite.close(); }
});

test('choice group uses active default when multiple options exist and fact is silent', async () => {
  const sqlite = freshDatabase();
  try {
    const setup = setupChoiceGroup(sqlite, { defaultCode: 'GAJI' });
    const resolved = await resolvePosFactToJournalCommand(d1(sqlite), setup.store, expenseFact());
    assert.equal(resolved.ok, true);
    const debit = resolved.command.journalLines.find(line => line.side === 'DEBIT');
    assert.equal(debit.accountId, setup.secondAccount);
    assert.equal(debit.choiceOptionCode, 'GAJI');
  } finally { sqlite.close(); }
});

test('choice group fails closed when selection is required or requested option is inactive', async () => {
  const sqlite = freshDatabase();
  try {
    const setup = setupChoiceGroup(sqlite);
    const db = d1(sqlite);
    const missing = await resolvePosFactToJournalCommand(db, setup.store, expenseFact());
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'NEEDS_CHOICE_SELECTION');

    sqlite.prepare(`UPDATE accounting_choice_options SET is_active = 0 WHERE id = 'choice_gaji'`).run();
    const inactive = await resolvePosFactToJournalCommand(db, setup.store, expenseFact({
      choiceSelections: [{ groupCode: 'BEBAN_TETAP', optionCode: 'GAJI' }]
    }));
    assert.equal(inactive.ok, false);
    assert.equal(inactive.code, 'NEEDS_CHOICE_OPTION');
  } finally { sqlite.close(); }
});

test('choice group allows generic option without account but Accounting fails closed when it is selected', async () => {
  const sqlite = freshDatabase();
  try {
    const setup = setupChoiceGroup(sqlite, { secondOption: false });
    sqlite.prepare(`UPDATE accounting_choice_options SET account_id = NULL WHERE id = 'choice_listrik'`).run();
    const result = await resolvePosFactToJournalCommand(d1(sqlite), setup.store, expenseFact());
    assert.equal(result.ok, false);
    assert.equal(result.code, 'NEEDS_CHOICE_ACCOUNT');
  } finally { sqlite.close(); }
});

test('choice group rejects an inactive mapped account at Accounting resolution time', async () => {
  const sqlite = freshDatabase();
  try {
    const setup = setupChoiceGroup(sqlite, { secondOption: false });
    sqlite.prepare(`UPDATE chart_of_accounts SET is_active = 0 WHERE id = ?`).run(setup.expenseAccount);
    const result = await resolvePosFactToJournalCommand(d1(sqlite), setup.store, expenseFact());
    assert.equal(result.ok, false);
    assert.equal(result.code, 'NEEDS_CHOICE_ACCOUNT');
  } finally { sqlite.close(); }
});

test('distinct choice-group rules do not collapse when they resolve to the same account', async () => {
  const sqlite = freshDatabase();
  try {
    const setup = setupChoiceGroup(sqlite, { secondOption: false });
    const secondGroupId = 'choice_group_operational_second';
    sqlite.prepare(`INSERT INTO accounting_choice_groups (id, store_id, code, name, is_active) VALUES (?, ?, 'BEBAN_LAIN', 'Beban Lain', 1)`).run(secondGroupId, setup.store.id);
    sqlite.prepare(`INSERT INTO accounting_choice_options (id, choice_group_id, store_id, code, name, account_id, is_default, sort_order, is_active) VALUES ('choice_lain', ?, ?, 'LAIN', 'Lain', ?, 1, 10, 1)`).run(secondGroupId, setup.store.id, setup.expenseAccount);
    sqlite.prepare(`INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, choice_group_id, is_active, sort_order) VALUES ('choice_rule_second', ?, ?, 'Beban Lain', 'DEBIT', 'choice_group', ?, 1, 15)`).run(setup.store.id, setup.categoryId, secondGroupId);
    const result = await resolvePosFactToJournalCommand(d1(sqlite), setup.store, expenseFact());
    assert.equal(result.ok, true);
    const debits = result.command.journalLines.filter(line => line.side === 'DEBIT' && line.accountId === setup.expenseAccount);
    assert.equal(debits.length, 2);
    assert.deepEqual(debits.map(line => line.choiceGroupCode).sort(), ['BEBAN_LAIN', 'BEBAN_TETAP']);
  } finally { sqlite.close(); }
});

test('reversal preserves original choice provenance after option account mapping changes', async () => {
  const sqlite = freshDatabase();
  try {
    const setup = setupChoiceGroup(sqlite, { secondOption: false });
    const db = d1(sqlite);
    const resolved = await resolvePosFactToJournalCommand(db, setup.store, expenseFact());
    assert.equal(resolved.ok, true);
    const original = await postAccountingJournal(db, setup.store, resolved.command);
    assert.equal(original.ok, true);
    sqlite.prepare(`UPDATE accounting_choice_options SET account_id = ? WHERE id = 'choice_listrik'`).run(setup.secondAccount);

    const reversed = await postAccountingJournal(db, setup.store, {
      businessDate: '2026-08-20',
      occurredAt: '2026-08-20T03:00:00.000Z',
      sourceSystem: 'LEKER_POS_VOID',
      sourceReferenceId: 'VOID:EXPENSE:expense_choice_test:permit_test',
      correlationId: 'permit_test',
      idempotencyKey: 'LEKER_POS_VOID:permit_test',
      description: 'Pembalik operasional choice group',
      reversalOfJournalId: original.journal.journalId,
      journalLines: original.journal.lines.map(line => ({
        accountId: line.accountId,
        side: line.side === 'DEBIT' ? 'CREDIT' : 'DEBIT',
        amountScaled: line.amountScaled,
        description: `Pembalik · ${line.description}`,
        isSystemGenerated: line.isSystemGenerated
      }))
    });
    assert.equal(reversed.ok, true);
    const reversedChoiceLine = reversed.journal.lines.find(line => line.choiceGroupCode === 'BEBAN_TETAP');
    assert.ok(reversedChoiceLine);
    assert.equal(reversedChoiceLine.accountId, setup.expenseAccount, 'reversal must keep the original account snapshot');
    assert.equal(reversedChoiceLine.choiceOptionCode, 'LISTRIK');
    assert.notEqual(reversedChoiceLine.accountId, setup.secondAccount);
  } finally { sqlite.close(); }
});

test('journal line provenance must be supplied as a complete group+option pair', async () => {
  const sqlite = freshDatabase();
  try {
    const setup = setupChoiceGroup(sqlite, { secondOption: false });
    const result = await postAccountingJournal(d1(sqlite), setup.store, {
      businessDate: '2026-08-20',
      sourceSystem: 'TEST',
      sourceReferenceId: 'partial_provenance',
      correlationId: 'partial_provenance',
      idempotencyKey: 'partial_provenance',
      description: 'Partial provenance',
      journalLines: [
        { accountId: setup.expenseAccount, side: 'DEBIT', amountScaled: ACCOUNTING_AMOUNT_SCALE, choiceGroupCode: 'BEBAN_TETAP' },
        { accountId: setup.secondAccount, side: 'CREDIT', amountScaled: ACCOUNTING_AMOUNT_SCALE }
      ]
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'JOURNAL_LINE_CHOICE_PROVENANCE_INVALID');
  } finally { sqlite.close(); }
});
