import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { listStoreStockBalances } from '../src/admin-stock.js';

// Bos Cyo, 2026-09-29: "selain saldo tambahkan informasi hpp saat itu,
// kususnya disisi admin". Saldo stok sudah ada (item.quantity); yang belum
// ada adalah rata-rata biaya (Average Cost / HPP) barang itu saat ini.
// products.average_cost sudah tersimpan scaled-integer (1 rupiah =
// 1.000.000 unit, invariant #1) -- tinggal ikut diambil dan diubah balik ke
// desimal rupiah di listStoreStockBalances, yang dipakai bareng oleh Admin
// Stok dan mirror baca-saja Kasir/CS.

const migrationDir = new URL('../migrations/', import.meta.url);
const adminStockUi = readFileSync(new URL('../public/admin-stock.js', import.meta.url), 'utf8');

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

test('listStoreStockBalances ikut mengembalikan averageCost (HPP) hasil konversi balik dari scaled-integer', async () => {
  const db = migratedDatabase();
  try {
    const product = db.prepare("SELECT id FROM products WHERE store_id = 'store_001' ORDER BY id LIMIT 1").get();
    // Rp 12.345,67 disimpan scaled: 12345.67 * 1_000_000
    db.prepare('UPDATE products SET average_cost = ? WHERE id = ?').run(Math.round(12345.67 * 1_000_000), product.id);

    const balances = await listStoreStockBalances(new D1Database(db), 'store_001');
    const row = balances.find(item => item.productId === product.id);
    assert.ok(row, 'produk yang di-update wajib ada di daftar saldo');
    assert.equal(row.averageCost, 12345.67);
  } finally {
    db.close();
  }
});

test('UI Admin Stok menampilkan HPP saat ini di samping Saldo, bukan cuma quantity', () => {
  assert.match(adminStockUi, /HPP saat ini/);
  assert.match(adminStockUi, /rupiah4\(item\.averageCost\)/);
});
