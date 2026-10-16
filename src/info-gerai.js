import { json, readJson } from './http.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { requireManagement } from './owner-auth.js';
import { requireCashier } from './cashier-auth.js';
import { INFO_GERAI_KEY, getTenantPolicySetting, resolveTenantId } from './tenant-policy.js';
import { emitNotification, listNotificationActors } from './management-notifications.js';

// Info Gerai (Bos Cyo, 2026-10-16; migration 0161). Papan informasi per gerai:
// - KONTAK  : kontak darurat (pemasok es batu, plastik, tukang listrik) dengan WA/telepon/lokasi.
// - LAPORAN : masalah yang dilaporkan CS atau temuan sidak; diikuti sampai Selesai.
// - PANDUAN : "masalah -> cara mengatasi"; laporan yang diselesaikan bisa langsung jadi panduan,
//             supaya CS baru (dan nanti agen HRD) bisa mencari solusinya sendiri.
//
// Siapa boleh apa (server yang menegakkan, UI hanya menyembunyikan tombol):
// - Kasir   : melihat yang UMUM di gerainya, membuat LAPORAN (selalu UMUM), menambah catatan,
//             "saya juga lihat", dan menilai panduan. Tidak bisa mengubah status/kontak/panduan.
// - Admin Gerai : + melihat ADMIN, mengelola catatan gerainya sendiri, mengubah status laporan.
// - Entity Admin / Owner : + melihat RAHASIA, mengelola catatan "semua gerai", menandai Temuan Sidak.
// - Token agen : hanya membaca yang UMUM (bahan agen HRD/Una nanti).

const KINDS = new Set(['KONTAK', 'LAPORAN', 'PANDUAN']);
const VISIBILITY_RANK = { UMUM: 0, ADMIN: 1, RAHASIA: 2 };
const SEVERITIES = new Set(['MERAH', 'KUNING', 'HIJAU']);
const STATUSES = ['BARU', 'DILIHAT', 'DITANGANI', 'SELESAI'];
const ACTIVITY_BY_ANYONE = new Set(['CATATAN', 'SAYA_JUGA', 'MEMBANTU', 'KURANG_JELAS']);
const MAX_PHOTO_LENGTH = 400_000;

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

function parsePhoto(value) {
  if (value === undefined) return undefined;
  const dataUrl = String(value ?? '');
  if (!dataUrl) return '';
  if (dataUrl.length > MAX_PHOTO_LENGTH) return null;
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl) ? dataUrl : null;
}

// Hanya tautan http(s) yang disimpan, supaya tombol "Buka Peta" tidak bisa jadi javascript:.
function parseMapsUrl(value) {
  const raw = text(value, 500);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch { return ''; }
}

async function resolveActor(request, env) {
  const db = env.DB;
  const cashierAuth = await requireCashier(request, db);
  if (cashierAuth.ok && !cashierAuth.readOnly) {
    const cashier = cashierAuth.cashier;
    const store = await resolveStore(db, cashier.store.code, { includeInactive: true });
    if (!store?.entityId) return { error: json({ error: 'Gerai ini belum terhubung ke Entity.' }, 409) };
    return { role: 'CASHIER', id: cashier.id, name: cashier.employeeName || cashier.username || 'Kasir', store, maxVisibility: 'UMUM', canManage: false, entityWide: false };
  }
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return { error: auth.response };
  const store = await resolveStore(db, new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE, { includeInactive: true });
  if (!store) return { error: json({ error: 'Gerai tidak ditemukan.' }, 404) };
  if (!store.entityId) return { error: json({ error: 'Gerai ini belum terhubung ke Entity.' }, 409) };
  if (auth.authType === 'AGENT_TOKEN') return { role: 'AGENT', id: '', name: 'Agen', store, maxVisibility: 'UMUM', canManage: false, entityWide: false, readOnly: true };
  if (auth.owner) return { role: 'OWNER', id: auth.owner.id, name: auth.owner.displayName || 'Owner', store, maxVisibility: 'RAHASIA', canManage: true, entityWide: true };
  if (auth.entityAdmin) return { role: 'ENTITY_ADMIN', id: auth.entityAdmin.id, name: auth.entityAdmin.displayName || 'Entity Admin', store, maxVisibility: 'RAHASIA', canManage: true, entityWide: true };
  if (auth.admin) return { role: 'ADMIN', id: auth.admin.id, name: auth.admin.displayName || 'Admin Gerai', store, maxVisibility: 'ADMIN', canManage: true, entityWide: false };
  return { error: json({ error: 'Login diperlukan.' }, 401) };
}

const canSee = (actor, row) => VISIBILITY_RANK[row.visibility] <= VISIBILITY_RANK[actor.maxVisibility];
// Catatan "semua gerai" (store_id NULL) hanya dikelola Entity Admin/Owner.
const canEdit = (actor, row) => actor.canManage && (actor.entityWide || row.store_id === actor.store.id);

function mapEntry(row, activity) {
  const own = activity.filter(item => item.entryId === row.id);
  return {
    id: row.id,
    storeId: row.store_id || null,
    allStores: !row.store_id,
    kind: row.kind,
    visibility: row.visibility,
    category: row.category,
    title: row.title,
    body: row.body,
    phone: row.phone,
    mapsUrl: row.maps_url,
    openHours: row.open_hours,
    priority: Number(row.priority) || 0,
    supplierId: row.supplier_id || null,
    severity: row.severity || null,
    status: row.status || null,
    source: row.source,
    resolution: row.resolution,
    resolvedAt: row.resolved_at || null,
    resolvedByName: row.resolved_by_name,
    sourceEntryId: row.source_entry_id || null,
    hasPhoto: Boolean(row.has_photo),
    createdByName: row.created_by_name,
    createdByRole: row.created_by_role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sayaJuga: own.filter(item => item.kind === 'SAYA_JUGA').length,
    membantu: own.filter(item => item.kind === 'MEMBANTU').length,
    kurangJelas: own.filter(item => item.kind === 'KURANG_JELAS').length,
    activity: own.filter(item => item.kind === 'CATATAN' || item.kind === 'STATUS')
  };
}

const ENTRY_COLUMNS = `e.id, e.store_id, e.kind, e.visibility, e.category, e.title, e.body, e.phone, e.maps_url,
  e.open_hours, e.priority, e.supplier_id, e.severity, e.status, e.source, e.resolution, e.resolved_at,
  e.resolved_by_name, e.source_entry_id, e.created_by_role, e.created_by_name, e.created_at, e.updated_at,
  (e.photo_data IS NOT NULL AND e.photo_data != '') AS has_photo`;

async function loadEntries(db, actor) {
  const rows = (await db.prepare(`
    SELECT ${ENTRY_COLUMNS} FROM info_gerai_entries e
    WHERE e.entity_id = ? AND e.is_active = 1 AND (e.store_id IS NULL OR e.store_id = ?)
    ORDER BY e.created_at DESC
  `).bind(actor.store.entityId, actor.store.id).all()).results ?? [];
  const visible = rows.filter(row => canSee(actor, row));
  if (!visible.length) return [];
  const activity = ((await db.prepare(`
    SELECT a.id, a.entry_id, a.kind, a.body, a.actor_name, a.actor_role, a.created_at
    FROM info_gerai_activity a JOIN info_gerai_entries e ON e.id = a.entry_id
    WHERE a.entity_id = ? AND e.is_active = 1 AND (e.store_id IS NULL OR e.store_id = ?)
    ORDER BY a.created_at
  `).bind(actor.store.entityId, actor.store.id).all()).results ?? []).map(row => ({
    id: row.id, entryId: row.entry_id, kind: row.kind, body: row.body, actorName: row.actor_name, actorRole: row.actor_role, createdAt: row.created_at
  }));
  return visible.map(row => {
    const entry = mapEntry(row, activity);
    entry.canEdit = canEdit(actor, row);
    return entry;
  });
}

async function loadEntry(db, actor, id) {
  const row = await db.prepare(`
    SELECT ${ENTRY_COLUMNS}, e.entity_id, e.photo_data FROM info_gerai_entries e
    WHERE e.id = ? AND e.entity_id = ? AND e.is_active = 1 AND (e.store_id IS NULL OR e.store_id = ?)
  `).bind(id, actor.store.entityId, actor.store.id).first();
  return row && canSee(actor, row) ? row : null;
}

async function addActivity(db, actor, entryId, kind, body = '') {
  await db.prepare(`
    INSERT INTO info_gerai_activity (id, entry_id, entity_id, kind, body, actor_role, actor_id, actor_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(`igact_${crypto.randomUUID()}`, entryId, actor.store.entityId, kind, body, actor.role, actor.id, actor.name, new Date().toISOString()).run();
}

// Laporan "Mengganggu jualan" langsung masuk kotak notifikasi admin gerai itu, Entity Admin, dan
// Owner -- bukan menunggu ada yang membuka Info Gerai. Gagal kirim notifikasi tidak membatalkan laporan.
async function notifyUrgentReport(env, actor, entry) {
  try {
    const actors = await listNotificationActors(env, { entityId: actor.store.entityId, storeId: actor.store.id });
    for (const recipient of actors.filter(item => item.role !== 'CASHIER')) {
      await emitNotification(env, {
        recipientKey: recipient.key,
        entityId: actor.store.entityId,
        storeId: actor.store.id,
        dedupKey: `info-gerai:laporan:${entry.id}`,
        title: `🔴 Masalah di ${actor.store.storeName || actor.store.code}`,
        body: `${entry.title} — dilaporkan ${actor.name}. Buka Info Gerai untuk menindaklanjuti.`,
        url: recipient.role === 'ADMIN' ? `/s/${encodeURIComponent(actor.store.code)}/admin` : recipient.role === 'OWNER' ? '/admin' : '/entity-admin',
        kind: 'INFO_GERAI_URGENT'
      });
    }
  } catch (error) {
    console.error('Info Gerai: notifikasi laporan mendesak gagal', { name: error?.name });
  }
}

function forbidden(message) {
  return json({ error: message, code: 'INFO_GERAI_FORBIDDEN' }, 403);
}

async function createEntry(env, actor, value) {
  const db = env.DB;
  const kind = text(value?.kind, 20).toUpperCase();
  if (!KINDS.has(kind)) return json({ error: 'Jenis catatan tidak dikenal.' }, 400);
  if (actor.readOnly) return forbidden('Akses ini hanya untuk membaca.');
  if (!actor.canManage && kind !== 'LAPORAN') return forbidden('Kasir hanya bisa membuat laporan masalah.');

  const title = text(value?.title, 120);
  if (!title) return json({ error: kind === 'KONTAK' ? 'Nama kontak wajib diisi.' : 'Judul wajib diisi.' }, 400);
  const photo = parsePhoto(value?.photoDataUrl);
  if (photo === null) return json({ error: 'Foto tidak valid atau terlalu besar.' }, 400);

  // Kasir: laporan selalu UMUM untuk gerainya sendiri, sumber CS.
  let visibility = actor.canManage ? text(value?.visibility, 10).toUpperCase() || 'UMUM' : 'UMUM';
  if (!(visibility in VISIBILITY_RANK)) return json({ error: 'Sifat catatan tidak dikenal.' }, 400);
  if (VISIBILITY_RANK[visibility] > VISIBILITY_RANK[actor.maxVisibility]) return forbidden('Sifat Rahasia hanya untuk Entity Admin/Owner.');
  const allStores = actor.canManage && value?.allStores === true && kind !== 'LAPORAN';
  if (allStores && !actor.entityWide) return forbidden('Catatan untuk semua gerai hanya bisa dibuat Entity Admin/Owner.');
  let source = 'ADMIN';
  if (kind === 'LAPORAN') source = actor.canManage ? (value?.source === 'SIDAK' ? 'SIDAK' : 'ADMIN') : 'CS';
  if (source === 'SIDAK' && visibility === 'UMUM' && value?.visibility === undefined) visibility = 'ADMIN';
  const severity = kind === 'LAPORAN' ? (SEVERITIES.has(String(value?.severity || '').toUpperCase()) ? String(value.severity).toUpperCase() : 'KUNING') : null;

  const now = new Date().toISOString();
  const id = `info_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO info_gerai_entries (
      id, entity_id, store_id, kind, visibility, category, title, body, phone, maps_url, open_hours, priority,
      supplier_id, severity, status, source, photo_data, created_by_role, created_by_id, created_by_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, actor.store.entityId, allStores ? null : actor.store.id, kind, visibility,
    text(value?.category, 60), title, text(value?.body, 3000),
    kind === 'KONTAK' ? text(value?.phone, 40) : '', kind === 'KONTAK' ? parseMapsUrl(value?.mapsUrl) : '',
    kind === 'KONTAK' ? text(value?.openHours, 80) : '', kind === 'KONTAK' ? Math.max(0, Math.min(9, Number.parseInt(value?.priority, 10) || 0)) : 0,
    kind === 'KONTAK' ? text(value?.supplierId, 180) || null : null,
    severity, kind === 'LAPORAN' ? 'BARU' : null, source, photo || null,
    actor.role, actor.id, actor.name, now, now
  ).run();
  if (kind === 'LAPORAN' && severity === 'MERAH') await notifyUrgentReport(env, actor, { id, title });
  return json({ ok: true, id }, 201);
}

async function updateEntry(db, actor, row, value) {
  if (!canEdit(actor, row)) return forbidden('Catatan ini hanya bisa diubah admin yang berwenang.');
  const visibility = value?.visibility === undefined ? row.visibility : text(value.visibility, 10).toUpperCase();
  if (!(visibility in VISIBILITY_RANK)) return json({ error: 'Sifat catatan tidak dikenal.' }, 400);
  if (VISIBILITY_RANK[visibility] > VISIBILITY_RANK[actor.maxVisibility]) return forbidden('Sifat Rahasia hanya untuk Entity Admin/Owner.');
  const photo = parsePhoto(value?.photoDataUrl);
  if (photo === null) return json({ error: 'Foto tidak valid atau terlalu besar.' }, 400);
  const title = value?.title === undefined ? row.title : text(value.title, 120);
  if (!title) return json({ error: 'Judul wajib diisi.' }, 400);
  const severity = row.kind === 'LAPORAN' && SEVERITIES.has(String(value?.severity || '').toUpperCase()) ? String(value.severity).toUpperCase() : row.severity;
  await db.prepare(`
    UPDATE info_gerai_entries
    SET visibility = ?, category = ?, title = ?, body = ?, phone = ?, maps_url = ?, open_hours = ?, priority = ?,
        severity = ?, photo_data = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    visibility,
    value?.category === undefined ? row.category : text(value.category, 60),
    title,
    value?.body === undefined ? row.body : text(value.body, 3000),
    row.kind !== 'KONTAK' || value?.phone === undefined ? row.phone : text(value.phone, 40),
    row.kind !== 'KONTAK' || value?.mapsUrl === undefined ? row.maps_url : parseMapsUrl(value.mapsUrl),
    row.kind !== 'KONTAK' || value?.openHours === undefined ? row.open_hours : text(value.openHours, 80),
    row.kind !== 'KONTAK' || value?.priority === undefined ? row.priority : Math.max(0, Math.min(9, Number.parseInt(value.priority, 10) || 0)),
    severity,
    photo === undefined ? row.photo_data : (photo || null),
    new Date().toISOString(),
    row.id
  ).run();
  return json({ ok: true });
}

const STATUS_LABEL = { BARU: 'Baru', DILIHAT: 'Dilihat admin', DITANGANI: 'Sedang ditangani', SELESAI: 'Selesai' };

async function changeStatus(db, actor, row, value) {
  if (row.kind !== 'LAPORAN') return json({ error: 'Hanya laporan yang punya status.' }, 400);
  if (!canEdit(actor, row)) return forbidden('Status laporan hanya bisa diubah admin.');
  const status = text(value?.status, 20).toUpperCase();
  if (!STATUSES.includes(status)) return json({ error: 'Status tidak dikenal.' }, 400);
  const now = new Date().toISOString();
  if (status !== 'SELESAI') {
    await db.prepare(`UPDATE info_gerai_entries SET status = ?, resolution = '', resolved_at = NULL, resolved_by_name = '', updated_at = ? WHERE id = ?`)
      .bind(status, now, row.id).run();
    await addActivity(db, actor, row.id, 'STATUS', STATUS_LABEL[status]);
    return json({ ok: true });
  }
  // Selesai wajib menulis solusinya -- inilah yang mengubah kejadian jadi pengetahuan gerai.
  const resolution = text(value?.resolution, 3000);
  if (!resolution) return json({ error: 'Tulis solusinya dulu (apa yang dilakukan sampai beres).' }, 400);
  await db.prepare(`UPDATE info_gerai_entries SET status = 'SELESAI', resolution = ?, resolved_at = ?, resolved_by_name = ?, updated_at = ? WHERE id = ?`)
    .bind(resolution, now, actor.name, now, row.id).run();
  await addActivity(db, actor, row.id, 'STATUS', `Selesai: ${resolution}`);
  let guideId = null;
  if (value?.jadikanPanduan !== false) {
    const existing = await db.prepare(`SELECT id FROM info_gerai_entries WHERE source_entry_id = ? AND is_active = 1`).bind(row.id).first();
    guideId = existing?.id || `info_${crypto.randomUUID()}`;
    const body = [row.body ? `Masalah: ${row.body}` : '', `Cara mengatasi: ${resolution}`].filter(Boolean).join('\n\n');
    if (existing) {
      await db.prepare(`UPDATE info_gerai_entries SET body = ?, updated_at = ? WHERE id = ?`).bind(body, now, guideId).run();
    } else {
      await db.prepare(`
        INSERT INTO info_gerai_entries (id, entity_id, store_id, kind, visibility, category, title, body, source, source_entry_id,
          created_by_role, created_by_id, created_by_name, created_at, updated_at)
        VALUES (?, ?, ?, 'PANDUAN', ?, ?, ?, ?, 'ADMIN', ?, ?, ?, ?, ?, ?)
      `).bind(guideId, row.entity_id, row.store_id, row.visibility, row.category, row.title, body, row.id, actor.role, actor.id, actor.name, now, now).run();
    }
  }
  return json({ ok: true, guideId });
}

async function infoGeraiEnabled(db, store) {
  return getTenantPolicySetting(db, await resolveTenantId(db, store.entityId), INFO_GERAI_KEY);
}

export async function handleInfoGeraiApi(request, env, pathname) {
  if (pathname !== '/api/info-gerai' && !pathname.startsWith('/api/info-gerai/')) return null;
  const db = env.DB;
  const actor = await resolveActor(request, env);
  if (actor.error) return actor.error;
  const enabled = await infoGeraiEnabled(db, actor.store);

  // Ringkasan dipanggil sekali saat halaman dibuka (bukan polling) untuk tombol + angka laporan terbuka.
  if (request.method === 'GET' && pathname === '/api/info-gerai/ringkasan') {
    if (!enabled) return json({ enabled: false, stores: [] });
    const storeFilter = actor.entityWide ? '' : ' AND e.store_id = ?';
    const rows = (await db.prepare(`
      SELECT s.code AS store_code, e.visibility, e.severity, COUNT(*) AS n
      FROM info_gerai_entries e JOIN stores s ON s.id = e.store_id
      WHERE e.entity_id = ? AND e.kind = 'LAPORAN' AND e.is_active = 1 AND e.status != 'SELESAI'${storeFilter}
      GROUP BY s.code, e.visibility, e.severity
    `).bind(actor.store.entityId, ...(actor.entityWide ? [] : [actor.store.id])).all()).results ?? [];
    const byStore = new Map();
    for (const row of rows.filter(item => canSee(actor, item))) {
      const current = byStore.get(row.store_code) || { storeCode: row.store_code, open: 0, urgent: 0 };
      current.open += Number(row.n);
      if (row.severity === 'MERAH') current.urgent += Number(row.n);
      byStore.set(row.store_code, current);
    }
    return json({ enabled: true, role: actor.role, stores: [...byStore.values()] });
  }

  if (!enabled) return json({ error: 'Info Gerai tidak diaktifkan untuk usaha ini.', code: 'INFO_GERAI_DISABLED' }, 403);

  if (request.method === 'GET' && pathname === '/api/info-gerai') {
    const suppliers = actor.canManage
      ? ((await db.prepare(`SELECT id, name, phone, address FROM suppliers WHERE store_id = ? AND is_active = 1 ORDER BY name COLLATE NOCASE`).bind(actor.store.id).all()).results ?? [])
      : [];
    return json({
      store: { code: actor.store.code, storeName: actor.store.storeName },
      role: actor.role,
      canManage: actor.canManage && !actor.readOnly,
      entityWide: actor.entityWide,
      maxVisibility: actor.maxVisibility,
      entries: await loadEntries(db, actor),
      suppliers
    });
  }

  if (request.method === 'POST' && pathname === '/api/info-gerai') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Data tidak valid.' }, 400);
    return createEntry(env, actor, body.value);
  }

  const match = pathname.match(/^\/api\/info-gerai\/([^/]+)(?:\/(foto|status|aktivitas))?$/);
  if (!match) return json({ error: 'Rute Info Gerai tidak ditemukan.' }, 404);
  const row = await loadEntry(db, actor, decodeURIComponent(match[1]));
  if (!row) return json({ error: 'Catatan tidak ditemukan.' }, 404);
  const action = match[2] || '';

  if (request.method === 'GET' && action === 'foto') {
    if (!row.photo_data) return json({ error: 'Catatan ini tidak punya foto.' }, 404);
    return json({ photoDataUrl: row.photo_data });
  }
  if (actor.readOnly) return forbidden('Akses ini hanya untuk membaca.');

  if (request.method === 'POST' && action === 'aktivitas') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Data tidak valid.' }, 400);
    const kind = text(body.value?.kind, 20).toUpperCase();
    if (!ACTIVITY_BY_ANYONE.has(kind)) return json({ error: 'Jenis aktivitas tidak dikenal.' }, 400);
    if (kind === 'SAYA_JUGA' && row.kind !== 'LAPORAN') return json({ error: '"Saya juga lihat" hanya untuk laporan.' }, 400);
    if ((kind === 'MEMBANTU' || kind === 'KURANG_JELAS') && row.kind !== 'PANDUAN') return json({ error: 'Penilaian hanya untuk panduan.' }, 400);
    const note = text(body.value?.body, 1000);
    if (kind === 'CATATAN' && !note) return json({ error: 'Catatan kosong.' }, 400);
    // Satu orang cukup sekali menekan "saya juga lihat" / menilai satu panduan.
    if (kind !== 'CATATAN') {
      const dup = await db.prepare(`SELECT 1 FROM info_gerai_activity WHERE entry_id = ? AND actor_role = ? AND actor_id = ? AND kind IN ('SAYA_JUGA','MEMBANTU','KURANG_JELAS') LIMIT 1`)
        .bind(row.id, actor.role, actor.id).first();
      if (dup) return json({ error: 'Kamu sudah menandai catatan ini.', code: 'INFO_GERAI_ALREADY_MARKED' }, 409);
    }
    await addActivity(db, actor, row.id, kind, note);
    return json({ ok: true }, 201);
  }

  if (request.method === 'POST' && action === 'status') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Data tidak valid.' }, 400);
    return changeStatus(db, actor, row, body.value);
  }

  if (request.method === 'PATCH' && !action) {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Data tidak valid.' }, 400);
    return updateEntry(db, actor, row, body.value);
  }

  if (request.method === 'DELETE' && !action) {
    if (!canEdit(actor, row)) return forbidden('Catatan ini hanya bisa dihapus admin yang berwenang.');
    await db.prepare(`UPDATE info_gerai_entries SET is_active = 0, updated_at = ? WHERE id = ?`).bind(new Date().toISOString(), row.id).run();
    return json({ ok: true });
  }

  return json({ error: 'Method tidak didukung.' }, 405);
}
