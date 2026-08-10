import { json, readJson } from './http.js';
import { listStores, normalizeStoreCode, resolveStore } from './stores.js';

const OWNER_SESSION_HOURS = 12;
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

export async function requireOwner(request, db) {
  const owner = await ownerFromRequest(request, db);
  return owner
    ? { ok: true, owner }
    : { ok: false, response: json({ error: 'Login Owner diperlukan.', code: 'OWNER_LOGIN_REQUIRED' }, 401) };
}

export async function requireManagement(request, db) {
  const owner = await ownerFromRequest(request, db);
  if (owner) return { ok: true, owner, authType: 'OWNER' };

  // Backward-compatible prototype fallback while the old PIN UI is being retired.
  const settings = await db.prepare('SELECT admin_pin_hash FROM store_settings WHERE id = 1').first();
  const pin = request.headers.get('x-admin-pin') || '';
  if (settings?.admin_pin_hash && pin && await hashCredential(pin) === settings.admin_pin_hash) {
    return { ok: true, owner: null, authType: 'LEGACY_PIN' };
  }

  return { ok: false, response: json({ error: 'Login Owner diperlukan.' }, 401) };
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
    const id = `store_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO stores (id, code, store_name, address, logo_data, is_active)
      VALUES (?, ?, ?, ?, '', 1)
    `).bind(id, code, storeName, address).run();
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
    await db.prepare(`
      UPDATE stores
      SET code = ?, store_name = ?, address = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(code, storeName, address, isActive, id).run();
    return json({ ok: true, store: await resolveStore(db, id, { includeInactive: true }) });
  }

  return json({ error: 'Route Owner tidak ditemukan.' }, 404);
}
