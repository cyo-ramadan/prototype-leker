import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { requireDrawerOwner } from './cashier-drawer.js';
import { buildTransactionAccountingSnapshot } from './accounting-reference.js';
import { resolvePosPaymentMethod } from './accounting-pos-bridge.js';

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);

function money(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function canonicalPositiveDecimal(value, maxScale = 6) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(0|[1-9]\d*)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = match[2] || '';
  if (fraction.length > maxScale) return null;
  if (match[1].length > 12) return null;
  const normalizedFraction = fraction.replace(/0+$/, '');
  const canonical = normalizedFraction ? `${match[1]}.${normalizedFraction}` : match[1];
  return /^0(?:\.0*)?$/.test(canonical) ? null : canonical;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export async function handleCashierOperationalExpenseApi(request, env, pathname) {
  if (pathname !== '/api/cashier/expenses') return null;
  if (request.method !== 'POST') return null;

  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const ownership = await requireDrawerOwner(env.DB, auth.cashier);
  if (!ownership.ok) return ownership.response;

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload pengeluaran tidak valid.' }, 400);

  if (Array.isArray(body.value?.items)) {
    if (!body.value.items.length || body.value.items.length > 50) return json({ error: 'Operasional wajib memiliki 1–50 detail biaya.' }, 400);
    const resolvedPayment = await resolvePosPaymentMethod(env.DB, auth.cashier.store.id, body.value?.paymentMethod, 'CASH');
    if (!resolvedPayment) return json({ error: 'Cara bayar operasional tidak aktif / tidak tersedia di Setting Akuntansi.', code: 'PAYMENT_METHOD_NOT_AVAILABLE' }, 400);
    const ids = body.value.items.map(item => text(item?.costMasterId, 160));
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) return json({ error: 'Master Biaya wajib valid dan tidak boleh duplikat.' }, 400);
    const placeholders = ids.map(() => '?').join(',');
    const rows = await env.DB.prepare(`
      SELECT cm.id, cm.name, cm.outgoing_amount, cm.cost_group,
             ct.id AS cost_type_id
      FROM cost_masters cm
      JOIN cost_types ct ON ct.id = cm.cost_type_id AND ct.store_id = cm.store_id
      WHERE cm.store_id = ? AND cm.is_active = 1 AND ct.is_active = 1
        AND cm.id IN (${placeholders})
    `).bind(auth.cashier.store.id, ...ids).all();
    const byId = new Map((rows.results ?? []).map(row => [row.id, row]));
    const normalizedItems = [];
    for (const requested of body.value.items) {
      const master = byId.get(text(requested?.costMasterId, 160));
      const quantity = positiveInteger(requested?.quantity);
      const unitAmount = money(requested?.unitAmount);
      if (!master || !quantity || unitAmount === null) return json({ error: 'Master Biaya, Qty, atau nominal biaya tidak valid.' }, 400);
      const amount = quantity * unitAmount;
      if (!Number.isSafeInteger(amount) || amount <= 0) return json({ error: 'Total detail biaya tidak valid.' }, 400);
      normalizedItems.push({ master, quantity, unitAmount, amount });
    }
    const now = new Date().toISOString();
    const statements = [];
    const committed = [];
    for (const item of normalizedItems) {
      const id = `expense_${crypto.randomUUID()}`;
      const accounting = await buildTransactionAccountingSnapshot(env.DB, {
        storeId: auth.cashier.store.id, sourceType: 'EXPENSE', sourceId: id,
        businessEvent: 'EXPENSE', paymentMethod: resolvedPayment.code, now
      });
      statements.push(env.DB.prepare(`
        INSERT INTO expenses (
          id, store_id, drawer_session_id, cashier_id, description, amount,
          quantity, created_at, payment_method
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, auth.cashier.store.id, ownership.drawer.id, auth.cashier.id,
        item.master.name, item.amount, String(item.quantity), now, resolvedPayment.code));
      statements.push(accounting.statement);
      committed.push({ id, costMasterId: item.master.id, name: item.master.name, quantity: item.quantity, unitAmount: item.unitAmount, amount: item.amount, costTypeId: item.master.cost_type_id, costGroup: item.master.cost_group });
    }
    await env.DB.batch(statements);
    return json({
      ok: true,
      id: committed[0].id,
      ids: committed.map(item => item.id),
      items: committed,
      businessEvent: 'EXPENSE',
      transactionCategoryCode: 'operational',
      totalAmount: committed.reduce((sum, item) => sum + item.amount, 0),
      paymentMethod: resolvedPayment.code,
      createdAt: now
    }, 201);
  }

  const description = text(body.value?.description, 220);
  const amount = money(body.value?.amount);
  const quantity = canonicalPositiveDecimal(body.value?.quantity ?? '1');
  const resolvedPayment = await resolvePosPaymentMethod(env.DB, auth.cashier.store.id, body.value?.paymentMethod, 'CASH');
  if (!resolvedPayment) {
    return json({ error: 'Cara bayar operasional tidak aktif / tidak tersedia di Setting Akuntansi.', code: 'PAYMENT_METHOD_NOT_AVAILABLE' }, 400);
  }
  if (!description || amount === null || !quantity) {
    return json({ error: 'Deskripsi, qty, dan total nominal pengeluaran wajib valid.' }, 400);
  }

  const channel = resolvedPayment.code;
  const id = `expense_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const accounting = await buildTransactionAccountingSnapshot(env.DB, {
    storeId: auth.cashier.store.id,
    sourceType: 'EXPENSE',
    sourceId: id,
    businessEvent: 'EXPENSE',
    paymentMethod: channel,
    now
  });

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO expenses (
        id, store_id, drawer_session_id, cashier_id,
        description, amount, quantity, created_at, payment_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      auth.cashier.store.id,
      ownership.drawer.id,
      auth.cashier.id,
      description,
      amount,
      quantity,
      now,
      channel
    ),
    accounting.statement
  ]);

  return json({
    ok: true,
    id,
    description,
    quantity,
    amount,
    businessEvent: 'EXPENSE',
    transactionCategoryCode: 'operational',
    paymentMethod: channel,
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
