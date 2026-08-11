import { json, readJson } from './http.js';
import { requireOwner } from './owner-auth.js';
import { listStores } from './stores.js';

const text = (value, max = 100) => String(value ?? '').trim().slice(0, max);
const placeholders = count => Array.from({ length: count }, () => '?').join(', ');

export async function resolveCustomerScope(db, storeId) {
  const membership = await db.prepare(`
    SELECT g.id, g.name
    FROM customer_share_group_stores m
    JOIN customer_share_groups g ON g.id = m.group_id
    WHERE m.store_id = ? AND g.is_active = 1
    LIMIT 1
  `).bind(storeId).first();

  if (!membership) return { group: null, storeIds: [storeId], stores: [] };

  const rows = await db.prepare(`
    SELECT s.id, s.code, s.store_name
    FROM customer_share_group_stores m
    JOIN stores s ON s.id = m.store_id
    WHERE m.group_id = ? AND s.is_active = 1
    ORDER BY s.code
  `).bind(membership.id).all();
  const stores = rows.results ?? [];
  const storeIds = stores.map(store => store.id);
  return {
    group: { id: membership.id, name: membership.name },
    storeIds: storeIds.length ? storeIds : [storeId],
    stores: stores.map(store => ({ id: store.id, code: store.code, storeName: store.store_name }))
  };
}

async function listGroups(db) {
  const groupsResult = await db.prepare(`
    SELECT id, name, is_active, created_at, updated_at
    FROM customer_share_groups
    ORDER BY name COLLATE NOCASE, created_at
  `).all();
  const groups = [];
  for (const row of groupsResult.results ?? []) {
    const members = await db.prepare(`
      SELECT s.id, s.code, s.store_name, s.is_active
      FROM customer_share_group_stores m
      JOIN stores s ON s.id = m.store_id
      WHERE m.group_id = ?
      ORDER BY s.code
    `).bind(row.id).all();
    groups.push({
      id: row.id,
      name: row.name,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      stores: (members.results ?? []).map(store => ({
        id: store.id,
        code: store.code,
        storeName: store.store_name,
        isActive: Boolean(store.is_active)
      }))
    });
  }
  return groups;
}

async function validateMembershipSet(db, storeIds, currentGroupId = null) {
  const uniqueStoreIds = [...new Set((storeIds ?? []).map(value => String(value || '').trim()).filter(Boolean))];
  if (!uniqueStoreIds.length) return { ok: false, error: 'Pilih minimal satu gerai untuk grup berbagi pelanggan.' };

  const stores = await db.prepare(`
    SELECT id, code, store_name
    FROM stores
    WHERE id IN (${placeholders(uniqueStoreIds.length)})
  `).bind(...uniqueStoreIds).all();
  if ((stores.results ?? []).length !== uniqueStoreIds.length) {
    return { ok: false, error: 'Ada gerai yang tidak ditemukan.' };
  }

  const memberships = await db.prepare(`
    SELECT m.store_id, m.group_id, g.name AS group_name
    FROM customer_share_group_stores m
    JOIN customer_share_groups g ON g.id = m.group_id
    WHERE m.store_id IN (${placeholders(uniqueStoreIds.length)})
      ${currentGroupId ? 'AND m.group_id <> ?' : ''}
    LIMIT 1
  `);
  const membership = currentGroupId
    ? await memberships.bind(...uniqueStoreIds, currentGroupId).first()
    : await memberships.bind(...uniqueStoreIds).first();
  if (membership) {
    const store = (stores.results ?? []).find(item => item.id === membership.store_id);
    return { ok: false, error: `Gerai ${store?.code || membership.store_id} sudah tergabung di grup ${membership.group_name}.` };
  }

  if (uniqueStoreIds.length > 1) {
    const duplicate = await db.prepare(`
      SELECT LOWER(username) AS username_key, COUNT(*) AS account_count
      FROM customers
      WHERE store_id IN (${placeholders(uniqueStoreIds.length)})
        AND username IS NOT NULL AND TRIM(username) <> ''
      GROUP BY LOWER(username)
      HAVING COUNT(*) > 1
      LIMIT 1
    `).bind(...uniqueStoreIds).first();
    if (duplicate) {
      return {
        ok: false,
        error: `Tidak bisa mengaktifkan sharing: username pelanggan @${duplicate.username_key} bentrok antar gerai. Rapikan username dulu.`
      };
    }
  }

  return { ok: true, storeIds: uniqueStoreIds };
}

export async function handleOwnerCustomerSharingApi(request, env, pathname) {
  if (!pathname.startsWith('/api/owner/customer-sharing')) return null;
  const auth = await requireOwner(request, env.DB);
  if (!auth.ok) return auth.response;

  if (request.method === 'GET' && pathname === '/api/owner/customer-sharing') {
    const [stores, groups] = await Promise.all([
      listStores(env.DB, { includeInactive: true }),
      listGroups(env.DB)
    ]);
    return json({ owner: auth.owner, stores, groups });
  }

  if (request.method === 'POST' && pathname === '/api/owner/customer-sharing/groups') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload berbagi pelanggan tidak valid.' }, 400);
    const name = text(body.value?.name, 80);
    if (!name) return json({ error: 'Nama grup sharing wajib diisi.' }, 400);
    const validation = await validateMembershipSet(env.DB, body.value?.storeIds);
    if (!validation.ok) return json({ error: validation.error }, 409);

    const id = `customer_share_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const statements = [
      env.DB.prepare(`
        INSERT INTO customer_share_groups (id, name, is_active, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?)
      `).bind(id, name, now, now),
      ...validation.storeIds.map(storeId => env.DB.prepare(`
        INSERT INTO customer_share_group_stores (group_id, store_id, created_at)
        VALUES (?, ?, ?)
      `).bind(id, storeId, now))
    ];
    await env.DB.batch(statements);
    return json({ ok: true, id, groups: await listGroups(env.DB) }, 201);
  }

  const match = pathname.match(/^\/api\/owner\/customer-sharing\/groups\/([^/]+)$/);
  if (!match) return json({ error: 'Route berbagi pelanggan tidak ditemukan.' }, 404);
  const groupId = decodeURIComponent(match[1]);
  const current = await env.DB.prepare('SELECT id, name, is_active FROM customer_share_groups WHERE id = ?').bind(groupId).first();
  if (!current) return json({ error: 'Grup berbagi pelanggan tidak ditemukan.' }, 404);

  if (request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload berbagi pelanggan tidak valid.' }, 400);
    const name = text(body.value?.name ?? current.name, 80);
    const validation = await validateMembershipSet(env.DB, body.value?.storeIds, groupId);
    if (!validation.ok) return json({ error: validation.error }, 409);
    const now = new Date().toISOString();
    const statements = [
      env.DB.prepare('UPDATE customer_share_groups SET name = ?, is_active = 1, updated_at = ? WHERE id = ?').bind(name, now, groupId),
      env.DB.prepare('DELETE FROM customer_share_group_stores WHERE group_id = ?').bind(groupId),
      ...validation.storeIds.map(storeId => env.DB.prepare(`
        INSERT INTO customer_share_group_stores (group_id, store_id, created_at)
        VALUES (?, ?, ?)
      `).bind(groupId, storeId, now))
    ];
    await env.DB.batch(statements);
    return json({ ok: true, groups: await listGroups(env.DB) });
  }

  if (request.method === 'DELETE') {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM customer_share_group_stores WHERE group_id = ?').bind(groupId),
      env.DB.prepare('UPDATE customer_share_groups SET is_active = 0, updated_at = ? WHERE id = ?').bind(now, groupId)
    ]);
    return json({ ok: true, groups: await listGroups(env.DB) });
  }

  return json({ error: 'Method berbagi pelanggan tidak didukung.' }, 405);
}
