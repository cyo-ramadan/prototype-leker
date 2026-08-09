import { json, readJson } from './http.js';
import { listStores, resolveStore } from './stores.js';

const SESSION_HOURS = 12;
const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const usernameText = value => text(value, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '');

async function hash(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function mapCashier(row) {
  return row ? {
    id: row.id,
    username: row.username,
    employeeName: row.employee_name,
    isActive: Boolean(row.is_active),
    store: {
      id: row.store_id,
      code: row.store_code,
      storeName: row.store_name
    }
  } : null;
}

export async function requireCashier(request, db) {
  const token = bearerToken(request);
  if (!token) return { ok: false, response: json({ error: 'Login kasir diperlukan.', code: 'CASHIER_LOGIN_REQUIRED' }, 401) };
  const tokenHash = await hash(token);
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT c.id, c.username, c.employee_name, c.is_active,
           s.id AS store_id, s.code AS store_code, s.store_name
    FROM cashier_sessions cs
    JOIN cashiers c ON c.id = cs.cashier_id
    JOIN stores s ON s.id = c.store_id
    WHERE cs.token_hash = ? AND cs.expires_at > ?
      AND c.is_active = 1 AND s.is_active = 1
    LIMIT 1
  `).bind(tokenHash, now).first();
  if (!row) return { ok: false, response: json({ error: 'Session kasir tidak valid atau sudah habis.', code: 'CASHIER_SESSION_EXPIRED' }, 401) };
  return { ok: true, cashier: mapCashier(row), tokenHash };
}

export async function handleCashierAuthApi(request, env, pathname) {
  const db = env.DB;

  if (request.method === 'POST' && pathname === '/api/cashier/login') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload login tidak valid.' }, 400);
    const username = usernameText(body.value?.username);
    const password = String(body.value?.password ?? '');
    if (!username || !password) return json({ error: 'Username dan password wajib diisi.' }, 400);

    const row = await db.prepare(`
      SELECT c.id, c.username, c.password_hash, c.employee_name, c.is_active,
             s.id AS store_id, s.code AS store_code, s.store_name, s.is_active AS store_active
      FROM cashiers c
      JOIN stores s ON s.id = c.store_id
      WHERE c.username = ? COLLATE NOCASE
      LIMIT 1
    `).bind(username).first();

    if (!row || !row.is_active || !row.store_active || await hash(password) !== row.password_hash) {
      return json({ error: 'Username atau password salah.' }, 401);
    }

    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
    const tokenHash = await hash(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
    await db.batch([
      db.prepare('DELETE FROM cashier_sessions WHERE expires_at <= ?').bind(now.toISOString()),
      db.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
        .bind(tokenHash, row.id, now.toISOString(), expiresAt)
    ]);

    return json({
      token,
      expiresAt,
      cashier: mapCashier(row)
    });
  }

  if (request.method === 'GET' && pathname === '/api/cashier/me') {
    const auth = await requireCashier(request, db);
    return auth.ok ? json({ cashier: auth.cashier }) : auth.response;
  }

  if (request.method === 'POST' && pathname === '/api/cashier/logout') {
    const token = bearerToken(request);
    if (token) await db.prepare('DELETE FROM cashier_sessions WHERE token_hash = ?').bind(await hash(token)).run();
    return json({ ok: true });
  }

  return null;
}

async function requireAdmin(request, db) {
  const row = await db.prepare('SELECT admin_pin_hash FROM store_settings WHERE id = 1').first();
  const pin = request.headers.get('x-admin-pin') || '';
  if (!row?.admin_pin_hash || !pin || await hash(pin) !== row.admin_pin_hash) {
    return { ok: false, response: json({ error: 'PIN admin salah.' }, 401) };
  }
  return { ok: true };
}

async function resolveRequestedStore(db, value) {
  if (!value) return null;
  return resolveStore(db, String(value), { includeInactive: true });
}

export async function handleAdminCashierApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/cashiers')) return null;
  const db = env.DB;
  const auth = await requireAdmin(request, db);
  if (!auth.ok) return auth.response;

  if (request.method === 'GET' && pathname === '/api/admin/cashiers') {
    const [rows, stores] = await Promise.all([
      db.prepare(`
        SELECT c.id, c.username, c.employee_name, c.is_active,
               s.id AS store_id, s.code AS store_code, s.store_name
        FROM cashiers c
        JOIN stores s ON s.id = c.store_id
        ORDER BY s.code, c.employee_name COLLATE NOCASE
      `).all(),
      listStores(db, { includeInactive: true })
    ]);
    return json({ cashiers: (rows.results ?? []).map(mapCashier), stores });
  }

  if (request.method === 'POST' && pathname === '/api/admin/cashiers') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload kasir tidak valid.' }, 400);
    const username = usernameText(body.value?.username);
    const password = String(body.value?.password ?? '');
    const employeeName = text(body.value?.employeeName, 100);
    const store = await resolveRequestedStore(db, body.value?.storeId || body.value?.storeCode);
    if (username.length < 3 || password.length < 6 || !employeeName || !store) {
      return json({ error: 'Username min. 3 karakter, password min. 6 karakter, nama karyawan dan gerai wajib valid.' }, 400);
    }
    const duplicate = await db.prepare('SELECT id FROM cashiers WHERE username = ? COLLATE NOCASE').bind(username).first();
    if (duplicate) return json({ error: 'Username kasir sudah dipakai.' }, 409);
    const id = `cashier_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(id, username, await hash(password), employeeName, store.id).run();
    return json({ ok: true, id }, 201);
  }

  const match = pathname.match(/^\/api\/admin\/cashiers\/([^/]+)$/);
  if (!match) return json({ error: 'Route master kasir tidak ditemukan.' }, 404);
  const id = decodeURIComponent(match[1]);
  const current = await db.prepare('SELECT id, username, employee_name, store_id, is_active FROM cashiers WHERE id = ?').bind(id).first();
  if (!current) return json({ error: 'Kasir tidak ditemukan.' }, 404);

  if (request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload kasir tidak valid.' }, 400);
    const username = usernameText(body.value?.username ?? current.username);
    const employeeName = text(body.value?.employeeName ?? current.employee_name, 100);
    const store = await resolveRequestedStore(db, body.value?.storeId || body.value?.storeCode || current.store_id);
    const password = String(body.value?.password ?? '');
    const isActive = body.value?.isActive === false ? 0 : 1;
    if (username.length < 3 || !employeeName || !store || (password && password.length < 6)) {
      return json({ error: 'Data kasir tidak valid.' }, 400);
    }
    const duplicate = await db.prepare('SELECT id FROM cashiers WHERE username = ? COLLATE NOCASE AND id <> ?').bind(username, id).first();
    if (duplicate) return json({ error: 'Username kasir sudah dipakai.' }, 409);

    if (password) {
      await db.prepare(`UPDATE cashiers SET username = ?, password_hash = ?, employee_name = ?, store_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(username, await hash(password), employeeName, store.id, isActive, id).run();
    } else {
      await db.prepare(`UPDATE cashiers SET username = ?, employee_name = ?, store_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(username, employeeName, store.id, isActive, id).run();
    }
    await db.prepare('DELETE FROM cashier_sessions WHERE cashier_id = ?').bind(id).run();
    return json({ ok: true });
  }

  if (request.method === 'DELETE') {
    await db.batch([
      db.prepare('UPDATE cashiers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id),
      db.prepare('DELETE FROM cashier_sessions WHERE cashier_id = ?').bind(id)
    ]);
    return json({ ok: true });
  }

  return json({ error: 'Method tidak didukung.' }, 405);
}
