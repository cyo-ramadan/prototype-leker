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

export async function handleAdminStockApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/stock')) return null;
  if (request.method !== 'GET') return json({ error: 'Stock tracking saat ini read-only dari Admin.' }, 405);
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (pathname === '/api/admin/stock') {
    const rows = await env.DB.prepare(`
      SELECT p.id, p.name, p.is_active, p.stock_tracking_enabled, p.production_mode, p.recipe_link_enabled,
             t.name AS item_type_name, COALESCE(t.track_stock, 1) AS type_track_stock,
             p.base_unit_id, u.symbol AS unit_symbol, p.average_cost,
             b.quantity, b.updated_at,
             r.id AS recipe_id, r.revision AS recipe_revision
      FROM products p
      LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
      LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
      LEFT JOIN inventory_stock_balances b ON b.store_id = p.store_id AND b.product_id = p.id
      LEFT JOIN manufacturing_recipes r
        ON r.store_id = p.store_id AND r.output_product_id = p.id AND r.status = 'ACTIVE'
      WHERE p.store_id = ?
      ORDER BY p.name COLLATE NOCASE, p.id
    `).bind(store.id).all();
    return json({
      store,
      stocks: (rows.results ?? []).map(row => ({
        productId: Number(row.id),
        productName: row.name,
        isActive: Boolean(row.is_active),
        itemTypeName: row.item_type_name || '',
        unitId: row.base_unit_id || null,
        unitSymbol: row.unit_symbol || '',
        stockTrackingEnabled: Boolean(row.stock_tracking_enabled) && Boolean(row.type_track_stock),
        quantity: row.quantity == null ? null : Number(row.quantity),
        averageCostScaled: Number(row.average_cost || 0),
        updatedAt: row.updated_at || null,
        productionMode: row.production_mode || 'STOCK',
        recipeLinkEnabled: Boolean(row.recipe_link_enabled),
        activeRecipe: row.recipe_id ? { id: row.recipe_id, revision: Number(row.recipe_revision || 0) } : null
      }))
    });
  }

  const costHistoryMatch = pathname.match(/^\/api\/admin\/stock\/(\d+)\/cost-history$/);
  if (costHistoryMatch) {
    const productId = Number(costHistoryMatch[1]);
    const url = new URL(request.url);
    const from = String(url.searchParams.get('from') || '').trim();
    const to = String(url.searchParams.get('to') || '').trim();
    if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to)) {
      return json({ error: 'Filter tanggal Histori HPP tidak valid.' }, 400);
    }
    const requestedLimit = Number(url.searchParams.get('limit') || 5);
    const limit = Number.isInteger(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 5;
    const product = await env.DB.prepare(`
      SELECT id, name, average_cost
      FROM products
      WHERE store_id = ? AND id = ?
      LIMIT 1
    `).bind(store.id, productId).first();
    if (!product) return json({ error: 'Barang tidak ditemukan.' }, 404);
    const rows = await env.DB.prepare(`
      SELECT id, previous_average_cost_scaled, new_average_cost_scaled,
             change_reason, reference_type, reference_id, created_at
      FROM product_average_cost_history
      WHERE store_id = ? AND product_id = ?
        AND (? = '' OR substr(created_at, 1, 10) >= ?)
        AND (? = '' OR substr(created_at, 1, 10) <= ?)
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).bind(store.id, productId, from, from, to, to, limit).all();
    return json({
      product: {
        productId: Number(product.id),
        productName: product.name,
        averageCostScaled: Number(product.average_cost || 0)
      },
      history: (rows.results || []).map(row => ({
        id: row.id,
        previousAverageCostScaled: Number(row.previous_average_cost_scaled),
        newAverageCostScaled: Number(row.new_average_cost_scaled),
        changeReason: row.change_reason,
        referenceType: row.reference_type,
        referenceId: row.reference_id,
        createdAt: row.created_at
      }))
    });
  }

  const match = pathname.match(/^\/api\/admin\/stock\/(\d+)\/movements$/);
  if (!match) return json({ error: 'Route stock tidak ditemukan.' }, 404);
  const productId = Number(match[1]);
  const url = new URL(request.url);
  const before = parseCursor(url.searchParams.get('before'));
  if (url.searchParams.get('before') && !before) return json({ error: 'Cursor mutasi stok tidak valid.' }, 400);
  const requestedLimit = Number(url.searchParams.get('limit') || 50);
  const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(10, requestedLimit)) : 50;

  const product = await env.DB.prepare(`
    SELECT p.id, p.name, p.stock_tracking_enabled, p.base_unit_id, p.average_cost,
           u.symbol AS unit_symbol, b.quantity, b.updated_at
    FROM products p
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN inventory_stock_balances b ON b.store_id = p.store_id AND b.product_id = p.id
    WHERE p.store_id = ? AND p.id = ?
    LIMIT 1
  `).bind(store.id, productId).first();
  if (!product) return json({ error: 'Barang tidak ditemukan.' }, 404);

  const rows = await env.DB.prepare(`
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
    store.id, productId,
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
  return json({
    store,
    product: {
      productId: Number(product.id),
      productName: product.name,
      unitId: product.base_unit_id || null,
      unitSymbol: product.unit_symbol || '',
      stockTrackingEnabled: Boolean(product.stock_tracking_enabled),
      quantity: product.quantity == null ? null : Number(product.quantity),
      averageCostScaled: Number(product.average_cost || 0),
      updatedAt: product.updated_at || null
    },
    movements: visible,
    hasMore,
    nextCursor: hasMore && last ? `${last.occurredAt}|${last.id}` : null
  });
}
