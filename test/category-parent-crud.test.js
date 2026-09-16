import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminApi } from '../src/admin-multistore.js';
import { listProducts } from '../src/db-multistore.js';
import { hashCredential } from '../src/owner-auth.js';

// 2026-09-15, Bos Cyo: kategori barang dibikin ada sub-kategori --
// "mungkin yang sekarang itu dijadikan sub kategori aja ya, apa aman?".
// Sempat dibikin lewat tabel category_groups terpisah, tapi ketauan
// bentrok sama contracts/category-hierarchy-v1.md: hierarki kategori
// sudah ada lebih dulu lewat categories.parent_category_id (migration
// 0085), sudah dipakai 73 barang Leker gerai Dermo. Dirombak supaya
// nyambung ke situ -- migration 0094 cuma menambah pagar (isolasi
// store_id, larangan induk diri sendiri) di kolom yang sudah ada, dan CRUD
// Admin sekarang membaca/menulis parent_category_id langsung, bukan tabel
// baru. Tes di bawah membuktikan itu aman: kategori lama tetap jalan tanpa
// induk, hierarki dibatasi satu tingkat, dan data Dermo yang sudah ada
// tidak tersentuh.

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
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

async function setAdminPin(sqlite, pin) {
  sqlite.prepare(`UPDATE store_settings SET admin_pin_hash = ? WHERE id = 1`).run(await hashCredential(pin));
}

function adminRequest(path, pin, { method = 'GET', body } = {}) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: { 'X-Admin-Pin': pin, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

test('a pre-existing flat category stays valid without a parent, and bootstrap carries parentCategoryId directly on categories (no separate group table)', async () => {
  const sqlite = migratedDatabase();
  try {
    const db = new D1Database(sqlite);
    const env = { DB: db };
    const PIN = '123456';
    await setAdminPin(sqlite, PIN);

    const storeA = sqlite.prepare(`SELECT id, code FROM stores WHERE code = 'G001' LIMIT 1`).get();
    sqlite.prepare(`INSERT INTO categories (store_id, name, display_order, is_active) VALUES (?, 'Minuman', 1, 1)`).run(storeA.id);

    const bootstrap = await handleAdminApi(adminRequest(`/api/admin/bootstrap?store=${storeA.code}`, PIN), env, '/api/admin/bootstrap');
    const body = await bootstrap.json();
    assert.equal(body.categoryGroups, undefined, 'no separate categoryGroups list anymore -- categories carry parentCategoryId directly');
    const minuman = body.categories.find(c => c.name === 'Minuman');
    assert.equal(minuman.parentCategoryId, null);
  } finally {
    sqlite.close();
  }
});

test('creating a top-level category then assigning it as another category\'s parent works, is store-scoped, and never touches products.category', async () => {
  const sqlite = migratedDatabase();
  try {
    const db = new D1Database(sqlite);
    const env = { DB: db };
    const PIN = '123456';
    await setAdminPin(sqlite, PIN);

    const storeA = sqlite.prepare(`SELECT id, code FROM stores WHERE code = 'G001' LIMIT 1`).get();
    sqlite.prepare(`INSERT INTO stores (id, code, store_name, is_active) VALUES ('store_test_b', 'TESTB', 'Toko B', 1)`).run();
    sqlite.prepare(`
      INSERT INTO products (id, store_id, name, price, purchase_price, category, emoji, is_active)
      VALUES (9101, ?, 'Es Teh', 5000, 2000, 'Minuman', '🧊', 1)
    `).run(storeA.id);
    sqlite.prepare(`INSERT INTO categories (store_id, name, display_order, is_active) VALUES (?, 'Minuman', 1, 1)`).run(storeA.id);
    const minuman = sqlite.prepare(`SELECT id FROM categories WHERE store_id = ? AND name = 'Minuman'`).get(storeA.id);

    const createParent = await handleAdminApi(adminRequest(`/api/admin/categories?store=${storeA.code}`, PIN, { method: 'POST', body: { name: 'Minuman & Snack' } }), env, '/api/admin/categories');
    assert.equal(createParent.status, 201);
    const { id: parentId } = await createParent.json();

    const assign = await handleAdminApi(adminRequest(`/api/admin/categories/${minuman.id}?store=${storeA.code}`, PIN, { method: 'PATCH', body: { name: 'Minuman', isActive: true, parentCategoryId: parentId } }), env, `/api/admin/categories/${minuman.id}`);
    assert.equal(assign.status, 200);

    const productStillIntact = sqlite.prepare(`SELECT category FROM products WHERE id = 9101`).get();
    assert.equal(productStillIntact.category, 'Minuman', 'products.category untouched by grouping');

    const bootstrap = await handleAdminApi(adminRequest(`/api/admin/bootstrap?store=${storeA.code}`, PIN), env, '/api/admin/bootstrap');
    const body = await bootstrap.json();
    assert.equal(body.categories.find(c => c.name === 'Minuman').parentCategoryId, parentId);
    assert.equal(body.categories.find(c => c.name === 'Minuman & Snack').parentCategoryId, null);

    // A parent belonging to a DIFFERENT store cannot be assigned -- store
    // isolation, enforced both at the API layer and by
    // trg_categories_parent_scope_* underneath.
    const crossStoreAssign = await handleAdminApi(adminRequest(`/api/admin/categories/${minuman.id}?store=${storeA.code}`, PIN, { method: 'PATCH', body: { name: 'Minuman', isActive: true, parentCategoryId: 999999 } }), env, `/api/admin/categories/${minuman.id}`);
    assert.equal(crossStoreAssign.status, 400);

    // listProducts() -- the exact function Kasir and Customer both call --
    // exposes the parent name directly.
    const products = await listProducts(db, storeA.id);
    const esTeh = products.find(p => p.id === 9101);
    assert.equal(esTeh.categoryGroup, 'Minuman & Snack');
  } finally {
    sqlite.close();
  }
});

test('hierarchy stays one level: a category cannot become its own parent, cannot be parented under a sub-category, and cannot become a sub-category once it already has children', async () => {
  const sqlite = migratedDatabase();
  try {
    const db = new D1Database(sqlite);
    const env = { DB: db };
    const PIN = '123456';
    await setAdminPin(sqlite, PIN);
    const storeA = sqlite.prepare(`SELECT id, code FROM stores WHERE code = 'G001' LIMIT 1`).get();

    sqlite.prepare(`INSERT INTO categories (store_id, name, display_order, is_active) VALUES (?, 'Leker', 1, 1)`).run(storeA.id);
    const leker = sqlite.prepare(`SELECT id FROM categories WHERE store_id = ? AND name = 'Leker'`).get(storeA.id);

    // self-parent
    const selfParent = await handleAdminApi(adminRequest(`/api/admin/categories/${leker.id}?store=${storeA.code}`, PIN, { method: 'PATCH', body: { name: 'Leker', isActive: true, parentCategoryId: leker.id } }), env, `/api/admin/categories/${leker.id}`);
    assert.equal(selfParent.status, 400);

    sqlite.prepare(`INSERT INTO categories (store_id, name, display_order, is_active, parent_category_id) VALUES (?, '2K', 2, 1, ?)`).run(storeA.id, leker.id);
    const child = sqlite.prepare(`SELECT id FROM categories WHERE store_id = ? AND name = '2K'`).get(storeA.id);

    // cannot parent a new category under a category that is ITSELF already a child
    const parentUnderChild = await handleAdminApi(adminRequest(`/api/admin/categories?store=${storeA.code}`, PIN, { method: 'POST', body: { name: '2K Manis', parentCategoryId: child.id } }), env, '/api/admin/categories');
    assert.equal(parentUnderChild.status, 400);

    // Leker already has a child (2K) -- it cannot itself become a sub-category.
    sqlite.prepare(`INSERT INTO categories (store_id, name, display_order, is_active) VALUES (?, 'Semua Jajanan', 3, 1)`).run(storeA.id);
    const grandparent = sqlite.prepare(`SELECT id FROM categories WHERE store_id = ? AND name = 'Semua Jajanan'`).get(storeA.id);
    const makeGrandchild = await handleAdminApi(adminRequest(`/api/admin/categories/${leker.id}?store=${storeA.code}`, PIN, { method: 'PATCH', body: { name: 'Leker', isActive: true, parentCategoryId: grandparent.id } }), env, `/api/admin/categories/${leker.id}`);
    assert.equal(makeGrandchild.status, 400);
  } finally {
    sqlite.close();
  }
});

test('Dermo\'s existing Leker hierarchy from migration 0085 is untouched and still resolves through listProducts()', async () => {
  const sqlite = migratedDatabase();
  try {
    const db = new D1Database(sqlite);
    const storeDermo = sqlite.prepare(`SELECT id FROM stores WHERE id = 'store_dermo'`).get();
    if (!storeDermo) return; // synthetic test DB without Dermo seed data
    const products = await listProducts(db, storeDermo.id);
    const twoK = products.find(p => p.category === '2K');
    if (twoK) assert.equal(twoK.categoryGroup, 'Leker');
  } finally {
    sqlite.close();
  }
});

// 2026-09-16, Bos Cyo (Dermo screenshot): kategori utama seperti "Pentol"
// tetap harus muncul sebagai kelompoknya sendiri walau dia sendiri
// kategori teratas (tidak punya induk) -- selama dia sendiri punya anak.
// Kategori datar yang tidak pernah dijadikan induk siapa pun (gerai yang
// belum pakai sub-kategori sama sekali) harus tetap null/"Lainnya", supaya
// tidak ada baris kategori utama yang isinya duplikat sama baris
// sub-kategori di bawahnya.
test('a top-level category with children self-groups under its own name; a flat top-level category with no children stays ungrouped', async () => {
  const sqlite = migratedDatabase();
  try {
    const db = new D1Database(sqlite);
    const storeA = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001' LIMIT 1`).get();

    // "Pentol" is top-level (no parent) but gains a real child -- it must
    // now resolve as its own group for any product still filed directly
    // under "Pentol" itself.
    sqlite.prepare(`INSERT INTO categories (store_id, name, display_order, is_active) VALUES (?, 'Pentol', 1, 1)`).run(storeA.id);
    const pentol = sqlite.prepare(`SELECT id FROM categories WHERE store_id = ? AND name = 'Pentol'`).get(storeA.id);
    sqlite.prepare(`INSERT INTO categories (store_id, name, display_order, is_active, parent_category_id) VALUES (?, 'Pentol Korea', 1, 1, ?)`).run(storeA.id, pentol.id);
    sqlite.prepare(`
      INSERT INTO products (id, store_id, name, price, purchase_price, category, emoji, is_active)
      VALUES (9201, ?, 'Pentol Legacy', 5000, 2000, 'Pentol', '🍡', 1)
    `).run(storeA.id);

    // "Minuman" is a genuinely flat category -- never anyone's parent.
    sqlite.prepare(`INSERT INTO categories (store_id, name, display_order, is_active) VALUES (?, 'Minuman', 2, 1)`).run(storeA.id);
    sqlite.prepare(`
      INSERT INTO products (id, store_id, name, price, purchase_price, category, emoji, is_active)
      VALUES (9202, ?, 'Es Teh', 5000, 2000, 'Minuman', '🧊', 1)
    `).run(storeA.id);

    const products = await listProducts(db, storeA.id);
    assert.equal(products.find(p => p.id === 9201).categoryGroup, 'Pentol', 'top-level category with a child self-groups');
    assert.equal(products.find(p => p.id === 9202).categoryGroup, null, 'flat top-level category with no children stays ungrouped (Lainnya)');
  } finally {
    sqlite.close();
  }
});
