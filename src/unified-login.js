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

async function createOwnerSession(db, row) {
  const session = createSessionWindow();
  const tokenHash = await hashCredential(session.token);
  await db.batch([
    db.prepare('DELETE FROM owner_sessions WHERE expires_at <= ?').bind(session.now),
    db.prepare('INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(tokenHash, row.id, session.now, session.expiresAt)
  ]);
  return { role: 'OWNER', token: session.token, expiresAt: session.expiresAt, owner: mapOwner(row), redirect: '/admin' };
}

async function createCashierSession(db, row) {
  const session = createSessionWindow();
  const tokenHash = await hashCredential(session.token);
  await db.batch([
    db.prepare('DELETE FROM cashier_sessions WHERE expires_at <= ?').bind(session.now),
    db.prepare('INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(tokenHash, row.id, session.now, session.expiresAt)
  ]);
  return { role: 'CASHIER', token: session.token, expiresAt: session.expiresAt, cashier: mapCashier(row), redirect: '/cashier' };
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

export async function handleUnifiedLoginApi(request, env, pathname) {
  if (request.method !== 'POST' || pathname !== '/api/auth/login') return null;

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload login tidak valid.' }, 400);
  const username = usernameText(body.value?.username);
  const password = String(body.value?.password ?? '');
  if (!username || !password) return json({ error: 'Username dan password wajib diisi.' }, 400);

  const url = new URL(request.url);
  const storeToken = url.searchParams.get('store') || DEFAULT_STORE_CODE;
  const [owner, cashier, selectedStore] = await Promise.all([
    env.DB.prepare(`
      SELECT id, username, password_hash, display_name, is_active
      FROM owner_accounts
      WHERE username = ? COLLATE NOCASE AND is_active = 1
      LIMIT 1
    `).bind(username).first(),
    env.DB.prepare(`
      SELECT c.id, c.username, c.password_hash, c.employee_name, c.is_active,
             s.id AS store_id, s.code AS store_code, s.store_name, s.is_active AS store_active
      FROM cashiers c
      JOIN stores s ON s.id = c.store_id
      WHERE c.username = ? COLLATE NOCASE AND c.is_active = 1 AND s.is_active = 1
      LIMIT 1
    `).bind(username).first(),
    resolveStore(env.DB, storeToken)
  ]);

  let customerRows = [];
  if (selectedStore) {
    const scope = await resolveCustomerScope(env.DB, selectedStore.id);
    const rows = await env.DB.prepare(`
      SELECT c.id, c.store_id, c.customer_code, c.username, c.password_hash,
             c.customer_name, c.phone, c.email, c.notes, c.is_active,
             c.created_at, c.updated_at, s.code AS store_code, s.store_name
      FROM customers c
      JOIN stores s ON s.id = c.store_id
      WHERE c.store_id IN (${placeholders(scope.storeIds.length)})
        AND c.username = ? COLLATE NOCASE
        AND c.is_active = 1 AND s.is_active = 1
    `).bind(...scope.storeIds, username).all();
    customerRows = rows.results ?? [];
  }

  const passwordHash = await hashCredential(password);
  const matches = [];
  if (owner?.password_hash && owner.password_hash === passwordHash) matches.push({ role: 'OWNER', row: owner });
  if (cashier?.password_hash && cashier.password_hash === passwordHash) matches.push({ role: 'CASHIER', row: cashier });
  for (const customer of customerRows) {
    if (customer.password_hash && customer.password_hash === passwordHash) matches.push({ role: 'CUSTOMER', row: customer });
  }

  if (!matches.length) {
    if (!selectedStore && !owner && !cashier) return json({ error: 'Gerai yang dipilih tidak tersedia.' }, 404);
    return json({ error: 'Username atau password salah.' }, 401);
  }
  if (matches.length > 1) {
    return json({
      error: 'Kredensial bentrok pada lebih dari satu akun. Ubah username atau password salah satu akun.',
      code: 'AMBIGUOUS_LOGIN'
    }, 409);
  }

  const match = matches[0];
  if (match.role === 'OWNER') return json(await createOwnerSession(env.DB, match.row));
  if (match.role === 'CASHIER') return json(await createCashierSession(env.DB, match.row));
  return json(await createCustomerSession(env.DB, match.row));
}
