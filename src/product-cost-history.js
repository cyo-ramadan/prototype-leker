import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';

const COST_SCALE = 1_000_000;
const costFromScaled = value => Number(value || 0) / COST_SCALE;

function parseCursor(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const split = raw.lastIndexOf('|');
  if (split < 1) return null;
  const createdAt = raw.slice(0, split);
  const id = raw.slice(split + 1);
  return createdAt && id ? { createdAt, id } : null;
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function handleProductCostHistoryApi(request, env, pathname) {
  const match = pathname.match(/^\/api\/admin\/products\/(\d+)\/cost-history$/);
  if (!match || request.method !== 'GET') return null;
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  const productId = Number(match[1]);
  const product = await env.DB.prepare(`
    SELECT id, name FROM products WHERE id = ? AND store_id = ? LIMIT 1
  `).bind(productId, store.id).first();
  if (!product) return json({ error: 'Barang tidak ditemukan.' }, 404);

  const url = new URL(request.url);
  const before = parseCursor(url.searchParams.get('before'));
  if (url.searchParams.get('before') && !before) return json({ error: 'Cursor histori HPP tidak valid.' }, 400);
  const requestedLimit = Number(url.searchParams.get('limit') || 50);
  const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(10, requestedLimit)) : 50;

  const rows = await env.DB.prepare(`
    SELECT id, average_cost_scaled, source_type, source_id, created_at
    FROM product_average_cost_snapshots
    WHERE store_id = ? AND product_id = ?
      AND (
        ? IS NULL OR created_at < ? OR (created_at = ? AND id < ?)
      )
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).bind(
    store.id, productId,
    before?.createdAt || null, before?.createdAt || null, before?.createdAt || null, before?.id || null,
    limit + 1
  ).all();
  const all = rows.results ?? [];
  const hasMore = all.length > limit;
  const visible = all.slice(0, limit).map(row => ({
    id: row.id,
    averageCost: costFromScaled(row.average_cost_scaled),
    sourceType: row.source_type,
    sourceId: row.source_id,
    createdAt: row.created_at
  }));
  const last = visible.at(-1);
  return json({
    store,
    product: { productId: Number(product.id), productName: product.name },
    snapshots: visible,
    nextCursor: hasMore && last ? `${last.createdAt}|${last.id}` : null
  });
}
