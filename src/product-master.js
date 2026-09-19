import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getManufacturingReferenceData, resolveProductMasterReferences } from './manufacturing-master.js';
import { resolveLinkedRecipe } from './product-policy.js';
import { listProductKinds, resolveProductKind } from './product-kinds.js';

const MAX_PRODUCT_IMAGE_LENGTH = 900_000;
const COST_SCALE = 1_000_000;
const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const costFromScaled = value => Number(value || 0) / COST_SCALE;
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

const MAX_PURCHASE_PRICE_RUPIAH = 10_000_000;

// Harga Beli (Master Barang) shares the exact-unit-cost scale used by
// average_cost/last_purchase_price in this same table (1 rupiah = 1.000.000
// unit, see migration 0019/0059) so sub-rupiah unit prices (mis. bahan curah
// yang dibeli per ml/gram) survive without float/REAL as source of truth.
export function scaledPurchasePriceFromInput(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > MAX_PURCHASE_PRICE_RUPIAH) return null;
  const scaled = Math.round(number * COST_SCALE);
  return Number.isSafeInteger(scaled) ? scaled : null;
}

function purchasePriceInput(body, current) {
  if (owns(body, 'purchasePrice')) return scaledPurchasePriceFromInput(body.purchasePrice);
  const existing = Number(current?.purchase_price);
  return Number.isSafeInteger(existing) && existing >= 0 ? existing : null;
}

// Harga Jual (products.price) shares the same exact-unit-cost scale as of
// migration 0060, for the same reason Harga Beli did (0059): barang yang
// dijual per satuan sangat kecil (mis. per gram) needs a sub-rupiah catalog
// price. The actual Sale total stays whole-rupiah -- only this reference
// price gains precision. Reuses scaledPurchasePriceFromInput since the
// parsing/scaling/bounds logic is identical.
function priceInput(body, current) {
  if (owns(body, 'price')) return scaledPurchasePriceFromInput(body.price);
  const existing = Number(current?.price);
  return Number.isSafeInteger(existing) && existing >= 0 ? existing : null;
}

function nonNegativeInteger(value, max = 10_000_000) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= max ? number : null;
}

function imageData(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (!normalized.startsWith('data:image/')) return null;
  return normalized.length <= MAX_PRODUCT_IMAGE_LENGTH ? normalized : null;
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

const productCodeText = value => String(value ?? '').trim().slice(0, 40);

function actorFrom(auth) {
  if (auth.owner) return { role: 'OWNER', id: auth.owner.id };
  if (auth.entityAdmin) return { role: 'ENTITY_ADMIN', id: auth.entityAdmin.id };
  if (auth.admin) return { role: 'ADMIN', id: auth.admin.id };
  return { role: 'LEGACY_PIN', id: '' };
}

// Kode Barang (product_masters, migration 0098) -- ADR-043: Entity cuma
// punya kode + foto + label nama internal (identifikasi saja, mis. buat
// agen yang upload banyak foto sekaligus -- BUKAN nama tampil ke pelanggan,
// itu selalu products.name milik gerai masing-masing). Resep di sini murni
// acuan/referensi (lihat komentar migration). Dipanggil dari create/PATCH
// Master Barang biasa (declare kode baru) dan dari
// handleProductMasterCatalogApi (Gunakan/Aktifkan lintas gerai).
async function createProductMaster(db, entityId, code, referenceName, image, actor) {
  const id = `pm_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO product_masters (id, entity_id, code, name, image_data, created_by_role, created_by_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(id, entityId, code, referenceName || '', image || '', actor.role, actor.id).run();
  return id;
}

async function ensureCategory(db, storeId, categoryName) {
  const existing = await db.prepare('SELECT id FROM categories WHERE store_id = ? AND name = ?').bind(storeId, categoryName).first();
  if (existing) return;
  const next = await db.prepare('SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM categories WHERE store_id = ?').bind(storeId).first();
  await db.prepare(`
    INSERT INTO categories (store_id, name, display_order, is_active, created_at, updated_at)
    VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(storeId, categoryName, Number(next?.next_order ?? 1)).run();
}

async function listActiveRecipes(db, storeId) {
  const rows = await db.prepare(`
    SELECT r.id, r.output_product_id, p.name AS output_product_name,
           r.output_quantity, r.revision, u.symbol AS output_unit_symbol
    FROM manufacturing_recipes r
    JOIN products p ON p.id = r.output_product_id AND p.store_id = r.store_id
    JOIN units u ON u.id = r.output_unit_id AND u.store_id = r.store_id
    WHERE r.store_id = ? AND r.status = 'ACTIVE'
    ORDER BY p.name COLLATE NOCASE, r.revision DESC
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    outputProductId: Number(row.output_product_id),
    outputProductName: row.output_product_name,
    outputQuantity: Number(row.output_quantity || 0),
    revision: Number(row.revision || 0),
    outputUnitSymbol: row.output_unit_symbol || ''
  }));
}

async function listEditorProducts(db, storeId) {
  const rows = await db.prepare(`
    SELECT p.id, p.name, p.purchase_price, p.price, p.category, p.emoji, p.image_data,
           p.display_order, p.is_active, p.item_type_id, p.product_kind_id, p.base_unit_id,
           p.points_per_unit, p.recipe_link_enabled, p.linked_recipe_id, p.stock_tracking_enabled,
           p.average_cost, p.last_purchase_price, p.cost_updated_at, p.last_purchase_at,
           p.product_master_id, pm.code AS product_master_code, pm.name AS product_master_name,
           t.name AS item_type_name,
           k.code AS product_kind_code, k.name AS product_kind_name,
           u.name AS unit_name, u.symbol AS unit_symbol,
           b.quantity AS stock_quantity
    FROM products p
    LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    LEFT JOIN product_kinds k ON k.id = p.product_kind_id AND k.store_id = p.store_id
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN inventory_stock_balances b ON b.store_id = p.store_id AND b.product_id = p.id
    LEFT JOIN product_masters pm ON pm.id = p.product_master_id
    WHERE p.store_id = ?
    ORDER BY p.display_order, p.id
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: Number(row.id),
    name: row.name,
    purchasePrice: costFromScaled(row.purchase_price),
    price: costFromScaled(row.price),
    category: row.category,
    emoji: row.emoji,
    imageData: row.image_data || '',
    displayOrder: Number(row.display_order || 0),
    isActive: Boolean(row.is_active),
    itemTypeId: row.item_type_id || null,
    itemTypeName: row.item_type_name || '',
    productKindId: row.product_kind_id || null,
    productKindCode: row.product_kind_code || '',
    productKindName: row.product_kind_name || '',
    baseUnitId: row.base_unit_id || null,
    unitName: row.unit_name || '',
    unitSymbol: row.unit_symbol || '',
    pointsPerUnit: Number(row.points_per_unit || 0),
    linkedRecipeId: row.linked_recipe_id || null,
    recipeLinkEnabled: Boolean(row.linked_recipe_id || row.recipe_link_enabled),
    stockTrackingEnabled: Boolean(row.stock_tracking_enabled),
    stockQuantity: row.stock_quantity == null ? null : Number(row.stock_quantity),
    averageCost: costFromScaled(row.average_cost),
    lastPurchasePrice: costFromScaled(row.last_purchase_price),
    costUpdatedAt: row.cost_updated_at || null,
    lastPurchaseAt: row.last_purchase_at || null,
    productMasterId: row.product_master_id || null,
    productMasterCode: row.product_master_code || '',
    productMasterName: row.product_master_name || ''
  }));
}

async function editorPayload(db, store) {
  // Reference bootstrap may write missing defaults. Finish it before concurrent
  // reads so D1 never overlaps a bootstrap batch with the editor snapshot.
  const refs = await getManufacturingReferenceData(db, store.id);
  const [productKinds, products, recipes] = await Promise.all([
    listProductKinds(db, store.id),
    listEditorProducts(db, store.id),
    listActiveRecipes(db, store.id)
  ]);
  return { store, products, recipes, productKinds, ...refs };
}

async function validateBaseUnitChange(db, storeId, productId, currentUnitId, nextUnitId) {
  if (!currentUnitId || currentUnitId === nextUnitId) return { ok: true };
  const [recipe, movement, balance] = await db.batch([
    db.prepare(`SELECT id FROM manufacturing_recipes WHERE store_id = ? AND output_product_id = ? LIMIT 1`).bind(storeId, productId),
    db.prepare(`SELECT id FROM stock_movements WHERE store_id = ? AND product_id = ? LIMIT 1`).bind(storeId, productId),
    db.prepare(`SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ? LIMIT 1`).bind(storeId, productId)
  ]);
  const hasRecipe = Boolean(recipe.results?.length);
  const hasMovement = Boolean(movement.results?.length);
  const quantity = Number(balance.results?.[0]?.quantity || 0);
  if (hasRecipe || hasMovement || quantity !== 0) {
    return {
      ok: false,
      error: 'Satuan dasar tidak boleh diganti setelah barang punya resep atau histori stok. Gunakan proses konversi/migrasi satuan terpisah.'
    };
  }
  return { ok: true };
}

async function normalizeEditorInput(db, storeId, productId, body, current = null) {
  const name = text(owns(body, 'name') ? body.name : current?.name, 100);
  const purchasePrice = purchasePriceInput(body, current);
  const price = priceInput(body, current);
  const category = text(owns(body, 'category') ? body.category : current?.category, 60);
  const emoji = text(owns(body, 'emoji') ? body.emoji : current?.emoji, 8) || '🥞';
  const productImage = imageData(owns(body, 'imageData') ? body.imageData : current?.image_data);
  const pointsPerUnit = nonNegativeInteger(owns(body, 'pointsPerUnit') ? body.pointsPerUnit : (current?.points_per_unit ?? 0));
  const stockTrackingEnabled = owns(body, 'stockTrackingEnabled')
    ? body.stockTrackingEnabled !== false
    : current?.stock_tracking_enabled !== 0;

  if (!name || purchasePrice === null || price === null || !category || productImage === null) {
    return { ok: false, status: 400, error: 'Nama, kategori, harga beli, harga jual, atau foto barang tidak valid.' };
  }
  if (pointsPerUnit === null) return { ok: false, status: 400, error: 'Poin barang harus bilangan bulat nol atau positif.' };

  const itemTypeId = owns(body, 'itemTypeId') ? body.itemTypeId : current?.item_type_id;
  const baseUnitId = owns(body, 'baseUnitId') ? body.baseUnitId : current?.base_unit_id;
  const refs = await resolveProductMasterReferences(db, storeId, itemTypeId, baseUnitId, {
    allowInactive: Boolean(current && current.item_type_id === itemTypeId && current.base_unit_id === baseUnitId)
  });
  if (!refs.ok) return { ok: false, status: 400, error: refs.error };

  const productKindId = owns(body, 'productKindId') ? body.productKindId : current?.product_kind_id;
  const kind = await resolveProductKind(db, storeId, productKindId, {
    allowInactive: Boolean(current?.product_kind_id && current.product_kind_id === productKindId)
  });
  if (!kind.ok) return { ok: false, status: 400, error: kind.error };

  if (current) {
    const unitGuard = await validateBaseUnitChange(db, storeId, productId, current.base_unit_id, refs.baseUnitId);
    if (!unitGuard.ok) return { ok: false, status: 409, error: unitGuard.error };
  }

  let recipeLink = { ok: true, linkedRecipeId: null, recipe: null };
  const requestedRecipeId = owns(body, 'linkedRecipeId') ? body.linkedRecipeId : current?.linked_recipe_id;
  if (requestedRecipeId) {
    if (!current) {
      return { ok: false, status: 409, error: 'Barang baru harus disimpan dulu sebelum bisa memilih resep yang menghasilkan barang tersebut.' };
    }
    recipeLink = await resolveLinkedRecipe(db, storeId, productId, requestedRecipeId);
    if (!recipeLink.ok) return { ok: false, status: 400, error: recipeLink.error };
  }

  return {
    ok: true,
    name,
    purchasePrice,
    price,
    category,
    emoji,
    productImage,
    isActive: owns(body, 'isActive') ? (body.isActive === false ? 0 : 1) : (current?.is_active === 0 ? 0 : 1),
    itemTypeId: refs.itemTypeId,
    productKindId: kind.productKindId,
    baseUnitId: refs.baseUnitId,
    pointsPerUnit,
    linkedRecipeId: recipeLink.linkedRecipeId,
    recipeLinkEnabled: recipeLink.recipe ? 1 : 0,
    stockTrackingEnabled: stockTrackingEnabled ? 1 : 0
  };
}

export async function handleProductMasterApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/master/products/editor')) return null;
  const auth = await requireManagement(request, env.DB, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (request.method === 'GET' && pathname === '/api/admin/master/products/editor') {
    return json(await editorPayload(env.DB, store));
  }

  if (request.method === 'POST' && pathname === '/api/admin/master/products/editor') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload Master Barang tidak valid.' }, 400);
    const normalized = await normalizeEditorInput(env.DB, store.id, null, body.value, null);
    if (!normalized.ok) return json({ error: normalized.error }, normalized.status);
    await ensureCategory(env.DB, store.id, normalized.category);

    // Kode Barang opsional: gerai boleh sekalian mendaftarkan barang baru ini
    // ke Master Entity (ADR-043) supaya gerai lain bisa "Gunakan/Aktifkan"
    // tanpa mengetik ulang. Field productCode kosong = perilaku lama persis,
    // barang murni lokal gerai ini seperti sebelum fitur ini ada.
    let productMasterId = null;
    const requestedCode = productCodeText(body.value?.productCode);
    if (requestedCode) {
      if (!store.entityId) return json({ error: 'Gerai ini belum terhubung ke Entity mana pun, tidak bisa membuat Kode Barang.', code: 'STORE_WITHOUT_ENTITY' }, 409);
      const existingCode = await env.DB.prepare('SELECT id FROM product_masters WHERE entity_id = ? AND code = ?').bind(store.entityId, requestedCode).first();
      if (existingCode) {
        return json({ error: 'Kode Barang ini sudah dipakai di entity ini. Pakai Katalog "Gunakan/Aktifkan" untuk memakai kode yang sudah ada, jangan bikin baru.', code: 'PRODUCT_CODE_ALREADY_EXISTS' }, 409);
      }
      productMasterId = await createProductMaster(
        env.DB, store.entityId, requestedCode, text(body.value?.productMasterName, 100), normalized.productImage, actorFrom(auth)
      );
    }

    const next = await env.DB.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM products').first();
    const order = await env.DB.prepare('SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM products WHERE store_id = ?').bind(store.id).first();
    const id = Number(next?.next_id ?? 1);
    const statements = [
      env.DB.prepare(`
        INSERT INTO products (
          id, store_id, name, purchase_price, price, category, emoji, image_data,
          display_order, is_active, item_type_id, product_kind_id, base_unit_id,
          points_per_unit, recipe_link_enabled, linked_recipe_id, stock_tracking_enabled,
          product_master_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, store.id, normalized.name, normalized.purchasePrice, normalized.price,
        normalized.category, normalized.emoji, normalized.productImage, Number(order?.next_order ?? 1),
        normalized.isActive, normalized.itemTypeId, normalized.productKindId, normalized.baseUnitId,
        normalized.pointsPerUnit, normalized.recipeLinkEnabled,
        normalized.linkedRecipeId, normalized.stockTrackingEnabled, productMasterId
      )
    ];
    if (normalized.stockTrackingEnabled) {
      statements.push(env.DB.prepare(`
        INSERT OR IGNORE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
        VALUES (?, ?, 0, CURRENT_TIMESTAMP)
      `).bind(store.id, id));
    }
    await env.DB.batch(statements);
    return json({ ok: true, id, editor: await editorPayload(env.DB, store) }, 201);
  }

  const match = pathname.match(/^\/api\/admin\/master\/products\/editor\/(\d+)$/);
  if (!match) return json({ error: 'Route Master Barang tidak ditemukan.' }, 404);
  if (request.method !== 'PATCH') return json({ error: 'Method Master Barang tidak didukung.' }, 405);

  const productId = Number(match[1]);
  const current = await env.DB.prepare(`
    SELECT id, name, purchase_price, price, category, emoji, image_data, is_active,
           item_type_id, product_kind_id, base_unit_id, points_per_unit,
           stock_tracking_enabled, linked_recipe_id, product_master_id
    FROM products WHERE id = ? AND store_id = ?
  `).bind(productId, store.id).first();
  if (!current) return json({ error: 'Barang tidak ditemukan di gerai ini.' }, 404);

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload Master Barang tidak valid.' }, 400);
  const normalized = await normalizeEditorInput(env.DB, store.id, productId, body.value, current);
  if (!normalized.ok) return json({ error: normalized.error }, normalized.status);
  await ensureCategory(env.DB, store.id, normalized.category);

  // Retrofit Kode Barang: barang lama yang belum pernah didaftarkan ke
  // Master Entity boleh didaftarkan belakangan lewat productCode. Barang
  // yang SUDAH punya Kode Barang tidak bisa diganti/dilepas dari sini --
  // di luar scope fitur ini, silakan tulis eskalasi kalau memang dibutuhkan.
  let productMasterId = current.product_master_id || null;
  const requestedCode = productCodeText(body.value?.productCode);
  if (!productMasterId && requestedCode) {
    if (!store.entityId) return json({ error: 'Gerai ini belum terhubung ke Entity mana pun, tidak bisa membuat Kode Barang.', code: 'STORE_WITHOUT_ENTITY' }, 409);
    const existingCode = await env.DB.prepare('SELECT id FROM product_masters WHERE entity_id = ? AND code = ?').bind(store.entityId, requestedCode).first();
    if (existingCode) {
      return json({ error: 'Kode Barang ini sudah dipakai di entity ini. Pakai Katalog "Gunakan/Aktifkan" untuk memakai kode yang sudah ada, jangan bikin baru.', code: 'PRODUCT_CODE_ALREADY_EXISTS' }, 409);
    }
    productMasterId = await createProductMaster(
      env.DB, store.entityId, requestedCode, text(body.value?.productMasterName, 100), normalized.productImage, actorFrom(auth)
    );
  }

  const statements = [
    env.DB.prepare(`
      UPDATE products
      SET name = ?, purchase_price = ?, price = ?, category = ?, emoji = ?, image_data = ?,
          is_active = ?, item_type_id = ?, product_kind_id = ?, base_unit_id = ?, points_per_unit = ?,
          recipe_link_enabled = ?, linked_recipe_id = ?, stock_tracking_enabled = ?, product_master_id = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(
      normalized.name, normalized.purchasePrice, normalized.price, normalized.category,
      normalized.emoji, normalized.productImage, normalized.isActive,
      normalized.itemTypeId, normalized.productKindId, normalized.baseUnitId, normalized.pointsPerUnit,
      normalized.recipeLinkEnabled, normalized.linkedRecipeId,
      normalized.stockTrackingEnabled, productMasterId, productId, store.id
    )
  ];
  if (normalized.stockTrackingEnabled) {
    statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
      VALUES (?, ?, 0, CURRENT_TIMESTAMP)
    `).bind(store.id, productId));
  }
  if (current.product_master_id) {
    // Barang ini sudah punya Kode Barang SEBELUM edit ini -- foto adalah
    // milik Entity (ADR-043), jadi perubahan foto di sini ikut memperbarui
    // product_masters DAN setiap products row lain (gerai mana pun) yang
    // memakai Kode Barang yang sama. Nama/harga/status di UPDATE di atas
    // TIDAK ikut serta -- itu tetap murni milik products row gerai ini saja.
    statements.push(
      env.DB.prepare('UPDATE product_masters SET image_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(normalized.productImage, current.product_master_id),
      env.DB.prepare('UPDATE products SET image_data = ? WHERE product_master_id = ?')
        .bind(normalized.productImage, current.product_master_id)
    );
  }
  await env.DB.batch(statements);
  return json({ ok: true, id: productId, editor: await editorPayload(env.DB, store) });
}

// Katalog Kode Barang Entity + Gunakan/Aktifkan + resep acuan (ADR-043).
// Endpoint terpisah dari handleProductMasterApi di atas (route prefix beda)
// tapi satu file karena berbagi normalizeEditorInput/ensureCategory/
// createProductMaster/actorFrom -- pemisahan modul yang dipaksakan di sini
// cuma menambah boilerplate tanpa manfaat isolasi nyata.

function mapCatalogEntry(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name || '',
    imageData: row.image_data || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usedByStores: [],
    recipeReference: []
  };
}

async function loadProductMasterCatalog(db, entityId) {
  const masters = await db.prepare(`
    SELECT id, code, name, image_data, created_at, updated_at
    FROM product_masters WHERE entity_id = ? ORDER BY code COLLATE NOCASE
  `).bind(entityId).all();
  const entries = (masters.results ?? []).map(mapCatalogEntry);
  if (!entries.length) return entries;

  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const placeholders = entries.map(() => '?').join(',');
  const ids = entries.map(entry => entry.id);

  const usage = await db.prepare(`
    SELECT p.product_master_id, p.id AS product_id, p.name, s.code AS store_code, s.store_name
    FROM products p
    JOIN stores s ON s.id = p.store_id
    WHERE p.product_master_id IN (${placeholders})
    ORDER BY s.code
  `).bind(...ids).all();
  for (const row of usage.results ?? []) {
    const entry = byId.get(row.product_master_id);
    if (entry) entry.usedByStores.push({
      productId: Number(row.product_id), name: row.name, storeCode: row.store_code, storeName: row.store_name
    });
  }

  const components = await db.prepare(`
    SELECT product_master_id, id, ingredient_label, quantity_label, sort_order
    FROM product_master_recipe_components
    WHERE product_master_id IN (${placeholders})
    ORDER BY sort_order, id
  `).bind(...ids).all();
  for (const row of components.results ?? []) {
    const entry = byId.get(row.product_master_id);
    if (entry) entry.recipeReference.push({
      id: row.id, ingredientLabel: row.ingredient_label, quantityLabel: row.quantity_label || ''
    });
  }

  return entries;
}

// "Gunakan/Aktifkan Barang" -- gerai lain memilih satu Kode Barang dari
// katalog entity-nya, sistem bikin SATU products row baru MILIK GERAI ITU
// SENDIRI (bukan copy gerai lain): nama/harga/kategori/dll diisi gerai
// pemanggil sendiri lewat body (sama seperti create barang biasa), cuma
// foto yang dipaksa ikut foto Kode Barang (Entity-owned). Resep acuan
// (kalau ada) murni ditampilkan sebagai referensi ke UI -- TIDAK pernah
// otomatis di-link (linkedRecipeId tetap NULL kalau body tidak memintanya),
// jadi aktivasi tidak pernah gagal/diblokir gara-gara bahan baku belum ada.
async function activateProductMaster(db, store, masterId, body) {
  const master = await db.prepare('SELECT id, entity_id, code, image_data FROM product_masters WHERE id = ?').bind(masterId).first();
  if (!master) return { ok: false, status: 404, error: 'Kode Barang tidak ditemukan.' };
  if (master.entity_id !== store.entityId) {
    return { ok: false, status: 403, error: 'Kode Barang ini bukan milik entity gerai ini.', code: 'PRODUCT_MASTER_ENTITY_MISMATCH' };
  }

  const already = await db.prepare('SELECT id FROM products WHERE store_id = ? AND product_master_id = ? LIMIT 1').bind(store.id, masterId).first();
  if (already) {
    return { ok: false, status: 409, error: 'Barang ini sudah diaktifkan di gerai ini.', code: 'PRODUCT_MASTER_ALREADY_ACTIVE', productId: Number(already.id) };
  }

  const normalized = await normalizeEditorInput(db, store.id, null, { ...body, imageData: master.image_data }, null);
  if (!normalized.ok) return { ok: false, status: normalized.status, error: normalized.error };
  await ensureCategory(db, store.id, normalized.category);

  const next = await db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM products').first();
  const order = await db.prepare('SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM products WHERE store_id = ?').bind(store.id).first();
  const id = Number(next?.next_id ?? 1);
  const statements = [
    db.prepare(`
      INSERT INTO products (
        id, store_id, name, purchase_price, price, category, emoji, image_data,
        display_order, is_active, item_type_id, product_kind_id, base_unit_id,
        points_per_unit, recipe_link_enabled, linked_recipe_id, stock_tracking_enabled,
        product_master_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, store.id, normalized.name, normalized.purchasePrice, normalized.price,
      normalized.category, normalized.emoji, normalized.productImage, Number(order?.next_order ?? 1),
      normalized.isActive, normalized.itemTypeId, normalized.productKindId, normalized.baseUnitId,
      normalized.pointsPerUnit, normalized.recipeLinkEnabled,
      normalized.linkedRecipeId, normalized.stockTrackingEnabled, masterId
    )
  ];
  if (normalized.stockTrackingEnabled) {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
      VALUES (?, ?, 0, CURRENT_TIMESTAMP)
    `).bind(store.id, id));
  }
  await db.batch(statements);
  return { ok: true, id };
}

async function replaceRecipeComponents(db, masterId, components) {
  const statements = [db.prepare('DELETE FROM product_master_recipe_components WHERE product_master_id = ?').bind(masterId)];
  components.forEach((component, index) => {
    statements.push(db.prepare(`
      INSERT INTO product_master_recipe_components (id, product_master_id, ingredient_label, quantity_label, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).bind(`pmrc_${crypto.randomUUID()}`, masterId, component.ingredientLabel, component.quantityLabel, index));
  });
  await db.batch(statements);
}

export async function handleProductMasterCatalogApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/product-masters')) return null;
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  if (!store.entityId) return json({ error: 'Gerai ini belum terhubung ke Entity mana pun.', code: 'STORE_WITHOUT_ENTITY' }, 409);

  if (request.method === 'GET' && pathname === '/api/admin/product-masters') {
    return json({ store, catalog: await loadProductMasterCatalog(db, store.entityId) });
  }

  // Upload Master Barang lewat Admin Entity (Bos Cyo, 2026-09-19: "bikin
  // sistem upload barang lewat admin entity dan uploadnya juga di master
  // barang entity ya") -- sebelumnya satu-satunya jalan bikin Kode Barang
  // adalah nebeng field "Kode Barang" saat gerai bikin/edit barangnya
  // sendiri (lihat handleProductMasterApi di atas). Ini jalur top-down:
  // Entity Admin/Owner mendaftarkan Kode Barang duluan, gerai mana pun
  // (termasuk gerai yang belum punya barang sama sekali) tinggal
  // "Gunakan/Aktifkan" dari katalog di bawah -- tidak perlu ada products
  // row lebih dulu di gerai mana pun.
  if (request.method === 'POST' && pathname === '/api/admin/product-masters') {
    if (!(auth.owner || auth.entityAdmin)) {
      return json({ error: 'Upload Master Barang Entity hanya bisa dilakukan Entity Admin atau Owner.', code: 'ENTITY_LEVEL_ONLY' }, 403);
    }
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload Master Barang Entity tidak valid.' }, 400);
    const code = productCodeText(body.value?.code);
    if (!code) return json({ error: 'Kode Barang wajib diisi.' }, 400);
    const existingCode = await db.prepare('SELECT id FROM product_masters WHERE entity_id = ? AND code = ?').bind(store.entityId, code).first();
    if (existingCode) {
      return json({ error: 'Kode Barang ini sudah dipakai di entity ini.', code: 'PRODUCT_CODE_ALREADY_EXISTS' }, 409);
    }
    const image = imageData(body.value?.imageData);
    if (image === null) return json({ error: 'Foto barang tidak valid.' }, 400);
    const masterId = await createProductMaster(db, store.entityId, code, text(body.value?.name, 100), image, actorFrom(auth));
    return json({ ok: true, id: masterId, catalog: await loadProductMasterCatalog(db, store.entityId) }, 201);
  }

  const activateMatch = pathname.match(/^\/api\/admin\/product-masters\/([^/]+)\/activate$/);
  if (request.method === 'POST' && activateMatch) {
    const masterId = decodeURIComponent(activateMatch[1]);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload aktivasi tidak valid.' }, 400);
    const result = await activateProductMaster(db, store, masterId, body.value);
    if (!result.ok) return json({ error: result.error, code: result.code, productId: result.productId }, result.status);
    return json({ ok: true, id: result.id, editor: await editorPayload(db, store) }, 201);
  }

  const recipeMatch = pathname.match(/^\/api\/admin\/product-masters\/([^/]+)\/recipe-components$/);
  if (request.method === 'PUT' && recipeMatch) {
    const masterId = decodeURIComponent(recipeMatch[1]);
    const master = await db.prepare('SELECT id, entity_id FROM product_masters WHERE id = ?').bind(masterId).first();
    if (!master) return json({ error: 'Kode Barang tidak ditemukan.' }, 404);
    if (master.entity_id !== store.entityId) {
      return json({ error: 'Kode Barang ini bukan milik entity gerai ini.', code: 'PRODUCT_MASTER_ENTITY_MISMATCH' }, 403);
    }
    const body = await readJson(request);
    if (!body.ok || !Array.isArray(body.value?.components)) return json({ error: 'Payload resep acuan tidak valid.' }, 400);
    const components = body.value.components
      .map(component => ({
        ingredientLabel: text(component?.ingredientLabel, 100),
        quantityLabel: text(component?.quantityLabel, 40)
      }))
      .filter(component => component.ingredientLabel);
    await replaceRecipeComponents(db, masterId, components);
    return json({ ok: true, catalog: await loadProductMasterCatalog(db, store.entityId) });
  }

  const patchMatch = pathname.match(/^\/api\/admin\/product-masters\/([^/]+)$/);
  if (request.method === 'PATCH' && patchMatch) {
    if (!(auth.owner || auth.entityAdmin)) {
      return json({ error: 'Mengubah Master Barang Entity hanya bisa dilakukan Entity Admin atau Owner.', code: 'ENTITY_LEVEL_ONLY' }, 403);
    }
    const masterId = decodeURIComponent(patchMatch[1]);
    const master = await db.prepare('SELECT id, entity_id, name, image_data FROM product_masters WHERE id = ?').bind(masterId).first();
    if (!master) return json({ error: 'Kode Barang tidak ditemukan.' }, 404);
    if (master.entity_id !== store.entityId) {
      return json({ error: 'Kode Barang ini bukan milik entity gerai ini.', code: 'PRODUCT_MASTER_ENTITY_MISMATCH' }, 403);
    }
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload Master Barang Entity tidak valid.' }, 400);
    const name = owns(body.value, 'name') ? text(body.value.name, 100) : master.name;
    const image = owns(body.value, 'imageData') ? imageData(body.value.imageData) : master.image_data;
    if (image === null) return json({ error: 'Foto barang tidak valid.' }, 400);
    // Foto Kode Barang milik Entity (ADR-043) -- ganti di sini ikut
    // memperbarui setiap products row (gerai mana pun) yang sudah pakai
    // Kode Barang ini, sama seperti saat foto diganti lewat edit barang
    // biasa di satu gerai (lihat handleProductMasterApi PATCH di atas).
    await db.batch([
      db.prepare('UPDATE product_masters SET name = ?, image_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(name, image, masterId),
      db.prepare('UPDATE products SET image_data = ? WHERE product_master_id = ?').bind(image, masterId)
    ]);
    return json({ ok: true, catalog: await loadProductMasterCatalog(db, store.entityId) });
  }

  return json({ error: 'Route Kode Barang Entity tidak ditemukan.' }, 404);
}
