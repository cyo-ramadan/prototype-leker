import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { prepareSaleStockProduction } from '../src/stock-production.js';
import { listProducts } from '../src/db-multistore.js';
import { handleProductPolicyApi } from '../src/product-policy.js';
import { handleManufacturingMasterApi } from '../src/manufacturing-master.js';
import { validateDirectLines } from '../src/cashier-sales-tracking.js';

// Bos Cyo, 2026-09-30: barang dengan dua resep aktif (mis. Es Teh: larutan
// tawar + larutan gula, atau larutan manis). Kasir memilih resep saat penjualan
// Dadakan; pilihan terakhir yang dipakai penjualan jadi resep aktif berikutnya.
// Master Barang hanya menampilkan (read-only).

const migrationDir = new URL('../migrations/', import.meta.url);
const AGENT_TOKEN = 'b'.repeat(40);
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

class D1Statement {
  constructor(sqlite, sql, params = []) { this.sqlite = sqlite; this.sql = sql; this.params = params; }
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
    sqlite.exec(read(`../migrations/${file}`));
  }
  return sqlite;
}

// Es Teh (output) dengan resep A (tanpa label, komponen A) dan resep B
// (varian "Larutan manis", komponen B). Awalnya tersambung ke A.
function variantFixture(sqlite) {
  const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001' LIMIT 1`).get();
  const [output, componentA, componentB] = sqlite.prepare(`
    SELECT p.id, p.base_unit_id FROM products p
    WHERE p.store_id = ? AND p.base_unit_id IS NOT NULL ORDER BY p.id LIMIT 3
  `).all(store.id);
  const cashier = sqlite.prepare(`SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1`).get(store.id);
  for (const component of [componentA, componentB]) {
    sqlite.prepare(`UPDATE products SET is_active = 1, stock_tracking_enabled = 1 WHERE id = ? AND store_id = ?`).run(component.id, store.id);
    sqlite.prepare(`
      INSERT INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
      VALUES (?, ?, 100, '2026-09-30T00:00:00.000Z')
      ON CONFLICT(store_id, product_id) DO UPDATE SET quantity = 100
    `).run(store.id, component.id);
  }
  const addRecipe = (id, revision, label, component) => {
    sqlite.prepare(`
      INSERT INTO manufacturing_recipes (id, store_id, output_product_id, output_unit_id, output_quantity, revision, status, variant_label, created_at)
      VALUES (?, ?, ?, ?, 1, ?, 'ACTIVE', ?, '2026-09-30T00:00:00.000Z')
    `).run(id, store.id, output.id, output.base_unit_id, revision, label);
    sqlite.prepare(`
      INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity)
      VALUES (?, ?, ?, ?, ?, 2)
    `).run(`${id}_c`, id, store.id, component.id, component.base_unit_id);
  };
  addRecipe('recipe_variant_a', 1, '', componentA);
  addRecipe('recipe_variant_b', 2, 'Larutan manis', componentB);
  sqlite.prepare(`
    UPDATE products SET is_active = 1, linked_recipe_id = 'recipe_variant_a', recipe_link_enabled = 1,
      stock_tracking_enabled = 1, has_recipe_variants = 1 WHERE id = ? AND store_id = ?
  `).run(output.id, store.id);
  sqlite.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES ('drawer_variant', ?, ?, 0, 'OPEN', '2026-09-30T00:00:00.000Z')
  `).run(store.id, cashier.id);
  return {
    storeId: store.id, cashierId: cashier.id, drawerId: 'drawer_variant',
    outputId: Number(output.id), componentAId: Number(componentA.id), componentBId: Number(componentB.id)
  };
}

const balance = (sqlite, fixture, productId) =>
  sqlite.prepare('SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?').get(fixture.storeId, productId).quantity;

function saleLine(fixture, extra = {}) {
  return { productId: fixture.outputId, productName: 'Es Teh', unitPrice: 5000, quantity: 3, lineTotal: 15000, note: '', ...extra };
}

async function runSale(sqlite, fixture, saleId, lineExtra) {
  const db = new D1Database(sqlite);
  sqlite.prepare(`
    INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, customer_name, total_amount, created_at)
    VALUES (?, ?, ?, ?, '', 15000, '2026-09-30T01:00:00.000Z')
  `).run(saleId, fixture.storeId, fixture.drawerId, fixture.cashierId);
  const result = await prepareSaleStockProduction(db, {
    storeId: fixture.storeId, drawerId: fixture.drawerId, cashierId: fixture.cashierId,
    saleId, lines: [saleLine(fixture, lineExtra)], now: '2026-09-30T01:00:00.000Z'
  });
  if (result.ok) await db.batch(result.statements);
  return result;
}

test('kasir memilih resep varian: bahan varian yang terpotong, resep aktif berpindah, dan tercatat di log', async () => {
  const sqlite = freshDatabase();
  try {
    const fixture = variantFixture(sqlite);
    const result = await runSale(sqlite, fixture, 'sale_variant_1', { productionMode: 'DADAKAN', chosenRecipeId: 'recipe_variant_b' });
    assert.equal(result.ok, true);
    assert.equal(result.lines[0].recipeId, 'recipe_variant_b');
    assert.equal(balance(sqlite, fixture, fixture.componentBId), 94, '3 porsi x 2 = 6 dipotong dari bahan resep pilihan');
    assert.equal(balance(sqlite, fixture, fixture.componentAId), 100, 'bahan resep lain tidak tersentuh');
    assert.equal(sqlite.prepare('SELECT recipe_id FROM production_runs WHERE sale_id = ?').get('sale_variant_1').recipe_id, 'recipe_variant_b');
    assert.equal(sqlite.prepare('SELECT linked_recipe_id FROM products WHERE id = ?').get(fixture.outputId).linked_recipe_id, 'recipe_variant_b');
    const log = sqlite.prepare('SELECT from_recipe_id, to_recipe_id, actor_role, actor_id, sale_id FROM product_recipe_switch_log WHERE product_id = ?').all(fixture.outputId);
    assert.deepEqual(log.map(row => ({ ...row })), [{
      from_recipe_id: 'recipe_variant_a', to_recipe_id: 'recipe_variant_b', actor_role: 'CASHIER', actor_id: fixture.cashierId, sale_id: 'sale_variant_1'
    }]);

    // Penjualan berikutnya tanpa pilihan eksplisit memakai resep aktif terakhir.
    const next = await runSale(sqlite, fixture, 'sale_variant_2', { productionMode: 'DADAKAN' });
    assert.equal(next.ok, true);
    assert.equal(next.lines[0].recipeId, 'recipe_variant_b');
    assert.equal(balance(sqlite, fixture, fixture.componentBId), 88);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM product_recipe_switch_log').get().n, 1, 'tanpa pergantian tidak menambah log');
  } finally {
    sqlite.close();
  }
});

test('resep pilihan yang tidak aktif atau bukan milik barang ditolak tanpa mengubah apa pun', async () => {
  const sqlite = freshDatabase();
  try {
    const fixture = variantFixture(sqlite);
    const unknown = await runSale(sqlite, fixture, 'sale_variant_bad', { productionMode: 'DADAKAN', chosenRecipeId: 'recipe_tidak_ada' });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.status, 409);
    assert.match(unknown.error, /tidak aktif/);

    sqlite.prepare("UPDATE manufacturing_recipes SET status = 'ARCHIVED', archived_at = '2026-09-30T00:30:00.000Z' WHERE id = 'recipe_variant_b'").run();
    const archived = await runSale(sqlite, fixture, 'sale_variant_archived', { productionMode: 'DADAKAN', chosenRecipeId: 'recipe_variant_b' });
    assert.equal(archived.ok, false);
    assert.equal(sqlite.prepare('SELECT linked_recipe_id FROM products WHERE id = ?').get(fixture.outputId).linked_recipe_id, 'recipe_variant_a');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM product_recipe_switch_log').get().n, 0);
  } finally {
    sqlite.close();
  }
});

test('penjualan Biasa (STOCK) mengabaikan pilihan resep dan tidak memindahkan resep aktif', async () => {
  const sqlite = freshDatabase();
  try {
    const fixture = variantFixture(sqlite);
    sqlite.prepare(`
      INSERT INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
      VALUES (?, ?, 20, '2026-09-30T00:00:00.000Z')
      ON CONFLICT(store_id, product_id) DO UPDATE SET quantity = 20
    `).run(fixture.storeId, fixture.outputId);
    const result = await runSale(sqlite, fixture, 'sale_variant_stock', { productionMode: 'STOCK', chosenRecipeId: 'recipe_variant_b' });
    assert.equal(result.ok, true);
    assert.equal(sqlite.prepare('SELECT linked_recipe_id FROM products WHERE id = ?').get(fixture.outputId).linked_recipe_id, 'recipe_variant_a');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM product_recipe_switch_log').get().n, 0);
  } finally {
    sqlite.close();
  }
});

test('daftar menu kasir memuat varian hanya untuk barang bertanda dan hanya bila diminta', async () => {
  const sqlite = freshDatabase();
  try {
    const fixture = variantFixture(sqlite);
    const db = new D1Database(sqlite);
    const cashierMenu = await listProducts(db, fixture.storeId, { withRecipeVariants: true });
    const teh = cashierMenu.find(item => Number(item.id) === fixture.outputId);
    assert.deepEqual(teh.recipeVariants.map(variant => variant.label), ['', 'Larutan manis']);
    assert.equal(teh.activeRecipeId, 'recipe_variant_a');
    const others = cashierMenu.filter(item => Number(item.id) !== fixture.outputId);
    assert.ok(others.every(item => Array.isArray(item.recipeVariants) && item.recipeVariants.length === 0));

    const customerMenu = await listProducts(db, fixture.storeId);
    assert.equal('recipeVariants' in customerMenu[0], false, 'menu pelanggan tidak memuat varian resep');
  } finally {
    sqlite.close();
  }
});

test('membuat resep bernama varian menandai barangnya; resep biasa tidak', async () => {
  const sqlite = freshDatabase();
  try {
    const d1 = new D1Database(sqlite);
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001'`).get();
    const [output, a, b] = sqlite.prepare(`SELECT id FROM products WHERE store_id = ? AND base_unit_id IS NOT NULL ORDER BY id LIMIT 3`).all(store.id).map(row => Number(row.id));
    const post = body => handleManufacturingMasterApi(
      new Request('https://example.test/api/admin/manufacturing/recipes?store=G001', {
        method: 'POST', headers: { authorization: `Bearer ${AGENT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body)
      }),
      { DB: d1, AGENT_ADMIN_TOKEN: AGENT_TOKEN }, '/api/admin/manufacturing/recipes'
    );
    assert.equal((await post({ outputProductId: output, outputQuantity: 1, components: [{ productId: a, quantity: 1 }] })).status, 201);
    assert.equal(sqlite.prepare('SELECT has_recipe_variants AS f FROM products WHERE id = ?').get(output).f, 0);
    assert.equal((await post({ outputProductId: output, outputQuantity: 1, variantLabel: 'Manis', components: [{ productId: b, quantity: 1 }] })).status, 201);
    assert.equal(sqlite.prepare('SELECT has_recipe_variants AS f FROM products WHERE id = ?').get(output).f, 1);
  } finally {
    sqlite.close();
  }
});

test('Master Barang menolak mengganti resep barang bervarian; nilai yang sama dan sambungan basi tetap boleh', async () => {
  const sqlite = freshDatabase();
  try {
    const fixture = variantFixture(sqlite);
    const d1 = new D1Database(sqlite);
    const patch = linkedRecipeId => handleProductPolicyApi(
      new Request(`https://example.test/api/admin/master/products/${fixture.outputId}/policy?store=G001`, {
        method: 'PATCH', headers: { authorization: `Bearer ${AGENT_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ linkedRecipeId })
      }),
      { DB: d1, AGENT_ADMIN_TOKEN: AGENT_TOKEN }, `/api/admin/master/products/${fixture.outputId}/policy`
    );
    const blocked = await patch('recipe_variant_b');
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).code, 'RECIPE_VARIANT_SWITCH_VIA_SALE');
    assert.equal(sqlite.prepare('SELECT linked_recipe_id FROM products WHERE id = ?').get(fixture.outputId).linked_recipe_id, 'recipe_variant_a');

    assert.equal((await patch('recipe_variant_a')).status, 200, 'menyimpan dengan resep yang sama tidak diblokir');

    // Sambungan yang sudah tidak aktif (mis. resepnya direvisi) boleh dipilih ulang admin.
    sqlite.prepare("UPDATE manufacturing_recipes SET status = 'ARCHIVED', archived_at = '2026-09-30T00:30:00.000Z' WHERE id = 'recipe_variant_a'").run();
    assert.equal((await patch('recipe_variant_b')).status, 200);
  } finally {
    sqlite.close();
  }
});

test('validateDirectLines meneruskan resep pilihan kasir apa adanya untuk divalidasi server', () => {
  const result = validateDirectLines([{ id: 7, name: 'Es Teh', price: 5000 }], [{ productId: 7, quantity: 2, productionMode: 'DADAKAN', recipeId: ' recipe_x ' }]);
  assert.equal(result.ok, true);
  assert.equal(result.lines[0].chosenRecipeId, 'recipe_x');
  const none = validateDirectLines([{ id: 7, name: 'Es Teh', price: 5000 }], [{ productId: 7, quantity: 2 }]);
  assert.equal(none.lines[0].chosenRecipeId, null);
});

test('layar kasir menampilkan pilihan resep, mengirimnya saat penjualan, dan versi skrip dinaikkan', () => {
  const cashier = read('../public/cashier.js');
  const orders = read('../public/cashier-sales-orders.js');
  const html = read('../public/cashier.html');
  const policyUi = read('../public/admin-product-policy.js');
  assert.match(cashier, /data-draft-recipe/);
  assert.match(cashier, /recipeId: draftRecipeId\(line\)/);
  assert.match(cashier, /rememberChosenRecipes\(\[\.\.\.state\.draft\.values\(\)\]\)/);
  assert.match(orders, /recipeId: draftRecipeId\(line\)/);
  assert.match(orders, /\[data-draft-recipe\]/);
  assert.match(orders, /recipeVariants: live\?\.recipeVariants/);
  assert.ok(String(html.match(/\/cashier\.js\?v=([\w-]+)/)?.[1] || '') >= '20261004-setoran-laci-v1', 'versi cashier.js tidak boleh lebih lama dari 20261004-setoran-laci-v1');
  assert.match(html, /cashier-sales-orders\.js\?v=20260930-varian-resep-v1/);
  assert.match(policyUi, /variantLocked/);
});
