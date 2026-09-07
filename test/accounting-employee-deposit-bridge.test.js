import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  postEmployeeDepositRecognitionJournal,
  postEmployeeDepositSettlementJournal,
} from '../src/accounting-employee-deposit-bridge.js';

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(sqlite, sql, params = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) { return new D1Statement(this.sqlite, this.sql, params); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.params) ?? null; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.params) }; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class D1Database {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new D1Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function journalLines(sqlite, referenceId) {
  return sqlite.prepare(`
    SELECT h.source_system, h.source_reference_id, h.correlation_id,
           h.idempotency_key, l.side, l.amount_scaled,
           a.code, a.name, a.type, a.subtype
    FROM accounting_journal_headers h
    JOIN accounting_journal_lines l ON l.journal_id = h.id AND l.store_id = h.store_id
    JOIN chart_of_accounts a ON a.id = l.account_id AND a.store_id = l.store_id
    WHERE h.store_id = 'store_001' AND h.source_reference_id = ?
    ORDER BY l.line_number
  `).all(referenceId).map(row => ({ ...row }));
}

test('recognition bridge posts Dr 1202 / Cr 1101 exactly once with canonical provenance', async () => {
  const sqlite = freshDatabase();
  try {
    const db = new D1Database(sqlite);
    const store = { id: 'store_001', edition: 'ACCOUNTING' };
    const command = {
      receivableId: 'orp-employee-001',
      businessDate: '2026-09-07',
      amountScaled: 530000 * 1_000_000,
      occurredAt: '2026-09-07T01:00:00.000Z'
    };
    const first = await postEmployeeDepositRecognitionJournal(db, store, command);
    const retry = await postEmployeeDepositRecognitionJournal(db, store, command);
    assert.equal(first.ok, true);
    assert.equal(first.duplicate, false);
    assert.equal(retry.ok, true);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.journal.journalId, first.journal.journalId);
    assert.deepEqual(journalLines(sqlite, command.receivableId), [
      {
        source_system: 'EMPLOYEE_DEPOSIT',
        source_reference_id: command.receivableId,
        correlation_id: command.receivableId,
        idempotency_key: `EMPLOYEE_DEPOSIT_RECOGNITION:${store.id}:${command.receivableId}`,
        side: 'DEBIT', amount_scaled: command.amountScaled,
        code: '1202', name: 'Piutang Karyawan', type: 'ASSET', subtype: 'RECEIVABLE'
      },
      {
        source_system: 'EMPLOYEE_DEPOSIT',
        source_reference_id: command.receivableId,
        correlation_id: command.receivableId,
        idempotency_key: `EMPLOYEE_DEPOSIT_RECOGNITION:${store.id}:${command.receivableId}`,
        side: 'CREDIT', amount_scaled: command.amountScaled,
        code: '1101', name: 'Kas', type: 'ASSET', subtype: 'CASH'
      }
    ]);
  } finally {
    sqlite.close();
  }
});

test('settlement bridge posts Dr 1101 / Cr 1202 and retry stays idempotent', async () => {
  const sqlite = freshDatabase();
  try {
    const db = new D1Database(sqlite);
    const store = { id: 'store_001', edition: 'ACCOUNTING' };
    const command = {
      paymentId: 'orpp-employee-001',
      businessDate: '2026-09-07',
      amountScaled: 450000 * 1_000_000,
      occurredAt: '2026-09-07T02:00:00.000Z'
    };
    const first = await postEmployeeDepositSettlementJournal(db, store, command);
    const retry = await postEmployeeDepositSettlementJournal(db, store, command);
    assert.equal(first.ok, true);
    assert.equal(first.duplicate, false);
    assert.equal(retry.ok, true);
    assert.equal(retry.duplicate, true);
    assert.deepEqual(journalLines(sqlite, command.paymentId).map(row => ({
      side: row.side,
      amount_scaled: row.amount_scaled,
      code: row.code,
      idempotency_key: row.idempotency_key
    })), [
      {
        side: 'DEBIT', amount_scaled: command.amountScaled, code: '1101',
        idempotency_key: `EMPLOYEE_DEPOSIT_SETTLEMENT:${store.id}:${command.paymentId}`
      },
      {
        side: 'CREDIT', amount_scaled: command.amountScaled, code: '1202',
        idempotency_key: `EMPLOYEE_DEPOSIT_SETTLEMENT:${store.id}:${command.paymentId}`
      }
    ]);
  } finally {
    sqlite.close();
  }
});

test('non-ACCOUNTING bridge skips both events before database access', async () => {
  const db = {
    prepare() { throw new Error('database must not be touched'); },
    batch() { throw new Error('database must not be touched'); }
  };
  const store = { id: 'store_lite', edition: 'LITE' };
  assert.deepEqual(await postEmployeeDepositRecognitionJournal(db, store, {
    receivableId: 'orp-lite', businessDate: '2026-09-07', amountScaled: 1_000_000
  }), { ok: true, skipped: true, status: 'SKIPPED_NON_ACCOUNTING' });
  assert.deepEqual(await postEmployeeDepositSettlementJournal(db, store, {
    paymentId: 'orpp-lite', businessDate: '2026-09-07', amountScaled: 1_000_000
  }), { ok: true, skipped: true, status: 'SKIPPED_NON_ACCOUNTING' });
});

test('ACCOUNTING bridge fails closed when either exact fixed account is unavailable', async () => {
  const sqlite = freshDatabase();
  try {
    sqlite.prepare(`
      UPDATE chart_of_accounts SET is_active = 0
      WHERE store_id = 'store_001' AND code = '1202'
    `).run();
    const result = await postEmployeeDepositRecognitionJournal(
      new D1Database(sqlite),
      { id: 'store_001', edition: 'ACCOUNTING' },
      { receivableId: 'orp-missing-account', businessDate: '2026-09-07', amountScaled: 1_000_000 }
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.code, 'EMPLOYEE_DEPOSIT_ACCOUNTING_ACCOUNTS_MISSING');
    assert.equal(sqlite.prepare(`
      SELECT COUNT(*) AS count FROM accounting_journal_headers
      WHERE source_system = 'EMPLOYEE_DEPOSIT'
    `).get().count, 0);
  } finally {
    sqlite.close();
  }
});
