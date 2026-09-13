import { json, readJson } from './http.js';
import { bearerToken, hashCredential, requireManagement } from './owner-auth.js';
import { resolveCustomerScope } from './customer-sharing.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getJakartaBusinessDate } from './time.js';

const BIRTH_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CUSTOMER_SESSION_HOURS = 12;
const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const usernameText = value => text(value, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '');
const placeholders = count => Array.from({ length: count }, () => '?').join(', ');

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
    birthDate: row.birth_date || '',
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

async function customerFromToken(request, db, storeIds) {
  const token = bearerToken(request);
  if (!token || !storeIds?.length) return null;
  const tokenHash = await hashCredential(token);
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT c.id, c.store_id, c.customer_code, c.username, c.password_hash,
           c.customer_name, c.phone, c.email, c.notes, c.birth_date, c.is_active,
           c.created_at, c.updated_at, s.code AS store_code, s.store_name
    FROM customer_sessions cs
    JOIN customers c ON c.id = cs.customer_id
    JOIN stores s ON s.id = c.store_id
    WHERE cs.token_hash = ? AND cs.expires_at > ?
      AND c.is_active = 1 AND s.is_active = 1
      AND c.store_id IN (${placeholders(storeIds.length)})
    LIMIT 1
  `).bind(tokenHash, now, ...storeIds).first();
  return mapCustomer(row);
}

export async function optionalCustomerFromRequest(request, db, storeId) {
  const scope = await resolveCustomerScope(db, storeId);
  return customerFromToken(request, db, scope.storeIds);
}

async function requireCustomer(request, db, storeIds) {
  const customer = await customerFromToken(request, db, storeIds);
  return customer
    ? { ok: true, customer }
    : { ok: false, response: json({ error: 'Login pelanggan tidak valid atau sudah habis.', code: 'CUSTOMER_LOGIN_REQUIRED' }, 401) };
}

function customerCode(storeCode) {
  const suffix = crypto.randomUUID().replaceAll('-', '').toUpperCase();
  return `CUST-${storeCode}-${suffix}`;
}

async function findCustomerById(db, id, storeIds) {
  return db.prepare(`
    SELECT c.id, c.store_id, c.customer_code, c.username, c.password_hash,
           c.customer_name, c.phone, c.email, c.notes, c.birth_date, c.is_active,
           c.created_at, c.updated_at, s.code AS store_code, s.store_name
    FROM customers c
    JOIN stores s ON s.id = c.store_id
    WHERE c.id = ? AND c.store_id IN (${placeholders(storeIds.length)})
    LIMIT 1
  `).bind(id, ...storeIds).first();
}

function managementActorLabel(management) {
  if (management.owner) return { role: 'OWNER', id: management.owner.id };
  if (management.entityAdmin) return { role: 'ENTITY_ADMIN', id: management.entityAdmin.id };
  if (management.admin) return { role: 'ADMIN', id: management.admin.id };
  return { role: management.authType || 'MANAGEMENT', id: '' };
}

async function coinAlreadyGranted(db, customerId, referenceType, referenceId) {
  const row = await db.prepare(`
    SELECT id FROM customer_coin_ledger WHERE customer_id = ? AND reference_type = ? AND reference_id = ? LIMIT 1
  `).bind(customerId, referenceType, referenceId).first();
  return Boolean(row);
}

// Notifikasi Admin: pelanggan yang ulang tahun hari ini, dan member baru yang
// baru di-ACC (7 hari terakhir) -- keduanya kejadian yang bisa dikasih Coin
// sekali per kejadian. alreadyGranted dihitung dari customer_coin_ledger,
// bukan tabel notifikasi terpisah, supaya tombol "Kasih Coin" tetap terkunci
// walau halaman di-refresh atau dibuka sesi lain.
async function handleCoinAlerts(db, scopedIds) {
  const todayMonthDay = getJakartaBusinessDate().slice(5);
  const birthdayRows = await db.prepare(`
    SELECT id, customer_code, customer_name FROM customers
    WHERE store_id IN (${placeholders(scopedIds.length)})
      AND is_active = 1 AND birth_date <> '' AND substr(birth_date, 6, 5) = ?
    ORDER BY customer_name COLLATE NOCASE
  `).bind(...scopedIds, todayMonthDay).all();

  const birthdays = [];
  for (const row of birthdayRows.results ?? []) {
    const referenceId = `${row.id}:${todayMonthDay}`;
    birthdays.push({
      customerId: row.id,
      customerCode: row.customer_code,
      customerName: row.customer_name,
      occasion: 'BIRTHDAY',
      referenceId,
      alreadyGranted: await coinAlreadyGranted(db, row.id, 'BIRTHDAY', referenceId)
    });
  }

  const memberRows = await db.prepare(`
    SELECT r.id AS request_id, r.customer_id, r.customer_name, r.reviewed_at, c.customer_code
    FROM customer_registration_requests r
    JOIN customers c ON c.id = r.customer_id
    WHERE r.store_id IN (${placeholders(scopedIds.length)})
      AND r.status = 'APPROVED' AND r.customer_id IS NOT NULL
      AND r.reviewed_at >= datetime('now', '-7 days')
    ORDER BY r.reviewed_at DESC
    LIMIT 50
  `).bind(...scopedIds).all();

  const newMembers = [];
  for (const row of memberRows.results ?? []) {
    newMembers.push({
      customerId: row.customer_id,
      customerCode: row.customer_code,
      customerName: row.customer_name,
      occasion: 'NEW_MEMBER',
      referenceId: row.request_id,
      reviewedAt: row.reviewed_at,
      alreadyGranted: await coinAlreadyGranted(db, row.customer_id, 'NEW_MEMBER', row.request_id)
    });
  }

  return json({ birthdays, newMembers });
}

async function handleGrantCoins(db, scopedIds, customerId, request, management, store) {
  const current = await findCustomerById(db, customerId, scopedIds);
  if (!current) return json({ error: 'Pelanggan tidak ditemukan di jaringan gerai ini.' }, 404);

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload coin tidak valid.' }, 400);
  const amount = Number(body.value?.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > 1000) {
    return json({ error: 'Jumlah coin harus bilangan bulat 1-1000.' }, 400);
  }

  const occasion = String(body.value?.occasion || '').toUpperCase();
  let referenceType = 'ADMIN_MANUAL';
  let referenceId = '';
  if (occasion === 'BIRTHDAY' || occasion === 'NEW_MEMBER') {
    referenceType = occasion;
    referenceId = text(body.value?.referenceId, 60);
    if (!referenceId) return json({ error: 'referenceId kejadian wajib dikirim.' }, 400);
    if (occasion === 'NEW_MEMBER') {
      const approvedRequest = await db.prepare(`
        SELECT id FROM customer_registration_requests WHERE id = ? AND customer_id = ? AND status = 'APPROVED'
      `).bind(referenceId, customerId).first();
      if (!approvedRequest) return json({ error: 'Request pendaftaran tidak cocok / belum di-ACC.' }, 404);
    }
  }

  const actor = managementActorLabel(management);
  const notes = text(body.value?.notes, 200) || `Diberikan ${actor.role}${actor.id ? ` ${actor.id}` : ''}`;
  try {
    await db.prepare(`
      INSERT INTO customer_coin_ledger (
        id, customer_id, share_group_id, source_store_id, coins_delta, activity_type,
        reference_type, reference_id, notes, created_at
      ) VALUES (?, ?, NULL, ?, ?, 'GRANT', ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(`coin_${crypto.randomUUID()}`, customerId, store.id, amount, referenceType, referenceId, notes).run();
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('unique')) {
      return json({ error: 'Coin untuk kejadian ini sudah pernah diberikan.', code: 'COIN_ALREADY_GRANTED' }, 409);
    }
    throw error;
  }

  const balanceRow = await db.prepare(`
    SELECT COALESCE(SUM(coins_delta), 0) AS balance FROM customer_coin_ledger WHERE customer_id = ?
  `).bind(customerId).first();
  return json({ ok: true, customerId, coins: Number(balanceRow?.balance ?? 0) }, 201);
}

export async function handleCustomerApi(request, env, pathname) {
  const isCustomerAuth = pathname.startsWith('/api/customer/');
  const isAdminMaster = pathname.startsWith('/api/admin/customers');
  if (!isCustomerAuth && !isAdminMaster) return null;

  const db = env.DB;
  const store = await selectedStore(db, request, true);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const scope = await resolveCustomerScope(db, store.id);
  const scopedIds = scope.storeIds;

  if (isCustomerAuth) {
    if (request.method === 'POST' && pathname === '/api/customer/login') {
      const body = await readJson(request);
      if (!body.ok) return json({ error: 'Payload login pelanggan tidak valid.' }, 400);
      const username = usernameText(body.value?.username);
      const password = String(body.value?.password ?? '');
      if (!username || !password) return json({ error: 'Username dan password wajib diisi.' }, 400);

      const rows = await db.prepare(`
        SELECT c.id, c.store_id, c.customer_code, c.username, c.password_hash,
               c.customer_name, c.phone, c.email, c.notes, c.birth_date, c.is_active,
               c.created_at, c.updated_at, s.code AS store_code, s.store_name
        FROM customers c
        JOIN stores s ON s.id = c.store_id
        WHERE c.store_id IN (${placeholders(scopedIds.length)})
          AND c.username = ? COLLATE NOCASE
          AND c.is_active = 1 AND s.is_active = 1
      `).bind(...scopedIds, username).all();
      const passwordHash = await hashCredential(password);
      const matches = (rows.results ?? []).filter(row => row.password_hash && row.password_hash === passwordHash);
      if (!matches.length) return json({ error: 'Username atau password pelanggan salah untuk jaringan gerai ini.' }, 401);
      if (matches.length > 1) return json({ error: 'Akun pelanggan bentrok di jaringan gerai. Hubungi Owner.', code: 'AMBIGUOUS_CUSTOMER_LOGIN' }, 409);
      const row = matches[0];

      const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
      const tokenHash = await hashCredential(token);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + CUSTOMER_SESSION_HOURS * 60 * 60 * 1000).toISOString();
      await db.batch([
        db.prepare('DELETE FROM customer_sessions WHERE expires_at <= ?').bind(now.toISOString()),
        db.prepare('INSERT INTO customer_sessions (token_hash, customer_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
          .bind(tokenHash, row.id, now.toISOString(), expiresAt)
      ]);
      return json({ token, expiresAt, customer: mapCustomer(row), sharing: scope.group });
    }

    if (request.method === 'GET' && pathname === '/api/customer/me') {
      const auth = await requireCustomer(request, db, scopedIds);
      return auth.ok ? json({ customer: auth.customer, sharing: scope.group }) : auth.response;
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
      SELECT c.id, c.store_id, c.customer_code, c.username, c.password_hash, c.customer_name,
             c.phone, c.email, c.notes, c.birth_date, c.is_active, c.created_at, c.updated_at,
             s.code AS store_code, s.store_name
      FROM customers c
      JOIN stores s ON s.id = c.store_id
      WHERE c.store_id IN (${placeholders(scopedIds.length)})
      ORDER BY c.customer_name COLLATE NOCASE, c.created_at
    `).bind(...scopedIds).all();
    const todayMonthDay = getJakartaBusinessDate().slice(5);
    const customers = (rows.results ?? []).map(row => ({
      ...mapCustomer(row),
      isBirthdayToday: Boolean(row.birth_date) && row.birth_date.slice(5) === todayMonthDay
    }));
    return json({ store, sharing: scope.group, sharedStores: scope.stores, customers });
  }

  if (request.method === 'GET' && pathname === '/api/admin/customers/coin-alerts') {
    return handleCoinAlerts(db, scopedIds);
  }

  if (request.method === 'POST' && pathname === '/api/admin/customers') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload pelanggan tidak valid.' }, 400);
    const customerName = text(body.value?.customerName, 100);
    const username = usernameText(body.value?.username) || null;
    const password = String(body.value?.password ?? '');
    const birthDate = text(body.value?.birthDate, 10);
    if (!customerName) return json({ error: 'Nama pelanggan wajib diisi.' }, 400);
    if (birthDate && !BIRTH_DATE_RE.test(birthDate)) return json({ error: 'Tanggal lahir harus format YYYY-MM-DD.' }, 400);
    if ((username && password.length < 6) || (!username && password)) {
      return json({ error: 'Untuk akun login, isi username dan password minimal 6 karakter.' }, 400);
    }
    if (username) {
      const duplicate = await db.prepare(`
        SELECT id FROM customers
        WHERE store_id IN (${placeholders(scopedIds.length)}) AND username = ? COLLATE NOCASE
        LIMIT 1
      `).bind(...scopedIds, username).first();
      if (duplicate) return json({ error: 'Username pelanggan sudah dipakai di jaringan gerai yang berbagi pelanggan.' }, 409);
    }

    const id = `customer_${crypto.randomUUID()}`;
    const code = customerCode(store.code);
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO customers (
        id, store_id, customer_code, username, password_hash, customer_name,
        phone, email, notes, birth_date, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).bind(
      id, store.id, code, username, username ? await hashCredential(password) : '', customerName,
      text(body.value?.phone, 40), text(body.value?.email, 120), text(body.value?.notes, 500), birthDate, now, now
    ).run();
    return json({ ok: true, customer: mapCustomer(await findCustomerById(db, id, [store.id])) }, 201);
  }

  const coinMatch = pathname.match(/^\/api\/admin\/customers\/([^/]+)\/coins$/);
  if (coinMatch && request.method === 'POST') {
    return handleGrantCoins(db, scopedIds, decodeURIComponent(coinMatch[1]), request, management, store);
  }

  const match = pathname.match(/^\/api\/admin\/customers\/([^/]+)$/);
  if (!match) return json({ error: 'Route master pelanggan tidak ditemukan.' }, 404);
  const id = decodeURIComponent(match[1]);
  const current = await findCustomerById(db, id, scopedIds);
  if (!current) return json({ error: 'Pelanggan tidak ditemukan di jaringan gerai ini.' }, 404);

  if (request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload pelanggan tidak valid.' }, 400);
    const customerName = text(body.value?.customerName ?? current.customer_name, 100);
    const username = body.value?.username === undefined ? current.username : (usernameText(body.value.username) || null);
    const password = String(body.value?.password ?? '');
    const isActive = body.value?.isActive === false ? 0 : 1;
    const birthDate = text(body.value?.birthDate ?? current.birth_date, 10);
    if (!customerName) return json({ error: 'Nama pelanggan wajib diisi.' }, 400);
    if (birthDate && !BIRTH_DATE_RE.test(birthDate)) return json({ error: 'Tanggal lahir harus format YYYY-MM-DD.' }, 400);
    if (password && password.length < 6) return json({ error: 'Password minimal 6 karakter.' }, 400);
    if (username && !current.password_hash && !password) {
      return json({ error: 'Password wajib diisi saat akun login pertama kali diaktifkan.' }, 400);
    }
    if (username) {
      const duplicate = await db.prepare(`
        SELECT id FROM customers
        WHERE store_id IN (${placeholders(scopedIds.length)}) AND username = ? COLLATE NOCASE AND id <> ?
        LIMIT 1
      `).bind(...scopedIds, username, id).first();
      if (duplicate) return json({ error: 'Username pelanggan sudah dipakai di jaringan gerai yang berbagi pelanggan.' }, 409);
    }

    const passwordHash = !username ? '' : (password ? await hashCredential(password) : current.password_hash);
    await db.prepare(`
      UPDATE customers
      SET username = ?, password_hash = ?, customer_name = ?, phone = ?, email = ?, notes = ?,
          birth_date = ?, is_active = ?, updated_at = ?
      WHERE id = ? AND store_id = ?
    `).bind(
      username, passwordHash, customerName, text(body.value?.phone ?? current.phone, 40),
      text(body.value?.email ?? current.email, 120), text(body.value?.notes ?? current.notes, 500),
      birthDate, isActive, new Date().toISOString(), id, current.store_id
    ).run();
    if (password || !username || !isActive) {
      await db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').bind(id).run();
    }
    return json({ ok: true });
  }

  if (request.method === 'DELETE') {
    await db.batch([
      db.prepare('UPDATE customers SET is_active = 0, updated_at = ? WHERE id = ? AND store_id = ?').bind(new Date().toISOString(), id, current.store_id),
      db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').bind(id)
    ]);
    return json({ ok: true });
  }

  return json({ error: 'Method master pelanggan tidak didukung.' }, 405);
}
