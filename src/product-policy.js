import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';

const MODES = new Set(['STOCK', 'DADAKAN']);

function nonNegativeInteger(value, max = 1_000_000_000) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= max ? number : null;
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

function mapRow(row) {
  return {
    productId: Number(row.id),
    name: row.name,
    itemTypeId: row.item_type_id || null,
    itemTypeName: row.item_type_name || '',
    baseUnitId: row.base_unit_id || null,
    unitSymbol: row.unit_symbol || '',
    pointsPerUnit: Number(row.points_per_unit || 0),
    productionMode: row.production_mode || 'STOCK',
    recipeLinkEnabled: Boolean(row.recipe_link_enabled),
    stockTrackingEnabled: Boolean(row.stock_tracking_enabled),
    stockQuantity: row.stock_quantity == null ? null : Number(row.stock_quantity),
    activeRecipe: row.recipe_id ? {
      id: row.recipe_id,
      revision: Number(row.recipe_revision || 0),
      outputQuantity: Number(row.recipe_output_quantity || 0)
    } : null
  };
}

export async function getProductPolicies(db, storeId) {
  const rows = await db.prepare(`
    SELECT p.id, p.name, p.item_type_id, p.base_unit_id,
           p.points_per_unit, p.production_mode, p.recipe_link_enabled, p.stock_tracking_enabled,
           t.name AS item_type_name, u.symbol AS unit_symbol,
           b.quantity AS stock_quantity,
           r.id AS recipe_id, r.revision AS recipe_revision, r.output_quantity AS recipe_output_quantity
    FROM products p
    LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN inventory_stock_balances b ON b.store_id = p.store_id AND b.product_id = p.id
    LEFT JOIN manufacturing_recipes r
      ON r.store_id = p.store_id AND r.output_product_id = p.id AND r.status = 'ACTIVE'
    WHERE p.store_id = ?
    ORDER BY p.name COLLATE NOCASE, p.id
  `).bind(storeId).all();
  return (rows.results ?? []).map(mapRow);
}

async function getProductPolicy(db, storeId, productId) {
  const rows = await getProductPolicies(db, storeId);
  return rows.find(item => item.productId === productId) || null;
}

export async function handleProductPolicyApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/master/products')) return null;
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (request.method === 'GET' && pathname === '/api/admin/master/products/policies') {
    return json({ store, products: await getProductPolicies(env.DB, store.id) });
  }

  const match = pathname.match(/^\/api\/admin\/master\/products\/(\d+)\/policy$/);
  if (!match) return json({ error: 'Route product policy tidak ditemukan.' }, 404);
  const productId = Number(match[1]);

  if (request.method === 'GET') {
    const product = await getProductPolicy(env.DB, store.id, productId);
    return product ? json({ store, product }) : json({ error: 'Barang tidak ditemukan.' }, 404);
  }

  if (request.method !== 'PATCH') return json({ error: 'Method product policy tidak didukung.' }, 405);
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload product policy tidak valid.' }, 400);

  const current = await getProductPolicy(env.DB, store.id, productId);
  if (!current) return json({ error: 'Barang tidak ditemukan.' }, 404);

  const pointsPerUnit = body.value?.pointsPerUnit === undefined
    ? current.pointsPerUnit
    : nonNegativeInteger(body.value.pointsPerUnit, 10_000_000);
  if (pointsPerUnit === null) return json({ error: 'Poin per barang harus bilangan bulat nol atau positif.' }, 400);

  const productionMode = String(body.value?.productionMode ?? current.productionMode).trim().toUpperCase();
  if (!MODES.has(productionMode)) return json({ error: 'Mode produksi harus STOCK atau DADAKAN.' }, 400);
  const recipeLinkEnabled = body.value?.recipeLinkEnabled === undefined
    ? current.recipeLinkEnabled
    : Boolean(body.value.recipeLinkEnabled);
  const stockTrackingEnabled = body.value?.stockTrackingEnabled === undefined
    ? current.stockTrackingEnabled
    : Boolean(body.value.stockTrackingEnabled);

  if (productionMode === 'DADAKAN' && (!recipeLinkEnabled || !current.activeRecipe)) {
    return json({ error: 'Mode DADAKAN membutuhkan Link Resep aktif dan resep aktif untuk barang ini.' }, 409);
  }

  const statements = [
    env.DB.prepare(`
      UPDATE products
      SET points_per_unit = ?, production_mode = ?, recipe_link_enabled = ?, stock_tracking_enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(pointsPerUnit, productionMode, recipeLinkEnabled ? 1 : 0, stockTrackingEnabled ? 1 : 0, productId, store.id)
  ];
  if (stockTrackingEnabled) {
    statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
      VALUES (?, ?, 0, CURRENT_TIMESTAMP)
    `).bind(store.id, productId));
  }
  await env.DB.batch(statements);
  return json({ ok: true, product: await getProductPolicy(env.DB, store.id, productId) });
}
