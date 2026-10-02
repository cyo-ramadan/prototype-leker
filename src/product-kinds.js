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

// Barang tanpa Jenis Barang bikin penjualan/pembeliannya nyangkut
// NEEDS_PRODUCT_KIND di Akuntansi (ADR-046). Kalau admin tidak memilih,
// pakai Jenis Barang yang kodenya sama dengan Tipe Barang, lalu Bahan Baku.
export async function defaultProductKindForItemType(db, storeId, itemTypeId) {
  const row = await db.prepare(`
    SELECT COALESCE(
      (SELECT k.id FROM product_kinds k JOIN item_types t ON t.id = ? AND t.store_id = k.store_id
       WHERE k.store_id = ? AND k.code = t.code AND k.is_active = 1 ORDER BY k.id LIMIT 1),
      (SELECT k.id FROM product_kinds k
       WHERE k.store_id = ? AND k.code = 'RAW_MATERIAL' AND k.is_active = 1 ORDER BY k.id LIMIT 1)
    ) AS id
  `).bind(itemTypeId || '', storeId, storeId).first();
  return row?.id || null;
}

// Akun bawaan seragam (migration 0124 / ADR-046): Persediaan 1301, HPP 5101,
// Penjualan 4101. Jenis Barang baru di gerai Akuntansi langsung dapat Item
// Category dengan akun-akun ini, jadi barang barunya tidak pernah nyangkut
// "Jenis Barang belum dilink ke akun". Mengubahnya tetap lewat Setting
// Akuntansi -- ini hanya default awal (Bos Cyo, 2026-10-02).
const DEFAULT_KIND_ACCOUNT_CODES = Object.freeze({ inventory: '1301', cogs: '5101', revenue: '4101' });

export async function ensureItemCategoryForKind(db, storeId, productKindId) {
  if (!productKindId) return { created: false, reason: 'NO_KIND' };
  const store = await db.prepare('SELECT edition FROM stores WHERE id = ? LIMIT 1').bind(storeId).first();
  if (store?.edition !== 'ACCOUNTING') return { created: false, reason: 'NOT_ACCOUNTING_STORE' };
  const existing = await db.prepare('SELECT id FROM item_categories WHERE store_id = ? AND product_kind_id = ? LIMIT 1').bind(storeId, productKindId).first();
  if (existing) return { created: false, reason: 'EXISTS' };
  const kind = await db.prepare('SELECT id, name FROM product_kinds WHERE id = ? AND store_id = ? LIMIT 1').bind(productKindId, storeId).first();
  if (!kind) return { created: false, reason: 'KIND_NOT_FOUND' };
  const accounts = await db.prepare(`
    SELECT id, code FROM chart_of_accounts
    WHERE store_id = ? AND is_active = 1 AND code IN (?, ?, ?)
  `).bind(storeId, DEFAULT_KIND_ACCOUNT_CODES.inventory, DEFAULT_KIND_ACCOUNT_CODES.cogs, DEFAULT_KIND_ACCOUNT_CODES.revenue).all();
  const byCode = new Map((accounts.results ?? []).map(row => [row.code, row.id]));
  const inventory = byCode.get(DEFAULT_KIND_ACCOUNT_CODES.inventory);
  const cogs = byCode.get(DEFAULT_KIND_ACCOUNT_CODES.cogs);
  if (!inventory || !cogs) return { created: false, reason: 'DEFAULT_ACCOUNTS_MISSING' };
  try {
    await db.prepare(`
      INSERT INTO item_categories (id, store_id, product_kind_id, name, inventory_account_id, cogs_account_id, revenue_account_id, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).bind(`itemcat_${storeId}_${crypto.randomUUID()}`, storeId, productKindId, kind.name, inventory, cogs, byCode.get(DEFAULT_KIND_ACCOUNT_CODES.revenue) || null).run();
  } catch (error) {
    // Nama Item Category sama dengan yang lain: biarkan -- tidak boleh menggagalkan pembuatan barang.
    return { created: false, reason: 'INSERT_FAILED' };
  }
  return { created: true, reason: 'CREATED' };
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
  const auth = await requireManagement(request, env.DB, env);
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
    await ensureItemCategoryForKind(env.DB, store.id, id);
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
