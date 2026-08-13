import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';

const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const codeText = value => text(value, 32)
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function listProductKinds(db, storeId) {
  const rows = await db.prepare(`
    SELECT id, code, name, is_active, created_at, updated_at
    FROM product_kinds
    WHERE store_id = ?
    ORDER BY is_active DESC, name COLLATE NOCASE, code
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function resolveProductKind(db, storeId, productKindId, { allowInactive = false } = {}) {
  const id = String(productKindId || '').trim();
  if (!id) return { ok: true, productKindId: null };
  const row = await db.prepare(`
    SELECT id, is_active FROM product_kinds WHERE id = ? AND store_id = ? LIMIT 1
  `).bind(id, storeId).first();
  if (!row) return { ok: false, error: 'Jenis Barang tidak ditemukan di gerai ini.' };
  if (!allowInactive && !row.is_active) return { ok: false, error: 'Jenis Barang sudah nonaktif.' };
  return { ok: true, productKindId: row.id };
}

export async function handleProductKindApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/master/product-kinds')) return null;
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (request.method === 'GET' && pathname === '/api/admin/master/product-kinds') {
    return json({ store, productKinds: await listProductKinds(env.DB, store.id) });
  }

  if (request.method === 'POST' && pathname === '/api/admin/master/product-kinds') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload Jenis Barang tidak valid.' }, 400);
    const code = codeText(body.value?.code);
    const name = text(body.value?.name, 80);
    if (!code || !name) return json({ error: 'Kode dan nama Jenis Barang wajib diisi.' }, 400);
    const id = `product_kind_${crypto.randomUUID()}`;
    try {
      await env.DB.prepare(`
        INSERT INTO product_kinds (id, store_id, code, name, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(id, store.id, code, name).run();
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Kode atau nama Jenis Barang sudah dipakai.' }, 409);
      throw error;
    }
    return json({ ok: true, id, productKinds: await listProductKinds(env.DB, store.id) }, 201);
  }

  const match = pathname.match(/^\/api\/admin\/master\/product-kinds\/([^/]+)$/);
  if (!match) return json({ error: 'Route Jenis Barang tidak ditemukan.' }, 404);
  if (request.method !== 'PATCH') return json({ error: 'Method Jenis Barang tidak didukung.' }, 405);

  const id = decodeURIComponent(match[1]);
  const current = await env.DB.prepare(`
    SELECT id FROM product_kinds WHERE id = ? AND store_id = ?
  `).bind(id, store.id).first();
  if (!current) return json({ error: 'Jenis Barang tidak ditemukan.' }, 404);
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload Jenis Barang tidak valid.' }, 400);
  const name = text(body.value?.name, 80);
  if (!name) return json({ error: 'Nama Jenis Barang wajib diisi.' }, 400);
  try {
    await env.DB.prepare(`
      UPDATE product_kinds
      SET name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(name, body.value?.isActive === false ? 0 : 1, id, store.id).run();
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Nama Jenis Barang sudah dipakai.' }, 409);
    throw error;
  }
  return json({ ok: true, productKinds: await listProductKinds(env.DB, store.id) });
}
