import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { postVoucherRedemptionJournal } from '../src/accounting-voucher-bridge.js';

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

test('ACCOUNTING Voucher bridge posts exact promotion accounts once with canonical provenance', async () => {
  const sqlite = freshDatabase();
  try {
    const db = new D1Database(sqlite);
    const store = { id: 'store_001', edition: 'ACCOUNTING' };
    const command = {
      redemptionId: 'voucher-redemption-accounting-001',
      businessDate: '2026-09-06',
      costScaled: 2_500_000,
      occurredAt: '2026-09-06T10:30:00.000Z'
    };

    const first = await postVoucherRedemptionJournal(db, store, command);
    assert.equal(first.ok, true);
    assert.equal(first.duplicate, false);

    const second = await postVoucherRedemptionJournal(db, store, command);
    assert.equal(second.ok, true);
    assert.equal(second.duplicate, true);
    assert.equal(second.journal.journalId, first.journal.journalId);

    const headers = sqlite.prepare(`
      SELECT source_system, source_reference_id, correlation_id, idempotency_key
      FROM accounting_journal_headers
      WHERE store_id = ? AND source_reference_id = ?
    `).all(store.id, command.redemptionId);
    assert.deepEqual(headers.map(row => ({ ...row })), [{
      source_system: 'VOUCHER',
      source_reference_id: command.redemptionId,
      correlation_id: command.redemptionId,
      idempotency_key: `VOUCHER:${store.id}:${command.redemptionId}`
    }]);

    const lines = sqlite.prepare(`
      SELECT l.side, l.amount_scaled, a.code, a.name, a.type, a.subtype
      FROM accounting_journal_lines l
      JOIN accounting_journal_headers h ON h.id = l.journal_id AND h.store_id = l.store_id
      JOIN chart_of_accounts a ON a.id = l.account_id AND a.store_id = l.store_id
      WHERE h.store_id = ? AND h.source_reference_id = ?
      ORDER BY l.line_number
    `).all(store.id, command.redemptionId);
    assert.deepEqual(lines.map(row => ({ ...row })), [
      {
        side: 'DEBIT',
        amount_scaled: command.costScaled,
        code: '6105',
        name: 'Beban Promosi',
        type: 'EXPENSE',
        subtype: 'PROMOTIONAL_EXPENSE'
      },
      {
        side: 'CREDIT',
        amount_scaled: command.costScaled,
        code: '1304',
        name: 'Persediaan - Vocer Promosi',
        type: 'ASSET',
        subtype: 'INVENTORY'
      }
    ]);
    assert.doesNotMatch(JSON.stringify(lines), /REVENUE/);
  } finally {
    sqlite.close();
  }
});

test('non-ACCOUNTING Voucher bridge skips before any database access', async () => {
  const db = {
    prepare() { throw new Error('database must not be touched'); },
    batch() { throw new Error('database must not be touched'); }
  };
  const result = await postVoucherRedemptionJournal(db, { id: 'store_lite', edition: 'LITE' }, {
    redemptionId: 'voucher-redemption-lite-001',
    businessDate: '2026-09-06',
    costScaled: 2_500_000
  });
  assert.deepEqual(result, { ok: true, skipped: true, status: 'SKIPPED_NON_ACCOUNTING' });
});

test('ACCOUNTING Voucher bridge fails closed when either exact fixed account is unavailable', async () => {
  const sqlite = freshDatabase();
  try {
    sqlite.prepare(`
      UPDATE chart_of_accounts SET is_active = 0
      WHERE store_id = 'store_001' AND code = '6105'
    `).run();
    const result = await postVoucherRedemptionJournal(
      new D1Database(sqlite),
      { id: 'store_001', edition: 'ACCOUNTING' },
      {
        redemptionId: 'voucher-redemption-missing-account-001',
        businessDate: '2026-09-06',
        costScaled: 2_500_000
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.code, 'VOUCHER_ACCOUNTING_ACCOUNTS_MISSING');
    assert.equal(sqlite.prepare(`
      SELECT COUNT(*) AS count FROM accounting_journal_headers
      WHERE source_system = 'VOUCHER'
    `).get().count, 0);
  } finally {
    sqlite.close();
  }
});
