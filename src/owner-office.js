import { json, readJson } from './http.js';
import { bearerToken, ownerFromRequest, entityAdminFromRequest, hashCredential } from './owner-auth.js';
import { resolveStore } from './stores.js';
import { resolveTenantId, getTenantPolicyChoice, UI_SKIN_KEY } from './tenant-policy.js';

// Office credentials are an envelope around a live human management session,
// not a new authority. Never persist this envelope in browser storage or a URL.
// Every cashier request rechecks the human, entity, tenant, H skin and revision.
export const OWNER_OFFICE_TOKEN_PREFIX = 'office-h.';
export const OWNER_OFFICE_CASHIER_PREFIX = 'cashier_office_';
export const OWNER_OFFICE_EPOCH_KEY = 'owner_office_epoch';
const configKey = entityId => 'owner_office:' + entityId;
const fail = (error, code = 'OWNER_OFFICE_UNAVAILABLE', status = 403) => ({ ok: false, response: json({ error, code }, status) });
const dto = store => store ? { storeId: store.id, storeCode: store.code, storeName: store.storeName } : null;
function decode(token) {
  try {
    const raw = token.slice(OWNER_OFFICE_TOKEN_PREFIX.length);
    if (raw.length > 12000) return null;
    return JSON.parse(decodeURIComponent(escape(atob(raw))));
  } catch { return null; }
}
function encode(value) { return OWNER_OFFICE_TOKEN_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(value)))); }

async function human(request, db, entityId) {
  const owner = await ownerFromRequest(request, db);
  if (owner) return { ok: true, actor: { role: 'OWNER', id: owner.id, name: owner.displayName || owner.username } };
  const admin = await entityAdminFromRequest(request, db);
  if (admin && admin.entityId === entityId) return { ok: true, actor: { role: 'ENTITY_ADMIN', id: admin.id, name: admin.displayName || admin.username } };
  return fail('Kantor membutuhkan sesi Pemilik atau Admin Entity yang berwenang.', 'OWNER_OFFICE_HUMAN_REQUIRED');
}
async function context(db, entityId) {
  const entity = await db.prepare("SELECT id FROM entities WHERE id = ? AND status = 'ACTIVE'").bind(entityId).first();
  if (!entity) return fail('Entity tidak ditemukan.', 'OWNER_OFFICE_ENTITY_NOT_FOUND', 404);
  const tenantId = await resolveTenantId(db, entityId);
  if (await getTenantPolicyChoice(db, tenantId, UI_SKIN_KEY) !== 'H') return fail('Kantor terpadu hanya tersedia pada skin H.', 'OWNER_OFFICE_SKIN_REQUIRED');
  const saved = await db.prepare('SELECT setting_value FROM tenant_policy_settings WHERE tenant_id = ? AND setting_key = ?').bind(tenantId, configKey(entityId)).first();
  let config = null;
  try { config = JSON.parse(saved?.setting_value || 'null'); } catch { /* invalid configuration fails closed */ }
  const epoch = await db.prepare('SELECT setting_value FROM tenant_policy_settings WHERE tenant_id = ? AND setting_key = ?').bind(tenantId, OWNER_OFFICE_EPOCH_KEY).first();
  const store = config?.storeId ? await resolveStore(db, config.storeId) : null;
  return { ok: true, tenantId, config, epoch: epoch?.setting_value || '', store: store?.entityId === entityId && store?.tenantId === tenantId ? store : null };
}
async function cashierIdFor(actor, store) {
  return OWNER_OFFICE_CASHIER_PREFIX + (await hashCredential(actor.role + ':' + actor.id + '|' + store.id)).slice(0, 24);
}

export async function requireOwnerOfficeCashier(request, db) {
  const token = bearerToken(request);
  if (!token.startsWith(OWNER_OFFICE_TOKEN_PREFIX)) return null;
  const value = decode(token);
  if (!value || typeof value.managementToken !== 'string' || !value.entityId || !value.storeId || !value.revision) return fail('Sesi Kantor tidak valid.', 'OWNER_OFFICE_SESSION_INVALID', 401);
  const management = new Request(request.url, { headers: { authorization: 'Bearer ' + value.managementToken } });
  const auth = await human(management, db, value.entityId);
  if (!auth.ok) return auth;
  const current = await context(db, value.entityId);
  if (!current.ok) return current;
  if (!current.store || current.store.id !== value.storeId || current.tenantId !== value.tenantId || current.config.revision !== value.revision || current.epoch !== value.epoch) return fail('Pengaturan Kantor berubah. Buka kembali Kantor dari Admin.', 'OWNER_OFFICE_SESSION_CHANGED');
  const requestedStore = new URL(request.url).searchParams.get('store');
  if (requestedStore && ![current.store.id, current.store.code].includes(requestedStore)) return fail('Transaksi Kantor hanya untuk gerai Kantor.', 'OWNER_OFFICE_STORE_MISMATCH');
  // Office has no shift transitions. Reject stale or handcrafted close actions.
  if (request.method !== 'GET' && /^\/api\/cashier\/drawer\/close(?:-permits)?(?:\/|$)/.test(new URL(request.url).pathname)) return fail('Kas Kantor berjalan terus tanpa tutup laci.', 'OWNER_OFFICE_CONTINUOUS_DRAWER');
  const cashierId = await cashierIdFor(auth.actor, current.store);
  const row = await db.prepare('SELECT id, username, employee_name, is_active, store_id FROM cashiers WHERE id = ?').bind(cashierId).first();
  if (!row?.is_active || row.store_id !== current.store.id) return fail('Akun kasir Kantor tidak aktif.', 'OWNER_OFFICE_CASHIER_INACTIVE');
  return { ok: true, tokenHash: null, office: true, cashier: {
    id: row.id, username: row.username, employeeName: row.employee_name, isActive: true,
    officeActor: { role: auth.actor.role, id: auth.actor.id },
    store: { id: current.store.id, code: current.store.code, storeName: current.store.storeName, ownerOffice: true, ownerOperated: false, attendanceOptional: true, priceOverrideAllowed: false }
  } };
}

export async function handleOwnerOfficeApi(request, env, pathname) {
  if (!['/api/management/owner-office', '/api/management/owner-office/session'].includes(pathname)) return null;
  const entityId = String(new URL(request.url).searchParams.get('entity') || '').trim();
  if (!entityId) return json({ error: 'Pilih entity terlebih dahulu.', code: 'OWNER_OFFICE_ENTITY_REQUIRED' }, 400);
  const auth = await human(request, env.DB, entityId);
  if (!auth.ok) return auth.response;
  const current = await context(env.DB, entityId);
  if (!current.ok) return current.response;
  if (pathname.endsWith('/session')) {
    if (request.method !== 'POST') return json({ error: 'Method tidak didukung.' }, 405);
    if (!current.store) return json({ error: 'Pilih gerai Kantor terlebih dahulu.', code: 'OWNER_OFFICE_NOT_CONFIGURED' }, 409);
    const store = current.store;
    const cashierId = await cashierIdFor(auth.actor, store);
    const existing = await env.DB.prepare('SELECT id, store_id, is_active FROM cashiers WHERE id = ?').bind(cashierId).first();
    if (existing && (!existing.is_active || existing.store_id !== store.id)) return json({ error: 'Akun kasir Kantor tidak aktif.', code: 'OWNER_OFFICE_CASHIER_INACTIVE' }, 409);
    if (!existing) {
      const passwordHash = await hashCredential(crypto.randomUUID() + crypto.randomUUID());
      await env.DB.prepare('INSERT OR IGNORE INTO cashiers (id, username, password_hash, employee_name, store_id, is_active) VALUES (?, ?, ?, ?, ?, 1)').bind(cashierId, 'kantor.' + cashierId.slice(OWNER_OFFICE_CASHIER_PREFIX.length), passwordHash, String(auth.actor.name).slice(0, 80) + ' (Kantor)', store.id).run();
    }
    const token = encode({ managementToken: bearerToken(request), entityId, tenantId: current.tenantId, storeId: store.id, revision: current.config.revision, epoch: current.epoch });
    // Canonical opening derives carryover cash from the prior drawer; no ledger
    // or stock writes are duplicated here, and another cashier is never displaced.
    const { handleCashierDrawerApi } = await import('./cashier-drawer.js');
    const openRequest = new Request(new URL('/api/cashier/drawer/open?store=' + encodeURIComponent(store.code), request.url), { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ openingAmount: 0, shiftLabel: 'Kantor', openingNote: 'Kas Kantor berkelanjutan' }) });
    const opened = await handleCashierDrawerApi(openRequest, env, '/api/cashier/drawer/open');
    if (!opened.ok) return opened;
    const result = await opened.json();
    const verified = await requireOwnerOfficeCashier(openRequest, env.DB);
    if (!verified.ok) return verified.response;
    return json({ token, cashier: verified.cashier, cashierId, storeId: store.id, storeCode: store.code, entityId, drawer: result.drawer, office: dto(store) });
  }
  if (!['GET', 'PATCH'].includes(request.method)) return json({ error: 'Method tidak didukung.' }, 405);
  let office = current.store;
  if (request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok || !body.value?.storeCode) return json({ error: 'Pilih gerai Kantor yang valid.' }, 400);
    office = await resolveStore(env.DB, String(body.value.storeCode));
    if (!office || office.entityId !== entityId || office.tenantId !== current.tenantId) return json({ error: 'Gerai Kantor harus berada dalam entity ini.', code: 'OWNER_OFFICE_STORE_MISMATCH' }, 403);
    if (office.id !== current.store?.id) {
      await env.DB.prepare('INSERT INTO tenant_policy_settings (tenant_id, setting_key, setting_value, updated_by_role, updated_by_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (tenant_id, setting_key) DO UPDATE SET setting_value=excluded.setting_value, updated_at=CURRENT_TIMESTAMP, updated_by_role=excluded.updated_by_role, updated_by_id=excluded.updated_by_id').bind(current.tenantId, configKey(entityId), JSON.stringify({ storeId: office.id, revision: crypto.randomUUID() }), auth.actor.role, auth.actor.id).run();
    }
  }
  const stores = (await env.DB.prepare('SELECT id, code, store_name FROM stores WHERE entity_id = ? AND is_active = 1 ORDER BY code').bind(entityId).all()).results || [];
  return json({ entityId, office: dto(office), stores: stores.map(row => ({ id: row.id, code: row.code, storeName: row.store_name })) });
}
