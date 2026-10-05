import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { listStoreTransactions } from '../src/admin-transactions.js';

// Bos Cyo, 2026-10-05: "di kartu pembelian kenapa engga ada qty yang dibelinya".
// Daftar Data Transaksi hanya membawa deskripsi + total; rincian barang (qty + satuan)
// baru muncul di Detail. Sekarang tiap baris PURCHASE membawa purchaseItems.

const migrationDir = new URL('../migrations/', import.meta.url);

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

test('baris Pembelian di daftar transaksi membawa qty + satuan barang yang dibeli', async () => {
  const db = migratedDatabase();
  try {
    const store = db.prepare("SELECT id FROM stores WHERE code = 'G001' LIMIT 1").get();
    const cashier = db.prepare("SELECT id FROM cashiers WHERE store_id = 'store_001' AND is_active = 1 ORDER BY id LIMIT 1").get();
    const products = db.prepare(`
      SELECT p.id, p.name, u.id AS unit_id, u.symbol AS unit_symbol
      FROM products p JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
      WHERE p.store_id = 'store_001' ORDER BY p.id LIMIT 2
    `).all();
    db.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES ('drawer_qty', ?, ?, 100000, 'OPEN', '2026-10-05T00:00:00.000Z')
    `).run(store.id, cashier.id);
    db.prepare(`
      INSERT INTO purchases (id, store_id, drawer_session_id, cashier_id, description, total_amount, created_at, payment_method)
      VALUES ('purchase_qty', ?, 'drawer_qty', ?, 'Pembelian Gula', 17500, '2026-10-05T02:00:00.000Z', 'CASH')
    `).run(store.id, cashier.id);
    products.forEach((product, index) => {
      db.prepare(`
        INSERT INTO purchase_items (id, purchase_id, store_id, product_id, product_name, unit_id, unit_symbol, quantity, line_total, unit_cost, average_cost_before, average_cost_after, created_at)
        VALUES (?, 'purchase_qty', ?, ?, ?, ?, ?, ?, 8750, 8750000000, 0, 8750000000, '2026-10-05T02:00:00.000Z')
      `).run(`pi_qty_${index}`, store.id, product.id, product.name, product.unit_id, product.unit_symbol, index === 0 ? 1000 : 1);
    });
    db.prepare(`
      INSERT INTO purchases (id, store_id, drawer_session_id, cashier_id, description, total_amount, created_at, payment_method)
      VALUES ('purchase_kosong', ?, 'drawer_qty', ?, 'Pembelian lama tanpa rincian', 5000, '2026-10-05T01:00:00.000Z', 'CASH')
    `).run(store.id, cashier.id);

    const listing = await listStoreTransactions(new D1Database(db), store.id, { filter: 'PURCHASES', limit: 50 });
    assert.equal(listing.ok, true);
    const byId = new Map(listing.transactions.map(row => [row.id, row]));
    const purchase = byId.get('purchase_qty');
    assert.equal(purchase.purchaseItems.length, 2);
    const first = purchase.purchaseItems.find(item => item.productName === products[0].name);
    assert.equal(first.quantity, 1000);
    assert.equal(first.unitSymbol, products[0].unit_symbol);
    assert.deepEqual(byId.get('purchase_kosong').purchaseItems, [], 'pembelian tanpa rincian tetap tampil, dengan daftar kosong');
  } finally {
    db.close();
  }
});

test('kartu Pembelian di layar admin menampilkan baris "Dibeli:" dari purchaseItems', () => {
  const ui = readFileSync(new URL('../public/admin-transactions-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /function purchaseItemsLine\(transaction\)/);
  assert.match(ui, /Dibeli:/);
  assert.match(ui, /\$\{purchaseItemsLine\(transaction\)\}/);
});
