import { json, readJson } from './http.js';
import { resolveCustomerScope } from './customer-sharing.js';
import { hashCredential } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';

const SESSION_HOURS = 12;
const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const usernameText = value => text(value, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '');
const placeholders = count => Array.from({ length: count }, () => '?').join(', ');

function createSessionWindow() {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
  return { token, now: now.toISOString(), expiresAt };
}

function mapOwner(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isActive: Boolean(row.is_active)
  };
}

function mapAdmin(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isActive: Boolean(row.is_active),
    store: {
      id: row.store_id,
      code: row.store_code,
      storeName: row.store_name
    }
  };
}

function mapCashier(row) {
  return {
    id: row.id,
    username: row.username,
    employeeName: row.employee_name,
    isActive: Boolean(row.is_active),
    store: {
      id: row.store_id,
      code: row.store_code,
      storeName: row.store_name
    }
  };
}

function mapCustomer(row) {
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
    store: {
      id: row.store_id,
      code: row.store_code,
      storeName: row.store_name
    }
  };
}

async function createCustomerSession(db, row) {
  const session = createSessionWindow();
  const tokenHash = await hashCredential(session.token);
  await db.batch([
    db.prepare('DELETE FROM customer_sessions WHERE expires_at <= ?').bind(session.now),
    db.prepare('INSERT INTO customer_sessions (token_hash, customer_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(tokenHash, row.id, session.now, session.expiresAt)
  ]);
  return { role: 'CUSTOMER', token: session.token, expiresAt: session.expiresAt, customer: mapCustomer(row), redirect: null };
}

async function customerMatches(db, selectedStore, username, passwordHash) {
  if (!selectedStore) return [];
  const scope = await resolveCustomerScope(db, selectedStore.id);
  const rows = await db.prepare(`
    SELECT c.id, c.store_id, c.customer_code, c.username, c.password_hash,
           c.customer_name, c.phone, c.email, c.notes, c.is_active,
           c.created_at, c.updated_at, s.code AS store_code, s.store_name
    FROM customers c
    JOIN stores s ON s.id = c.store_id
    WHERE c.store_id IN (${placeholders(scope.storeIds.length)})
      AND c.username = ? COLLATE NOCASE
      AND c.is_active = 1 AND s.is_active = 1
  `).bind(...scope.storeIds, username).all();
  return (rows.results ?? []).filter(row => row.password_hash === passwordHash);
}

async function staffMatches(db, username, passwordHash) {
  const [owner, admin, cashier] = await Promise.all([
    db.prepare(`
      SELECT id, username, password_hash, display_name, is_active
      FROM owner_accounts
      WHERE username = ? COLLATE NOCASE AND is_active = 1
      LIMIT 1
    `).bind(username).first(),
    db.prepare(`
      SELECT a.id, a.username, a.password_hash, a.display_name, a.is_active,
             s.id AS store_id, s.code AS store_code, s.store_name, s.is_active AS store_active
      FROM store_admins a
      JOIN stores s ON s.id = a.store_id
      WHERE a.username = ? COLLATE NOCASE AND a.is_active = 1 AND s.is_active = 1
      LIMIT 1
    `).bind(username).first(),
    db.prepare(`
      SELECT c.id, c.username, c.password_hash, c.employee_name, c.is_active,
             s.id AS store_id, s.code AS store_code, s.store_name, s.is_active AS store_active
      FROM cashiers c
      JOIN stores s ON s.id = c.store_id
      WHERE c.username = ? COLLATE NOCASE AND c.is_active = 1 AND s.is_active = 1
      LIMIT 1
    `).bind(username).first()
  ]);

  const matches = [];
  if (owner?.password_hash === passwordHash) matches.push({ role: 'OWNER', row: owner });
  if (admin?.password_hash === passwordHash) matches.push({ role: 'ADMIN', row: admin });
  if (cashier?.password_hash === passwordHash) matches.push({ role: 'CASHIER', row: cashier });
  return matches;
}

function staffSessionSpec(match) {
  if (match.role === 'OWNER') {
    return { table: 'owner_sessions', idColumn: 'owner_id', mapped: mapOwner(match.row), redirect: '/admin', payloadKey: 'owner' };
  }
  if (match.role === 'ADMIN') {
    const admin = mapAdmin(match.row);
    return {
      table: 'store_admin_sessions', idColumn: 'admin_id', mapped: admin,
      redirect: `/s/${encodeURIComponent(admin.store.code)}/admin`, payloadKey: 'admin'
    };
  }
  const cashier = mapCashier(match.row);
  return { table: 'cashier_sessions', idColumn: 'cashier_id', mapped: cashier, redirect: '/cashier', payloadKey: 'cashier' };
}

async function createStaffSession(db, match, { takeover = false } = {}) {
  const spec = staffSessionSpec(match);
  const session = createSessionWindow();
  await db.prepare(`DELETE FROM ${spec.table} WHERE expires_at <= ?`).bind(session.now).run();
  const active = await db.prepare(`SELECT token_hash, expires_at FROM ${spec.table} WHERE ${spec.idColumn} = ? AND expires_at > ? LIMIT 1`)
    .bind(match.row.id, session.now).first();

  if (active && !takeover) {
    return {
      ok: false,
      response: json({
        error: 'Akun karyawan ini masih aktif di tab atau perangkat lain.',
        code: 'STAFF_SESSION_ACTIVE',
        canTakeover: true,
        role: match.role,
        expiresAt: active.expires_at
      }, 409)
    };
  }

  if (active) await db.prepare(`DELETE FROM ${spec.table} WHERE ${spec.idColumn} = ?`).bind(match.row.id).run();
  const tokenHash = await hashCredential(session.token);
  await db.prepare(`INSERT INTO ${spec.table} (token_hash, ${spec.idColumn}, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(tokenHash, match.row.id, session.now, session.expiresAt).run();

  return {
    ok: true,
    payload: {
      role: match.role,
      token: session.token,
      expiresAt: session.expiresAt,
      [spec.payloadKey]: spec.mapped,
      redirect: spec.redirect
    }
  };
}

async function readCredentials(request) {
  const body = await readJson(request);
  if (!body.ok) return { ok: false, response: json({ error: 'Payload login tidak valid.' }, 400) };
  const username = usernameText(body.value?.username);
  const password = String(body.value?.password ?? '');
  if (!username || !password) return { ok: false, response: json({ error: 'Username dan password wajib diisi.' }, 400) };
  return { ok: true, username, passwordHash: await hashCredential(password), takeover: body.value?.takeover === true };
}

async function handleCustomerLogin(request, env) {
  const credentials = await readCredentials(request);
  if (!credentials.ok) return credentials.response;
  const url = new URL(request.url);
  const selectedStore = await resolveStore(env.DB, url.searchParams.get('store') || DEFAULT_STORE_CODE);
  if (!selectedStore) return json({ error: 'Gerai yang dipilih tidak tersedia.' }, 404);
  const matches = await customerMatches(env.DB, selectedStore, credentials.username, credentials.passwordHash);
  if (!matches.length) return json({ error: 'Username atau password pelanggan salah.' }, 401);
  if (matches.length > 1) return json({ error: 'Akun pelanggan bentrok dalam grup berbagi pelanggan.', code: 'AMBIGUOUS_CUSTOMER_LOGIN' }, 409);
  return json(await createCustomerSession(env.DB, matches[0]));
}

async function handleStaffLogin(request, env) {
  const credentials = await readCredentials(request);
  if (!credentials.ok) return credentials.response;
  const matches = await staffMatches(env.DB, credentials.username, credentials.passwordHash);
  if (!matches.length) return json({ error: 'Username atau password karyawan salah.' }, 401);
  if (matches.length > 1) {
    return json({
      error: 'Kredensial karyawan bentrok pada lebih dari satu pangkat internal.',
      code: 'AMBIGUOUS_STAFF_LOGIN'
    }, 409);
  }
  const result = await createStaffSession(env.DB, matches[0], { takeover: credentials.takeover });
  return result.ok ? json(result.payload) : result.response;
}

async function handleLegacyUnifiedLogin(request, env) {
  const credentials = await readCredentials(request);
  if (!credentials.ok) return credentials.response;
  const url = new URL(request.url);
  const selectedStore = await resolveStore(env.DB, url.searchParams.get('store') || DEFAULT_STORE_CODE);
  const [staff, customers] = await Promise.all([
    staffMatches(env.DB, credentials.username, credentials.passwordHash),
    selectedStore ? customerMatches(env.DB, selectedStore, credentials.username, credentials.passwordHash) : []
  ]);
  const matches = [
    ...staff,
    ...customers.map(row => ({ role: 'CUSTOMER', row }))
  ];
  if (!matches.length) return json({ error: 'Username atau password salah.' }, 401);
  if (matches.length > 1) return json({ error: 'Kredensial bentrok. Gunakan login Pelanggan atau Karyawan.', code: 'AMBIGUOUS_LOGIN' }, 409);
  if (matches[0].role === 'CUSTOMER') return json(await createCustomerSession(env.DB, matches[0].row));
  const result = await createStaffSession(env.DB, matches[0], { takeover: credentials.takeover });
  return result.ok ? json(result.payload) : result.response;
}

export async function handleUnifiedLoginApi(request, env, pathname) {
  if (request.method !== 'POST') return null;
  if (pathname === '/api/auth/customer-login') return handleCustomerLogin(request, env);
  if (pathname === '/api/auth/staff-login') return handleStaffLogin(request, env);
  if (pathname === '/api/auth/login') return handleLegacyUnifiedLogin(request, env);
  return null;
}
