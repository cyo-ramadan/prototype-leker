import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';

const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);

function normalizeProductIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = value.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0);
  return [...new Set(ids)];
}

export async function listProductGroups(db, storeId) {
  const rows = await db.prepare(`
    SELECT g.id, g.name, g.created_at, COUNT(i.product_id) AS item_count
    FROM product_groups g
    LEFT JOIN product_group_items i ON i.product_group_id = g.id
    WHERE g.store_id = ?
    GROUP BY g.id
    ORDER BY g.name COLLATE NOCASE
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    name: row.name,
    itemCount: Number(row.item_count || 0),
    createdAt: row.created_at
  }));
}

export async function getProductGroupItems(db, storeId, groupId) {
  const group = await db.prepare(`
    SELECT id, name FROM product_groups WHERE id = ? AND store_id = ? LIMIT 1
  `).bind(groupId, storeId).first();
  if (!group) return { ok: false, error: 'Group barang tidak ditemukan.' };

  const rows = await db.prepare(`
    SELECT i.product_id, p.name AS product_name
    FROM product_group_items i
    JOIN products p ON p.id = i.product_id AND p.store_id = ?
    WHERE i.product_group_id = ?
    ORDER BY i.sort_order, p.name COLLATE NOCASE
  `).bind(storeId, groupId).all();

  return {
    ok: true,
    group: { id: group.id, name: group.name },
    items: (rows.results ?? []).map(row => ({ productId: Number(row.product_id), productName: row.product_name }))
  };
}

export async function handleProductGroupsApi(request, env, pathname) {
  if (!pathname.startsWith('/api/cashier/product-groups')) return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const storeId = auth.cashier.store.id;
  const db = env.DB;

  if (request.method === 'GET' && pathname === '/api/cashier/product-groups') {
    return json({ groups: await listProductGroups(db, storeId) });
  }

  if (request.method === 'POST' && pathname === '/api/cashier/product-groups') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload group barang tidak valid.' }, 400);
    const name = text(body.value?.name, 80);
    const productIds = normalizeProductIds(body.value?.productIds);
    if (!name) return json({ error: 'Nama group wajib diisi.' }, 400);
    if (!productIds.length) return json({ error: 'Pilih minimal 1 barang untuk group ini.' }, 400);

    const placeholders = productIds.map(() => '?').join(',');
    const owned = await db.prepare(`
      SELECT COUNT(*) AS n FROM products WHERE store_id = ? AND id IN (${placeholders})
    `).bind(storeId, ...productIds).first();
    if (Number(owned?.n || 0) !== productIds.length) {
      return json({ error: 'Ada barang yang tidak ditemukan di gerai ini.' }, 400);
    }

    const groupId = `product_group_${crypto.randomUUID()}`;
    const statements = [
      db.prepare(`
        INSERT INTO product_groups (id, store_id, name, created_by_role, created_by_id, created_at)
        VALUES (?, ?, ?, 'CASHIER', ?, CURRENT_TIMESTAMP)
      `).bind(groupId, storeId, name, auth.cashier.id),
      ...productIds.map((productId, index) => db.prepare(`
        INSERT INTO product_group_items (product_group_id, product_id, sort_order) VALUES (?, ?, ?)
      `).bind(groupId, productId, index))
    ];
    try {
      await db.batch(statements);
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Nama group sudah dipakai.' }, 409);
      throw error;
    }
    return json({ ok: true, id: groupId, groups: await listProductGroups(db, storeId) }, 201);
  }

  const match = pathname.match(/^\/api\/cashier\/product-groups\/([^/]+)$/);
  if (!match) return json({ error: 'Route group barang tidak ditemukan.' }, 404);
  if (request.method !== 'GET') return json({ error: 'Method group barang tidak didukung.' }, 405);

  const detail = await getProductGroupItems(db, storeId, decodeURIComponent(match[1]));
  if (!detail.ok) return json({ error: detail.error }, 404);
  return json({ group: detail.group, items: detail.items });
}
