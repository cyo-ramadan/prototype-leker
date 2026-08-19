import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { requireDrawerOwner } from './cashier-drawer.js';
import { isoNow } from './time.js';
import { stockPostingFailure } from './stock-production.js';
import { listManualProductionOptionsV2, prepareManualProductionV2 } from './warehouse-production.js';
import {
  ACCOUNTING_WAREHOUSE_PRODUCTION_BRIDGE_CONTRACT,
  dispatchWarehouseProductionAccountingFact
} from './accounting-warehouse-production-bridge.js';

function accountingPayload(result) {
  return {
    bridgeContract: ACCOUNTING_WAREHOUSE_PRODUCTION_BRIDGE_CONTRACT,
    bridgeStatus: result.status || (result.ok ? 'POSTED' : 'FAILED'),
    accountingChange: result.accountingChange || null,
    transferAmountScaled: result.transferAmountScaled ?? null,
    journalReference: result.journalId || null,
    journalNumber: result.journalNumber || null,
    failureCode: result.ok ? null : (result.code || 'ACCOUNTING_BRIDGE_FAILED'),
    failureDetail: result.ok ? null : (result.error || 'Accounting bridge produksi gagal.')
  };
}

export async function handleCashierProductionApi(request, env, pathname) {
  if (!pathname.startsWith('/api/cashier/production')) return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const storeId = auth.cashier.store.id;

  if (request.method === 'GET' && pathname === '/api/cashier/production/options') {
    const options = await listManualProductionOptionsV2(env.DB, storeId);
    return json({ cashier: auth.cashier, ...options });
  }

  if (request.method !== 'POST' || pathname !== '/api/cashier/production') {
    return json({ error: 'Route produksi kasir tidak ditemukan.' }, 404);
  }

  const ownership = await requireDrawerOwner(env.DB, auth.cashier);
  if (!ownership.ok) return ownership.response;
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload produksi tidak valid.' }, 400);

  const prepared = await prepareManualProductionV2(env.DB, {
    storeId,
    drawerId: ownership.drawer.id,
    cashierId: auth.cashier.id,
    outputProductId: body.value?.outputProductId,
    recipeId: body.value?.recipeId,
    outputQuantity: body.value?.outputQuantity,
    components: body.value?.components,
    batches: body.value?.batches,
    now: isoNow()
  });
  if (!prepared.ok) return json({ error: prepared.error }, prepared.status);

  try {
    await env.DB.batch(prepared.statements);
  } catch (error) {
    const stockFailure = stockPostingFailure(error);
    if (stockFailure) return json({ error: stockFailure.error }, stockFailure.status);
    throw error;
  }

  let accounting;
  try {
    accounting = await dispatchWarehouseProductionAccountingFact(env.DB, { id: storeId }, prepared.run.id);
  } catch (error) {
    console.error('production accounting bridge post-commit dispatch failed', { storeId, productionRunId: prepared.run.id, error });
    accounting = {
      ok: false,
      status: 'FAILED',
      code: 'ACCOUNTING_BRIDGE_EXCEPTION',
      error: 'Produksi dan stok sudah tersimpan, tetapi delivery Accounting gagal diproses.'
    };
  }

  return json({
    ok: true,
    production: prepared.run,
    accounting: accountingPayload(accounting)
  }, 201);
}
