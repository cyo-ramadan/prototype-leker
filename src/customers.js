import { json, readJson } from './http.js';
import { bearerToken, hashCredential, requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';

const CUSTOMER_SESSION_HOURS = 12;
const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const usernameText = value => text(value, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '');

function storeTokenFrom(request) {
  return new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
}

function mapCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerCode: row.customer_code,
    username: row.username || '',
    hasLogin: Boolean(row.username && row.password_hash),
    customerName: row.customer_name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    store: row.store_id ? {
      id: row.store_id,
      code: row.store_code,
      storeName: row.store_name
    } : undefined
  };
}

async function selectedStore(db, request, includeInactive = true) {
  return resolveStore(db, storeTokenFrom(request), { includeInactive });
}

async function customerFromToken(request, db, storeId = null) {
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = await hashCredential(token);
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT c.id, c.store_id, c.customer_code, c.username, c.password_hash,
           c.customer_name, c.phone, c.email, c.notes, c.is_active,
           c.created_at, c.updated_at, s.code AS store_code, s.store_name
    FROM customer_sessions cs
    JOIN customers c ON c.id = cs.customer_id
    JOIN stores s ON s.id = c.store_id
    WHERE cs.token_hash = ? AND cs.expires_at > ?
      AND c.is_active = 1 AND s.is_active = 1
      ${storeId ? 'AND c.store_id = ?' : ''}
    LIMIT 1
  `);
  const bound = storeId
    ? await row.bind(tokenHash, now, storeId).first()
    : await row.bind(tokenHash, now).first();
  return mapCustomer(bound);
}

export async function optionalCustomerFromRequest(request, db, storeId) {
  return customerFromToken(request, db, storeId);
}

async function requireCustomer(request, db, storeId) {
  const customer = await customerFromToken(request, db, storeId);
  return customer
    ? { ok: true, customer }
    : { ok: false, response: json({ error: 'Login pelanggan tidak valid atau sudah habis.', code: 'CUSTOMER_LOGIN_REQUIRED' }, 401) };
}

function customerCode(storeCode) {
  const suffix = crypto.randomUUID().replaceAll('-', '').toUpperCase();
  return `CUST-${storeCode}-${suffix}`;
}

export async function handleCustomerApi(request, env, pathname) {
  const isCustomerAuth = pathname.startsWith('/api/customer/');
  const isAdminMaster = pathname.startsWith('/api/admin/customers');
  if (!isCustomerAuth && !isAdminMaster) return null;

  const db = env.DB;
  const store = await selectedStore(db, request, true);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (isCustomerAuth) {
    if (request.method === 'POST' && pathname === '/api/customer/login') {
      const body = await readJson(request);
      if (!body.ok) return json({ error: 'Payload login pelanggan tidak valid.' }, 400);
      const username = usernameText(body.value?.username);
      const password = String(body.value?.password ?? '');
      if (!username || !password) return json({ error: 'Username dan password wajib diisi.' }, 400);

      const row = await db.prepare(`
        SELECT c.id, c.store_id, c.customer_code, c.username, c.password_hash,
               c.customer_name, c.phone, c.email, c.notes, c.is_active,
               c.created_at, c.updated_at, s.code AS store_code, s.store_name
        FROM customers c
        JOIN stores s ON s.id = c.store_id
        WHERE c.store_id = ? AND c.username = ? COLLATE NOCASE
        LIMIT 1
      `).bind(store.id, username).first();

      if (!row || !row.is_active || !row.password_hash || await hashCredential(password) !== row.password_hash) {
        return json({ error: 'Username atau password pelanggan salah untuk gerai ini.' }, 401);
      }

      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
      const tokenHash = await hashCredential(token);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + CUSTOMER_SESSION_HOURS * 60 * 60 * 1000).toISOString();
      await db.batch([
        db.prepare('DELETE FROM customer_sessions WHERE expires_at <= ?').bind(now.toISOString()),
        db.prepare('INSERT INTO customer_sessions (token_hash, customer_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
          .bind(tokenHash, row.id, now.toISOString(), expiresAt)
      ]);
      return json({ token, expiresAt, customer: mapCustomer(row) });
    }

    if (request.method === 'GET' && pathname === '/api/customer/me') {
      const auth = await requireCustomer(request, db, store.id);
      return auth.ok ? json({ customer: auth.customer }) : auth.response;
    }

    if (request.method === 'POST' && pathname === '/api/customer/logout') {
      const token = bearerToken(request);
      if (token) await db.prepare('DELETE FROM customer_sessions WHERE token_hash = ?').bind(await hashCredential(token)).run();
      return json({ ok: true });
    }

    return json({ error: 'Route pelanggan tidak ditemukan.' }, 404);
  }

  const management = await requireManagement(request, db);
  if (!management.ok) return management.response;

  if (request.method === 'GET' && pathname === '/api/admin/customers') {
    const rows = await db.prepare(`
      SELECT id, store_id, customer_code, username, password_hash, customer_name,
             phone, email, notes, is_active, created_at, updated_at
      FROM customers
      WHERE store_id = ?
      ORDER BY customer_name COLLATE NOCASE, created_at
    `).bind(store.id).all();
    return json({ store, customers: (rows.results ?? []).map(mapCustomer) });
  }

  if (request.method === 'POST' && pathname === '/api/admin/customers') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload pelanggan tidak valid.' }, 400);
    const customerName = text(body.value?.customerName, 100);
    const username = usernameText(body.value?.username) || null;
    const password = String(body.value?.password ?? '');
    if (!customerName) return json({ error: 'Nama pelanggan wajib diisi.' }, 400);
    if ((username && password.length < 6) || (!username && password)) {
      return json({ error: 'Untuk akun login, isi username dan password minimal 6 karakter.' }, 400);
    }
    if (username) {
      const duplicate = await db.prepare('SELECT id FROM customers WHERE store_id = ? AND username = ? COLLATE NOCASE').bind(store.id, username).first();
      if (duplicate) return json({ error: 'Username pelanggan sudah dipakai di gerai ini.' }, 409);
    }

    const id = `customer_${crypto.randomUUID()}`;
    const code = customerCode(store.code);
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO customers (
        id, store_id, customer_code, username, password_hash, customer_name,
        phone, email, notes, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).bind(
      id, store.id, code, username, username ? await hashCredential(password) : '', customerName,
      text(body.value?.phone, 40), text(body.value?.email, 120), text(body.value?.notes, 500), now, now
    ).run();
    return json({ ok: true, customer: mapCustomer(await db.prepare(`
      SELECT id, store_id, customer_code, username, password_hash, customer_name,
             phone, email, notes, is_active, created_at, updated_at
      FROM customers WHERE id = ? AND store_id = ?
    `).bind(id, store.id).first()) }, 201);
  }

  const match = pathname.match(/^\/api\/admin\/customers\/([^/]+)$/);
  if (!match) return json({ error: 'Route master pelanggan tidak ditemukan.' }, 404);
  const id = decodeURIComponent(match[1]);
  const current = await db.prepare(`
    SELECT id, store_id, customer_code, username, password_hash, customer_name,
           phone, email, notes, is_active, created_at, updated_at
    FROM customers
    WHERE id = ? AND store_id = ?
  `).bind(id, store.id).first();
  if (!current) return json({ error: 'Pelanggan tidak ditemukan di gerai ini.' }, 404);

  if (request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload pelanggan tidak valid.' }, 400);
    const customerName = text(body.value?.customerName ?? current.customer_name, 100);
    const username = body.value?.username === undefined ? current.username : (usernameText(body.value.username) || null);
    const password = String(body.value?.password ?? '');
    const isActive = body.value?.isActive === false ? 0 : 1;
    if (!customerName) return json({ error: 'Nama pelanggan wajib diisi.' }, 400);
    if (password && password.length < 6) return json({ error: 'Password minimal 6 karakter.' }, 400);
    if (username && !current.password_hash && !password) {
      return json({ error: 'Password wajib diisi saat akun login pertama kali diaktifkan.' }, 400);
    }
    if (username) {
      const duplicate = await db.prepare('SELECT id FROM customers WHERE store_id = ? AND username = ? COLLATE NOCASE AND id <> ?').bind(store.id, username, id).first();
      if (duplicate) return json({ error: 'Username pelanggan sudah dipakai di gerai ini.' }, 409);
    }

    const passwordHash = !username ? '' : (password ? await hashCredential(password) : current.password_hash);
    await db.prepare(`
      UPDATE customers
      SET username = ?, password_hash = ?, customer_name = ?, phone = ?, email = ?, notes = ?,
          is_active = ?, updated_at = ?
      WHERE id = ? AND store_id = ?
    `).bind(
      username, passwordHash, customerName, text(body.value?.phone ?? current.phone, 40),
      text(body.value?.email ?? current.email, 120), text(body.value?.notes ?? current.notes, 500),
      isActive, new Date().toISOString(), id, store.id
    ).run();
    if (password || !username || !isActive) {
      await db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').bind(id).run();
    }
    return json({ ok: true });
  }

  if (request.method === 'DELETE') {
    await db.batch([
      db.prepare('UPDATE customers SET is_active = 0, updated_at = ? WHERE id = ? AND store_id = ?').bind(new Date().toISOString(), id, store.id),
      db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').bind(id)
    ]);
    return json({ ok: true });
  }

  return json({ error: 'Method master pelanggan tidak didukung.' }, 405);
}
