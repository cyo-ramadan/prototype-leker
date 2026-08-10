import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';

const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);

function mapSupplier(row) {
  return row ? {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}

async function selectedStore(db, request) {
  const url = new URL(request.url);
  return resolveStore(db, url.searchParams.get('store') || DEFAULT_STORE_CODE, { includeInactive: true });
}

export async function handleSupplierApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/suppliers')) return null;
  const db = env.DB;
  const auth = await requireManagement(request, db);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (request.method === 'GET' && pathname === '/api/admin/suppliers') {
    const rows = await db.prepare(`
      SELECT id, name, phone, address, notes, is_active, created_at, updated_at
      FROM suppliers
      WHERE store_id = ?
      ORDER BY is_active DESC, name COLLATE NOCASE
    `).bind(store.id).all();
    return json({ store, suppliers: (rows.results ?? []).map(mapSupplier) });
  }

  if (request.method === 'POST' && pathname === '/api/admin/suppliers') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload supplier tidak valid.' }, 400);
    const name = text(body.value?.name, 100);
    const phone = text(body.value?.phone, 40);
    const address = text(body.value?.address, 180);
    const notes = text(body.value?.notes, 500);
    if (!name) return json({ error: 'Nama supplier wajib diisi.' }, 400);
    const duplicate = await db.prepare('SELECT id FROM suppliers WHERE store_id = ? AND name = ? COLLATE NOCASE').bind(store.id, name).first();
    if (duplicate) return json({ error: 'Supplier dengan nama tersebut sudah ada di gerai ini.' }, 409);
    const id = `supplier_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO suppliers (id, store_id, name, phone, address, notes, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(id, store.id, name, phone, address, notes).run();
    return json({ ok: true, id }, 201);
  }

  const match = pathname.match(/^\/api\/admin\/suppliers\/([^/]+)$/);
  if (!match) return json({ error: 'Route supplier tidak ditemukan.' }, 404);
  const id = decodeURIComponent(match[1]);
  const current = await db.prepare(`
    SELECT id, name, phone, address, notes, is_active, created_at, updated_at
    FROM suppliers WHERE id = ? AND store_id = ?
  `).bind(id, store.id).first();
  if (!current) return json({ error: 'Supplier tidak ditemukan di gerai ini.' }, 404);

  if (request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload supplier tidak valid.' }, 400);
    const name = text(body.value?.name ?? current.name, 100);
    const phone = text(body.value?.phone ?? current.phone, 40);
    const address = text(body.value?.address ?? current.address, 180);
    const notes = text(body.value?.notes ?? current.notes, 500);
    const isActive = body.value?.isActive === false ? 0 : 1;
    if (!name) return json({ error: 'Nama supplier wajib diisi.' }, 400);
    const duplicate = await db.prepare('SELECT id FROM suppliers WHERE store_id = ? AND name = ? COLLATE NOCASE AND id <> ?').bind(store.id, name, id).first();
    if (duplicate) return json({ error: 'Nama supplier sudah dipakai di gerai ini.' }, 409);
    await db.prepare(`
      UPDATE suppliers
      SET name = ?, phone = ?, address = ?, notes = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(name, phone, address, notes, isActive, id, store.id).run();
    return json({ ok: true });
  }

  if (request.method === 'DELETE') {
    await db.prepare(`
      UPDATE suppliers SET is_active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(id, store.id).run();
    return json({ ok: true });
  }

  return json({ error: 'Method supplier tidak didukung.' }, 405);
}
