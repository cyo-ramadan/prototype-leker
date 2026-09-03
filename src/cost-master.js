import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { requireCashier } from './cashier-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';

const text = (value, max = 220) => String(value ?? '').trim().slice(0, max);

function money(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

async function listCostTypes(db, storeId) {
  const rows = await db.prepare(`
    SELECT id, code, name, is_active
    FROM cost_types
    WHERE store_id = ?
    ORDER BY name COLLATE NOCASE, id
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    transactionCategoryCode: 'operational',
    isActive: Boolean(row.is_active)
  }));
}

async function listCosts(db, storeId, { activeOnly = false } = {}) {
  const rows = await db.prepare(`
    SELECT cm.id, cm.name, cm.contact, cm.outgoing_amount, cm.incoming_amount,
           cm.cost_type_id, cm.cost_group, cm.is_active,
           ct.code AS cost_type_code, ct.name AS cost_type_name
    FROM cost_masters cm
    JOIN cost_types ct ON ct.id = cm.cost_type_id AND ct.store_id = cm.store_id
    WHERE cm.store_id = ? ${activeOnly ? 'AND cm.is_active = 1 AND ct.is_active = 1' : ''}
    ORDER BY cm.cost_group COLLATE NOCASE, cm.name COLLATE NOCASE, cm.id
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    name: row.name,
    contact: row.contact || '',
    outgoingAmount: Number(row.outgoing_amount || 0),
    incomingAmount: Number(row.incoming_amount || 0),
    costTypeId: row.cost_type_id,
    costTypeCode: row.cost_type_code,
    costTypeName: row.cost_type_name,
    costGroup: row.cost_group,
    transactionCategoryCode: 'operational',
    isActive: Boolean(row.is_active)
  }));
}

function slugCode(value) {
  return String(value ?? '')
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

// Cost Master / Jenis Biaya is a POS business master, not an Accounting
// configuration proxy (ADR-029). It intentionally never selects, stores, or
// exposes an Accounting rule reference -- that column stays untouched (NULL)
// for every row created here.
async function normalizeCostType(db, storeId, body, currentId = null) {
  const name = text(body?.name, 100);
  if (!name) return { ok: false, error: 'Nama Jenis Biaya wajib diisi.' };
  const code = slugCode(body?.code) || slugCode(name);
  if (!code) return { ok: false, error: 'Kode Jenis Biaya tidak valid.' };
  const existing = await db.prepare('SELECT id FROM cost_types WHERE store_id = ? AND code = ?').bind(storeId, code).first();
  if (existing && existing.id !== currentId) return { ok: false, error: `Kode Jenis Biaya "${code}" sudah dipakai.` };
  return { ok: true, name, code, isActive: body?.isActive === false ? 0 : 1 };
}

async function normalizeCost(db, storeId, body) {
  const name = text(body?.name, 100);
  const contact = text(body?.contact, 120);
  const outgoingAmount = money(body?.outgoingAmount);
  const incomingAmount = money(body?.incomingAmount);
  const costTypeId = text(body?.costTypeId, 120);
  const costGroup = text(body?.costGroup, 80);
  if (!name || outgoingAmount === null || incomingAmount === null || !costTypeId || !costGroup) {
    return { ok: false, error: 'Nama, biaya keluar/masuk, Jenis Biaya, dan kelompok biaya wajib valid.' };
  }
  const type = await db.prepare('SELECT id FROM cost_types WHERE id = ? AND store_id = ? AND is_active = 1').bind(costTypeId, storeId).first();
  if (!type) return { ok: false, error: 'Jenis Biaya tidak aktif atau bukan milik gerai ini.' };
  return { ok: true, name, contact, outgoingAmount, incomingAmount, costTypeId, costGroup, isActive: body?.isActive === false ? 0 : 1 };
}

export async function handleCostMasterApi(request, env, pathname) {
  if (request.method === 'GET' && pathname === '/api/cashier/cost-masters/options') {
    const auth = await requireCashier(request, env.DB);
    if (!auth.ok) return auth.response;
    return json({ transactionCategoryCode: 'operational', costs: await listCosts(env.DB, auth.cashier.store.id, { activeOnly: true }) });
  }
  if (!pathname.startsWith('/api/admin/master/costs') && !pathname.startsWith('/api/admin/master/cost-types')) return null;
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (request.method === 'GET' && pathname === '/api/admin/master/costs') {
    return json({ store, transactionCategoryCode: 'operational', costTypes: await listCostTypes(env.DB, store.id), costs: await listCosts(env.DB, store.id) });
  }
  if (request.method === 'POST' && pathname === '/api/admin/master/cost-types') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const normalized = await normalizeCostType(env.DB, store.id, body.value);
    if (!normalized.ok) return json({ error: normalized.error }, 400);
    const id = `cost_type_${crypto.randomUUID()}`;
    await env.DB.prepare(`
      INSERT INTO cost_types (id, store_id, code, name, is_active)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, store.id, normalized.code, normalized.name, normalized.isActive).run();
    return json({ ok: true, id, costTypes: await listCostTypes(env.DB, store.id) }, 201);
  }
  const costTypeMatch = pathname.match(/^\/api\/admin\/master\/cost-types\/([^/]+)$/);
  if (request.method === 'PATCH' && costTypeMatch) {
    const costTypeId = decodeURIComponent(costTypeMatch[1]);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const normalized = await normalizeCostType(env.DB, store.id, body.value, costTypeId);
    if (!normalized.ok) return json({ error: normalized.error }, 400);
    const result = await env.DB.prepare(`
      UPDATE cost_types SET code = ?, name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(normalized.code, normalized.name, normalized.isActive, costTypeId, store.id).run();
    if (!result.meta?.changes) return json({ error: 'Jenis Biaya tidak ditemukan.' }, 404);
    return json({ ok: true, costTypes: await listCostTypes(env.DB, store.id) });
  }
  if (request.method === 'POST' && pathname === '/api/admin/master/costs') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const normalized = await normalizeCost(env.DB, store.id, body.value);
    if (!normalized.ok) return json({ error: normalized.error }, 400);
    const id = `cost_${crypto.randomUUID()}`;
    await env.DB.prepare(`
      INSERT INTO cost_masters (
        id, store_id, name, contact, outgoing_amount, incoming_amount,
        cost_type_id, cost_group, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, store.id, normalized.name, normalized.contact, normalized.outgoingAmount,
      normalized.incomingAmount, normalized.costTypeId, normalized.costGroup, normalized.isActive).run();
    return json({ ok: true, id }, 201);
  }
  const match = pathname.match(/^\/api\/admin\/master\/costs\/([^/]+)$/);
  if (request.method === 'PATCH' && match) {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const normalized = await normalizeCost(env.DB, store.id, body.value);
    if (!normalized.ok) return json({ error: normalized.error }, 400);
    const result = await env.DB.prepare(`
      UPDATE cost_masters
      SET name = ?, contact = ?, outgoing_amount = ?, incoming_amount = ?,
          cost_type_id = ?, cost_group = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(normalized.name, normalized.contact, normalized.outgoingAmount,
      normalized.incomingAmount, normalized.costTypeId, normalized.costGroup,
      normalized.isActive, decodeURIComponent(match[1]), store.id).run();
    return result.meta?.changes ? json({ ok: true }) : json({ error: 'Master Biaya tidak ditemukan.' }, 404);
  }
  return json({ error: 'Route Master Biaya tidak ditemukan.' }, 404);
}
