import { json, readJson } from './http.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { bearerToken, hashCredential, requireManagement } from './owner-auth.js';

const SESSION_HOURS = 12;
const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const usernameText = value => text(value, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '');

// Presensi masuk/keluar dianggap toggle state, bukan penanda per-hari-kalender
// (menghindari ambiguitas timezone gerai): status "in" berlaku sampai kasir
// eksplisit presensi keluar lagi lewat Portal Staf.
async function latestAttendanceStatus(db, cashierId) {
  const row = await db.prepare(`
    SELECT attendance_type FROM staff_attendance WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
  `).bind(cashierId).first();
  return row?.attendance_type === 'in' ? 'in' : 'out';
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
  const tokenHash = await hashCredential(token);
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

    if (!row || !row.is_active || !row.store_active || await hashCredential(password) !== row.password_hash) {
      return json({ error: 'Username atau password salah.' }, 401);
    }

    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
    const tokenHash = await hashCredential(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
    await db.batch([
      db.prepare('DELETE FROM cashier_sessions WHERE expires_at <= ?').bind(now.toISOString()),
      db.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
        .bind(tokenHash, row.id, now.toISOString(), expiresAt)
    ]);

    return json({ token, expiresAt, cashier: mapCashier(row), attendanceStatus: await latestAttendanceStatus(db, row.id) });
  }

  if (request.method === 'GET' && pathname === '/api/cashier/me') {
    const auth = await requireCashier(request, db);
    if (!auth.ok) return auth.response;
    return json({ cashier: auth.cashier, attendanceStatus: await latestAttendanceStatus(db, auth.cashier.id) });
  }

  if (request.method === 'POST' && pathname === '/api/cashier/logout') {
    const token = bearerToken(request);
    if (token) await db.prepare('DELETE FROM cashier_sessions WHERE token_hash = ?').bind(await hashCredential(token)).run();
    return json({ ok: true });
  }

  return null;
}

async function selectedAdminStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function handleAdminCashierApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/cashiers')) return null;
  const db = env.DB;
  const auth = await requireManagement(request, db);
  if (!auth.ok) return auth.response;
  const store = await selectedAdminStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (request.method === 'GET' && pathname === '/api/admin/cashiers') {
    const rows = await db.prepare(`
      SELECT c.id, c.username, c.employee_name, c.is_active,
             s.id AS store_id, s.code AS store_code, s.store_name
      FROM cashiers c
      JOIN stores s ON s.id = c.store_id
      WHERE c.store_id = ?
      ORDER BY c.employee_name COLLATE NOCASE
    `).bind(store.id).all();
    return json({ cashiers: (rows.results ?? []).map(mapCashier), store });
  }

  if (request.method === 'POST' && pathname === '/api/admin/cashiers') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload kasir tidak valid.' }, 400);
    const username = usernameText(body.value?.username);
    const password = String(body.value?.password ?? '');
    const employeeName = text(body.value?.employeeName, 100);
    if (username.length < 3 || password.length < 6 || !employeeName) {
      return json({ error: 'Username min. 3 karakter, password min. 6 karakter, dan nama karyawan wajib diisi.' }, 400);
    }
    const duplicate = await db.prepare('SELECT id FROM cashiers WHERE username = ? COLLATE NOCASE').bind(username).first();
    if (duplicate) return json({ error: 'Username kasir sudah dipakai.' }, 409);
    const id = `cashier_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(id, username, await hashCredential(password), employeeName, store.id).run();
    return json({ ok: true, id }, 201);
  }

  const match = pathname.match(/^\/api\/admin\/cashiers\/([^/]+)$/);
  if (!match) return json({ error: 'Route master kasir tidak ditemukan.' }, 404);
  const id = decodeURIComponent(match[1]);
  const current = await db.prepare('SELECT id, username, employee_name, store_id, is_active FROM cashiers WHERE id = ? AND store_id = ?').bind(id, store.id).first();
  if (!current) return json({ error: 'Kasir tidak ditemukan di gerai ini.' }, 404);

  if (request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload kasir tidak valid.' }, 400);
    const username = usernameText(body.value?.username ?? current.username);
    const employeeName = text(body.value?.employeeName ?? current.employee_name, 100);
    const password = String(body.value?.password ?? '');
    const isActive = body.value?.isActive === false ? 0 : 1;
    if (username.length < 3 || !employeeName || (password && password.length < 6)) {
      return json({ error: 'Data kasir tidak valid.' }, 400);
    }
    const duplicate = await db.prepare('SELECT id FROM cashiers WHERE username = ? COLLATE NOCASE AND id <> ?').bind(username, id).first();
    if (duplicate) return json({ error: 'Username kasir sudah dipakai.' }, 409);

    if (password) {
      await db.prepare(`UPDATE cashiers SET username = ?, password_hash = ?, employee_name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?`)
        .bind(username, await hashCredential(password), employeeName, isActive, id, store.id).run();
    } else {
      await db.prepare(`UPDATE cashiers SET username = ?, employee_name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?`)
        .bind(username, employeeName, isActive, id, store.id).run();
    }
    await db.prepare('DELETE FROM cashier_sessions WHERE cashier_id = ?').bind(id).run();
    return json({ ok: true });
  }

  if (request.method === 'DELETE') {
    await db.batch([
      db.prepare('UPDATE cashiers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?').bind(id, store.id),
      db.prepare('DELETE FROM cashier_sessions WHERE cashier_id = ?').bind(id)
    ]);
    return json({ ok: true });
  }

  return json({ error: 'Method tidak didukung.' }, 405);
}
