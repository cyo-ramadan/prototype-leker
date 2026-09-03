import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';

function parseCursor(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const split = raw.lastIndexOf('|');
  if (split < 1) return null;
  const occurredAt = raw.slice(0, split);
  const id = raw.slice(split + 1);
  return occurredAt && id ? { occurredAt, id } : null;
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

const STOCK_BALANCE_SELECT = `
  SELECT p.id, p.name, p.is_active, p.stock_tracking_enabled, p.production_mode, p.recipe_link_enabled,
         t.name AS item_type_name, COALESCE(t.track_stock, 1) AS type_track_stock,
         p.base_unit_id, u.symbol AS unit_symbol,
         b.quantity, b.updated_at,
         r.id AS recipe_id, r.revision AS recipe_revision
  FROM products p
  LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
  LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
  LEFT JOIN inventory_stock_balances b ON b.store_id = p.store_id AND b.product_id = p.id
  LEFT JOIN manufacturing_recipes r
    ON r.store_id = p.store_id AND r.output_product_id = p.id AND r.status = 'ACTIVE'
`;

function mapStockBalanceRow(row) {
  return {
    productId: Number(row.id),
    productName: row.name,
    isActive: Boolean(row.is_active),
    itemTypeName: row.item_type_name || '',
    unitId: row.base_unit_id || null,
    unitSymbol: row.unit_symbol || '',
    stockTrackingEnabled: Boolean(row.stock_tracking_enabled) && Boolean(row.type_track_stock),
    quantity: row.quantity == null ? null : Number(row.quantity),
    updatedAt: row.updated_at || null,
    productionMode: row.production_mode || 'STOCK',
    recipeLinkEnabled: Boolean(row.recipe_link_enabled),
    activeRecipe: row.recipe_id ? { id: row.recipe_id, revision: Number(row.recipe_revision || 0) } : null
  };
}

// Shared by Admin's own Stok tab and the Kasir read-only mirror -- single
// source of truth so the two views can never drift. storeId is always
// resolved by the caller before this runs.
export async function listStoreStockBalances(db, storeId) {
  const rows = await db.prepare(`${STOCK_BALANCE_SELECT} WHERE p.store_id = ? ORDER BY p.name COLLATE NOCASE, p.id`)
    .bind(storeId).all();
  return (rows.results ?? []).map(mapStockBalanceRow);
}

// Same balance shape as listStoreStockBalances but scoped to a curated list of
// product ids (tombol Laporan > Saldo Stok > Pilih Barang / Group Barang) --
// filtering with p.id IN (...) instead of pulling every product in the store
// keeps this fast regardless of catalog size.
export async function listStoreStockBalancesForProducts(db, storeId, productIds) {
  if (!Array.isArray(productIds) || !productIds.length) return [];
  const placeholders = productIds.map(() => '?').join(',');
  const rows = await db.prepare(`
    ${STOCK_BALANCE_SELECT} WHERE p.store_id = ? AND p.id IN (${placeholders}) ORDER BY p.name COLLATE NOCASE, p.id
  `).bind(storeId, ...productIds).all();
  return (rows.results ?? []).map(mapStockBalanceRow);
}

export async function listProductStockMovements(db, storeId, productId, { before = null, limit = 50 } = {}) {
  const product = await db.prepare(`
    SELECT p.id, p.name, p.stock_tracking_enabled, p.base_unit_id,
           u.symbol AS unit_symbol, b.quantity, b.updated_at
    FROM products p
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN inventory_stock_balances b ON b.store_id = p.store_id AND b.product_id = p.id
    WHERE p.store_id = ? AND p.id = ?
    LIMIT 1
  `).bind(storeId, productId).first();
  if (!product) return { ok: false, error: 'Barang tidak ditemukan.' };

  const rows = await db.prepare(`
    SELECT id, direction, quantity, source_type, source_id, drawer_session_id,
           note, actor_role, actor_id, occurred_at
    FROM stock_movements
    WHERE store_id = ? AND product_id = ?
      AND (
        ? IS NULL OR occurred_at < ? OR (occurred_at = ? AND id < ?)
      )
    ORDER BY occurred_at DESC, id DESC
    LIMIT ?
  `).bind(
    storeId, productId,
    before?.occurredAt || null, before?.occurredAt || null, before?.occurredAt || null, before?.id || null,
    limit + 1
  ).all();
  const all = rows.results ?? [];
  const hasMore = all.length > limit;
  const visible = all.slice(0, limit).map(row => ({
    id: row.id,
    direction: row.direction,
    quantity: Number(row.quantity),
    sourceType: row.source_type,
    sourceId: row.source_id,
    drawerSessionId: row.drawer_session_id || null,
    note: row.note || '',
    actorRole: row.actor_role || '',
    actorId: row.actor_id || '',
    occurredAt: row.occurred_at
  }));
  const last = visible.at(-1);
  return {
    ok: true,
    product: {
      productId: Number(product.id),
      productName: product.name,
      unitId: product.base_unit_id || null,
      unitSymbol: product.unit_symbol || '',
      stockTrackingEnabled: Boolean(product.stock_tracking_enabled),
      quantity: product.quantity == null ? null : Number(product.quantity),
      updatedAt: product.updated_at || null
    },
    movements: visible,
    hasMore,
    nextCursor: hasMore && last ? `${last.occurredAt}|${last.id}` : null
  };
}

export { parseCursor };

export async function handleAdminStockApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/stock')) return null;
  if (request.method !== 'GET') return json({ error: 'Stock tracking saat ini read-only dari Admin.' }, 405);
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (pathname === '/api/admin/stock') {
    return json({ store, stocks: await listStoreStockBalances(env.DB, store.id) });
  }

  const match = pathname.match(/^\/api\/admin\/stock\/(\d+)\/movements$/);
  if (!match) return json({ error: 'Route stock tidak ditemukan.' }, 404);
  const productId = Number(match[1]);
  const url = new URL(request.url);
  const before = parseCursor(url.searchParams.get('before'));
  if (url.searchParams.get('before') && !before) return json({ error: 'Cursor mutasi stok tidak valid.' }, 400);
  const requestedLimit = Number(url.searchParams.get('limit') || 50);
  const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(10, requestedLimit)) : 50;

  const listing = await listProductStockMovements(env.DB, store.id, productId, { before, limit });
  if (!listing.ok) return json({ error: listing.error }, 404);
  return json({ store, product: listing.product, movements: listing.movements, hasMore: listing.hasMore, nextCursor: listing.nextCursor });
}
