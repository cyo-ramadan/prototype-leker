import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminApi } from '../src/admin-multistore.js';
import { hashCredential } from '../src/owner-auth.js';

// 2026-09-15, Bos Cyo: Admin Dermo "berat banget, malah ga bisa masuk".
// Root cause dibuktikan langsung ke production: 118 barang berfoto di Dermo,
// ~3.1MB base64 digabung, dan bootstrap lama mengirim semuanya sekaligus
// dalam satu respons setiap dashboard dibuka. Perbaikan: listing cuma bawa
// flag hasImage, foto diambil satu-satu lewat endpoint ini. Tes di bawah
// membuktikan endpointnya benar (bukan cuma listing-nya jadi ringan) --
// discoped ke gerai yang benar, dan blob yang dikembalikan sama persis
// dengan yang tersimpan.

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

function imageRequest(path, pin) {
  return new Request(`https://example.test${path}`, { headers: { 'X-Admin-Pin': pin } });
}

test('admin product image endpoint serves the exact stored photo, scoped to the correct store, and listing no longer inlines it', async () => {
  const sqlite = migratedDatabase();
  try {
    const db = new D1Database(sqlite);
    const env = { DB: db };
    const PIN = '123456';
    await setAdminPin(sqlite, PIN);

    const storeA = sqlite.prepare(`SELECT id, code FROM stores WHERE code = 'G001' LIMIT 1`).get();
    assert.ok(storeA?.id, 'seed store G001 must exist');
    sqlite.prepare(`INSERT INTO stores (id, code, store_name, is_active) VALUES ('store_test_b', 'TESTB', 'Toko B', 1)`).run();

    const dataUrl = 'data:image/webp;base64,AAAA';
    const productId = 9001;
    sqlite.prepare(`
      INSERT INTO products (id, store_id, name, price, purchase_price, category, emoji, image_data, is_active)
      VALUES (?, ?, 'Produk Foto Tes', 10000, 5000, 'Tes', '🥞', ?, 1)
    `).run(productId, storeA.id, dataUrl);

    // Listing must not carry the image bytes anymore -- that was the whole
    // point of this fix. It must know a photo exists (hasImage) without
    // shipping it.
    const bootstrap = await handleAdminApi(imageRequest(`/api/admin/bootstrap?store=${storeA.code}`, PIN), env, '/api/admin/bootstrap');
    const bootstrapBody = await bootstrap.json();
    const listed = bootstrapBody.products.find(p => p.id === productId);
    assert.ok(listed, 'seeded product must appear in the listing');
    assert.equal(listed.hasImage, true);
    assert.equal(listed.imageData, undefined, 'listing response must not carry raw image bytes/data URL anymore');

    // The dedicated endpoint must return the exact bytes that were stored,
    // decoded from the data URL, with a matching Content-Type.
    const photo = await handleAdminApi(imageRequest(`/api/admin/products/${productId}/image?store=${storeA.code}`, PIN), env, `/api/admin/products/${productId}/image`);
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('Content-Type'), 'image/webp');
    const bytes = new Uint8Array(await photo.arrayBuffer());
    assert.deepEqual([...bytes], [0, 0, 0]); // base64 'AAAA' decodes to 3 zero bytes

    // Store isolation: the same numeric product id requested against a
    // DIFFERENT store must not leak the photo -- this endpoint filters by
    // store_id, not just id.
    const crossStore = await handleAdminApi(imageRequest(`/api/admin/products/${productId}/image?store=TESTB`, PIN), env, `/api/admin/products/${productId}/image`);
    assert.equal(crossStore.status, 404, 'a product photo must not be reachable from a different store');

    // A product with no photo at all must 404, not error.
    sqlite.prepare(`
      INSERT INTO products (id, store_id, name, price, purchase_price, category, emoji, image_data, is_active)
      VALUES (9002, ?, 'Produk Tanpa Foto', 10000, 5000, 'Tes', '🥞', '', 1)
    `).run(storeA.id);
    const missing = await handleAdminApi(imageRequest(`/api/admin/products/9002/image?store=${storeA.code}`, PIN), env, '/api/admin/products/9002/image');
    assert.equal(missing.status, 404);
  } finally {
    sqlite.close();
  }
});
