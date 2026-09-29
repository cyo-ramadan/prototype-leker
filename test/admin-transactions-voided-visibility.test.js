import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { listStoreTransactions } from '../src/admin-transactions.js';

// Bos Cyo, 2026-09-29: "data yang udah di-del/soft delete itu tetap tampil
// beserta jurnal pembaliknya atau dihilangkan? kalo masih tetap tampil,
// minimal dibuat transparant aja (read-only)". Jawabannya: baris transaksi
// yang sudah dihapus (voided_at terisi) TETAP tampil di Riwayat Transaksi --
// tidak pernah difilter keluar dari listStoreTransactions -- cuma status-nya
// berubah jadi 'voided'. Jurnal pembalik Accounting-nya sendiri hidup di
// modul Accounting terpisah (invariant #4), bukan di daftar operasional ini.

const migrationDir = new URL('../migrations/', import.meta.url);
const cashierDataExplorerUi = readFileSync(new URL('../public/cashier-data-explorer.js', import.meta.url), 'utf8');
const adminTransactionsUi = readFileSync(new URL('../public/admin-transactions-ui.js', import.meta.url), 'utf8');

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
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

test('penjualan yang sudah dihapus (voided) tetap tampil di Riwayat Transaksi, bukan hilang dari daftar', async () => {
  const db = migratedDatabase();
  try {
    const store = db.prepare("SELECT id FROM stores WHERE code = 'G001' LIMIT 1").get();
    const cashier = db.prepare("SELECT id FROM cashiers WHERE store_id = 'store_001' AND is_active = 1 ORDER BY id LIMIT 1").get();
    db.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES ('drawer_voided_vis', ?, ?, 100000, 'OPEN', '2026-09-29T00:00:00.000Z')
    `).run(store.id, cashier.id);
    db.prepare(`
      INSERT INTO sales (id, store_id, cashier_id, drawer_session_id, customer_name, total_amount, payment_method, created_at, voided_at)
      VALUES ('sale_voided_vis', ?, ?, 'drawer_voided_vis', '', 6000, 'CASH', '2026-09-29T06:00:00.000Z', '2026-09-29T07:00:00.000Z')
    `).run(store.id, cashier.id);

    const listing = await listStoreTransactions(new D1Database(db), store.id, { filter: 'ALL', limit: 50 });
    assert.equal(listing.ok, true);
    const row = listing.transactions.find(item => item.id === 'sale_voided_vis');
    assert.ok(row, 'penjualan yang sudah dihapus wajib tetap ada di daftar');
    assert.equal(row.status, 'voided');
  } finally {
    db.close();
  }
});

test('baris transaksi yang sudah dihapus dikasih penanda Read only di sisi Kasir dan Admin', () => {
  assert.match(cashierDataExplorerUi, /row\.status === 'voided'/);
  assert.match(cashierDataExplorerUi, /transaksi ini sudah dihapus/);
  assert.match(adminTransactionsUi, /raw === 'voided'/);
  assert.match(adminTransactionsUi, /Dihapus \(read only\)/);
});
