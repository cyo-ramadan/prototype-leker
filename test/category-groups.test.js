import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminApi } from '../src/admin-multistore.js';
import { listProducts } from '../src/db-multistore.js';
import { hashCredential } from '../src/owner-auth.js';

// 2026-09-15, Bos Cyo: kategori barang sekarang cuma satu tingkat. Nambah
// "Kategori Utama" opsional di atasnya -- kategori yang sudah ada jadi
// sub-kategori, tanpa mengubah products.category sama sekali. Tes di bawah
// membuktikan itu aman: kategori lama tetap jalan tanpa grup, grup baru
// scoped ke gerainya sendiri, dan listProducts() (dipakai bersama oleh
// Kasir & Customer) langsung membawa nama kategori utamanya.

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

test('category groups are additive: existing categories stay ungrouped, group CRUD is store-scoped, and assigning a group never touches products.category', async () => {
  const sqlite = migratedDatabase();
  try {
    const db = new D1Database(sqlite);
    const env = { DB: db };
    const PIN = '123456';
    await setAdminPin(sqlite, PIN);

    const storeA = sqlite.prepare(`SELECT id, code FROM stores WHERE code = 'G001' LIMIT 1`).get();
    sqlite.prepare(`INSERT INTO stores (id, code, store_name, is_active) VALUES ('store_test_b', 'TESTB', 'Toko B', 1)`).run();

    // A pre-existing category (no group yet) must still load fine.
    sqlite.prepare(`INSERT INTO categories (store_id, name, display_order, is_active) VALUES (?, 'Minuman', 1, 1)`).run(storeA.id);
    sqlite.prepare(`
      INSERT INTO products (id, store_id, name, price, purchase_price, category, emoji, is_active)
      VALUES (9101, ?, 'Es Teh', 5000, 2000, 'Minuman', '🧊', 1)
    `).run(storeA.id);

    let bootstrap = await handleAdminApi(adminRequest(`/api/admin/bootstrap?store=${storeA.code}`, PIN), env, '/api/admin/bootstrap');
    let body = await bootstrap.json();
    assert.deepEqual(body.categoryGroups, [], 'no groups yet');
    const minuman = body.categories.find(c => c.name === 'Minuman');
    assert.equal(minuman.categoryGroupId, null, 'pre-existing category has no group until assigned');

    // Create a group in store A.
    const createGroup = await handleAdminApi(adminRequest(`/api/admin/category-groups?store=${storeA.code}`, PIN, { method: 'POST', body: { name: 'Kategori Minuman & Snack' } }), env, '/api/admin/category-groups');
    assert.equal(createGroup.status, 201);
    const { id: groupId } = await createGroup.json();

    // A group name clash in the same store is rejected.
    const dup = await handleAdminApi(adminRequest(`/api/admin/category-groups?store=${storeA.code}`, PIN, { method: 'POST', body: { name: 'Kategori Minuman & Snack' } }), env, '/api/admin/category-groups');
    assert.equal(dup.status, 409);

    // Assigning that group to the existing category must not touch its
    // products at all -- rename cascade is a separate concern (name change),
    // grouping is additive metadata only.
    const patchCategory = await handleAdminApi(adminRequest(`/api/admin/categories/${minuman.id}?store=${storeA.code}`, PIN, { method: 'PATCH', body: { name: 'Minuman', isActive: true, categoryGroupId: groupId } }), env, `/api/admin/categories/${minuman.id}`);
    assert.equal(patchCategory.status, 200);
    const productStillIntact = sqlite.prepare(`SELECT category FROM products WHERE id = 9101`).get();
    assert.equal(productStillIntact.category, 'Minuman', 'products.category untouched by grouping');

    bootstrap = await handleAdminApi(adminRequest(`/api/admin/bootstrap?store=${storeA.code}`, PIN), env, '/api/admin/bootstrap');
    body = await bootstrap.json();
    assert.equal(body.categories.find(c => c.name === 'Minuman').categoryGroupId, groupId);
    assert.equal(body.categoryGroups.length, 1);

    // A group belonging to a DIFFERENT store cannot be assigned -- store
    // isolation (invariant #5), enforced both at the API layer and by the
    // trg_categories_group_scope_* triggers underneath.
    const crossStoreAssign = await handleAdminApi(adminRequest(`/api/admin/categories/${minuman.id}?store=${storeA.code}`, PIN, { method: 'PATCH', body: { name: 'Minuman', isActive: true, categoryGroupId: 999999 } }), env, `/api/admin/categories/${minuman.id}`);
    assert.equal(crossStoreAssign.status, 400);

    // listProducts() -- the exact function Kasir and Customer both call --
    // must expose the group name directly so neither frontend needs a
    // second fetch to build a two-tier filter.
    const products = await listProducts(db, storeA.id);
    const esTeh = products.find(p => p.id === 9101);
    assert.equal(esTeh.category, 'Minuman');
    assert.equal(esTeh.categoryGroup, 'Kategori Minuman & Snack');

    // Deactivating the group is store-scoped too: store B cannot deactivate
    // store A's group by id.
    const wrongStoreDeactivate = await handleAdminApi(adminRequest(`/api/admin/category-groups/${groupId}?store=TESTB`, PIN, { method: 'DELETE' }), env, `/api/admin/category-groups/${groupId}`);
    assert.equal(wrongStoreDeactivate.status, 404);
  } finally {
    sqlite.close();
  }
});

test('a product in a category that has no group still resolves with categoryGroup: null, not an error', async () => {
  const sqlite = migratedDatabase();
  try {
    const db = new D1Database(sqlite);
    const storeA = sqlite.prepare(`SELECT id FROM stores WHERE code = 'G001' LIMIT 1`).get();
    sqlite.prepare(`
      INSERT INTO products (id, store_id, name, price, purchase_price, category, emoji, is_active)
      VALUES (9102, ?, 'Kerupuk', 3000, 1000, 'Camilan Lepas', '🍘', 1)
    `).run(storeA.id);
    const products = await listProducts(db, storeA.id);
    const kerupuk = products.find(p => p.id === 9102);
    assert.equal(kerupuk.categoryGroup, null);
  } finally {
    sqlite.close();
  }
});
