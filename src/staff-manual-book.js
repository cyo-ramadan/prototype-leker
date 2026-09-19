import { json, readJson } from './http.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { requireManagement } from './owner-auth.js';
import { requireCashier } from './cashier-auth.js';

// Bos Cyo, 2026-09-19: "tambahkan juga di portal staff tombol manual book"
// -- halaman baru, Admin isi sendiri. Lingkup dua lapis (dikonfirmasi lewat
// tanya balik Hana): "diisi dari entity saja untuk info entity, tapi admin
// store tetap bisa nambahin untuk info khusus store itu." entity_manual_book
// (satu per entity, cuma Owner/Entity Admin yang boleh isi) + store_manual_book
// (satu per gerai, siapa pun requireManagement gerai itu boleh isi) --
// migration 0107. Bukan data akuntansi -- satu baris aktif ditimpa saat
// diedit, bukan histori/immutable.
const text = (value, max = 20000) => String(value ?? '').trim().slice(0, max);

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

function actorLabel(auth) {
  return auth.owner?.displayName || auth.entityAdmin?.displayName || auth.admin?.displayName || 'Admin';
}

async function loadEntityContent(db, entityId) {
  const row = await db.prepare('SELECT content, updated_at FROM entity_manual_book WHERE entity_id = ?').bind(entityId).first();
  return row || { content: '', updated_at: null };
}

async function loadStoreContent(db, storeId) {
  const row = await db.prepare('SELECT content, updated_at FROM store_manual_book WHERE store_id = ?').bind(storeId).first();
  return row || { content: '', updated_at: null };
}

export async function handleStaffManualBookApi(request, env, pathname) {
  const db = env.DB;

  // Portal Staf -- baca saja, gabungan entity + store.
  if (request.method === 'GET' && pathname === '/api/staff/manual-book') {
    const auth = await requireCashier(request, db);
    if (!auth.ok) return auth.response;
    const store = await resolveStore(db, auth.cashier.store.code, { includeInactive: true });
    const [entity, storeContent] = await Promise.all([
      store?.entityId ? loadEntityContent(db, store.entityId) : { content: '', updated_at: null },
      loadStoreContent(db, auth.cashier.store.id)
    ]);
    return json({
      entityContent: entity.content || '',
      storeContent: storeContent.content || ''
    });
  }

  if (!pathname.startsWith('/api/admin/manual-book')) return null;

  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const entityWide = auth.authType === 'OWNER' || auth.authType === 'ENTITY_ADMIN';

  if (request.method === 'GET' && pathname === '/api/admin/manual-book') {
    const [entity, storeContent] = await Promise.all([
      store.entityId ? loadEntityContent(db, store.entityId) : { content: '', updated_at: null },
      loadStoreContent(db, store.id)
    ]);
    return json({
      entityContent: entity.content || '',
      entityUpdatedAt: entity.updated_at,
      storeContent: storeContent.content || '',
      storeUpdatedAt: storeContent.updated_at,
      canEditEntity: entityWide && Boolean(store.entityId)
    });
  }

  if (request.method === 'PATCH' && pathname === '/api/admin/manual-book/entity') {
    if (!entityWide) return json({ error: 'Cuma Owner atau Entity Admin yang boleh mengubah Manual Book tingkat Entity.', code: 'ENTITY_LEVEL_ONLY' }, 403);
    if (!store.entityId) return json({ error: 'Gerai ini belum terhubung ke Entity mana pun.' }, 400);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
    const content = text(body.value?.content);
    await db.prepare(`
      INSERT INTO entity_manual_book (entity_id, content, updated_by, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (entity_id) DO UPDATE SET content = excluded.content, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
    `).bind(store.entityId, content, actorLabel(auth)).run();
    return json({ ok: true });
  }

  if (request.method === 'PATCH' && pathname === '/api/admin/manual-book/store') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
    const content = text(body.value?.content);
    await db.prepare(`
      INSERT INTO store_manual_book (store_id, content, updated_by, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (store_id) DO UPDATE SET content = excluded.content, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
    `).bind(store.id, content, actorLabel(auth)).run();
    return json({ ok: true });
  }

  return json({ error: 'Route Manual Book tidak ditemukan.' }, 404);
}
