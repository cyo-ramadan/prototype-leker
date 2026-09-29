import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { listStoreTransactions } from '../src/admin-transactions.js';

// Bos Cyo, 2026-09-29: sempat dicoba sembunyikan produksi AUTO_DADAKAN dari
// Riwayat Transaksi (digabung total ke Detail Penjualan). Setelah "adu
// gagasan", diputuskan baliknya: TETAP tampil sebagai baris sendiri --
// filter "Arus Barang & Produksi" butuh ini biar lengkap buat audit
// pergerakan bahan -- tapi dikasih penanda jelas kalau itu bagian dari satu
// Penjualan (bukan aktivitas berdiri sendiri yang bisa dihapus sendiri-
// sendiri). Hapus tetap lewat baris Penjualannya (mirror penuh).

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

function productWithBaseUnit(db, excludeId) {
  return db.prepare(`
    SELECT p.id, p.name, u.id AS unit_id, u.symbol AS unit_symbol
    FROM products p JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    WHERE p.store_id = 'store_001' AND (? IS NULL OR p.id != ?)
    ORDER BY p.id LIMIT 1
  `).get(excludeId ?? null, excludeId ?? null);
}

function seedRecipeAndRun(db, { runId, mode, saleId = null, outputProduct, componentProduct, cashierId }) {
  const recipeId = `recipe_${runId}`;
  db.prepare(`
    INSERT INTO manufacturing_recipes (id, store_id, output_product_id, output_unit_id, output_quantity, revision, status, created_at)
    VALUES (?, 'store_001', ?, ?, 1, 1, 'ACTIVE', '2026-09-29T00:00:00.000Z')
  `).run(recipeId, outputProduct.id, outputProduct.unit_id);
  db.prepare(`
    INSERT INTO production_runs (
      id, store_id, drawer_session_id, sale_id, mode, output_product_id, output_product_name,
      output_unit_id, output_unit_symbol, recipe_id, recipe_revision, batches,
      output_quantity_per_batch, total_output_quantity, status, created_by_role, created_by_id, created_at
    ) VALUES (?, 'store_001', NULL, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, 'POSTED', 'CASHIER', ?, '2026-09-29T06:00:00.000Z')
  `).run(runId, saleId, mode, outputProduct.id, outputProduct.name, outputProduct.unit_id, outputProduct.unit_symbol, recipeId, cashierId);
  db.prepare(`
    INSERT INTO production_run_components (
      id, production_run_id, store_id, component_product_id, component_product_name,
      component_unit_id, component_unit_symbol, quantity_per_batch, total_quantity
    ) VALUES (?, ?, 'store_001', ?, ?, ?, ?, 1, 1)
  `).run(`comp_${runId}`, runId, componentProduct.id, componentProduct.name, componentProduct.unit_id, componentProduct.unit_symbol);
}

test('produksi AUTO_DADAKAN tetap tampil sebagai baris sendiri di Riwayat Transaksi, dengan penanda terkait Penjualannya', async () => {
  const db = migratedDatabase();
  try {
    const store = db.prepare("SELECT id FROM stores WHERE code = 'G001' LIMIT 1").get();
    const cashier = db.prepare("SELECT id FROM cashiers WHERE store_id = 'store_001' AND is_active = 1 ORDER BY id LIMIT 1").get();
    const outputProduct = productWithBaseUnit(db, null);
    const componentProduct = productWithBaseUnit(db, outputProduct.id);
    const manualOutputProduct = db.prepare(`
      SELECT p.id, p.name, u.id AS unit_id, u.symbol AS unit_symbol
      FROM products p JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
      WHERE p.store_id = 'store_001' AND p.id NOT IN (?, ?) ORDER BY p.id LIMIT 1
    `).get(outputProduct.id, componentProduct.id);

    db.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES ('drawer_dadakan_merge', ?, ?, 100000, 'OPEN', '2026-09-29T00:00:00.000Z')
    `).run(store.id, cashier.id);
    db.prepare(`
      INSERT INTO sales (id, store_id, cashier_id, drawer_session_id, customer_name, total_amount, payment_method, created_at)
      VALUES ('sale_dadakan_merge', ?, ?, 'drawer_dadakan_merge', '', 6000, 'CASH', '2026-09-29T06:00:00.000Z')
    `).run(store.id, cashier.id);

    seedRecipeAndRun(db, { runId: 'run_dadakan_merge', mode: 'AUTO_DADAKAN', saleId: 'sale_dadakan_merge', outputProduct, componentProduct, cashierId: cashier.id });
    seedRecipeAndRun(db, { runId: 'run_manual_merge', mode: 'MANUAL', outputProduct: manualOutputProduct, componentProduct, cashierId: cashier.id });

    const listing = await listStoreTransactions(new D1Database(db), store.id, { filter: 'ALL', limit: 50 });
    assert.equal(listing.ok, true);
    const byId = new Map(listing.transactions.map(row => [row.id, row]));

    const sale = byId.get('sale_dadakan_merge');
    assert.equal(sale.kind, 'SALE');
    assert.match(sale.description, /\+Produksi Dadakan/, 'Penjualan yang memicu produksi dadakan ditandai di deskripsinya');

    const dadakan = byId.get('run_dadakan_merge');
    assert.equal(dadakan.kind, 'PRODUCTION', 'produksi AUTO_DADAKAN tetap tampil sebagai baris sendiri');
    assert.match(dadakan.description, /Dadakan \(terkait Penjualan sale_dadakan_merge\)/, 'baris Produksi dadakan menyebut Penjualan yang terkait');

    const manual = byId.get('run_manual_merge');
    assert.equal(manual.kind, 'PRODUCTION');
    assert.doesNotMatch(manual.description, /Dadakan|terkait Penjualan/, 'produksi MANUAL tidak dikasih penanda link (memang bukan dadakan)');
  } finally {
    db.close();
  }
});
