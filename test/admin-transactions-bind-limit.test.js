import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { listStoreTransactions } from '../src/admin-transactions.js';

// D1 rejects statements with more than 100 bind variables; node:sqlite does
// not, so this shim enforces the production cap. Data Transaksi page sizes go
// up to 100, and a page full of sales used to send 101 (page 50) or 201
// (page 100) values in one lookup.
const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) {
    if (params.length > 100) throw new Error(`too many SQL variables: ${params.length}`);
    return new D1Statement(this.db, this.sql, params);
  }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
}
class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
}

test('Data Transaksi works at every page size with a page full of sales (D1 100-bind cap)', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
    }
    const cashier = db.prepare("SELECT id FROM cashiers WHERE store_id = 'store_001' AND is_active = 1 ORDER BY id LIMIT 1").get();
    db.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES ('drawer_bind_limit', 'store_001', ?, 0, 'OPEN', '2026-09-29T00:00:00.000Z')
    `).run(cashier.id);
    const insertSale = db.prepare(`
      INSERT INTO sales (id, store_id, cashier_id, drawer_session_id, customer_name, total_amount, payment_method, created_at)
      VALUES (?, 'store_001', ?, 'drawer_bind_limit', '', 1000, 'CASH', ?)
    `);
    for (let i = 0; i < 120; i += 1) {
      insertSale.run(`sale_bind_${String(i).padStart(3, '0')}`, cashier.id, new Date(Date.UTC(2026, 8, 29, 0, i)).toISOString());
    }
    for (const limit of [5, 20, 50, 100]) {
      const listing = await listStoreTransactions(new D1Database(db), 'store_001', { limit });
      assert.equal(listing.ok, true);
      assert.equal(listing.transactions.length, limit);
    }
  } finally {
    db.close();
  }
});
