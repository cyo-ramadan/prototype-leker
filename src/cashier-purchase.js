import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { requireDrawerOwner } from './cashier-drawer.js';
import { buildTransactionAccountingSnapshot } from './accounting-reference.js';

const PAYMENT_METHODS = new Set(['CASH', 'BANK', 'PAYABLE', 'NON_CASH']);
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function purchasePaymentMethod(value) {
  const method = String(value || 'CASH').trim().toUpperCase();
  return PAYMENT_METHODS.has(method) ? method : null;
}

export async function handleCashierPurchaseApi(request, env, pathname) {
  if (request.method !== 'POST' || pathname !== '/api/cashier/purchases') return null;

  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const cashier = auth.cashier;
  const ownership = await requireDrawerOwner(env.DB, cashier);
  if (!ownership.ok) return ownership.response;

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload pembelian tidak valid.' }, 400);

  const description = text(body.value?.description, 220);
  const totalAmount = money(body.value?.totalAmount);
  const supplierId = text(body.value?.supplierId, 120) || null;
  const note = text(body.value?.note, 500);
  const paymentMethod = purchasePaymentMethod(body.value?.paymentMethod);
  if (!description || totalAmount === null || totalAmount <= 0 || !paymentMethod) {
    return json({ error: 'Deskripsi, nominal, atau cara bayar pembelian tidak valid.' }, 400);
  }

  if (supplierId) {
    const supplier = await env.DB.prepare(`
      SELECT id FROM suppliers WHERE id = ? AND store_id = ? AND is_active = 1
    `).bind(supplierId, cashier.store.id).first();
    if (!supplier) return json({ error: 'Supplier tidak ditemukan di gerai kasir.' }, 400);
  }

  const id = `purchase_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const accounting = await buildTransactionAccountingSnapshot(env.DB, {
    storeId: cashier.store.id,
    sourceType: 'PURCHASE',
    sourceId: id,
    businessEvent: 'PURCHASE_MATERIAL',
    paymentMethod,
    now
  });

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO purchases (
        id, store_id, drawer_session_id, cashier_id, supplier_id,
        description, total_amount, note, created_at, payment_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      cashier.store.id,
      ownership.drawer.id,
      cashier.id,
      supplierId,
      description,
      totalAmount,
      note,
      now,
      paymentMethod
    ),
    accounting.statement
  ]);

  return json({
    ok: true,
    id,
    businessEvent: 'PURCHASE_MATERIAL',
    paymentMethod,
    accounting: {
      contract: 'MAXI_ACCOUNTING_REFERENCE_V1',
      mappingStatus: accounting.status,
      mappingId: accounting.mappingId,
      debitAccountRefId: accounting.debitAccountRefId,
      creditAccountRefId: accounting.creditAccountRefId,
      journalReference: null
    },
    createdAt: now
  }, 201);
}
