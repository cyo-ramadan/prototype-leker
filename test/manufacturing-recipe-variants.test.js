import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleManufacturingMasterApi } from '../src/manufacturing-master.js';

// Bos Cyo, 2026-09-30: satu barang (Es Teh) boleh punya lebih dari satu resep
// aktif (varian), mis. larutan tawar + larutan gula, atau larutan manis.
// Sebelumnya membuat resep kedua otomatis mengarsipkan resep pertama.

const migrationDir = new URL('../migrations/', import.meta.url);
const AGENT_TOKEN = 'a'.repeat(40);

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
  batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = statements.map(statement => statement.run());
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function migratedDatabase(upTo = null) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    if (upTo && file > upTo) break;
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

function call(d1, method, path, body) {
  const request = new Request(`https://example.test${path}?store=G001`, {
    method,
    headers: { authorization: `Bearer ${AGENT_TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return handleManufacturingMasterApi(request, { DB: d1, AGENT_ADMIN_TOKEN: AGENT_TOKEN }, path);
}

function pickProducts(db) {
  const rows = db.prepare(`
    SELECT p.id FROM products p
    JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    WHERE p.store_id = 'store_001' AND p.is_active = 1 ORDER BY p.id LIMIT 4
  `).all();
  assert.ok(rows.length >= 4, 'seed store_001 butuh minimal 4 barang');
  return rows.map(row => Number(row.id));
}

test('migrasi varian tidak menulis ulang resep lama: semua baris lama berlabel kosong', () => {
  const before = migratedDatabase('0126_product_base_unit_change_log.sql');
  const [output, a, b] = pickProducts(before);
  before.prepare(`
    INSERT INTO manufacturing_recipes (id, store_id, output_product_id, output_unit_id, output_quantity, revision, status, created_at)
    SELECT 'recipe_lama', 'store_001', ?, base_unit_id, 1, 1, 'ACTIVE', '2026-09-01T00:00:00.000Z' FROM products WHERE id = ?
  `).run(output, output);
  before.exec(readFileSync(new URL('0127_recipe_variant_label.sql', migrationDir), 'utf8'));
  const old = before.prepare("SELECT variant_label FROM manufacturing_recipes WHERE id = 'recipe_lama'").get();
  assert.equal(old.variant_label, '');
  assert.ok(a && b);
  before.close();
});

test('dua resep aktif berbeda varian hidup bersamaan; revisi varian sama mengarsipkan hanya varian itu', async () => {
  const db = migratedDatabase();
  try {
    const d1 = new D1Database(db);
    const [output, tawar, gula, manis] = pickProducts(db);

    const first = await call(d1, 'POST', '/api/admin/manufacturing/recipes', {
      outputProductId: output, outputQuantity: 1,
      components: [{ productId: tawar, quantity: 1 }, { productId: gula, quantity: 1 }]
    });
    assert.equal(first.status, 201);
    const firstId = (await first.json()).id;

    const second = await call(d1, 'POST', '/api/admin/manufacturing/recipes', {
      outputProductId: output, outputQuantity: 1, variantLabel: 'Larutan manis',
      components: [{ productId: manis, quantity: 1 }]
    });
    assert.equal(second.status, 201);
    const secondId = (await second.json()).id;

    let rows = db.prepare('SELECT id, status, variant_label FROM manufacturing_recipes WHERE output_product_id = ? ORDER BY revision').all(output);
    assert.deepEqual(rows.map(row => [row.id, row.status, row.variant_label]), [
      [firstId, 'ACTIVE', ''],
      [secondId, 'ACTIVE', 'Larutan manis']
    ], 'resep pertama tidak boleh ikut terarsip saat varian kedua dibuat');

    // Sambungan Master Barang bisa dipindah antar resep aktif (trigger lama tetap lolos).
    db.prepare('UPDATE products SET linked_recipe_id = ? WHERE id = ?').run(firstId, output);
    db.prepare('UPDATE products SET linked_recipe_id = ? WHERE id = ?').run(secondId, output);

    // Revisi varian "Larutan manis" hanya mengarsipkan varian itu.
    const revised = await call(d1, 'POST', '/api/admin/manufacturing/recipes', {
      outputProductId: output, outputQuantity: 1, variantLabel: 'Larutan manis',
      components: [{ productId: manis, quantity: 2 }]
    });
    assert.equal(revised.status, 201);
    rows = db.prepare('SELECT id, status, variant_label FROM manufacturing_recipes WHERE output_product_id = ? ORDER BY revision').all(output);
    assert.equal(rows.find(row => row.id === firstId).status, 'ACTIVE', 'varian tanpa label tidak tersentuh');
    assert.equal(rows.find(row => row.id === secondId).status, 'ARCHIVED');
    assert.equal(rows.filter(row => row.status === 'ACTIVE').length, 2);

    // Revisi tanpa label mengarsipkan hanya resep tanpa label (perilaku lama).
    const legacy = await call(d1, 'POST', '/api/admin/manufacturing/recipes', {
      outputProductId: output, outputQuantity: 1,
      components: [{ productId: tawar, quantity: 2 }]
    });
    assert.equal(legacy.status, 201);
    rows = db.prepare("SELECT id, status, variant_label FROM manufacturing_recipes WHERE output_product_id = ? AND status = 'ACTIVE' ORDER BY variant_label").all(output);
    assert.deepEqual(rows.map(row => row.variant_label), ['', 'Larutan manis']);
    assert.equal(rows.some(row => row.id === firstId), false, 'resep tanpa label lama sudah digantikan revisinya');

    const listing = await (await call(d1, 'GET', '/api/admin/manufacturing/recipes')).json();
    const labels = listing.recipes.filter(recipe => recipe.outputProductId === output).map(recipe => recipe.variantLabel).sort();
    assert.deepEqual(labels, ['', 'Larutan manis']);
  } finally {
    db.close();
  }
});

test('database menolak dua resep aktif dengan varian yang sama', () => {
  const db = migratedDatabase();
  try {
    const [output] = pickProducts(db);
    const insert = (id, revision) => db.prepare(`
      INSERT INTO manufacturing_recipes (id, store_id, output_product_id, output_unit_id, output_quantity, revision, status, variant_label, created_at)
      SELECT ?, 'store_001', ?, base_unit_id, 1, ?, 'ACTIVE', 'X', '2026-09-30T00:00:00.000Z' FROM products WHERE id = ?
    `).run(id, output, revision, output);
    insert('recipe_x1', 1);
    assert.throws(() => insert('recipe_x2', 2), /UNIQUE/);
  } finally {
    db.close();
  }
});
