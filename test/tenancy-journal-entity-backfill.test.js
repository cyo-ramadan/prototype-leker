import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { listAccountingAccounts, postAccountingJournal } from '../src/accounting-ledger.js';

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

test('normal journal posting anchors header and lines to the store entity without caller entity context', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  const store = { id: 'store_001' };
  try {
    const expectedEntityId = sqlite.prepare('SELECT entity_id FROM stores WHERE id = ?').get(store.id).entity_id;
    assert.ok(expectedEntityId);

    const accounts = await listAccountingAccounts(db, store.id);
    const debit = accounts.find(account => account.accountCode === '1101');
    const credit = accounts.find(account => account.accountCode === '3101');
    assert.ok(debit && credit);

    const posted = await postAccountingJournal(db, store, {
      businessDate: '2026-08-23',
      sourceSystem: 'MANUAL',
      sourceReferenceId: 'entity-anchor-regression',
      correlationId: 'entity-anchor-regression',
      idempotencyKey: 'entity-anchor-regression',
      description: 'Entity anchor regression',
      journalLines: [
        { accountId: debit.accountId, side: 'DEBIT', amountMinor: 1000 },
        { accountId: credit.accountId, side: 'CREDIT', amountMinor: 1000 }
      ]
    });
    assert.equal(posted.ok, true);

    const header = sqlite.prepare(`
      SELECT entity_id, journal_status
      FROM accounting_journal_headers
      WHERE id = ?
    `).get(posted.journal.journalId);
    assert.deepEqual(header, { entity_id: expectedEntityId, journal_status: 'POSTED' });

    const lines = sqlite.prepare(`
      SELECT entity_id
      FROM accounting_journal_lines
      WHERE journal_id = ?
      ORDER BY line_number
    `).all(posted.journal.journalId);
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map(row => row.entity_id), [expectedEntityId, expectedEntityId]);
  } finally {
    sqlite.close();
  }
});

test('entity anchoring does not weaken posted journal immutability', async () => {
  const sqlite = freshDatabase();
  const db = d1(sqlite);
  const store = { id: 'store_001' };
  try {
    const accounts = await listAccountingAccounts(db, store.id);
    const debit = accounts.find(account => account.accountCode === '1101');
    const credit = accounts.find(account => account.accountCode === '3101');
    assert.ok(debit && credit);

    const posted = await postAccountingJournal(db, store, {
      businessDate: '2026-08-23',
      sourceSystem: 'MANUAL',
      sourceReferenceId: 'immutability-regression',
      correlationId: 'immutability-regression',
      idempotencyKey: 'immutability-regression',
      description: 'Immutability regression',
      journalLines: [
        { accountId: debit.accountId, side: 'DEBIT', amountMinor: 1000 },
        { accountId: credit.accountId, side: 'CREDIT', amountMinor: 1000 }
      ]
    });
    assert.equal(posted.ok, true);

    assert.throws(
      () => sqlite.prepare(`UPDATE accounting_journal_headers SET description = ? WHERE id = ?`)
        .run('mutated', posted.journal.journalId),
      /POSTED_JOURNAL_IMMUTABLE/
    );
    assert.throws(
      () => sqlite.prepare(`UPDATE accounting_journal_lines SET description = ? WHERE journal_id = ?`)
        .run('mutated', posted.journal.journalId),
      /POSTED_JOURNAL_IMMUTABLE/
    );
  } finally {
    sqlite.close();
  }
});
