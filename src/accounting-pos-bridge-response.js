import { json } from './http.js';
import { ACCOUNTING_POS_BRIDGE_CONTRACT, dispatchPosAccountingFact } from './accounting-pos-bridge.js';

const FACT_TABLE = Object.freeze({ SALE: 'sales', PURCHASE: 'purchases', EXPENSE: 'expenses' });

async function storeForFact(db, factType, factId) {
  const table = FACT_TABLE[factType];
  if (!table || !factId) return null;
  const row = await db.prepare(`SELECT store_id FROM ${table} WHERE id = ? LIMIT 1`).bind(factId).first();
  return row?.store_id ? { id: row.store_id } : null;
}

function factIdFromPayload(factType, payload) {
  if (factType === 'SALE') return payload?.sale?.id || null;
  return payload?.id || null;
}

function factIdsFromPayload(factType, payload) {
  if (factType === 'EXPENSE' && Array.isArray(payload?.ids) && payload.ids.length) return payload.ids;
  const id = factIdFromPayload(factType, payload);
  return id ? [id] : [];
}

function accountingPayload(existing, result) {
  return {
    ...(existing && typeof existing === 'object' ? existing : {}),
    bridgeContract: ACCOUNTING_POS_BRIDGE_CONTRACT,
    bridgeStatus: result.status || (result.ok ? 'POSTED' : 'FAILED'),
    journalReference: result.journalId || null,
    journalNumber: result.journalNumber || null,
    failureCode: result.ok ? null : (result.code || 'ACCOUNTING_BRIDGE_FAILED'),
    failureDetail: result.ok ? null : (result.error || 'Accounting bridge gagal.')
  };
}

export async function attachAccountingBridgeToCommittedResponse(response, env, factType) {
  if (!response || response.status < 200 || response.status >= 300) return response;
  const type = String(factType || '').toUpperCase();
  if (!FACT_TABLE[type]) return response;

  let payload;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }
  const factIds = factIdsFromPayload(type, payload);
  if (!factIds.length) return response;

  if (factIds.length > 1) {
    const deliveries = [];
    for (const factId of factIds) {
      try {
        const store = await storeForFact(env.DB, type, factId);
        const result = store
          ? await dispatchPosAccountingFact(env.DB, store, { factType: type, factId })
          : { ok: false, status: 'FAILED', code: 'BUSINESS_FACT_NOT_FOUND', error: 'Business fact POS tidak ditemukan setelah commit.' };
        deliveries.push({ factId, ...accountingPayload(null, result) });
      } catch (error) {
        console.error('accounting bridge batch dispatch failed', { factType: type, factId, error });
        deliveries.push({ factId, bridgeContract: ACCOUNTING_POS_BRIDGE_CONTRACT, bridgeStatus: 'FAILED', failureCode: 'ACCOUNTING_BRIDGE_EXCEPTION', failureDetail: 'Transaksi POS sudah tersimpan, tetapi delivery Accounting gagal diproses.' });
      }
    }
    return json({ ...payload, accounting: { bridgeContract: ACCOUNTING_POS_BRIDGE_CONTRACT, deliveries } }, response.status);
  }

  const [factId] = factIds;

  let result;
  try {
    const store = await storeForFact(env.DB, type, factId);
    result = store
      ? await dispatchPosAccountingFact(env.DB, store, { factType: type, factId })
      : { ok: false, status: 'FAILED', code: 'BUSINESS_FACT_NOT_FOUND', error: 'Business fact POS tidak ditemukan setelah commit.' };
  } catch (error) {
    console.error('accounting bridge post-commit dispatch failed', { factType: type, factId, error });
    result = {
      ok: false,
      status: 'FAILED',
      code: 'ACCOUNTING_BRIDGE_EXCEPTION',
      error: 'Transaksi POS sudah tersimpan, tetapi delivery Accounting gagal diproses.'
    };
  }

  return json({
    ...payload,
    accounting: accountingPayload(payload?.accounting, result)
  }, response.status);
}
