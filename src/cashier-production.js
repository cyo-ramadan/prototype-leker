import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { requireDrawerOwner } from './cashier-drawer.js';
import { isoNow } from './time.js';
import { listManualProductionOptions, prepareManualProduction, stockPostingFailure } from './stock-production.js';

export async function handleCashierProductionApi(request, env, pathname) {
  if (!pathname.startsWith('/api/cashier/production')) return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const storeId = auth.cashier.store.id;

  if (request.method === 'GET' && pathname === '/api/cashier/production/options') {
    return json({
      cashier: auth.cashier,
      products: await listManualProductionOptions(env.DB, storeId)
    });
  }

  if (request.method !== 'POST' || pathname !== '/api/cashier/production') {
    return json({ error: 'Route produksi kasir tidak ditemukan.' }, 404);
  }

  const ownership = await requireDrawerOwner(env.DB, auth.cashier);
  if (!ownership.ok) return ownership.response;
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload produksi tidak valid.' }, 400);

  const prepared = await prepareManualProduction(env.DB, {
    storeId,
    drawerId: ownership.drawer.id,
    cashierId: auth.cashier.id,
    outputProductId: body.value?.outputProductId,
    batches: body.value?.batches,
    now: isoNow()
  });
  if (!prepared.ok) return json({ error: prepared.error }, prepared.status);

  try {
    await env.DB.batch(prepared.statements);
    return json({ ok: true, production: prepared.run }, 201);
  } catch (error) {
    const stockFailure = stockPostingFailure(error);
    if (stockFailure) return json({ error: stockFailure.error }, stockFailure.status);
    throw error;
  }
}
