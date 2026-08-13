import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';

const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const flag = value => value === false ? 0 : 1;

function codeText(value, max = 32) {
  return text(value, max)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function canonicalNonNegativeDecimal(value, maxScale = 6) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(0|[1-9]\d*)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = match[2] || '';
  if (fraction.length > maxScale || match[1].length > 12) return null;
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction ? `${match[1]}.${normalizedFraction}` : match[1];
}

function percentageToBps(value) {
  const raw = String(value ?? '0').trim();
  const match = raw.match(/^(0|[1-9]\d?)(?:\.(\d{1,2}))?$|^100(?:\.0{1,2})?$/);
  if (!match) return null;
  const [wholeText, fractionText = ''] = raw.split('.');
  const whole = Number(wholeText);
  const bps = (whole * 100) + Number(fractionText.padEnd(2, '0') || 0);
  return bps >= 0 && bps <= 10000 ? bps : null;
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

async function context(request, env) {
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth;
  const store = await selectedStore(env.DB, request);
  if (!store) return { ok: false, response: json({ error: 'Gerai tidak ditemukan.' }, 404) };
  return { ok: true, auth, store };
}

async function listPrincipals(db, storeId) {
  const [admins, cashiers] = await db.batch([
    db.prepare(`SELECT id, display_name AS name FROM store_admins WHERE store_id = ? AND is_active = 1 ORDER BY display_name COLLATE NOCASE`).bind(storeId),
    db.prepare(`SELECT id, employee_name AS name FROM cashiers WHERE store_id = ? AND is_active = 1 ORDER BY employee_name COLLATE NOCASE`).bind(storeId)
  ]);
  return [
    ...(admins.results ?? []).map(row => ({ type: 'ADMIN', id: row.id, name: row.name })),
    ...(cashiers.results ?? []).map(row => ({ type: 'CASHIER', id: row.id, name: row.name }))
  ];
}

async function listWarehouses(db, storeId) {
  const rows = await db.prepare(`
    SELECT w.id, w.code, w.name, w.location_name, w.is_active,
           o.quantity_tolerance, o.percentage_tolerance_bps, o.schedule_type,
           o.schedule_day, o.requires_approval
    FROM warehouses w
    LEFT JOIN warehouse_stock_opname_settings o ON o.warehouse_id = w.id AND o.store_id = w.store_id
    WHERE w.store_id = ?
    ORDER BY w.name COLLATE NOCASE, w.code
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    locationName: row.location_name || '',
    isActive: Boolean(row.is_active),
    opname: {
      quantityTolerance: row.quantity_tolerance ?? '0',
      percentageTolerance: Number(row.percentage_tolerance_bps || 0) / 100,
      scheduleType: row.schedule_type || 'MANUAL',
      scheduleDay: row.schedule_day == null ? null : Number(row.schedule_day),
      requiresApproval: row.requires_approval == null ? true : Boolean(row.requires_approval)
    }
  }));
}

async function listAccess(db, storeId) {
  const rows = await db.prepare(`
    SELECT id, warehouse_id, principal_type, principal_id, principal_name_snapshot,
           can_stock_opname, can_transfer, can_receive, can_issue, is_active
    FROM warehouse_access
    WHERE store_id = ?
    ORDER BY warehouse_id, principal_type, principal_name_snapshot COLLATE NOCASE
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    warehouseId: row.warehouse_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    principalName: row.principal_name_snapshot,
    canStockOpname: Boolean(row.can_stock_opname),
    canTransfer: Boolean(row.can_transfer),
    canReceive: Boolean(row.can_receive),
    canIssue: Boolean(row.can_issue),
    isActive: Boolean(row.is_active)
  }));
}

async function listRegisteredTransactions(db, storeId) {
  const rows = await db.prepare(`
    SELECT id, code, name, description, is_active
    FROM transaction_categories
    WHERE store_id = ? AND registered_by_module = 'WAREHOUSE'
    ORDER BY code
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description || '',
    isActive: Boolean(row.is_active)
  }));
}

async function bootstrap(db, store) {
  const [warehouses, access, principals, registeredTransactions] = await Promise.all([
    listWarehouses(db, store.id),
    listAccess(db, store.id),
    listPrincipals(db, store.id),
    listRegisteredTransactions(db, store.id)
  ]);
  return {
    contract: 'MAXI_WAREHOUSE_SETTINGS_V1',
    accountingMappingOwnership: 'ACCOUNTING_SETTINGS',
    store,
    warehouses,
    access,
    principals,
    registeredTransactions
  };
}

async function warehouseRow(db, storeId, id) {
  return db.prepare(`SELECT * FROM warehouses WHERE id = ? AND store_id = ?`).bind(id, storeId).first();
}

async function createWarehouse(db, store, body) {
  const code = codeText(body?.code, 32);
  const name = text(body?.name, 100);
  const locationName = text(body?.locationName, 140);
  if (!code || !name) return json({ error: 'Kode dan nama gudang wajib diisi.' }, 400);
  const id = `warehouse_${store.id}_${crypto.randomUUID()}`;
  try {
    await db.batch([
      db.prepare(`INSERT INTO warehouses (id, store_id, code, name, location_name, is_active) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(id, store.id, code, name, locationName, flag(body?.isActive)),
      db.prepare(`INSERT INTO warehouse_stock_opname_settings (warehouse_id, store_id) VALUES (?, ?)`)
        .bind(id, store.id)
    ]);
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Kode/nama gudang sudah dipakai pada gerai ini.' }, 409);
    throw error;
  }
  return json({ ok: true, id }, 201);
}

async function updateWarehouse(db, store, id, body) {
  const current = await warehouseRow(db, store.id, id);
  if (!current) return json({ error: 'Gudang tidak ditemukan.' }, 404);
  const name = text(body?.name ?? current.name, 100);
  const locationName = text(body?.locationName ?? current.location_name, 140);
  const isActive = body?.isActive === undefined ? Number(current.is_active) : flag(body.isActive);
  if (!name) return json({ error: 'Nama gudang wajib diisi.' }, 400);
  await db.prepare(`UPDATE warehouses SET name = ?, location_name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?`)
    .bind(name, locationName, isActive, id, store.id).run();
  return json({ ok: true });
}

async function principal(db, storeId, type, id) {
  if (type === 'ADMIN') {
    return db.prepare(`SELECT id, display_name AS name FROM store_admins WHERE id = ? AND store_id = ? AND is_active = 1`).bind(id, storeId).first();
  }
  if (type === 'CASHIER') {
    return db.prepare(`SELECT id, employee_name AS name FROM cashiers WHERE id = ? AND store_id = ? AND is_active = 1`).bind(id, storeId).first();
  }
  return null;
}

async function saveAccess(db, store, warehouseId, body) {
  if (!await warehouseRow(db, store.id, warehouseId)) return json({ error: 'Gudang tidak ditemukan.' }, 404);
  const principalType = text(body?.principalType, 12).toUpperCase();
  const principalId = text(body?.principalId, 180);
  const person = await principal(db, store.id, principalType, principalId);
  if (!person) return json({ error: 'Admin/Kasir aktif wajib dipilih dari gerai ini.' }, 400);
  const id = `whaccess_${store.id}_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO warehouse_access (
      id, store_id, warehouse_id, principal_type, principal_id, principal_name_snapshot,
      can_stock_opname, can_transfer, can_receive, can_issue, is_active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(warehouse_id, principal_type, principal_id) DO UPDATE SET
      principal_name_snapshot = excluded.principal_name_snapshot,
      can_stock_opname = excluded.can_stock_opname,
      can_transfer = excluded.can_transfer,
      can_receive = excluded.can_receive,
      can_issue = excluded.can_issue,
      is_active = excluded.is_active,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    id, store.id, warehouseId, principalType, principalId, person.name,
    body?.canStockOpname === true ? 1 : 0,
    body?.canTransfer === true ? 1 : 0,
    body?.canReceive === true ? 1 : 0,
    body?.canIssue === true ? 1 : 0,
    body?.isActive === false ? 0 : 1
  ).run();
  return json({ ok: true });
}

async function saveOpname(db, store, warehouseId, body) {
  if (!await warehouseRow(db, store.id, warehouseId)) return json({ error: 'Gudang tidak ditemukan.' }, 404);
  const quantityTolerance = canonicalNonNegativeDecimal(body?.quantityTolerance ?? '0');
  const percentageToleranceBps = percentageToBps(body?.percentageTolerance ?? '0');
  const scheduleType = text(body?.scheduleType || 'MANUAL', 20).toUpperCase();
  const scheduleDayValue = body?.scheduleDay == null || body.scheduleDay === '' ? null : Number(body.scheduleDay);
  const scheduleDay = Number.isInteger(scheduleDayValue) && scheduleDayValue >= 1 && scheduleDayValue <= 31 ? scheduleDayValue : null;
  if (quantityTolerance === null || percentageToleranceBps === null || !['MANUAL','DAILY','WEEKLY','MONTHLY'].includes(scheduleType)) {
    return json({ error: 'Tolerance atau jadwal stock opname tidak valid.' }, 400);
  }
  if ((scheduleType === 'WEEKLY' || scheduleType === 'MONTHLY') && scheduleDay === null) {
    return json({ error: 'Jadwal mingguan/bulanan membutuhkan angka hari 1–31.' }, 400);
  }
  await db.prepare(`
    INSERT INTO warehouse_stock_opname_settings (
      warehouse_id, store_id, quantity_tolerance, percentage_tolerance_bps,
      schedule_type, schedule_day, requires_approval, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(warehouse_id) DO UPDATE SET
      quantity_tolerance = excluded.quantity_tolerance,
      percentage_tolerance_bps = excluded.percentage_tolerance_bps,
      schedule_type = excluded.schedule_type,
      schedule_day = excluded.schedule_day,
      requires_approval = excluded.requires_approval,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    warehouseId, store.id, quantityTolerance, percentageToleranceBps,
    scheduleType, scheduleType === 'DAILY' || scheduleType === 'MANUAL' ? null : scheduleDay,
    body?.requiresApproval === false ? 0 : 1
  ).run();
  return json({ ok: true });
}

export async function handleWarehouseSettingsApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/settings/warehouse')) return null;
  const ctx = await context(request, env);
  if (!ctx.ok) return ctx.response;
  const { store } = ctx;

  if (request.method === 'GET' && pathname === '/api/admin/settings/warehouse') {
    return json(await bootstrap(env.DB, store));
  }

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload Warehouse Settings tidak valid.' }, 400);

  if (request.method === 'POST' && pathname === '/api/admin/settings/warehouse/warehouses') return createWarehouse(env.DB, store, body.value);
  const warehouseMatch = pathname.match(/^\/api\/admin\/settings\/warehouse\/warehouses\/([^/]+)$/);
  if (request.method === 'PATCH' && warehouseMatch) return updateWarehouse(env.DB, store, decodeURIComponent(warehouseMatch[1]), body.value);

  const accessMatch = pathname.match(/^\/api\/admin\/settings\/warehouse\/warehouses\/([^/]+)\/access$/);
  if (request.method === 'PUT' && accessMatch) return saveAccess(env.DB, store, decodeURIComponent(accessMatch[1]), body.value);

  const opnameMatch = pathname.match(/^\/api\/admin\/settings\/warehouse\/warehouses\/([^/]+)\/opname-settings$/);
  if (request.method === 'PUT' && opnameMatch) return saveOpname(env.DB, store, decodeURIComponent(opnameMatch[1]), body.value);

  return json({ error: 'Route Warehouse Settings tidak ditemukan.' }, 404);
}
