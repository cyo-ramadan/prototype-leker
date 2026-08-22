import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';

const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const flag = value => value === false ? 0 : 1;

function codeText(value, max = 40) {
  return text(value, max)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

async function managementContext(request, env) {
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth;
  const store = await selectedStore(env.DB, request);
  if (!store) return { ok: false, response: json({ error: 'Gerai tidak ditemukan.' }, 404) };
  return { ok: true, auth, store };
}

async function activeAccount(db, storeId, accountId) {
  return db.prepare(`SELECT id FROM chart_of_accounts WHERE id = ? AND store_id = ? AND is_active = 1`)
    .bind(accountId, storeId).first();
}

export async function savePaymentMethod(db, store, body, id = null) {
  const current = id ? await db.prepare(`SELECT * FROM payment_methods WHERE id = ? AND store_id = ?`).bind(id, store.id).first() : null;
  if (id && !current) return json({ error: 'Metode pembayaran tidak ditemukan.' }, 404);
  const code = current?.code || codeText(body?.code || body?.name, 32).toUpperCase();
  const name = text(body?.name ?? current?.name, 80);
  const accountId = body?.accountId === undefined ? (current?.account_id || null) : (text(body.accountId, 180) || null);
  const isActive = body?.isActive === undefined ? Number(current?.is_active ?? 1) : flag(body.isActive);
  const isDefault = body?.isDefault === undefined ? Number(current?.is_default ?? 0) : flag(body.isDefault);
  if (!code || !name) return json({ error: 'Kode dan nama metode pembayaran wajib valid.' }, 400);
  if (accountId && !await activeAccount(db, store.id, accountId)) return json({ error: 'Akun metode pembayaran harus akun aktif di gerai ini.' }, 400);
  if (isDefault && !isActive) return json({ error: 'Cara bayar default harus aktif.' }, 400);
  if (current?.is_default && !isDefault) return json({ error: 'Pilih cara bayar lain sebagai default sebelum melepas default ini.' }, 400);
  if (isDefault) {
    await db.prepare(`UPDATE payment_methods SET is_default = 0, updated_at = CURRENT_TIMESTAMP WHERE store_id = ? AND id <> ?`).bind(store.id, id || '').run();
  }
  if (current) {
    await db.prepare(`UPDATE payment_methods SET name = ?, account_id = ?, is_active = ?, is_default = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?`)
      .bind(name, accountId, isActive, isDefault, id, store.id).run();
    return json({ ok: true });
  }
  const nextId = `payment_${store.id}_${crypto.randomUUID()}`;
  try {
    await db.prepare(`INSERT INTO payment_methods (id, store_id, code, name, account_id, is_active, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(nextId, store.id, code, name, accountId, isActive, isDefault).run();
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Kode/nama metode pembayaran sudah dipakai.' }, 409);
    throw error;
  }
  return json({ ok: true, id: nextId }, 201);
}

export async function handleBusinessSettingsApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/settings/business')) return null;
  const ctx = await managementContext(request, env);
  if (!ctx.ok) return ctx.response;

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload Business Settings tidak valid.' }, 400);

  if (request.method === 'POST' && pathname === '/api/admin/settings/business/payment-methods') {
    return savePaymentMethod(env.DB, ctx.store, body.value);
  }
  const paymentMatch = pathname.match(/^\/api\/admin\/settings\/business\/payment-methods\/([^/]+)$/);
  if (request.method === 'PATCH' && paymentMatch) {
    return savePaymentMethod(env.DB, ctx.store, body.value, decodeURIComponent(paymentMatch[1]));
  }
  return json({ error: 'Route Business Settings tidak ditemukan.' }, 404);
}
