import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { requireDrawerOwner } from './cashier-drawer.js';
import { buildTransactionAccountingSnapshot } from './accounting-reference.js';
import { listOperationalAccountingComponents, resolvePosPaymentMethod } from './accounting-pos-bridge.js';

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

export async function handleCashierOperationalExpenseApi(request, env, pathname) {
  if (pathname !== '/api/cashier/expenses') return null;
  if (request.method !== 'POST') return null;

  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const ownership = await requireDrawerOwner(env.DB, auth.cashier);
  if (!ownership.ok) return ownership.response;

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload pengeluaran tidak valid.' }, 400);

  const description = text(body.value?.description, 220);
  const amount = money(body.value?.amount);
  const quantity = canonicalPositiveDecimal(body.value?.quantity ?? '1');
  const resolvedPayment = await resolvePosPaymentMethod(env.DB, auth.cashier.store.id, body.value?.paymentMethod, 'CASH');
  if (!resolvedPayment) {
    return json({ error: 'Cara bayar operasional tidak aktif / tidak tersedia di Setting Akuntansi.', code: 'PAYMENT_METHOD_NOT_AVAILABLE' }, 400);
  }
  const accountingComponentRuleId = text(body.value?.accountingComponentRuleId, 180) || null;
  if (accountingComponentRuleId) {
    const components = await listOperationalAccountingComponents(env.DB, auth.cashier.store.id);
    if (!components.some(component => component.journalRuleId === accountingComponentRuleId)) {
      return json({ error: 'Komponen beban Accounting tidak aktif / tidak tersedia.', code: 'ACCOUNTING_COMPONENT_NOT_AVAILABLE' }, 400);
    }
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
        description, amount, quantity, created_at, payment_method, accounting_component_rule_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      auth.cashier.store.id,
      ownership.drawer.id,
      auth.cashier.id,
      description,
      amount,
      quantity,
      now,
      channel,
      accountingComponentRuleId
    ),
    accounting.statement
  ]);

  return json({
    ok: true,
    id,
    description,
    quantity,
    amount,
    paymentMethod: channel,
    accountingComponentRuleId,
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
