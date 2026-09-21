import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';

// ADR-043, keputusan final Bos Cyo 2026-09-17: Entity cuma memiliki Kode
// Barang + foto + label nama internal (identifikasi saja). Nama tampil,
// harga, status, promo, average_cost/HPP tetap murni milik Store. Resep di
// product_masters murni acuan/referensi -- tidak pernah memblokir aktivasi.
//
// KANTOR dan PENDEM sengaja dipakai sebagai dua gerai yang sudah nyata
// berbagi entity ENT-KPM (migration 0064), bukan bikin entity baru --
// mengikuti data yang sudah ada di repo ini.

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

async function seedOwnerToken(db) {
  const ownerId = 'owner_pm_test';
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES (?, 'owner_pm_test', 'x', 'Test Owner')`).run(ownerId);
  const token = 'owner-pm-token';
  const tokenHash = await hashCredential(token);
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, '2026-09-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(tokenHash, ownerId);
  return token;
}

function request(pathname, { token, store, method = 'GET', body } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store) url.searchParams.set('store', store);
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

const newProductBody = (overrides = {}) => ({
  name: 'Es Teh Poci', purchasePrice: 2000, price: 5000, category: 'Minuman', ...overrides
});

test('creating a product with productCode registers a Kode Barang at Entity level, with the internal name label distinct from the store name', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };

    const createRes = await worker.fetch(request('/api/admin/master/products/editor', {
      token, store: 'KANTOR', method: 'POST',
      body: newProductBody({ name: 'Es Teh Poci Kantor', productCode: 'KODE-ESTEH', productMasterName: 'Es Teh Poci (label internal)' })
    }), env);
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    const product = created.editor.products.find(p => p.id === created.id);
    assert.equal(product.productMasterCode, 'KODE-ESTEH');
    assert.equal(product.productMasterName, 'Es Teh Poci (label internal)');
    assert.equal(product.name, 'Es Teh Poci Kantor', 'store-facing name stays exactly what this store typed, independent of the internal label');

    const master = db.prepare('SELECT entity_id, code, name FROM product_masters WHERE id = ?').get(product.productMasterId);
    assert.equal(master.code, 'KODE-ESTEH');
    assert.equal(master.name, 'Es Teh Poci (label internal)');

    const store = db.prepare('SELECT entity_id FROM stores WHERE code = ?').get('KANTOR');
    assert.equal(master.entity_id, store.entity_id);
  } finally {
    db.close();
  }
});

test('reusing an already-registered Kode Barang code within the same entity is rejected -- must use the catalog activate flow instead', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };

    await worker.fetch(request('/api/admin/master/products/editor', {
      token, store: 'KANTOR', method: 'POST',
      body: newProductBody({ productCode: 'KODE-DUPE' })
    }), env);

    const dupeRes = await worker.fetch(request('/api/admin/master/products/editor', {
      token, store: 'PENDEM', method: 'POST',
      body: newProductBody({ productCode: 'KODE-DUPE' })
    }), env);
    assert.equal(dupeRes.status, 409);
    const dupeBody = await dupeRes.json();
    assert.equal(dupeBody.code, 'PRODUCT_CODE_ALREADY_EXISTS');
  } finally {
    db.close();
  }
});

test('catalog lists Kode Barang scoped to entity, showing which stores already use it', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };

    const createRes = await worker.fetch(request('/api/admin/master/products/editor', {
      token, store: 'KANTOR', method: 'POST',
      body: newProductBody({ name: 'Es Teh Kantor', productCode: 'KODE-KATALOG' })
    }), env);
    const created = await createRes.json();

    const catalogRes = await worker.fetch(request('/api/admin/product-masters', { token, store: 'PENDEM' }), env);
    assert.equal(catalogRes.status, 200);
    const catalogBody = await catalogRes.json();
    const entry = catalogBody.catalog.find(item => item.code === 'KODE-KATALOG');
    assert.ok(entry, 'Kode Barang created from KANTOR must be visible from PENDEM (same entity)');
    assert.deepEqual(entry.usedByStores.map(u => u.storeCode), ['KANTOR']);
    assert.equal(entry.usedByStores[0].productId, created.id);
  } finally {
    db.close();
  }
});

test('activating a Kode Barang from another store creates its OWN products row with its OWN name/price -- never copied from the originating store', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };

    const createRes = await worker.fetch(request('/api/admin/master/products/editor', {
      token, store: 'KANTOR', method: 'POST',
      body: newProductBody({ name: 'Es Teh Kantor', price: 5000, productCode: 'KODE-AKTIVASI' })
    }), env);
    const created = await createRes.json();
    const masterId = created.editor.products.find(p => p.id === created.id).productMasterId;

    const activateRes = await worker.fetch(request(`/api/admin/product-masters/${masterId}/activate`, {
      token, store: 'PENDEM', method: 'POST',
      body: newProductBody({ name: 'Es Teh Pendem Spesial', price: 7000 })
    }), env);
    assert.equal(activateRes.status, 201);
    const activated = await activateRes.json();
    const pendemProduct = activated.editor.products.find(p => p.id === activated.id);
    assert.equal(pendemProduct.name, 'Es Teh Pendem Spesial');
    assert.equal(pendemProduct.price, 7000);
    assert.equal(pendemProduct.productMasterId, masterId);
    assert.equal(pendemProduct.linkedRecipeId, null, 'activation must never auto-link a recipe -- best-effort, store sets its own local recipe later');

    const kantorProduct = db.prepare('SELECT name, price FROM products WHERE id = ?').get(created.id);
    assert.equal(kantorProduct.name, 'Es Teh Kantor', 'the originating store row is untouched by another store activating the same code');
  } finally {
    db.close();
  }
});

test('activation is rejected across entities, and re-activating the same code twice at the same store is rejected', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };

    const createRes = await worker.fetch(request('/api/admin/master/products/editor', {
      token, store: 'KANTOR', method: 'POST',
      body: newProductBody({ productCode: 'KODE-SCOPE' })
    }), env);
    const created = await createRes.json();
    const masterId = created.editor.products.find(p => p.id === created.id).productMasterId;

    // IKAN01 (Ikan Galeh) punya entity berbeda (ENT-GALEH, migration 0050).
    const crossEntityRes = await worker.fetch(request(`/api/admin/product-masters/${masterId}/activate`, {
      token, store: 'IKAN01', method: 'POST', body: newProductBody()
    }), env);
    assert.equal(crossEntityRes.status, 403);
    assert.equal((await crossEntityRes.json()).code, 'PRODUCT_MASTER_ENTITY_MISMATCH');

    const firstActivate = await worker.fetch(request(`/api/admin/product-masters/${masterId}/activate`, {
      token, store: 'PENDEM', method: 'POST', body: newProductBody()
    }), env);
    assert.equal(firstActivate.status, 201);

    const secondActivate = await worker.fetch(request(`/api/admin/product-masters/${masterId}/activate`, {
      token, store: 'PENDEM', method: 'POST', body: newProductBody()
    }), env);
    assert.equal(secondActivate.status, 409);
    assert.equal((await secondActivate.json()).code, 'PRODUCT_MASTER_ALREADY_ACTIVE');
  } finally {
    db.close();
  }
});

test('photo is Entity-owned: editing it at one store propagates to product_masters and every other store sharing the same Kode Barang; name/price never propagate', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const image = 'data:image/png;base64,AAAA';

    const createRes = await worker.fetch(request('/api/admin/master/products/editor', {
      token, store: 'KANTOR', method: 'POST',
      body: newProductBody({ name: 'Es Teh Kantor', productCode: 'KODE-FOTO' })
    }), env);
    const created = await createRes.json();
    const masterId = created.editor.products.find(p => p.id === created.id).productMasterId;

    const activateRes = await worker.fetch(request(`/api/admin/product-masters/${masterId}/activate`, {
      token, store: 'PENDEM', method: 'POST', body: newProductBody({ name: 'Es Teh Pendem', price: 7000 })
    }), env);
    const activated = await activateRes.json();
    const pendemId = activated.id;

    const patchRes = await worker.fetch(request(`/api/admin/master/products/editor/${created.id}`, {
      token, store: 'KANTOR', method: 'PATCH',
      body: newProductBody({ name: 'Es Teh Kantor Baru Nama', price: 9999, imageData: image })
    }), env);
    assert.equal(patchRes.status, 200);

    const master = db.prepare('SELECT image_data FROM product_masters WHERE id = ?').get(masterId);
    assert.equal(master.image_data, image, 'product_masters.image_data must reflect the edit');

    const pendemProduct = db.prepare('SELECT image_data, name, price FROM products WHERE id = ?').get(pendemId);
    assert.equal(pendemProduct.image_data, image, 'photo propagates to every store sharing this Kode Barang');
    assert.equal(pendemProduct.name, 'Es Teh Pendem', 'name never propagates -- stays exactly what PENDEM set at activation');
    assert.equal(pendemProduct.price / 1_000_000, 7000, 'price never propagates -- stays exactly what PENDEM set at activation (raw column is scaled-integer, invariant #1)');
  } finally {
    db.close();
  }
});

test('resep acuan (recipe reference) can be set on a Kode Barang and never blocks or auto-links activation', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };

    const createRes = await worker.fetch(request('/api/admin/master/products/editor', {
      token, store: 'KANTOR', method: 'POST',
      body: newProductBody({ productCode: 'KODE-RESEP' })
    }), env);
    const created = await createRes.json();
    const masterId = created.editor.products.find(p => p.id === created.id).productMasterId;

    const putRes = await worker.fetch(request(`/api/admin/product-masters/${masterId}/recipe-components`, {
      token, store: 'KANTOR', method: 'PUT',
      body: { components: [{ ingredientLabel: 'Teh celup', quantityLabel: '1 kantong' }, { ingredientLabel: 'Gula', quantityLabel: '20 gram' }] }
    }), env);
    assert.equal(putRes.status, 200);
    const putBody = await putRes.json();
    const entry = putBody.catalog.find(item => item.id === masterId);
    assert.deepEqual(entry.recipeReference.map(c => c.ingredientLabel), ['Teh celup', 'Gula']);

    // PENDEM tidak punya bahan lokal "Teh celup"/"Gula" sama sekali di gerainya
    // -- aktivasi tetap harus berhasil, resep acuan cuma referensi tampilan.
    const activateRes = await worker.fetch(request(`/api/admin/product-masters/${masterId}/activate`, {
      token, store: 'PENDEM', method: 'POST', body: newProductBody()
    }), env);
    assert.equal(activateRes.status, 201, 'a store with none of the referenced ingredients locally must still be able to activate the item');
    const activated = await activateRes.json();
    const pendemProduct = activated.editor.products.find(p => p.id === activated.id);
    assert.equal(pendemProduct.linkedRecipeId, null);
    assert.equal(pendemProduct.recipeLinkEnabled, false);
  } finally {
    db.close();
  }
});

test('a product created without productCode behaves exactly as before this feature -- no Kode Barang, purely local', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };

    const createRes = await worker.fetch(request('/api/admin/master/products/editor', {
      token, store: 'KANTOR', method: 'POST', body: newProductBody()
    }), env);
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    const product = created.editor.products.find(p => p.id === created.id);
    assert.equal(product.productMasterId, null);
    assert.equal(product.productMasterCode, '');
  } finally {
    db.close();
  }
});
