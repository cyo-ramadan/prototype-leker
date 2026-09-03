import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { listStoreTransactions } from '../src/admin-transactions.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const source = readFileSync(new URL('../src/admin-transactions.js', import.meta.url), 'utf8');

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

// D1 caps every compound-select node at 5 terms (Cloudflare's SQLITE_LIMIT_COMPOUND_SELECT,
// far below SQLite's usual default of 500). node:sqlite -- what this whole suite runs
// against -- does not enforce that cap at all, so a >5-term UNION ALL passes every local
// test while returning zero rows on real production D1 ("too many terms in compound
// SELECT", confirmed 2026-09-03 against the live database). This is a static guard against
// the fix regressing back into one flat 6-term union: it counts UNION ALL occurrences
// between each CTE boundary, not just the total.
test('the six-source transaction query stays split under the D1 compound-select cap (5 terms)', () => {
  const cteBodies = source.split(/\b\w+\s+AS\s+\(/).slice(1);
  assert.ok(cteBodies.length >= 3, 'expected at least pos_facts, other_facts, and transaction_facts CTEs');
  for (const body of cteBodies.slice(0, 2)) {
    const unionCount = (body.match(/UNION ALL/g) || []).length;
    assert.ok(unionCount <= 4, `a CTE has ${unionCount} UNION ALL (>4, i.e. >5 terms) -- exceeds D1's compound-select cap`);
  }
});

async function seedCommon(db) {
  const cashier = db.prepare("SELECT id FROM cashiers WHERE store_id = 'store_001' AND is_active = 1 ORDER BY id LIMIT 1").get();
  db.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES ('drawer_tx_query_test', 'store_001', ?, 100000, 'OPEN', '2026-09-03T00:00:00.000Z')
  `).run(cashier.id);
  return cashier.id;
}

test('listStoreTransactions returns every fact source (Sale/Purchase/Expense/OtherIncome/ApprovalRequest) after the CTE split', async () => {
  const db = migratedDatabase();
  try {
    const cashierId = await seedCommon(db);
    db.prepare(`
      INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, customer_name, total_amount, created_at)
      VALUES ('sale_tx_query_test', 'store_001', 'drawer_tx_query_test', ?, 'Budi', 25000, '2026-09-03T01:00:00.000Z')
    `).run(cashierId);
    db.prepare(`
      INSERT INTO purchases (id, store_id, drawer_session_id, cashier_id, description, total_amount, created_at)
      VALUES ('purchase_tx_query_test', 'store_001', 'drawer_tx_query_test', ?, 'Beli gula', 15000, '2026-09-03T02:00:00.000Z')
    `).run(cashierId);
    db.prepare(`
      INSERT INTO expenses (id, store_id, drawer_session_id, cashier_id, description, amount, quantity, created_at)
      VALUES ('expense_tx_query_test', 'store_001', 'drawer_tx_query_test', ?, 'Ongkir', 5000, '1', '2026-09-03T03:00:00.000Z')
    `).run(cashierId);
    db.prepare(`
      INSERT INTO other_income (id, store_id, drawer_session_id, cashier_id, description, amount, created_at)
      VALUES ('income_tx_query_test', 'store_001', 'drawer_tx_query_test', ?, 'Jual kardus bekas', 3000, '2026-09-03T04:00:00.000Z')
    `).run(cashierId);
    db.prepare(`
      INSERT INTO approval_requests (id, store_id, drawer_session_id, cashier_id, request_type, payload_json, created_at, updated_at)
      VALUES ('approval_tx_query_test', 'store_001', 'drawer_tx_query_test', ?, 'GOODS_FLOW', '{}', '2026-09-03T05:00:00.000Z', '2026-09-03T05:00:00.000Z')
    `).run(cashierId);

    const result = await listStoreTransactions(new D1Database(db), 'store_001', { filter: 'ALL', limit: 50 });
    assert.equal(result.ok, true);
    const kinds = result.transactions.map(item => item.kind);
    for (const expected of ['SALE', 'PURCHASE', 'EXPENSE', 'OTHER_INCOME', 'GOODS_FLOW']) {
      assert.ok(kinds.includes(expected), `expected ${expected} in results, got: ${kinds.join(', ')}`);
    }
  } finally {
    db.close();
  }
});
