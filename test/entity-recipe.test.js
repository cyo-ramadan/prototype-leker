import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleEntityRecipeApi } from '../src/entity-recipe.js';
import { hashCredential } from '../src/owner-auth.js';

// ADR-050, Bos Cyo 2026-10-01: "resep di taruh entity aja, biar ga ngerjain
// satu2 per gerai". Template resep milik Entity (dirujuk lewat Kode Barang),
// diterapkan ke gerai sebagai revisi manufacturing_recipes milik gerai itu.
// KANTOR / PENDEM / MANDALA berbagi entity ENT-KPM (migration 0064).

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

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

const OWNER_TOKEN = 'owner-er-token';
async function seedOwner(db) {
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_er', 'owner_er', 'x', 'Owner Uji')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_er', '2026-09-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential(OWNER_TOKEN));
}

const STORES = { kantor: 'store_kantor', pendem: 'store_pendem', mandala: 'store_mandala' };
const ENTITY = 'ENT-KPM';

function addMaster(db, code) {
  const id = `pm_er_${code}`;
  db.prepare(`INSERT INTO product_masters (id, entity_id, code, name) VALUES (?, ?, ?, ?)`).run(id, ENTITY, code, `Label ${code}`);
  return id;
}

function ensureUnit(db, storeId, code) {
  const id = `unit_er_${storeId}_${code}`;
  db.prepare(`INSERT OR IGNORE INTO units (id, store_id, code, name, symbol, decimal_scale) VALUES (?, ?, ?, ?, ?, 0)`).run(id, storeId, code, `Uji ${code}`, code);
  return id;
}

function addProduct(db, storeId, masterId, name, unitCode) {
  const unitId = ensureUnit(db, storeId, unitCode);
  const id = Number(db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM products').get().n);
  db.prepare(`
    INSERT INTO products (id, store_id, name, price, category, base_unit_id, product_master_id, stock_tracking_enabled)
    VALUES (?, ?, ?, 5000, 'Uji', ?, ?, 0)
  `).run(id, storeId, name, unitId, masterId);
  return id;
}

async function setup() {
  const sqlite = migratedDatabase();
  await seedOwner(sqlite);
  const d1 = new D1Database(sqlite);
  const masters = {
    es: addMaster(sqlite, 'ER-ES'), tawar: addMaster(sqlite, 'ER-TAWAR'),
    manis: addMaster(sqlite, 'ER-MANIS'), cup: addMaster(sqlite, 'ER-CUP')
  };
  const products = {};
  // KANTOR: lengkap. PENDEM: tidak punya larutan manis. MANDALA: larutan tawar satuan KG.
  for (const [key, storeId] of Object.entries(STORES)) {
    products[key] = {
      es: addProduct(sqlite, storeId, masters.es, `Es Teh ${key}`, 'TPCS'),
      cup: addProduct(sqlite, storeId, masters.cup, `Cup ${key}`, 'TPCS'),
      tawar: addProduct(sqlite, storeId, masters.tawar, `Larutan Tawar ${key}`, key === 'mandala' ? 'TKG' : 'TGRAM')
    };
    if (key !== 'pendem') products[key].manis = addProduct(sqlite, storeId, masters.manis, `Larutan Manis ${key}`, 'TGRAM');
  }
  return { sqlite, d1, masters, products };
}

function call(d1, method, path, body, { token = OWNER_TOKEN, store = 'KANTOR' } = {}) {
  const url = new URL(`https://example.test${path}`);
  url.searchParams.set('store', store);
  return handleEntityRecipeApi(new Request(url, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }), { DB: d1 }, url.pathname);
}

const resep1 = masters => ({
  outputMasterId: masters.es, outputQuantity: 1, outputUnitCode: 'TPCS', variantLabel: '',
  components: [{ masterId: masters.tawar, unitCode: 'TGRAM', quantity: 100 }, { masterId: masters.cup, unitCode: 'TPCS', quantity: 1 }]
});
const resep2 = masters => ({
  outputMasterId: masters.es, outputQuantity: 1, outputUnitCode: 'TPCS', variantLabel: 'Larutan manis',
  components: [{ masterId: masters.manis, unitCode: 'TGRAM', quantity: 120 }, { masterId: masters.cup, unitCode: 'TPCS', quantity: 1 }]
});

async function saveBoth(d1, masters) {
  const first = await (await call(d1, 'PUT', '/api/admin/entity-recipes', resep1(masters))).json();
  const second = await (await call(d1, 'PUT', '/api/admin/entity-recipes', resep2(masters))).json();
  return { t1: first.id, t2: second.id };
}

const statusByStore = payload => Object.fromEntries(payload.stores.map(item => [item.storeCode, item]));

test('Owner menyimpan dua template varian untuk satu Kode Barang; daftar menampilkan keduanya lengkap dengan bahan', async () => {
  const { sqlite, d1, masters } = await setup();
  try {
    const { t1, t2 } = await saveBoth(d1, masters);
    assert.ok(t1 && t2 && t1 !== t2);
    const list = await (await call(d1, 'GET', '/api/admin/entity-recipes')).json();
    assert.equal(list.templates.length, 2);
    const manis = list.templates.find(item => item.variantLabel === 'Larutan manis');
    assert.equal(manis.outputCode, 'ER-ES');
    assert.deepEqual(manis.components.map(item => [item.code, item.unitCode, item.quantity]), [['ER-MANIS', 'TGRAM', 120], ['ER-CUP', 'TPCS', 1]]);
  } finally { sqlite.close(); }
});

test('validasi template: tanpa login ditolak, Admin Gerai ditolak, bahan ganda/diri sendiri/qty pecahan/Kode Barang entity lain ditolak, putaran antar Kode Barang ditolak', async () => {
  const { sqlite, d1, masters } = await setup();
  try {
    assert.equal((await call(d1, 'GET', '/api/admin/entity-recipes', null, { token: null })).status, 401);
    assert.equal((await call(d1, 'GET', '/api/admin/entity-recipes', null, { token: 'token-bukan-owner' })).status, 401);

    const bad = async patch => (await call(d1, 'PUT', '/api/admin/entity-recipes', { ...resep1(masters), ...patch })).status;
    assert.equal(await bad({ components: [] }), 400);
    assert.equal(await bad({ outputQuantity: 1.5 }), 400);
    assert.equal(await bad({ outputUnitCode: '' }), 400);
    assert.equal(await bad({ components: [{ masterId: masters.cup, unitCode: 'TPCS', quantity: 1 }, { masterId: masters.cup, unitCode: 'TPCS', quantity: 2 }] }), 400);
    assert.equal(await bad({ components: [{ masterId: masters.es, unitCode: 'TPCS', quantity: 1 }] }), 400);
    assert.equal(await bad({ components: [{ masterId: masters.cup, unitCode: 'TPCS', quantity: 0.5 }] }), 400);

    sqlite.prepare(`INSERT INTO product_masters (id, entity_id, code) VALUES ('pm_lain', 'ENT-G001', 'LAIN')`).run();
    assert.equal(await bad({ components: [{ masterId: 'pm_lain', unitCode: 'TPCS', quantity: 1 }] }), 400, 'Kode Barang entity lain');

    // Es butuh Cup; sekarang Cup butuh Es -> putaran.
    assert.equal((await call(d1, 'PUT', '/api/admin/entity-recipes', resep1(masters))).status, 201);
    const loop = await call(d1, 'PUT', '/api/admin/entity-recipes', {
      outputMasterId: masters.cup, outputQuantity: 1, outputUnitCode: 'TPCS', components: [{ masterId: masters.es, unitCode: 'TPCS', quantity: 1 }]
    });
    assert.equal(loop.status, 409);
  } finally { sqlite.close(); }
});

test('pratinjau per gerai: siap, terblokir karena bahan belum diaktifkan, terblokir karena satuan dasar beda', async () => {
  const { sqlite, d1, masters } = await setup();
  try {
    const { t1, t2 } = await saveBoth(d1, masters);

    const preview1 = statusByStore(await (await call(d1, 'GET', `/api/admin/entity-recipes/${t1}/preview`)).json());
    assert.equal(preview1.KANTOR.status, 'READY');
    assert.equal(preview1.PENDEM.status, 'READY');
    assert.equal(preview1.MANDALA.status, 'BLOCKED');
    assert.match(preview1.MANDALA.problems.join(' | '), /satuan TKG.*TGRAM/);
    assert.equal(preview1.SUGIONO.status, 'BLOCKED', 'gerai yang belum mengaktifkan barang apa pun');
    assert.equal(preview1.G001, undefined, 'gerai entity lain tidak ikut');

    const preview2 = statusByStore(await (await call(d1, 'GET', `/api/admin/entity-recipes/${t2}/preview`)).json());
    assert.equal(preview2.KANTOR.status, 'READY');
    assert.equal(preview2.PENDEM.status, 'BLOCKED');
    assert.match(preview2.PENDEM.problems.join(' | '), /Label ER-MANIS|belum diaktifkan/);
  } finally { sqlite.close(); }
});

test('menerapkan dua varian ke satu gerai membuat dua resep aktif milik gerai itu; terapkan ulang dilewati; gerai terblokir tidak menulis apa pun', async () => {
  const { sqlite, d1, masters, products } = await setup();
  try {
    const { t1, t2 } = await saveBoth(d1, masters);
    const apply = (id, storeIds) => call(d1, 'POST', `/api/admin/entity-recipes/${id}/apply`, { storeIds });

    const first = await (await apply(t1, ['store_kantor', 'store_mandala', 'store_g001_bukan'])).json();
    const byStore = Object.fromEntries(first.results.map(item => [item.storeId, item]));
    assert.equal(byStore.store_kantor.status, 'APPLIED');
    assert.equal(byStore.store_mandala.status, 'BLOCKED');
    assert.equal(byStore.store_g001_bukan.status, 'FAILED');
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM manufacturing_recipes WHERE store_id = 'store_mandala' AND output_product_id = ?").get(products.mandala.es).n, 0);

    const second = await (await apply(t2, ['store_kantor'])).json();
    assert.equal(second.results[0].status, 'APPLIED');

    const recipes = sqlite.prepare(`
      SELECT id, variant_label, status, output_quantity, notes FROM manufacturing_recipes
      WHERE store_id = 'store_kantor' AND output_product_id = ? ORDER BY variant_label
    `).all(products.kantor.es);
    assert.deepEqual(recipes.map(row => [row.variant_label, row.status, row.output_quantity]), [['', 'ACTIVE', 1], ['Larutan manis', 'ACTIVE', 1]]);
    assert.match(recipes[1].notes, /Resep Entity ER-ES.*Larutan manis.*rev \d/);

    const manisRecipe = recipes[1].id;
    const components = sqlite.prepare('SELECT component_product_id, quantity FROM manufacturing_recipe_components WHERE recipe_id = ? ORDER BY display_order').all(manisRecipe);
    assert.deepEqual(components.map(row => [Number(row.component_product_id), Number(row.quantity)]), [[products.kantor.manis, 120], [products.kantor.cup, 1]]);
    assert.equal(sqlite.prepare('SELECT has_recipe_variants AS v FROM products WHERE id = ?').get(products.kantor.es).v, 1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM entity_recipe_applications WHERE store_id = ?').get('store_kantor').n, 2);

    const again = await (await apply(t1, ['store_kantor'])).json();
    assert.equal(again.results[0].status, 'SKIPPED');
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM manufacturing_recipes WHERE store_id = 'store_kantor' AND output_product_id = ?").get(products.kantor.es).n, 2);

    const preview = statusByStore(await (await call(d1, 'GET', `/api/admin/entity-recipes/${t1}/preview`)).json());
    assert.equal(preview.KANTOR.status, 'UP_TO_DATE');
    assert.equal(preview.PENDEM.status, 'READY');

    assert.equal((await apply(t1, [])).status, 400);
  } finally { sqlite.close(); }
});

test('menerapkan ke gerai yang sudah punya resep aktif varian sama: pratinjau memberi peringatan, resep lama diarsipkan, penunjuk barang pindah, varian lain tidak tersentuh', async () => {
  const { sqlite, d1, masters, products } = await setup();
  try {
    const { t1 } = await saveBoth(d1, masters);
    const pendem = products.pendem;
    const insertLocal = (id, variant) => {
      sqlite.prepare(`
        INSERT INTO manufacturing_recipes (id, store_id, output_product_id, output_unit_id, output_quantity, revision, status, variant_label, created_at)
        SELECT ?, 'store_pendem', ?, base_unit_id, 1, ?, 'ACTIVE', ?, '2026-09-30T00:00:00.000Z' FROM products WHERE id = ?
      `).run(id, pendem.es, variant ? 2 : 1, variant, pendem.es);
      sqlite.prepare(`INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order)
        SELECT ?, ?, 'store_pendem', ?, base_unit_id, 5, 1 FROM products WHERE id = ?`).run(`${id}_c`, id, pendem.cup, pendem.cup);
    };
    insertLocal('recipe_lokal_polos', '');
    insertLocal('recipe_lokal_manis', 'Manual manis');
    sqlite.prepare("UPDATE products SET linked_recipe_id = 'recipe_lokal_polos', recipe_link_enabled = 1 WHERE id = ?").run(pendem.es);

    const preview = statusByStore(await (await call(d1, 'GET', `/api/admin/entity-recipes/${t1}/preview`)).json());
    assert.equal(preview.PENDEM.status, 'REPLACES');
    assert.equal(preview.PENDEM.replacesRecipeId, 'recipe_lokal_polos');

    const applied = await (await call(d1, 'POST', `/api/admin/entity-recipes/${t1}/apply`, { storeIds: ['store_pendem'] })).json();
    assert.equal(applied.results[0].status, 'APPLIED');
    const old = sqlite.prepare("SELECT status FROM manufacturing_recipes WHERE id = 'recipe_lokal_polos'").get();
    assert.equal(old.status, 'ARCHIVED', 'riwayat tetap ada, hanya diarsipkan');
    assert.equal(sqlite.prepare("SELECT status FROM manufacturing_recipes WHERE id = 'recipe_lokal_manis'").get().status, 'ACTIVE', 'varian lain tidak tersentuh');
    const linked = sqlite.prepare('SELECT linked_recipe_id FROM products WHERE id = ?').get(pendem.es).linked_recipe_id;
    assert.equal(linked, applied.results[0].recipeId, 'penunjuk pindah ke revisi baru');
  } finally { sqlite.close(); }
});

test('penunjuk barang yang tidak menunjuk resep yang digantikan, atau belum ada sama sekali, tidak dibuat/dipindah oleh penerapan', async () => {
  const { sqlite, d1, masters, products } = await setup();
  try {
    const { t1 } = await saveBoth(d1, masters);
    const applied = await (await call(d1, 'POST', `/api/admin/entity-recipes/${t1}/apply`, { storeIds: ['store_kantor'] })).json();
    assert.equal(applied.results[0].status, 'APPLIED');
    assert.equal(sqlite.prepare('SELECT linked_recipe_id FROM products WHERE id = ?').get(products.kantor.es).linked_recipe_id, null);
  } finally { sqlite.close(); }
});

test('revisi template baru untuk varian yang sama mengarsipkan revisi lama; gerai yang sudah menerapkan revisi lama kembali menjadi bisa diterapkan', async () => {
  const { sqlite, d1, masters, products } = await setup();
  try {
    const { t1 } = await saveBoth(d1, masters);
    await call(d1, 'POST', `/api/admin/entity-recipes/${t1}/apply`, { storeIds: ['store_kantor'] });

    const revised = await (await call(d1, 'PUT', '/api/admin/entity-recipes', {
      ...resep1(masters), components: [{ masterId: masters.tawar, unitCode: 'TGRAM', quantity: 90 }, { masterId: masters.cup, unitCode: 'TPCS', quantity: 1 }]
    })).json();
    // Penomoran revisi per Kode Barang hasil lintas varian (sama dengan resep gerai): varian manis sudah rev 2.
    assert.equal(revised.revision, 3);
    assert.equal(sqlite.prepare('SELECT status FROM entity_recipe_templates WHERE id = ?').get(t1).status, 'ARCHIVED');
    assert.equal((await call(d1, 'GET', `/api/admin/entity-recipes/${t1}/preview`)).status, 404, 'revisi lama tidak bisa diterapkan lagi');

    const preview = statusByStore(await (await call(d1, 'GET', `/api/admin/entity-recipes/${revised.id}/preview`)).json());
    assert.equal(preview.KANTOR.status, 'REPLACES');
    const applied = await (await call(d1, 'POST', `/api/admin/entity-recipes/${revised.id}/apply`, { storeIds: ['store_kantor'] })).json();
    assert.equal(applied.results[0].status, 'APPLIED');
    const active = sqlite.prepare(`SELECT revision, status FROM manufacturing_recipes WHERE store_id = 'store_kantor' AND output_product_id = ? AND variant_label = '' ORDER BY revision`).all(products.kantor.es);
    // Penomoran revisi resep gerai berlaku per barang hasil lintas varian (aturan lama).
    assert.deepEqual(active.map(row => row.status), ['ARCHIVED', 'ACTIVE']);
    assert.ok(Number(active[1].revision) > Number(active[0].revision));
  } finally { sqlite.close(); }
});

test('UI Entity Admin: panel Resep Produksi Entity terpasang dengan pratinjau + terapkan, versi ?v= dibump', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const html = read('../public/entity-admin.html');
  const js = read('../public/entity-admin.js');
  assert.match(js, /\/api\/admin\/entity-recipes/);
  assert.match(js, /\/preview/);
  assert.match(js, /\/apply/);
  assert.match(js, /data-entity-recipe-apply/);
  assert.match(html, /entity-admin\.js\?v=20261002-laporan-gerai-v1/);
});
