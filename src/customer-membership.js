import { json, readJson } from './http.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { resolveCustomerScope } from './customer-sharing.js';
import { optionalCustomerFromRequest } from './customers.js';
import { hashCredential, requireManagement } from './owner-auth.js';

const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const usernameText = value => text(value, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '');
const placeholders = count => Array.from({ length: count }, () => '?').join(', ');

function storeTokenFrom(request) {
  return new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
}

async function selectedStore(db, request, includeInactive = false) {
  return resolveStore(db, storeTokenFrom(request), { includeInactive });
}

function requestCode(storeCode) {
  return `REG-${storeCode}-${crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
}

function customerCode(storeCode) {
  return `CUST-${storeCode}-${crypto.randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;
}

function mapRequest(row) {
  return {
    id: row.id,
    requestCode: row.request_code,
    customerName: row.customer_name,
    username: row.username,
    phone: row.phone,
    email: row.email,
    status: row.status,
    rejectionReason: row.rejection_reason || '',
    customerId: row.customer_id || null,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at || null,
    reviewedBy: row.reviewed_by || ''
  };
}

async function usernameExistsInScope(db, scopeStoreIds, username) {
  if (!scopeStoreIds.length) return false;
  const row = await db.prepare(`
    SELECT id FROM customers
    WHERE store_id IN (${placeholders(scopeStoreIds.length)})
      AND username = ? COLLATE NOCASE
    LIMIT 1
  `).bind(...scopeStoreIds, username).first();
  return Boolean(row);
}

async function pendingUsernameExistsInScope(db, scopeStoreIds, username, excludeRequestId = '') {
  if (!scopeStoreIds.length) return false;
  const params = [...scopeStoreIds, username];
  let sql = `
    SELECT id FROM customer_registration_requests
    WHERE store_id IN (${placeholders(scopeStoreIds.length)})
      AND username = ? COLLATE NOCASE
      AND status = 'PENDING'
  `;
  if (excludeRequestId) {
    sql += ' AND id <> ?';
    params.push(excludeRequestId);
  }
  sql += ' LIMIT 1';
  return Boolean(await db.prepare(sql).bind(...params).first());
}

async function handleRegistration(request, env) {
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan atau sedang nonaktif.' }, 404);
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload pendaftaran tidak valid.' }, 400);

  const customerName = text(body.value?.customerName, 100);
  const username = usernameText(body.value?.username);
  const password = String(body.value?.password ?? '');
  const phone = text(body.value?.phone, 40);
  const email = text(body.value?.email, 120);
  if (!customerName || username.length < 3 || password.length < 6) {
    return json({ error: 'Nama wajib diisi, username minimal 3 karakter, dan password minimal 6 karakter.' }, 400);
  }

  const scope = await resolveCustomerScope(env.DB, store.id);
  if (await usernameExistsInScope(env.DB, scope.storeIds, username)) {
    return json({ error: 'Username sudah dipakai pelanggan pada jaringan gerai ini.' }, 409);
  }
  if (await pendingUsernameExistsInScope(env.DB, scope.storeIds, username)) {
    return json({ error: 'Username tersebut sudah memiliki pendaftaran yang masih menunggu persetujuan.' }, 409);
  }

  const id = `customer_request_${crypto.randomUUID()}`;
  const code = requestCode(store.code);
  await env.DB.prepare(`
    INSERT INTO customer_registration_requests (
      id, request_code, store_id, username, password_hash, customer_name, phone, email, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP)
  `).bind(id, code, store.id, username, await hashCredential(password), customerName, phone, email).run();

  return json({
    ok: true,
    request: { requestCode: code, status: 'PENDING', store: { code: store.code, storeName: store.storeName } },
    message: 'Pendaftaran dikirim. Akun baru bisa login setelah disetujui Admin Gerai.'
  }, 202);
}

async function requireLoggedCustomer(request, env, store) {
  const customer = await optionalCustomerFromRequest(request, env.DB, store.id);
  return customer
    ? { ok: true, customer }
    : { ok: false, response: json({ error: 'Login pelanggan diperlukan.', code: 'CUSTOMER_LOGIN_REQUIRED' }, 401) };
}

async function handlePoints(request, env) {
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const auth = await requireLoggedCustomer(request, env, store);
  if (!auth.ok) return auth.response;
  const row = await env.DB.prepare(`
    SELECT COALESCE(SUM(points_delta), 0) AS points_balance
    FROM customer_point_ledger
    WHERE customer_id = ?
  `).bind(auth.customer.id).first();
  return json({ customerId: auth.customer.id, points: Number(row?.points_balance ?? 0) });
}

async function handleCustomerOrders(request, env) {
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const auth = await requireLoggedCustomer(request, env, store);
  if (!auth.ok) return auth.response;
  const scope = await resolveCustomerScope(env.DB, store.id);
  const rows = await env.DB.prepare(`
    SELECT o.id, o.order_no, o.total_amount, o.status, o.created_at, o.updated_at,
           s.code AS store_code, s.store_name
    FROM orders o
    JOIN stores s ON s.id = o.store_id
    WHERE o.customer_id = ?
      AND o.store_id IN (${placeholders(scope.storeIds.length)})
    ORDER BY o.created_at DESC
    LIMIT 20
  `).bind(auth.customer.id, ...scope.storeIds).all();
  return json({
    orders: (rows.results ?? []).map(row => ({
      id: row.id,
      orderNo: row.order_no,
      total: Number(row.total_amount || 0),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      store: { code: row.store_code, storeName: row.store_name }
    }))
  });
}

async function handleAdminRequests(request, env, pathname) {
  const management = await requireManagement(request, env.DB);
  if (!management.ok) return management.response;
  const store = await selectedStore(env.DB, request, true);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (request.method === 'GET' && pathname === '/api/admin/customer-requests') {
    const rows = await env.DB.prepare(`
      SELECT id, request_code, customer_name, username, phone, email, status,
             rejection_reason, customer_id, created_at, reviewed_at, reviewed_by
      FROM customer_registration_requests
      WHERE store_id = ? AND status = 'PENDING'
      ORDER BY created_at ASC
    `).bind(store.id).all();
    return json({ store, requests: (rows.results ?? []).map(mapRequest) });
  }

  const match = pathname.match(/^\/api\/admin\/customer-requests\/([^/]+)$/);
  if (!match || request.method !== 'PATCH') return json({ error: 'Route request pelanggan tidak ditemukan.' }, 404);
  const id = decodeURIComponent(match[1]);
  const current = await env.DB.prepare(`
    SELECT id, request_code, store_id, username, password_hash, customer_name, phone, email, status,
           rejection_reason, customer_id, created_at, reviewed_at, reviewed_by
    FROM customer_registration_requests
    WHERE id = ? AND store_id = ?
    LIMIT 1
  `).bind(id, store.id).first();
  if (!current) return json({ error: 'Request pelanggan tidak ditemukan di gerai ini.' }, 404);
  if (current.status !== 'PENDING') return json({ error: 'Request pelanggan sudah pernah direview.' }, 409);

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload review tidak valid.' }, 400);
  const action = String(body.value?.action || '').trim().toUpperCase();
  const reviewer = management.admin?.displayName || management.owner?.displayName || management.authType || 'Management';

  if (action === 'REJECT') {
    const reason = text(body.value?.reason, 240);
    await env.DB.prepare(`
      UPDATE customer_registration_requests
      SET status = 'REJECTED', rejection_reason = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?
      WHERE id = ? AND store_id = ? AND status = 'PENDING'
    `).bind(reason, reviewer, id, store.id).run();
    return json({ ok: true, status: 'REJECTED' });
  }

  if (action !== 'APPROVE') return json({ error: 'Action harus APPROVE atau REJECT.' }, 400);

  const scope = await resolveCustomerScope(env.DB, store.id);
  if (await usernameExistsInScope(env.DB, scope.storeIds, current.username)) {
    return json({ error: 'Username sudah dipakai pelanggan pada jaringan gerai ini.' }, 409);
  }
  if (await pendingUsernameExistsInScope(env.DB, scope.storeIds, current.username, current.id)) {
    return json({ error: 'Ada request pending lain dengan username sama pada jaringan berbagi pelanggan.' }, 409);
  }

  const customerId = `customer_${crypto.randomUUID()}`;
  const code = customerCode(store.code);
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO customers (
        id, store_id, customer_code, username, password_hash, customer_name,
        phone, email, notes, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(customerId, store.id, code, current.username, current.password_hash, current.customer_name, current.phone, current.email),
    env.DB.prepare(`
      UPDATE customer_registration_requests
      SET status = 'APPROVED', customer_id = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?
      WHERE id = ? AND store_id = ? AND status = 'PENDING'
    `).bind(customerId, reviewer, id, store.id)
  ]);
  return json({ ok: true, status: 'APPROVED', customerId, customerCode: code });
}

export async function handleCustomerMembershipApi(request, env, pathname) {
  if (request.method === 'POST' && pathname === '/api/customer/register') return handleRegistration(request, env);
  if (request.method === 'GET' && pathname === '/api/customer/points') return handlePoints(request, env);
  if (request.method === 'GET' && pathname === '/api/customer/orders') return handleCustomerOrders(request, env);
  if (pathname === '/api/admin/customer-requests' || pathname.startsWith('/api/admin/customer-requests/')) {
    return handleAdminRequests(request, env, pathname);
  }
  return null;
}
