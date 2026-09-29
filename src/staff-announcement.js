import { json, readJson } from './http.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { requireManagement } from './owner-auth.js';
import { requireCashier } from './cashier-auth.js';

// Bos Cyo, 2026-09-19: "tambahkan juga tombol anoncement" -- papan
// pengumuman SEARAH (Admin/Owner tulis, staf cuma baca). Lingkup "sama
// seperti manual book yang aku jelasin": entity-wide (Owner/Entity Admin,
// tampil semua gerai entity itu) DITAMBAH per-gerai (Admin Gerai, cuma
// tampil di gerainya). store_id NULL = entity-wide (migration 0108).
// Tidak ada endpoint edit isi yang sudah tayang -- salah ketik dibereskan
// dengan menonaktifkan lalu buat baru.
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const bodyText = (value, max = 5000) => String(value ?? '').trim().slice(0, max);

function mapAnnouncement(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    scope: row.store_id ? 'STORE' : 'ENTITY',
    createdBy: row.created_by,
    createdByRole: row.created_by_role,
    createdAt: row.created_at
  };
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

function actorLabel(auth) {
  return auth.owner?.displayName || auth.entityAdmin?.displayName || auth.admin?.displayName || 'Admin';
}

export async function handleStaffAnnouncementApi(request, env, pathname) {
  const db = env.DB;

  // Portal Staf -- baca saja, gabungan entity-wide + khusus gerai ini.
  if (request.method === 'GET' && pathname === '/api/staff/announcements') {
    const auth = await requireCashier(request, db);
    if (!auth.ok) return auth.response;
    const store = await resolveStore(db, auth.cashier.store.code, { includeInactive: true });
    const rows = await db.prepare(`
      SELECT id, title, body, store_id, created_by, created_by_role, created_at
      FROM announcements
      WHERE is_active = 1 AND entity_id = ? AND (store_id IS NULL OR store_id = ?)
      ORDER BY created_at DESC
      LIMIT 50
    `).bind(store?.entityId ?? '', auth.cashier.store.id).all();
    return json({ announcements: (rows.results ?? []).map(mapAnnouncement) });
  }

  if (!pathname.startsWith('/api/admin/announcements')) return null;

  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const entityWide = auth.authType === 'OWNER' || auth.authType === 'ENTITY_ADMIN';
  const createdByRole = auth.authType === 'OWNER' ? 'OWNER' : (auth.authType === 'ENTITY_ADMIN' ? 'ENTITY_ADMIN' : 'ADMIN');

  if (request.method === 'GET' && pathname === '/api/admin/announcements') {
    const rows = await db.prepare(`
      SELECT id, title, body, store_id, created_by, created_by_role, created_at, is_active
      FROM announcements
      WHERE entity_id = ? AND (store_id IS NULL OR store_id = ?)
      ORDER BY created_at DESC
      LIMIT 100
    `).bind(store.entityId ?? '', store.id).all();
    return json({
      announcements: (rows.results ?? []).map(row => ({ ...mapAnnouncement(row), isActive: Boolean(row.is_active) })),
      canPostEntityWide: entityWide && Boolean(store.entityId)
    });
  }

  if (request.method === 'POST' && pathname === '/api/admin/announcements') {
    if (!store.entityId) return json({ error: 'Gerai ini belum terhubung ke Entity mana pun.' }, 400);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
    const title = text(body.value?.title);
    const content = bodyText(body.value?.body);
    if (!title) return json({ error: 'Judul pengumuman wajib diisi.' }, 400);
    const wantsEntityWide = Boolean(body.value?.entityWide);
    if (wantsEntityWide && !entityWide) {
      return json({ error: 'Cuma Owner atau Entity Admin yang boleh bikin pengumuman berlaku semua gerai.', code: 'ENTITY_LEVEL_ONLY' }, 403);
    }
    const id = `announce_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO announcements (id, entity_id, store_id, title, body, created_by, created_by_role, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `).bind(id, store.entityId, wantsEntityWide ? null : store.id, title, content, actorLabel(auth), createdByRole).run();
    return json({ ok: true, id }, 201);
  }

  const match = pathname.match(/^\/api\/admin\/announcements\/([^/]+)$/);
  if (match && request.method === 'PATCH') {
    const id = decodeURIComponent(match[1]);
    const current = await db.prepare('SELECT id, store_id FROM announcements WHERE id = ? AND entity_id = ?').bind(id, store.entityId ?? '').first();
    if (!current) return json({ error: 'Pengumuman tidak ditemukan.' }, 404);
    if (current.store_id && current.store_id !== store.id) {
      return json({ error: 'Pengumuman ini milik gerai lain.' }, 403);
    }
    if (!current.store_id && !entityWide) {
      return json({ error: 'Cuma Owner atau Entity Admin yang boleh menonaktifkan pengumuman berlaku semua gerai.', code: 'ENTITY_LEVEL_ONLY' }, 403);
    }
    // Cuma boleh menonaktifkan -- tidak ada jalur ubah title/body yang sudah tayang.
    await db.prepare('UPDATE announcements SET is_active = 0 WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return json({ error: 'Route Pengumuman tidak ditemukan.' }, 404);
}
