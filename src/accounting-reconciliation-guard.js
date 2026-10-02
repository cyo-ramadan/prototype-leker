import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { dispatchPosAccountingFact } from './accounting-pos-bridge.js';
import { syncStoreAccounting } from './accounting-auto-sync.js';

const FACT_TABLE = Object.freeze({ SALE: 'sales', PURCHASE: 'purchases', EXPENSE: 'expenses' });
const text = (value, max = 300) => String(value ?? '').trim().slice(0, max);

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

async function factState(db, storeId, factType, factId) {
  const table = FACT_TABLE[factType];
  if (!table) return null;
  return db.prepare(`SELECT id, voided_at FROM ${table} WHERE id = ? AND store_id = ? LIMIT 1`).bind(factId, storeId).first();
}

export async function handleAccountingReconciliationGuardApi(request, env, pathname) {
  if (request.method !== 'POST' || pathname !== '/api/admin/accounting/bridge/sync') return null;
  const auth = await requireManagement(request, env.DB, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload sync Accounting bridge tidak valid.' }, 400);
  const factType = text(body.value?.factType, 24).toUpperCase();
  const factId = text(body.value?.factId, 180);
  if (factType && factId) {
    if (!FACT_TABLE[factType]) return json({ error: 'Jenis business fact tidak didukung.' }, 400);
    const state = await factState(env.DB, store.id, factType, factId);
    if (!state) return json({ error: 'Business fact POS tidak ditemukan.' }, 404);
    if (state.voided_at) return json({ ok: true, status: 'SKIPPED_VOIDED', code: 'BUSINESS_FACT_VOIDED', factType, factId });
    const result = await dispatchPosAccountingFact(env.DB, store, { factType, factId });
    return json(result, result.ok ? 200 : 409);
  }
  const results = await syncStoreAccounting(env.DB, store, { limit: body.value?.limit || 50 });
  return json({ attempted: results.length, posted: results.filter(row => row.status === 'POSTED').length, needsConfiguration: results.filter(row => row.status === 'NEEDS_CONFIGURATION').length, failed: results.filter(row => row.status === 'FAILED').length, results });
}
