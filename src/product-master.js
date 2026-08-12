import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getManufacturingReferenceData, resolveProductMasterReferences } from './manufacturing-master.js';
import { resolveLinkedRecipe } from './product-policy.js';
import {
  listAccountingAccountRefs,
  productAccountingRefStatement,
  resolveProductAccountingRefs
} from './accounting-reference.js';

const MAX_PRODUCT_IMAGE_LENGTH = 900_000;
const MODES = new Set(['STOCK', 'DADAKAN']);
const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
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
           p.display_order, p.is_active, p.item_type_id, p.base_unit_id,
           p.points_per_unit, p.production_mode, p.recipe_link_enabled, p.linked_recipe_id,
           p.stock_tracking_enabled,
           t.name AS item_type_name, u.name AS unit_name, u.symbol AS unit_symbol,
           b.quantity AS stock_quantity,
           ar.sales_account_ref_id, ar.inventory_account_ref_id, ar.cogs_account_ref_id
    FROM products p
    LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN inventory_stock_balances b ON b.store_id = p.store_id AND b.product_id = p.id
    LEFT JOIN product_accounting_refs ar ON ar.store_id = p.store_id AND ar.product_id = p.id
    WHERE p.store_id = ?
    ORDER BY p.display_order, p.id
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: Number(row.id),
    name: row.name,
    purchasePrice: Number(row.purchase_price || 0),
    price: Number(row.price || 0),
    category: row.category,
    emoji: row.emoji,
    imageData: row.image_data || '',
    displayOrder: Number(row.display_order || 0),
    isActive: Boolean(row.is_active),
    itemTypeId: row.item_type_id || null,
    itemTypeName: row.item_type_name || '',
    baseUnitId: row.base_unit_id || null,
    unitName: row.unit_name || '',
    unitSymbol: row.unit_symbol || '',
    pointsPerUnit: Number(row.points_per_unit || 0),
    productionMode: row.production_mode || 'STOCK',
    linkedRecipeId: row.linked_recipe_id || null,
    recipeLinkEnabled: Boolean(row.linked_recipe_id || row.recipe_link_enabled),
    stockTrackingEnabled: Boolean(row.stock_tracking_enabled),
    stockQuantity: row.stock_quantity == null ? null : Number(row.stock_quantity),
    accounting: {
      salesAccountRefId: row.sales_account_ref_id || null,
      inventoryAccountRefId: row.inventory_account_ref_id || null,
      cogsAccountRefId: row.cogs_account_ref_id || null
    }
  }));
}

async function editorPayload(db, store) {
  const [refs, products, recipes, accountingAccounts] = await Promise.all([
    getManufacturingReferenceData(db, store.id),
    listEditorProducts(db, store.id),
    listActiveRecipes(db, store.id),
    listAccountingAccountRefs(db, store.id)
  ]);
  return { store, products, recipes, accountingAccounts, ...refs };
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
  const name = text(body?.name, 100);
  const purchasePrice = money(body?.purchasePrice);
  const price = money(body?.price);
  const category = text(body?.category, 60);
  const emoji = text(body?.emoji, 8) || '🥞';
  const productImage = imageData(body?.imageData);
  const pointsPerUnit = nonNegativeInteger(body?.pointsPerUnit ?? 0);
  const productionMode = String(body?.productionMode || 'STOCK').trim().toUpperCase();
  const stockTrackingEnabled = body?.stockTrackingEnabled !== false;

  if (!name || purchasePrice === null || price === null || !category || productImage === null) {
    return { ok: false, status: 400, error: 'Nama, kategori, harga beli/jual, atau foto barang tidak valid.' };
  }
  if (pointsPerUnit === null) return { ok: false, status: 400, error: 'Poin barang harus bilangan bulat nol atau positif.' };
  if (!MODES.has(productionMode)) return { ok: false, status: 400, error: 'Mode barang harus STOCK atau DADAKAN.' };

  const refs = await resolveProductMasterReferences(db, storeId, body?.itemTypeId, body?.baseUnitId);
  if (!refs.ok) return { ok: false, status: 400, error: refs.error };

  if (current) {
    const unitGuard = await validateBaseUnitChange(db, storeId, productId, current.base_unit_id, refs.baseUnitId);
    if (!unitGuard.ok) return { ok: false, status: 409, error: unitGuard.error };
  }

  let recipeLink = { ok: true, linkedRecipeId: null, recipe: null };
  if (body?.linkedRecipeId) {
    if (!current) {
      return { ok: false, status: 409, error: 'Barang baru harus disimpan dulu sebelum bisa memilih resep yang menghasilkan barang tersebut.' };
    }
    recipeLink = await resolveLinkedRecipe(db, storeId, productId, body.linkedRecipeId);
    if (!recipeLink.ok) return { ok: false, status: 400, error: recipeLink.error };
  }
  if (productionMode === 'DADAKAN' && !recipeLink.recipe) {
    return { ok: false, status: 409, error: 'Mode DADAKAN membutuhkan Recipe Linked dari Master Resep.' };
  }
  if (productionMode === 'DADAKAN' && !stockTrackingEnabled) {
    return { ok: false, status: 409, error: 'Mode DADAKAN wajib mengaktifkan tracking stok.' };
  }

  const accounting = await resolveProductAccountingRefs(db, storeId, body?.accounting || {});
  if (!accounting.ok) return { ok: false, status: 400, error: accounting.error };

  return {
    ok: true,
    name,
    purchasePrice,
    price,
    category,
    emoji,
    productImage,
    isActive: body?.isActive === false ? 0 : 1,
    itemTypeId: refs.itemTypeId,
    baseUnitId: refs.baseUnitId,
    pointsPerUnit,
    productionMode,
    linkedRecipeId: recipeLink.linkedRecipeId,
    recipeLinkEnabled: recipeLink.recipe ? 1 : 0,
    stockTrackingEnabled: stockTrackingEnabled ? 1 : 0,
    accounting
  };
}

export async function handleProductMasterApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/master/products/editor')) return null;
  const auth = await requireManagement(request, env.DB);
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

    const next = await env.DB.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM products').first();
    const order = await env.DB.prepare('SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM products WHERE store_id = ?').bind(store.id).first();
    const id = Number(next?.next_id ?? 1);
    const statements = [
      env.DB.prepare(`
        INSERT INTO products (
          id, store_id, name, purchase_price, price, category, emoji, image_data,
          display_order, is_active, item_type_id, base_unit_id,
          points_per_unit, production_mode, recipe_link_enabled, linked_recipe_id,
          stock_tracking_enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, store.id, normalized.name, normalized.purchasePrice, normalized.price,
        normalized.category, normalized.emoji, normalized.productImage, Number(order?.next_order ?? 1),
        normalized.isActive, normalized.itemTypeId, normalized.baseUnitId,
        normalized.pointsPerUnit, normalized.productionMode, normalized.recipeLinkEnabled,
        normalized.linkedRecipeId, normalized.stockTrackingEnabled
      ),
      productAccountingRefStatement(env.DB, store.id, id, normalized.accounting)
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
    SELECT id, base_unit_id FROM products WHERE id = ? AND store_id = ?
  `).bind(productId, store.id).first();
  if (!current) return json({ error: 'Barang tidak ditemukan di gerai ini.' }, 404);

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload Master Barang tidak valid.' }, 400);
  const normalized = await normalizeEditorInput(env.DB, store.id, productId, body.value, current);
  if (!normalized.ok) return json({ error: normalized.error }, normalized.status);
  await ensureCategory(env.DB, store.id, normalized.category);

  const statements = [
    env.DB.prepare(`
      UPDATE products
      SET name = ?, purchase_price = ?, price = ?, category = ?, emoji = ?, image_data = ?,
          is_active = ?, item_type_id = ?, base_unit_id = ?, points_per_unit = ?,
          production_mode = ?, recipe_link_enabled = ?, linked_recipe_id = ?,
          stock_tracking_enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(
      normalized.name, normalized.purchasePrice, normalized.price, normalized.category,
      normalized.emoji, normalized.productImage, normalized.isActive,
      normalized.itemTypeId, normalized.baseUnitId, normalized.pointsPerUnit,
      normalized.productionMode, normalized.recipeLinkEnabled, normalized.linkedRecipeId,
      normalized.stockTrackingEnabled, productId, store.id
    ),
    productAccountingRefStatement(env.DB, store.id, productId, normalized.accounting)
  ];
  if (normalized.stockTrackingEnabled) {
    statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
      VALUES (?, ?, 0, CURRENT_TIMESTAMP)
    `).bind(store.id, productId));
  }
  await env.DB.batch(statements);
  return json({ ok: true, id: productId, editor: await editorPayload(env.DB, store) });
}
