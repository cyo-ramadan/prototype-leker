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


import { UI_SKIN_KEY, setTenantPolicySetting, isOwnerOperatedChoice, isAttendanceOptionalChoice } from '../src/tenant-policy.js';
import { resolveUiProfile } from '../src/ui-profile.js';

async function hStore(db) {
  const tenant = db.prepare("SELECT et.tenant_id FROM stores s JOIN entity_tenancy et ON et.entity_id = s.entity_id AND et.effective_to IS NULL WHERE s.id = 'store_001'").get();
  const d1 = new D1Database(db);
  await setTenantPolicySetting(d1, tenant.tenant_id, UI_SKIN_KEY, 'H');
  return d1;
}
const inlinePath = id => '/api/admin/manufacturing/products/'+id+'/recipe';

test('skin H tenant-scoped; kasir dan presensi tidak mengikuti mode E', async () => {
  const db = migratedDatabase();
  try {
    const d1 = await hStore(db);
    assert.equal((await resolveUiProfile(d1, {storeCode:'G001'})).skin, 'h');
    assert.notEqual((await resolveUiProfile(d1, {storeCode:'LABA'})).skin, 'h');
    assert.equal(isOwnerOperatedChoice('H'), false);
    assert.equal(isAttendanceOptionalChoice('H'), false);
  } finally { db.close(); }
});

test('resep langsung hanya H; revisi dan link tersimpan bersama, retry tidak menggandakan', async () => {
  const db = migratedDatabase();
  try {
    let d1 = new D1Database(db);
    const [output, a, b] = pickProducts(db);
    const draft = {sourceRecipeId:null, outputQuantity:1, components:[{productId:a,quantity:2}]};
    assert.equal((await call(d1,'POST',inlinePath(output),draft)).status,403);
    d1 = await hStore(db);
    const first = await call(d1,'POST',inlinePath(output),draft);
    assert.equal(first.status,201,await first.clone().text());
    const id = (await first.json()).id;
    assert.equal(db.prepare('SELECT linked_recipe_id, recipe_link_enabled FROM products WHERE id = ?').get(output).linked_recipe_id,id);
    assert.equal((await call(d1,'POST',inlinePath(output),draft)).status,200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM manufacturing_recipes WHERE output_product_id = ?').get(output).n,1);
    const other = await call(d1,'POST','/api/admin/manufacturing/recipes',{outputProductId:output,outputQuantity:1,variantLabel:'Alternatif',components:[{productId:b,quantity:3}]});
    const otherId = (await other.json()).id;
    const stale = await call(d1,'POST',inlinePath(output),{...draft,components:[{productId:a,quantity:4}]});
    assert.equal(stale.status,409);
    const revised = await call(d1,'POST',inlinePath(output),{...draft,sourceRecipeId:id,components:[{productId:a,quantity:4}]});
    assert.equal(revised.status,201,await revised.clone().text());
    const revisionId = (await revised.json()).id;
    assert.equal(db.prepare('SELECT status FROM manufacturing_recipes WHERE id = ?').get(id).status,'ARCHIVED');
    assert.equal(db.prepare('SELECT quantity FROM manufacturing_recipe_components WHERE recipe_id = ?').get(id).quantity,2);
    assert.equal(db.prepare('SELECT linked_recipe_id FROM products WHERE id = ?').get(output).linked_recipe_id,revisionId);
    assert.equal(db.prepare('SELECT status FROM manufacturing_recipes WHERE id = ?').get(otherId).status,'ACTIVE');
    const foreign = db.prepare("SELECT id FROM products WHERE store_id <> 'store_001' AND is_active=1 LIMIT 1").get().id;
    const rejected = await call(d1,'POST',inlinePath(output),{...draft,sourceRecipeId:revisionId,components:[{productId:foreign,quantity:1}]});
    assert.equal(rejected.status,400);
    assert.equal(db.prepare('SELECT linked_recipe_id FROM products WHERE id = ?').get(output).linked_recipe_id,revisionId);
  } finally { db.close(); }
});

test('perubahan sambungan saat batch berjalan membatalkan arsip/revisi baru seluruhnya', async () => {
  const db = migratedDatabase();
  try {
    const d1 = await hStore(db);
    const [output,a,b] = pickProducts(db);
    const draft = {sourceRecipeId:null,outputQuantity:1,components:[{productId:a,quantity:1}]};
    const firstId = (await (await call(d1,'POST',inlinePath(output),draft)).json()).id;
    const alternateId = (await (await call(d1,'POST','/api/admin/manufacturing/recipes',{outputProductId:output,outputQuantity:1,variantLabel:'Alternatif',components:[{productId:b,quantity:1}]})).json()).id;
    const originalBatch = d1.batch.bind(d1);
    let changed = false;
    d1.batch = statements => {
      if (!changed && statements.some(s => s.sql.includes('INSERT INTO manufacturing_recipes'))) {
        changed = true;
        db.prepare('UPDATE products SET linked_recipe_id = ? WHERE id = ?').run(alternateId,output);
      }
      return originalBatch(statements);
    };
    const response = await call(d1,'POST',inlinePath(output),{...draft,sourceRecipeId:firstId,components:[{productId:a,quantity:2}]});
    assert.equal(response.status,409,await response.clone().text());
    assert.equal(changed,true);
    assert.equal(db.prepare('SELECT status FROM manufacturing_recipes WHERE id=?').get(firstId).status,'ACTIVE');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM manufacturing_recipes WHERE output_product_id=?').get(output).n,2);
    assert.equal(db.prepare('SELECT linked_recipe_id FROM products WHERE id=?').get(output).linked_recipe_id,alternateId);
  } finally { db.close(); }
});
