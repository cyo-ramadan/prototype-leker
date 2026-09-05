import { json, readJson } from './http.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { requireManagement } from './owner-auth.js';

// Master Karyawan (migration 0072). Pemisahan "orang" dari "akun login":
// employees menyimpan manusianya (milik Entity), employee_account_links
// menyimpan siapa memegang username apa dari kapan sampai kapan.
//
// Aturan wewenang di modul ini:
// - Gerai (Admin Gerai) boleh MELIHAT semua karyawan di bawah entity-nya --
//   itu yang bikin gerai lain bisa menautkan CS backup ke username-nya
//   sendiri tanpa harus mendaftarkan ulang orang yang sama.
// - Tapi gerai hanya boleh MENGUBAH/menonaktifkan karyawan yang gerainya
//   sendiri yang merekrut (home_store_id). Karyawan gerai tetangga atau
//   karyawan tingkat Entity (mis. OB kantor, home_store_id NULL) cuma bisa
//   diubah Entity Admin/Owner.
// - Menautkan/melepas username selalu dibatasi ke username milik gerai yang
//   sedang dibuka -- gerai tidak bisa mengutak-atik username gerai lain.

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

const ACCOUNT_SOURCES = {
  CASHIER: { table: 'cashiers', nameColumn: 'employee_name', scope: 'STORE' },
  STORE_ADMIN: { table: 'store_admins', nameColumn: 'display_name', scope: 'STORE' },
  ENTITY_ADMIN: { table: 'entity_admins', nameColumn: 'display_name', scope: 'ENTITY' }
};

function mapEmployee(row, storeId) {
  return {
    id: row.id,
    entityId: row.entity_id,
    fullName: row.full_name,
    phone: row.phone || '',
    address: row.address || '',
    idNumber: row.id_number || '',
    note: row.note || '',
    status: row.status,
    homeStoreId: row.home_store_id || null,
    homeStoreCode: row.home_store_code || '',
    homeStoreName: row.home_store_name || '',
    // Penanda yang diminta Bos Cyo: dari gerai mana pun, kelihatan ini
    // karyawan rekrutan gerai siapa.
    ownedByThisStore: Boolean(row.home_store_id && row.home_store_id === storeId),
    entityLevel: !row.home_store_id,
    createdAt: row.created_at,
    links: []
  };
}

function mapLink(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    accountType: row.account_type,
    accountId: row.account_id,
    username: row.username || '',
    accountName: row.account_name || '',
    storeId: row.store_id || null,
    storeCode: row.store_code || '',
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || null,
    endedReason: row.ended_reason || ''
  };
}

async function selectedAdminStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

async function loadLinks(db, entityId, { activeOnly = true } = {}) {
  const rows = await db.prepare(`
    SELECT l.id, l.employee_id, l.account_type, l.account_id, l.store_id,
           l.effective_from, l.effective_to, l.ended_reason,
           s.code AS store_code,
           COALESCE(c.username, a.username, ea.username) AS username,
           COALESCE(c.employee_name, a.display_name, ea.display_name) AS account_name
    FROM employee_account_links l
    LEFT JOIN stores s ON s.id = l.store_id
    LEFT JOIN cashiers c ON l.account_type = 'CASHIER' AND c.id = l.account_id
    LEFT JOIN store_admins a ON l.account_type = 'STORE_ADMIN' AND a.id = l.account_id
    LEFT JOIN entity_admins ea ON l.account_type = 'ENTITY_ADMIN' AND ea.id = l.account_id
    WHERE l.entity_id = ? ${activeOnly ? 'AND l.effective_to IS NULL' : ''}
    ORDER BY l.effective_from DESC, l.id
  `).bind(entityId).all();
  return (rows.results ?? []).map(mapLink);
}

// Username di gerai ini yang belum dipegang siapa pun -- ini yang muncul di
// dropdown "tautkan ke username". Username yang sudah punya pemegang aktif
// sengaja tidak ditawarkan; harus dilepas dulu dari pemegang lama.
async function loadLinkableAccounts(db, storeId) {
  const rows = await db.prepare(`
    SELECT 'CASHIER' AS account_type, c.id AS account_id, c.username, c.employee_name AS account_name
    FROM cashiers c
    WHERE c.store_id = ? AND c.is_active = 1
      AND NOT EXISTS (
        SELECT 1 FROM employee_account_links l
        WHERE l.account_type = 'CASHIER' AND l.account_id = c.id AND l.effective_to IS NULL
      )
    UNION ALL
    SELECT 'STORE_ADMIN', a.id, a.username, a.display_name
    FROM store_admins a
    WHERE a.store_id = ? AND a.is_active = 1
      AND NOT EXISTS (
        SELECT 1 FROM employee_account_links l
        WHERE l.account_type = 'STORE_ADMIN' AND l.account_id = a.id AND l.effective_to IS NULL
      )
    ORDER BY account_type, username
  `).bind(storeId, storeId).all();
  return (rows.results ?? []).map(row => ({
    accountType: row.account_type,
    accountId: row.account_id,
    username: row.username,
    accountName: row.account_name
  }));
}

async function loadEmployees(db, entityId, storeId, { includeHistory = false } = {}) {
  const rows = await db.prepare(`
    SELECT e.*, s.code AS home_store_code, s.store_name AS home_store_name
    FROM employees e
    LEFT JOIN stores s ON s.id = e.home_store_id
    WHERE e.entity_id = ?
    ORDER BY e.status, e.full_name COLLATE NOCASE
  `).bind(entityId).all();
  const employees = (rows.results ?? []).map(row => mapEmployee(row, storeId));
  const links = await loadLinks(db, entityId, { activeOnly: !includeHistory });
  const byEmployee = new Map();
  for (const link of links) {
    if (!byEmployee.has(link.employeeId)) byEmployee.set(link.employeeId, []);
    byEmployee.get(link.employeeId).push(link);
  }
  for (const employee of employees) employee.links = byEmployee.get(employee.id) ?? [];
  return employees;
}

function actorFrom(auth) {
  if (auth.owner) return { role: 'OWNER', id: auth.owner.id, entityWide: true };
  if (auth.entityAdmin) return { role: 'ENTITY_ADMIN', id: auth.entityAdmin.id, entityWide: true };
  if (auth.admin) return { role: 'ADMIN', id: auth.admin.id, entityWide: false };
  return { role: 'LEGACY_PIN', id: '', entityWide: true };
}

function canManageEmployee(actor, store, employee) {
  if (actor.entityWide) return true;
  return employee.home_store_id === store.id;
}

export async function handleEmployeeMasterApi(request, env, pathname) {
  const isEmployeeRoute = pathname === '/api/admin/employees' || pathname.startsWith('/api/admin/employees/');
  const isLinkRoute = pathname.startsWith('/api/admin/employee-links/');
  if (!isEmployeeRoute && !isLinkRoute) return null;

  const db = env.DB;
  const auth = await requireManagement(request, db);
  if (!auth.ok) return auth.response;
  const store = await selectedAdminStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  if (!store.entityId) return json({ error: 'Gerai ini belum terhubung ke Entity mana pun.', code: 'STORE_WITHOUT_ENTITY' }, 409);
  const actor = actorFrom(auth);

  if (request.method === 'GET' && pathname === '/api/admin/employees') {
    const includeHistory = new URL(request.url).searchParams.get('history') === '1';
    return json({
      store,
      employees: await loadEmployees(db, store.entityId, store.id, { includeHistory }),
      linkableAccounts: await loadLinkableAccounts(db, store.id),
      canCreateEntityLevel: actor.entityWide
    });
  }

  if (request.method === 'POST' && pathname === '/api/admin/employees') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload karyawan tidak valid.' }, 400);
    const fullName = text(body.value?.fullName, 100);
    if (!fullName) return json({ error: 'Nama karyawan wajib diisi.' }, 400);

    // Karyawan tingkat Entity (tidak menempel gerai mana pun, mis. OB kantor)
    // hanya boleh dibuat Entity Admin/Owner -- Admin Gerai selalu merekrut
    // atas nama gerainya sendiri.
    const wantsEntityLevel = body.value?.scope === 'ENTITY';
    if (wantsEntityLevel && !actor.entityWide) {
      return json({ error: 'Karyawan tingkat Entity hanya bisa dibuat Entity Admin atau Owner.', code: 'ENTITY_LEVEL_FORBIDDEN' }, 403);
    }
    const homeStoreId = wantsEntityLevel ? null : store.id;

    const id = `emp_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO employees (
        id, entity_id, home_store_id, full_name, phone, address, id_number, note,
        status, created_by_role, created_by_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      id, store.entityId, homeStoreId, fullName,
      text(body.value?.phone, 40), text(body.value?.address, 200),
      text(body.value?.idNumber, 40), text(body.value?.note, 500),
      actor.role, actor.id
    ).run();
    return json({ ok: true, id }, 201);
  }

  const linkCreateMatch = pathname.match(/^\/api\/admin\/employees\/([^/]+)\/links$/);
  if (request.method === 'POST' && linkCreateMatch) {
    const employeeId = decodeURIComponent(linkCreateMatch[1]);
    const employee = await db.prepare('SELECT * FROM employees WHERE id = ? AND entity_id = ?').bind(employeeId, store.entityId).first();
    if (!employee) return json({ error: 'Karyawan tidak ditemukan di entity gerai ini.' }, 404);
    if (employee.status !== 'ACTIVE') return json({ error: 'Karyawan nonaktif tidak bisa ditautkan ke username.', code: 'EMPLOYEE_INACTIVE' }, 409);

    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tautan tidak valid.' }, 400);
    const accountType = text(body.value?.accountType, 20).toUpperCase();
    const accountId = text(body.value?.accountId, 180);
    const source = ACCOUNT_SOURCES[accountType];
    if (!source || !accountId) return json({ error: 'Jenis akun atau username tidak valid.' }, 400);
    if (source.scope === 'ENTITY' && !actor.entityWide) {
      return json({ error: 'Username Entity Admin hanya bisa ditautkan oleh Entity Admin atau Owner.', code: 'ENTITY_ACCOUNT_FORBIDDEN' }, 403);
    }

    const account = source.scope === 'STORE'
      ? await db.prepare(`SELECT id FROM ${source.table} WHERE id = ? AND store_id = ? AND is_active = 1`).bind(accountId, store.id).first()
      : await db.prepare(`SELECT id FROM ${source.table} WHERE id = ? AND entity_id = ? AND is_active = 1`).bind(accountId, store.entityId).first();
    if (!account) return json({ error: 'Username tidak ditemukan atau bukan milik gerai ini.', code: 'ACCOUNT_OUT_OF_SCOPE' }, 404);

    const held = await db.prepare(`
      SELECT l.id, e.full_name FROM employee_account_links l
      JOIN employees e ON e.id = l.employee_id
      WHERE l.account_type = ? AND l.account_id = ? AND l.effective_to IS NULL
    `).bind(accountType, accountId).first();
    if (held) {
      return json({
        error: `Username ini masih dipegang ${held.full_name}. Lepas dulu tautannya sebelum dipasang ke karyawan lain.`,
        code: 'ACCOUNT_ALREADY_HELD'
      }, 409);
    }

    const id = `emplink_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO employee_account_links (
        id, employee_id, entity_id, account_type, account_id, store_id,
        effective_from, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, employeeId, store.entityId, accountType, accountId,
      source.scope === 'ENTITY' ? null : store.id,
      new Date().toISOString(), new Date().toISOString()
    ).run();
    return json({ ok: true, id }, 201);
  }

  const linkCloseMatch = pathname.match(/^\/api\/admin\/employee-links\/([^/]+)$/);
  if (request.method === 'DELETE' && linkCloseMatch) {
    const linkId = decodeURIComponent(linkCloseMatch[1]);
    const link = await db.prepare('SELECT * FROM employee_account_links WHERE id = ? AND entity_id = ?').bind(linkId, store.entityId).first();
    if (!link) return json({ error: 'Tautan tidak ditemukan di entity gerai ini.' }, 404);
    if (link.effective_to) return json({ error: 'Tautan ini sudah dilepas sebelumnya.', code: 'LINK_ALREADY_CLOSED' }, 409);
    if (link.store_id && link.store_id !== store.id && !actor.entityWide) {
      return json({ error: 'Tautan username gerai lain hanya bisa dilepas dari gerai itu sendiri.', code: 'LINK_OUT_OF_SCOPE' }, 403);
    }

    const body = await readJson(request);
    const reason = body.ok ? text(body.value?.reason, 200) : '';
    // Tidak pernah kurang dari effective_from: kalau dilepas di milidetik yang
    // sama dengan saat ditautkan (salah pilih lalu langsung dibetulkan),
    // periodenya jadi nol -- itu sah, yang dilarang cuma mundur.
    const closedAt = new Date().toISOString();
    const result = await db.prepare(`
      UPDATE employee_account_links
      SET effective_to = MAX(?, effective_from), ended_reason = ?
      WHERE id = ? AND effective_to IS NULL
    `).bind(closedAt, reason, linkId).run();
    if (!result.success || Number(result.meta?.changes ?? 0) !== 1) {
      return json({ error: 'Tautan sudah berubah di request lain.' }, 409);
    }
    return json({ ok: true });
  }

  const employeeMatch = pathname.match(/^\/api\/admin\/employees\/([^/]+)$/);
  if (!employeeMatch) return json({ error: 'Route master karyawan tidak ditemukan.' }, 404);
  const employeeId = decodeURIComponent(employeeMatch[1]);
  const current = await db.prepare('SELECT * FROM employees WHERE id = ? AND entity_id = ?').bind(employeeId, store.entityId).first();
  if (!current) return json({ error: 'Karyawan tidak ditemukan di entity gerai ini.' }, 404);

  if (request.method === 'PATCH') {
    if (!canManageEmployee(actor, store, current)) {
      return json({
        error: 'Karyawan ini direkrut gerai lain. Perubahan data hanya bisa dilakukan gerai perekrut atau Entity Admin.',
        code: 'EMPLOYEE_NOT_OWNED_BY_STORE'
      }, 403);
    }
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload karyawan tidak valid.' }, 400);
    const fullName = text(body.value?.fullName ?? current.full_name, 100);
    if (!fullName) return json({ error: 'Nama karyawan wajib diisi.' }, 400);
    const status = body.value?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (status === 'INACTIVE') {
      const active = await db.prepare('SELECT COUNT(*) AS n FROM employee_account_links WHERE employee_id = ? AND effective_to IS NULL').bind(employeeId).first();
      if (Number(active?.n ?? 0) > 0) {
        return json({ error: 'Lepas dulu semua tautan username karyawan ini sebelum dinonaktifkan.', code: 'EMPLOYEE_STILL_LINKED' }, 409);
      }
    }
    await db.prepare(`
      UPDATE employees
      SET full_name = ?, phone = ?, address = ?, id_number = ?, note = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND entity_id = ?
    `).bind(
      fullName,
      text(body.value?.phone ?? current.phone, 40),
      text(body.value?.address ?? current.address, 200),
      text(body.value?.idNumber ?? current.id_number, 40),
      text(body.value?.note ?? current.note, 500),
      status, employeeId, store.entityId
    ).run();
    return json({ ok: true });
  }

  if (request.method === 'DELETE') {
    if (!canManageEmployee(actor, store, current)) {
      return json({
        error: 'Karyawan ini direkrut gerai lain. Nonaktifkan hanya bisa dilakukan gerai perekrut atau Entity Admin.',
        code: 'EMPLOYEE_NOT_OWNED_BY_STORE'
      }, 403);
    }
    const active = await db.prepare('SELECT COUNT(*) AS n FROM employee_account_links WHERE employee_id = ? AND effective_to IS NULL').bind(employeeId).first();
    if (Number(active?.n ?? 0) > 0) {
      return json({ error: 'Lepas dulu semua tautan username karyawan ini sebelum dinonaktifkan.', code: 'EMPLOYEE_STILL_LINKED' }, 409);
    }
    await db.prepare(`UPDATE employees SET status = 'INACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND entity_id = ?`).bind(employeeId, store.entityId).run();
    return json({ ok: true });
  }

  return json({ error: 'Method tidak didukung.' }, 405);
}
