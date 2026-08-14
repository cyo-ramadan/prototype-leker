import { ACCOUNTING_AMOUNT_SCALE, postAccountingJournal } from './accounting-ledger.js';
import { getJakartaBusinessDate } from './time.js';

export const ACCOUNTING_CASH_FLOW_BRIDGE_CONTRACT = 'MAXI_ACCOUNTING_CASH_FLOW_BRIDGE_V1';
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const bridgeResult = (status, code = '', error = '', extra = {}) => ({ ok: status === 'POSTED', status, code, error, ...extra });

async function loadFact(db, storeId, requestId) {
  return db.prepare(`
    SELECT r.id, r.payload_json, c.direction, c.amount, c.description, c.note, c.posted_at
    FROM approval_requests r
    JOIN cash_ledger_entries c ON c.approval_request_id = r.id AND c.store_id = r.store_id
    WHERE r.id = ? AND r.store_id = ? AND r.request_type = 'CASH_FLOW'
      AND r.approval_status = 'approved' AND r.posting_status = 'posted'
    LIMIT 1
  `).bind(requestId, storeId).first();
}

async function loadRules(db, storeId, categoryCode) {
  const category = await db.prepare(`
    SELECT id FROM transaction_categories
    WHERE store_id = ? AND code = ? AND is_active = 1
    LIMIT 1
  `).bind(storeId, categoryCode).first();
  if (!category) return null;
  const rows = await db.prepare(`
    SELECT r.id, r.label, r.side, r.source_type, r.fixed_account_id,
           a.id AS active_fixed_account_id, a.code AS fixed_account_code,
           a.name AS fixed_account_name
    FROM journal_rules r
    LEFT JOIN chart_of_accounts a
      ON a.id = r.fixed_account_id
     AND a.store_id = r.store_id
     AND a.is_active = 1
    WHERE r.store_id = ? AND r.transaction_category_id = ? AND r.is_active = 1
    ORDER BY r.sort_order, r.id
  `).bind(storeId, category.id).all();
  return rows.results ?? [];
}

export async function listCashFlowCounterpartOptions(db, storeId) {
  const rows = await db.prepare(`
    SELECT r.id AS journal_rule_id, r.label, r.side, r.fixed_account_id, r.is_default,
           c.code AS category_code, a.code AS account_code, a.name AS account_name
    FROM journal_rules r
    JOIN transaction_categories c
      ON c.id = r.transaction_category_id
     AND c.store_id = r.store_id
     AND c.is_active = 1
    JOIN chart_of_accounts a
      ON a.id = r.fixed_account_id
     AND a.store_id = r.store_id
     AND a.is_active = 1
    WHERE r.store_id = ? AND r.is_active = 1
      AND r.source_type = 'fixed_account'
      AND ((c.code = 'cash_flow_in' AND r.side = 'CREDIT')
        OR (c.code = 'cash_flow_out' AND r.side = 'DEBIT'))
    ORDER BY c.code, r.is_default DESC, r.sort_order, a.code, r.id
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    direction: row.category_code === 'cash_flow_out' ? 'OUT' : 'IN',
    journalRuleId: row.journal_rule_id,
    isDefault: Boolean(row.is_default),
    label: row.label,
    accountCode: row.account_code,
    accountName: row.account_name
  }));
}

export async function resolveCashFlowCounterpartOption(db, storeId, direction, journalRuleId) {
  const normalizedDirection = text(direction, 8).toUpperCase();
  const ruleId = text(journalRuleId, 180);
  if (!['IN', 'OUT'].includes(normalizedDirection) || !ruleId) return null;
  const categoryCode = normalizedDirection === 'OUT' ? 'cash_flow_out' : 'cash_flow_in';
  const expectedSide = normalizedDirection === 'OUT' ? 'DEBIT' : 'CREDIT';
  const row = await db.prepare(`
    SELECT r.id AS journal_rule_id, r.label, r.fixed_account_id,
           a.code AS account_code, a.name AS account_name
    FROM journal_rules r
    JOIN transaction_categories c
      ON c.id = r.transaction_category_id
     AND c.store_id = r.store_id
     AND c.is_active = 1
    JOIN chart_of_accounts a
      ON a.id = r.fixed_account_id
     AND a.store_id = r.store_id
     AND a.is_active = 1
    WHERE r.id = ? AND r.store_id = ? AND r.is_active = 1
      AND r.source_type = 'fixed_account' AND r.side = ? AND c.code = ?
    LIMIT 1
  `).bind(ruleId, storeId, expectedSide, categoryCode).first();
  return row ? {
    journalRuleId: row.journal_rule_id,
    label: row.label,
    accountId: row.fixed_account_id,
    accountCode: row.account_code,
    accountName: row.account_name
  } : null;
}

async function loadCashAccount(db, storeId) {
  return db.prepare(`
    SELECT p.account_id, a.id AS active_account_id
    FROM payment_methods p
    LEFT JOIN chart_of_accounts a
      ON a.id = p.account_id
     AND a.store_id = p.store_id
     AND a.is_active = 1
    WHERE p.store_id = ? AND p.code = 'CASH' AND p.is_active = 1
    LIMIT 1
  `).bind(storeId).first();
}

async function existingDelivery(db, storeId, requestId) {
  return db.prepare(`
    SELECT status, journal_id
    FROM accounting_bridge_deliveries
    WHERE store_id = ? AND producer_module = 'POS'
      AND fact_type = 'CASH_FLOW' AND fact_id = ?
    LIMIT 1
  `).bind(storeId, requestId).first();
}

async function saveDelivery(db, storeId, requestId, categoryCode, value) {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO accounting_bridge_deliveries (
      id, store_id, producer_module, fact_type, fact_id, transaction_category_code,
      status, journal_id, failure_code, failure_detail,
      attempts, last_attempt_at, created_at, updated_at
    ) VALUES (?, ?, 'POS', 'CASH_FLOW', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(store_id, producer_module, fact_type, fact_id) DO UPDATE SET
      transaction_category_code = excluded.transaction_category_code,
      status = excluded.status,
      journal_id = excluded.journal_id,
      failure_code = excluded.failure_code,
      failure_detail = excluded.failure_detail,
      attempts = accounting_bridge_deliveries.attempts + 1,
      last_attempt_at = excluded.last_attempt_at,
      updated_at = excluded.updated_at
  `).bind(
    `accounting_cash_flow_${crypto.randomUUID()}`,
    storeId,
    requestId,
    categoryCode,
    value.status,
    value.journalId || null,
    value.code || '',
    text(value.error, 500),
    now,
    now,
    now
  ).run();
}

function wholeRupiahScaled(amount) {
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  const scaled = value * ACCOUNTING_AMOUNT_SCALE;
  return Number.isSafeInteger(scaled) ? scaled : null;
}

export async function dispatchApprovedCashFlowToAccounting(db, storeId, approvalRequestId) {
  const requestId = text(approvalRequestId, 180);
  if (!requestId) return bridgeResult('FAILED', 'CASH_FLOW_REFERENCE_INVALID', 'Referensi Arus Kas tidak valid.');

  const previous = await existingDelivery(db, storeId, requestId);
  if (previous?.status === 'POSTED' && previous.journal_id) {
    return bridgeResult('POSTED', '', '', { duplicate: true, journalId: previous.journal_id });
  }

  const source = await loadFact(db, storeId, requestId);
  if (!source) {
    const value = bridgeResult('FAILED', 'CASH_FLOW_FACT_NOT_POSTED', 'Arus Kas belum approved + posted.');
    await saveDelivery(db, storeId, requestId, '', value);
    return value;
  }

  if (source.direction !== 'IN' && source.direction !== 'OUT') {
    const value = bridgeResult('FAILED', 'CASH_FLOW_DIRECTION_INVALID', 'Arah Arus Kas harus IN atau OUT.');
    await saveDelivery(db, storeId, requestId, '', value);
    return value;
  }

  const categoryCode = source.direction === 'OUT' ? 'cash_flow_out' : 'cash_flow_in';
  const rules = await loadRules(db, storeId, categoryCode);
  if (!rules) {
    const value = bridgeResult('NEEDS_CONFIGURATION', 'NEEDS_TRANSACTION_MAPPING', `Aturan ${categoryCode} belum aktif.`);
    await saveDelivery(db, storeId, requestId, categoryCode, value);
    return value;
  }

  let payload = {};
  try { payload = JSON.parse(source.payload_json || '{}'); } catch {}
  const requestedCounterpartRuleId = text(payload.accountingCounterpartRuleId, 180);
  const paymentRules = rules.filter(rule => rule.source_type === 'payment_method');
  const fixedRules = rules.filter(rule => rule.source_type === 'fixed_account');
  const counterpartRule = requestedCounterpartRuleId
    ? fixedRules.find(rule => rule.id === requestedCounterpartRuleId)
    : fixedRules.length === 1 ? fixedRules[0] : null;
  if (paymentRules.length !== 1 || !fixedRules.length || rules.some(rule => !['payment_method', 'fixed_account'].includes(rule.source_type))) {
    const value = bridgeResult('NEEDS_CONFIGURATION', 'NEEDS_MAPPING', `Aturan ${categoryCode} wajib memiliki tepat satu payment_method dan minimal satu fixed_account.`);
    await saveDelivery(db, storeId, requestId, categoryCode, value);
    return value;
  }
  if (!counterpartRule || paymentRules[0].side === counterpartRule.side) {
    const value = bridgeResult('NEEDS_CONFIGURATION', 'NEEDS_COUNTERPART_SELECTION', 'Akun lawan Arus Kas belum dipilih atau tidak cocok dengan arah transaksi.');
    await saveDelivery(db, storeId, requestId, categoryCode, value);
    return value;
  }

  const cash = await loadCashAccount(db, storeId);
  if (!cash?.active_account_id) {
    const value = bridgeResult('NEEDS_CONFIGURATION', 'NEEDS_PAYMENT_MAPPING', 'Metode CASH belum terhubung ke akun aktif.');
    await saveDelivery(db, storeId, requestId, categoryCode, value);
    return value;
  }
  if (!counterpartRule.active_fixed_account_id) {
    const value = bridgeResult('NEEDS_CONFIGURATION', 'NEEDS_FIXED_ACCOUNT', 'Akun lawan Arus Kas belum aktif.');
    await saveDelivery(db, storeId, requestId, categoryCode, value);
    return value;
  }

  const amountScaled = wholeRupiahScaled(source.amount);
  if (!amountScaled) {
    const value = bridgeResult('FAILED', 'CASH_FLOW_AMOUNT_INVALID', 'Nominal Arus Kas tidak valid untuk precision Accounting.');
    await saveDelivery(db, storeId, requestId, categoryCode, value);
    return value;
  }

  const occurredAt = new Date(source.posted_at);
  if (Number.isNaN(occurredAt.valueOf())) {
    const value = bridgeResult('FAILED', 'CASH_FLOW_DATE_INVALID', 'Waktu posting Arus Kas tidak valid.');
    await saveDelivery(db, storeId, requestId, categoryCode, value);
    return value;
  }

  let posted;
  try {
    posted = await postAccountingJournal(db, { id: storeId }, {
      businessDate: getJakartaBusinessDate(occurredAt),
      occurredAt: occurredAt.toISOString(),
      sourceSystem: 'LEKER_POS',
      sourceReferenceId: `CASH_FLOW:${requestId}`,
      correlationId: requestId,
      idempotencyKey: `LEKER_POS:CASH_FLOW:${requestId}`,
      description: source.description,
      journalLines: [paymentRules[0], counterpartRule].map(rule => ({
        accountId: rule.source_type === 'payment_method' ? cash.account_id : rule.fixed_account_id,
        side: rule.side,
        amountScaled,
        description: rule.label || source.description
      }))
    });
  } catch (error) {
    const value = bridgeResult('FAILED', 'ACCOUNTING_POST_FAILED', text(error?.message || error, 500));
    await saveDelivery(db, storeId, requestId, categoryCode, value);
    return value;
  }

  const value = posted.ok
    ? bridgeResult('POSTED', '', '', {
        duplicate: Boolean(posted.duplicate),
        journalId: posted.journal.journalId,
        journalNumber: posted.journal.journalNumber
      })
    : bridgeResult(
        posted.code?.startsWith('NEEDS_') ? 'NEEDS_CONFIGURATION' : 'FAILED',
        posted.code || 'ACCOUNTING_POST_FAILED',
        posted.error || 'Accounting posting gagal.'
      );
  await saveDelivery(db, storeId, requestId, categoryCode, value);
  return value;
}
