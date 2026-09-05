import { json, readJson } from './http.js';
import { listStores, normalizeStoreCode, resolveStore } from './stores.js';

const OWNER_SESSION_HOURS = 12;
const STORE_ADMIN_SESSION_HOURS = 12;
const DEFAULT_STORE_CODE = 'G001';
const text = (value, max = 180) => String(value ?? '').trim().slice(0, max);
const usernameText = value => text(value, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '');

export async function hashCredential(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function mapOwner(row) {
  return row ? {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isActive: Boolean(row.is_active)
  } : null;
}

function mapTenant(row) {
  return row ? { id: row.id, name: row.name, status: row.status, createdAt: row.created_at } : null;
}

function mapEntity(row) {
  return row ? {
    id: row.id,
    name: row.name,
    status: row.status,
    tenantId: row.tenant_id ?? null,
    tenantName: row.tenant_name ?? null,
    createdAt: row.created_at
  } : null;
}

async function listTenants(db) {
  const rows = await db.prepare(`SELECT id, name, status, created_at FROM tenants ORDER BY name COLLATE NOCASE`).all();
  return (rows.results ?? []).map(mapTenant);
}

// Entity's current tenant comes from the open (effective_to IS NULL) row in
// entity_tenancy, per ADR-030 -- entities never stores tenant_id directly,
// since that link moves on a customer merge and would turn the merge into a
// rewrite of ownership history.
async function listEntities(db) {
  const rows = await db.prepare(`
    SELECT e.id, e.name, e.status, e.created_at, et.tenant_id, t.name AS tenant_name
    FROM entities e
    LEFT JOIN entity_tenancy et ON et.entity_id = e.id AND et.effective_to IS NULL
    LEFT JOIN tenants t ON t.id = et.tenant_id
    ORDER BY e.name COLLATE NOCASE
  `).all();
  return (rows.results ?? []).map(mapEntity);
}

function mapStoreAdmin(row) {
  return row ? {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isActive: Boolean(row.is_active),
    store: {
      id: row.store_id,
      code: row.store_code,
      storeName: row.store_name
    }
  } : null;
}

function mapEntityAdmin(row) {
  return row ? {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isActive: Boolean(row.is_active),
    entityId: row.entity_id,
    entityName: row.entity_name ?? null
  } : null;
}

export async function ownerFromRequest(request, db) {
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = await hashCredential(token);
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT o.id, o.username, o.display_name, o.is_active
    FROM owner_sessions os
    JOIN owner_accounts o ON o.id = os.owner_id
    WHERE os.token_hash = ? AND os.expires_at > ? AND o.is_active = 1
    LIMIT 1
  `).bind(tokenHash, now).first();
  return mapOwner(row);
}

export async function storeAdminFromRequest(request, db) {
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = await hashCredential(token);
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT a.id, a.username, a.display_name, a.is_active,
           s.id AS store_id, s.code AS store_code, s.store_name, s.is_active AS store_active
    FROM store_admin_sessions ss
    JOIN store_admins a ON a.id = ss.admin_id
    JOIN stores s ON s.id = a.store_id
    WHERE ss.token_hash = ? AND ss.expires_at > ?
      AND a.is_active = 1 AND s.is_active = 1
    LIMIT 1
  `).bind(tokenHash, now).first();
  return row?.store_active ? mapStoreAdmin(row) : null;
}

export async function entityAdminFromRequest(request, db) {
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = await hashCredential(token);
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT a.id, a.username, a.display_name, a.is_active, a.entity_id,
           e.name AS entity_name, e.status AS entity_status
    FROM entity_admin_sessions es
    JOIN entity_admins a ON a.id = es.entity_admin_id
    JOIN entities e ON e.id = a.entity_id
    WHERE es.token_hash = ? AND es.expires_at > ? AND a.is_active = 1
    LIMIT 1
  `).bind(tokenHash, now).first();
  return row?.entity_status === 'ACTIVE' ? mapEntityAdmin(row) : null;
}

export async function createEntityAdminSession(db, row) {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
  const tokenHash = await hashCredential(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STORE_ADMIN_SESSION_HOURS * 60 * 60 * 1000).toISOString();
  await db.batch([
    db.prepare('DELETE FROM entity_admin_sessions WHERE expires_at <= ?').bind(now.toISOString()),
    db.prepare('INSERT INTO entity_admin_sessions (token_hash, entity_admin_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(tokenHash, row.id, now.toISOString(), expiresAt)
  ]);
  return { role: 'ENTITY_ADMIN', token, expiresAt, entityAdmin: mapEntityAdmin(row) };
}

export async function createStoreAdminSession(db, row) {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
  const tokenHash = await hashCredential(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STORE_ADMIN_SESSION_HOURS * 60 * 60 * 1000).toISOString();
  await db.batch([
    db.prepare('DELETE FROM store_admin_sessions WHERE expires_at <= ?').bind(now.toISOString()),
    db.prepare('INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(tokenHash, row.id, now.toISOString(), expiresAt)
  ]);
  const admin = mapStoreAdmin(row);
  return {
    role: 'ADMIN',
    token,
    expiresAt,
    admin,
    redirect: `/s/${encodeURIComponent(admin.store.code)}/admin`
  };
}

export async function requireOwner(request, db) {
  const owner = await ownerFromRequest(request, db);
  return owner
    ? { ok: true, owner }
    : { ok: false, response: json({ error: 'Login Owner diperlukan.', code: 'OWNER_LOGIN_REQUIRED' }, 401) };
}

function adminStoreMatchesRequest(request, admin) {
  const url = new URL(request.url);
  const requestedStore = String(url.searchParams.get('store') || DEFAULT_STORE_CODE).trim().toUpperCase();
  return requestedStore === String(admin.store.code).toUpperCase()
    || requestedStore === String(admin.store.id).toUpperCase();
}

// Entity Admin isn't pinned to one store like Store Admin is, so its scope
// check has to actually resolve whichever store the request names and
// compare entity_id -- unlike adminStoreMatchesRequest, which only ever
// compares against the one store already loaded on the admin's own session.
async function entityAdminStoreAuthorized(request, entityAdmin, db) {
  const url = new URL(request.url);
  const requestedStore = String(url.searchParams.get('store') || DEFAULT_STORE_CODE).trim();
  const store = await resolveStore(db, requestedStore, { includeInactive: true });
  if (!store) return { ok: false, response: json({ error: 'Gerai tidak ditemukan.' }, 404) };
  if (store.entityId !== entityAdmin.entityId) {
    return {
      ok: false,
      response: json({
        error: `Entity Admin ${entityAdmin.displayName} hanya berwenang pada gerai di bawah entity ${entityAdmin.entityName || entityAdmin.entityId}.`,
        code: 'ENTITY_ADMIN_STORE_SCOPE_MISMATCH'
      }, 403)
    };
  }
  return { ok: true };
}

export async function requireManagement(request, db) {
  const owner = await ownerFromRequest(request, db);
  if (owner) return { ok: true, owner, admin: null, authType: 'OWNER' };

  const admin = await storeAdminFromRequest(request, db);
  if (admin) {
    const pathname = new URL(request.url).pathname;
    if (/^\/api\/admin\/stores(?:\/|$)/.test(pathname)) {
      return { ok: false, response: json({ error: 'Create dan pengaturan gerai hanya boleh dilakukan Owner.', code: 'OWNER_ONLY' }, 403) };
    }
    if (!adminStoreMatchesRequest(request, admin)) {
      return {
        ok: false,
        response: json({
          error: `Admin ${admin.displayName} hanya berwenang pada gerai ${admin.store.code}.`,
          code: 'ADMIN_STORE_SCOPE_MISMATCH'
        }, 403)
      };
    }
    return { ok: true, owner: null, admin, authType: 'ADMIN' };
  }

  const entityAdmin = await entityAdminFromRequest(request, db);
  if (entityAdmin) {
    const pathname = new URL(request.url).pathname;
    if (/^\/api\/admin\/stores(?:\/|$)/.test(pathname)) {
      return { ok: false, response: json({ error: 'Create dan pengaturan gerai hanya boleh dilakukan Owner.', code: 'OWNER_ONLY' }, 403) };
    }
    const storeCheck = await entityAdminStoreAuthorized(request, entityAdmin, db);
    if (!storeCheck.ok) return storeCheck;
    return { ok: true, owner: null, admin: null, entityAdmin, authType: 'ENTITY_ADMIN' };
  }

  // Backward-compatible prototype fallback while the old PIN UI is being retired.
  const settings = await db.prepare('SELECT admin_pin_hash FROM store_settings WHERE id = 1').first();
  const pin = request.headers.get('x-admin-pin') || '';
  if (settings?.admin_pin_hash && pin && await hashCredential(pin) === settings.admin_pin_hash) {
    return { ok: true, owner: null, admin: null, authType: 'LEGACY_PIN' };
  }

  return { ok: false, response: json({ error: 'Login Owner atau Admin Gerai diperlukan.' }, 401) };
}

export async function handleStoreAdminApi(request, env, pathname) {
  if (!pathname.startsWith('/api/store-admin/')) return null;
  const db = env.DB;

  if (request.method === 'POST' && pathname === '/api/store-admin/login') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload login Admin Gerai tidak valid.' }, 400);
    const username = usernameText(body.value?.username);
    const password = String(body.value?.password ?? '');
    if (!username || !password) return json({ error: 'Username dan password wajib diisi.' }, 400);

    const row = await db.prepare(`
      SELECT a.id, a.username, a.password_hash, a.display_name, a.is_active,
             s.id AS store_id, s.code AS store_code, s.store_name, s.is_active AS store_active
      FROM store_admins a
      JOIN stores s ON s.id = a.store_id
      WHERE a.username = ? COLLATE NOCASE
      LIMIT 1
    `).bind(username).first();

    if (!row || !row.is_active || !row.store_active || await hashCredential(password) !== row.password_hash) {
      return json({ error: 'Username atau password Admin Gerai salah.' }, 401);
    }
    return json(await createStoreAdminSession(db, row));
  }

  if (request.method === 'GET' && pathname === '/api/store-admin/me') {
    const admin = await storeAdminFromRequest(request, db);
    return admin
      ? json({ admin })
      : json({ error: 'Session Admin Gerai tidak valid atau sudah habis.', code: 'ADMIN_SESSION_EXPIRED' }, 401);
  }

  if (request.method === 'POST' && pathname === '/api/store-admin/logout') {
    const token = bearerToken(request);
    if (token) await db.prepare('DELETE FROM store_admin_sessions WHERE token_hash = ?').bind(await hashCredential(token)).run();
    return json({ ok: true });
  }

  return json({ error: 'Route Admin Gerai tidak ditemukan.' }, 404);
}

export async function handleEntityAdminApi(request, env, pathname) {
  if (!pathname.startsWith('/api/entity-admin/')) return null;
  const db = env.DB;

  if (request.method === 'POST' && pathname === '/api/entity-admin/login') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload login Entity Admin tidak valid.' }, 400);
    const username = usernameText(body.value?.username);
    const password = String(body.value?.password ?? '');
    if (!username || !password) return json({ error: 'Username dan password wajib diisi.' }, 400);

    const row = await db.prepare(`
      SELECT a.id, a.username, a.password_hash, a.display_name, a.is_active, a.entity_id,
             e.name AS entity_name, e.status AS entity_status
      FROM entity_admins a
      JOIN entities e ON e.id = a.entity_id
      WHERE a.username = ? COLLATE NOCASE
      LIMIT 1
    `).bind(username).first();

    if (!row || !row.is_active || row.entity_status !== 'ACTIVE' || await hashCredential(password) !== row.password_hash) {
      return json({ error: 'Username atau password Entity Admin salah.' }, 401);
    }
    return json(await createEntityAdminSession(db, row));
  }

  if (request.method === 'GET' && pathname === '/api/entity-admin/me') {
    const entityAdmin = await entityAdminFromRequest(request, db);
    return entityAdmin
      ? json({ entityAdmin })
      : json({ error: 'Session Entity Admin tidak valid atau sudah habis.', code: 'ENTITY_ADMIN_SESSION_EXPIRED' }, 401);
  }

  if (request.method === 'POST' && pathname === '/api/entity-admin/logout') {
    const token = bearerToken(request);
    if (token) await db.prepare('DELETE FROM entity_admin_sessions WHERE token_hash = ?').bind(await hashCredential(token)).run();
    return json({ ok: true });
  }

  if (request.method === 'GET' && pathname === '/api/entity-admin/stores') {
    const entityAdmin = await entityAdminFromRequest(request, db);
    if (!entityAdmin) return json({ error: 'Session Entity Admin tidak valid atau sudah habis.', code: 'ENTITY_ADMIN_SESSION_EXPIRED' }, 401);
    const stores = (await listStores(db)).filter(store => store.entityId === entityAdmin.entityId);
    return json({ entityAdmin, stores });
  }

  return json({ error: 'Route Entity Admin tidak ditemukan.' }, 404);
}

export async function handleOwnerApi(request, env, pathname) {
  if (!pathname.startsWith('/api/owner/')) return null;
  const db = env.DB;

  if (request.method === 'POST' && pathname === '/api/owner/login') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload login Owner tidak valid.' }, 400);
    const username = usernameText(body.value?.username);
    const password = String(body.value?.password ?? '');
    if (!username || !password) return json({ error: 'Username dan password wajib diisi.' }, 400);

    const row = await db.prepare(`
      SELECT id, username, password_hash, display_name, is_active
      FROM owner_accounts
      WHERE username = ? COLLATE NOCASE
      LIMIT 1
    `).bind(username).first();

    if (!row || !row.is_active || await hashCredential(password) !== row.password_hash) {
      return json({ error: 'Username atau password Owner salah.' }, 401);
    }

    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
    const tokenHash = await hashCredential(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OWNER_SESSION_HOURS * 60 * 60 * 1000).toISOString();
    await db.batch([
      db.prepare('DELETE FROM owner_sessions WHERE expires_at <= ?').bind(now.toISOString()),
      db.prepare('INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .bind(tokenHash, row.id, now.toISOString(), expiresAt)
    ]);
    return json({ token, expiresAt, owner: mapOwner(row) });
  }

  if (request.method === 'GET' && pathname === '/api/owner/me') {
    const auth = await requireOwner(request, db);
    return auth.ok ? json({ owner: auth.owner }) : auth.response;
  }

  if (request.method === 'POST' && pathname === '/api/owner/logout') {
    const token = bearerToken(request);
    if (token) await db.prepare('DELETE FROM owner_sessions WHERE token_hash = ?').bind(await hashCredential(token)).run();
    return json({ ok: true });
  }

  const auth = await requireOwner(request, db);
  if (!auth.ok) return auth.response;

  if (request.method === 'GET' && pathname === '/api/owner/tenants') {
    return json({ tenants: await listTenants(db) });
  }

  if (request.method === 'POST' && pathname === '/api/owner/tenants') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tenant tidak valid.' }, 400);
    const name = text(body.value?.name, 80);
    if (!name) return json({ error: 'Nama tenant wajib diisi.' }, 400);
    const id = `tenant_${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO tenants (id, name, status, created_at) VALUES (?, ?, 'ACTIVE', CURRENT_TIMESTAMP)`).bind(id, name).run();
    return json({ ok: true, tenants: await listTenants(db) }, 201);
  }

  if (request.method === 'GET' && pathname === '/api/owner/entities') {
    return json({ entities: await listEntities(db), tenants: await listTenants(db) });
  }

  if (request.method === 'POST' && pathname === '/api/owner/entities') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload entity tidak valid.' }, 400);
    const name = text(body.value?.name, 80);
    const tenantId = text(body.value?.tenantId, 80);
    if (!name || !tenantId) return json({ error: 'Nama entity dan tenant wajib diisi.' }, 400);
    const tenant = await db.prepare(`SELECT id FROM tenants WHERE id = ? AND status = 'ACTIVE'`).bind(tenantId).first();
    if (!tenant) return json({ error: 'Tenant tidak ditemukan atau tidak aktif.' }, 400);
    const entityId = `entity_${crypto.randomUUID()}`;
    const tenancyId = `tnc_${crypto.randomUUID()}`;
    await db.batch([
      db.prepare(`INSERT INTO entities (id, name, status, created_at) VALUES (?, ?, 'ACTIVE', CURRENT_TIMESTAMP)`).bind(entityId, name),
      db.prepare(`
        INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from, reason)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'Dibuat lewat panel Owner')
      `).bind(tenancyId, entityId, tenantId)
    ]);
    return json({ ok: true, entities: await listEntities(db) }, 201);
  }

  if (request.method === 'GET' && pathname === '/api/owner/stores') {
    const stores = await listStores(db, { includeInactive: true });
    return json({ owner: auth.owner, stores });
  }

  if (request.method === 'POST' && pathname === '/api/owner/stores') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload gerai tidak valid.' }, 400);
    const code = normalizeStoreCode(body.value?.code);
    const storeName = text(body.value?.storeName, 80);
    const address = text(body.value?.address, 180);
    if (code.length < 2 || !storeName) return json({ error: 'Kode dan nama gerai wajib diisi.' }, 400);
    const duplicate = await db.prepare('SELECT id FROM stores WHERE code = ?').bind(code).first();
    if (duplicate) return json({ error: 'Kode gerai sudah dipakai.' }, 409);
    const entityId = body.value?.entityId ? text(body.value.entityId, 80) : null;
    if (entityId) {
      const entity = await db.prepare('SELECT id FROM entities WHERE id = ?').bind(entityId).first();
      if (!entity) return json({ error: 'Entity tidak ditemukan.' }, 400);
    }
    const id = `store_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO stores (id, code, store_name, address, logo_data, is_active, entity_id)
      VALUES (?, ?, ?, ?, '', 1, ?)
    `).bind(id, code, storeName, address, entityId).run();
    return json({ ok: true, store: await resolveStore(db, id, { includeInactive: true }) }, 201);
  }

  const storeMatch = pathname.match(/^\/api\/owner\/stores\/([^/]+)$/);
  if (storeMatch && request.method === 'PATCH') {
    const id = decodeURIComponent(storeMatch[1]);
    const current = await resolveStore(db, id, { includeInactive: true });
    if (!current) return json({ error: 'Gerai tidak ditemukan.' }, 404);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload gerai tidak valid.' }, 400);
    const code = normalizeStoreCode(body.value?.code ?? current.code);
    const storeName = text(body.value?.storeName ?? current.storeName, 80);
    const address = text(body.value?.address ?? current.address, 180);
    const isActive = body.value?.isActive === false ? 0 : 1;
    if (code.length < 2 || !storeName) return json({ error: 'Data gerai tidak valid.' }, 400);
    const duplicate = await db.prepare('SELECT id FROM stores WHERE code = ? AND id <> ?').bind(code, id).first();
    if (duplicate) return json({ error: 'Kode gerai sudah dipakai.' }, 409);
    const entityId = body.value?.entityId === undefined ? current.entityId : (body.value.entityId ? text(body.value.entityId, 80) : null);
    if (entityId) {
      const entity = await db.prepare('SELECT id FROM entities WHERE id = ?').bind(entityId).first();
      if (!entity) return json({ error: 'Entity tidak ditemukan.' }, 400);
    }
    await db.prepare(`
      UPDATE stores
      SET code = ?, store_name = ?, address = ?, is_active = ?, entity_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(code, storeName, address, isActive, entityId, id).run();
    return json({ ok: true, store: await resolveStore(db, id, { includeInactive: true }) });
  }

  return json({ error: 'Route Owner tidak ditemukan.' }, 404);
}
