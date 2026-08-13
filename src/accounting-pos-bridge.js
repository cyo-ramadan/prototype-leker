import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getJakartaBusinessDate } from './time.js';
import {
  ACCOUNTING_AMOUNT_SCALE,
  SYSTEM_ADJUSTMENT_POLICY,
  postAccountingJournal
} from './accounting-ledger.js';

export const ACCOUNTING_POS_BRIDGE_CONTRACT = 'MAXI_ACCOUNTING_POS_BRIDGE_V1';

const FACT_CONFIG = Object.freeze({
  SALE: { transactionCategoryCode: 'sale', producerModule: 'POS' },
  PURCHASE: { transactionCategoryCode: 'purchase_material', producerModule: 'POS' },
  EXPENSE: { transactionCategoryCode: 'operational', producerModule: 'POS' }
});

const text = (value, max = 300) => String(value ?? '').trim().slice(0, max);

function configurationFailure(code, error, detail = {}) {
  return { ok: false, status: 'NEEDS_CONFIGURATION', code, error, detail };
}

function bridgeFailure(code, error, detail = {}) {
  return { ok: false, status: 'FAILED', code, error, detail };
}

function safeAdd(current, amount) {
  const next = current + amount;
  if (!Number.isSafeInteger(next)) throw new Error('ACCOUNTING_BRIDGE_AMOUNT_OVERFLOW');
  return next;
}

function rupiahIntegerToScaled(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  const scaled = amount * ACCOUNTING_AMOUNT_SCALE;
  return Number.isSafeInteger(scaled) ? scaled : null;
}

export async function listPosPaymentMethods(db, storeId) {
  const rows = await db.prepare(`
    SELECT p.id, p.code, p.name, p.account_id,
           a.code AS account_code, a.name AS account_name
    FROM payment_methods p
    LEFT JOIN chart_of_accounts a
      ON a.id = p.account_id
     AND a.store_id = p.store_id
     AND a.is_active = 1
    WHERE p.store_id = ? AND p.is_active = 1
    ORDER BY CASE p.code WHEN 'CASH' THEN 0 ELSE 1 END, p.name COLLATE NOCASE, p.code
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    paymentMethodId: row.id,
    code: row.code,
    name: row.name,
    accountId: row.account_id || null,
    accountCode: row.account_code || '',
    accountName: row.account_name || '',
    accountingReady: Boolean(row.account_id && row.account_code),
    usesCashDrawer: row.code === 'CASH'
  }));
}

export async function resolvePosPaymentMethod(db, storeId, requestedCode, fallbackCode = 'CASH') {
  const code = text(requestedCode || fallbackCode, 32).toUpperCase();
  const row = await db.prepare(`
    SELECT id, code, name, account_id
    FROM payment_methods
    WHERE store_id = ? AND code = ? AND is_active = 1
    LIMIT 1
  `).bind(storeId, code).first();
  return row ? {
    paymentMethodId: row.id,
    code: row.code,
    name: row.name,
    accountId: row.account_id || null,
    usesCashDrawer: row.code === 'CASH'
  } : null;
}

export async function listOperationalAccountingComponents(db, storeId) {
  const rows = await db.prepare(`
    SELECT r.id, r.label, r.fixed_account_id,
           a.code AS account_code, a.name AS account_name
    FROM journal_rules r
    JOIN transaction_categories c
      ON c.id = r.transaction_category_id
     AND c.store_id = r.store_id
    JOIN chart_of_accounts a
      ON a.id = r.fixed_account_id
     AND a.store_id = r.store_id
     AND a.is_active = 1
    WHERE r.store_id = ?
      AND c.code = 'operational'
      AND c.is_active = 1
      AND r.is_active = 1
      AND r.side = 'DEBIT'
      AND r.source_type = 'fixed_account'
    ORDER BY r.sort_order, r.label COLLATE NOCASE, r.id
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    journalRuleId: row.id,
    label: row.label,
    accountId: row.fixed_account_id,
    accountCode: row.account_code,
    accountName: row.account_name
  }));
}

async function loadSaleFact(db, storeId, factId) {
  const header = await db.prepare(`
    SELECT id, total_amount, payment_method, created_at, note
    FROM sales
    WHERE id = ? AND store_id = ?
    LIMIT 1
  `).bind(factId, storeId).first();
  if (!header) return null;
  const rows = await db.prepare(`
    SELECT product_kind_id, product_kind_code, product_kind_name, line_total, line_cogs
    FROM sale_items
    WHERE sale_id = ? AND store_id = ?
    ORDER BY id
  `).bind(factId, storeId).all();
  return {
    factType: 'SALE',
    factId: header.id,
    totalAmountMinor: Number(header.total_amount),
    paymentMethodCode: header.payment_method || 'CASH',
    description: text(header.note, 300) || `Penjualan ${header.id}`,
    createdAt: header.created_at,
    itemLines: (rows.results ?? []).map(row => ({
      productKindId: row.product_kind_id || null,
      productKindCode: row.product_kind_code || '',
      productKindName: row.product_kind_name || '',
      lineAmountMinor: Number(row.line_total),
      lineCogsScaled: row.line_cogs == null ? null : Number(row.line_cogs)
    }))
  };
}

async function loadPurchaseFact(db, storeId, factId) {
  const header = await db.prepare(`
    SELECT id, total_amount, payment_method, created_at, description
    FROM purchases
    WHERE id = ? AND store_id = ?
    LIMIT 1
  `).bind(factId, storeId).first();
  if (!header) return null;
  const rows = await db.prepare(`
    SELECT product_kind_id, product_kind_code, product_kind_name, line_total
    FROM purchase_items
    WHERE purchase_id = ? AND store_id = ?
    ORDER BY id
  `).bind(factId, storeId).all();
  return {
    factType: 'PURCHASE',
    factId: header.id,
    totalAmountMinor: Number(header.total_amount),
    paymentMethodCode: header.payment_method || 'CASH',
    description: text(header.description, 300) || `Pembelian ${header.id}`,
    createdAt: header.created_at,
    itemLines: (rows.results ?? []).map(row => ({
      productKindId: row.product_kind_id || null,
      productKindCode: row.product_kind_code || '',
      productKindName: row.product_kind_name || '',
      lineAmountMinor: Number(row.line_total),
      lineCogsScaled: null
    }))
  };
}

async function loadExpenseFact(db, storeId, factId) {
  const row = await db.prepare(`
    SELECT id, amount, payment_method, accounting_component_rule_id, created_at, description
    FROM expenses
    WHERE id = ? AND store_id = ?
    LIMIT 1
  `).bind(factId, storeId).first();
  if (!row) return null;
  return {
    factType: 'EXPENSE',
    factId: row.id,
    totalAmountMinor: Number(row.amount),
    paymentMethodCode: row.payment_method || 'CASH',
    accountingComponentRuleId: row.accounting_component_rule_id || null,
    description: text(row.description, 300) || `Operasional ${row.id}`,
    createdAt: row.created_at,
    itemLines: []
  };
}

export async function loadPosAccountingFact(db, storeId, factType, factId) {
  const type = text(factType, 24).toUpperCase();
  const id = text(factId, 180);
  if (!FACT_CONFIG[type] || !id) return null;
  if (type === 'SALE') return loadSaleFact(db, storeId, id);
  if (type === 'PURCHASE') return loadPurchaseFact(db, storeId, id);
  return loadExpenseFact(db, storeId, id);
}

async function loadSettingsResolver(db, storeId, transactionCategoryCode) {
  const category = await db.prepare(`
    SELECT id, code, name, is_active
    FROM transaction_categories
    WHERE store_id = ? AND code = ? AND is_active = 1
    LIMIT 1
  `).bind(storeId, transactionCategoryCode).first();
  if (!category) return null;
  const rows = await db.prepare(`
    SELECT r.id, r.label, r.side, r.source_type, r.fixed_account_id, r.sort_order,
           a.code AS fixed_account_code, a.name AS fixed_account_name
    FROM journal_rules r
    LEFT JOIN chart_of_accounts a
      ON a.id = r.fixed_account_id
     AND a.store_id = r.store_id
     AND a.is_active = 1
    WHERE r.store_id = ?
      AND r.transaction_category_id = ?
      AND r.is_active = 1
    ORDER BY r.sort_order, r.id
  `).bind(storeId, category.id).all();
  return {
    category,
    rules: (rows.results ?? []).map(row => ({
      journalRuleId: row.id,
      label: row.label,
      side: row.side,
      sourceType: row.source_type,
      fixedAccountId: row.fixed_account_id || null,
      fixedAccountCode: row.fixed_account_code || '',
      fixedAccountName: row.fixed_account_name || '',
      sortOrder: Number(row.sort_order || 0)
    }))
  };
}

async function paymentAccount(db, storeId, paymentMethodCode) {
  const row = await db.prepare(`
    SELECT p.id, p.code, p.name, p.account_id,
           a.code AS account_code, a.name AS account_name
    FROM payment_methods p
    LEFT JOIN chart_of_accounts a
      ON a.id = p.account_id
     AND a.store_id = p.store_id
     AND a.is_active = 1
    WHERE p.store_id = ? AND p.code = ? AND p.is_active = 1
    LIMIT 1
  `).bind(storeId, paymentMethodCode).first();
  if (!row) return null;
  return {
    paymentMethodId: row.id,
    code: row.code,
    name: row.name,
    accountId: row.account_id || null,
    accountCode: row.account_code || '',
    accountName: row.account_name || ''
  };
}

async function itemMappings(db, storeId, productKindIds) {
  if (!productKindIds.length) return new Map();
  const unique = [...new Set(productKindIds)];
  const placeholders = unique.map(() => '?').join(', ');
  const rows = await db.prepare(`
    SELECT product_kind_id, name, inventory_account_id, cogs_account_id, revenue_account_id
    FROM item_categories
    WHERE store_id = ? AND is_active = 1 AND product_kind_id IN (${placeholders})
  `).bind(storeId, ...unique).all();
  return new Map((rows.results ?? []).map(row => [row.product_kind_id, {
    name: row.name,
    inventoryAccountId: row.inventory_account_id,
    cogsAccountId: row.cogs_account_id,
    revenueAccountId: row.revenue_account_id || null
  }]));
}

function verifyBusinessFact(fact) {
  if (!Number.isSafeInteger(fact.totalAmountMinor) || fact.totalAmountMinor <= 0) {
    return bridgeFailure('BUSINESS_FACT_AMOUNT_INVALID', 'Nominal business fact POS tidak valid.');
  }
  if (['SALE', 'PURCHASE'].includes(fact.factType)) {
    if (!fact.itemLines.length) return bridgeFailure('BUSINESS_FACT_ITEMS_MISSING', 'Business fact itemized tidak memiliki baris barang.');
    let sum = 0;
    for (const item of fact.itemLines) {
      if (!Number.isSafeInteger(item.lineAmountMinor) || item.lineAmountMinor <= 0) {
        return bridgeFailure('BUSINESS_FACT_LINE_AMOUNT_INVALID', 'Nilai baris business fact tidak valid.');
      }
      sum = safeAdd(sum, item.lineAmountMinor);
      if (item.lineCogsScaled !== null && item.lineCogsScaled !== undefined) {
        if (!Number.isSafeInteger(item.lineCogsScaled) || item.lineCogsScaled < 0) {
          return bridgeFailure('BUSINESS_FACT_COST_INVALID', 'Snapshot HPP business fact tidak valid.');
        }
      }
    }
    if (sum !== fact.totalAmountMinor) {
      return bridgeFailure('BUSINESS_FACT_TOTAL_MISMATCH', 'Total business fact tidak sama dengan jumlah baris.', { expected: fact.totalAmountMinor, actual: sum });
    }
  }
  const date = new Date(fact.createdAt);
  if (Number.isNaN(date.valueOf())) return bridgeFailure('BUSINESS_FACT_DATE_INVALID', 'Waktu business fact tidak valid.');
  return { ok: true };
}

function detectAmbiguousGenericRules(rules) {
  const generic = new Set(['payment_method', 'item_category_inventory', 'item_category_cogs', 'item_category_revenue', 'cost_center_cash']);
  const counts = new Map();
  for (const rule of rules) {
    if (!generic.has(rule.sourceType)) continue;
    const key = `${rule.side}:${rule.sourceType}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, count] of counts) {
    if (count > 1) return configurationFailure('AMBIGUOUS_RULE_CONFIGURATION', `Source ${key} muncul lebih dari sekali pada aturan aktif.`);
  }
  return null;
}

function aggregateLine(target, side, accountId, amountScaled, description, order) {
  if (!Number.isSafeInteger(amountScaled) || amountScaled <= 0) throw new Error('ACCOUNTING_BRIDGE_AMOUNT_INVALID');
  const key = `${side}:${accountId}`;
  const current = target.get(key);
  if (current) {
    current.amountScaled = safeAdd(current.amountScaled, amountScaled);
    if (description && !current.description.includes(description)) current.description = `${current.description}; ${description}`.slice(0, 240);
    current.order = Math.min(current.order, order);
    return;
  }
  target.set(key, { accountId, side, amountScaled, description: text(description, 240), order });
}

function itemAccountForSource(mapping, sourceType) {
  if (sourceType === 'item_category_inventory') return mapping.inventoryAccountId;
  if (sourceType === 'item_category_cogs') return mapping.cogsAccountId;
  if (sourceType === 'item_category_revenue') return mapping.revenueAccountId;
  return null;
}

function itemAmountForSource(fact, item, sourceType) {
  if (fact.factType === 'PURCHASE' && sourceType === 'item_category_inventory') return rupiahIntegerToScaled(item.lineAmountMinor);
  if (fact.factType === 'SALE' && sourceType === 'item_category_revenue') return rupiahIntegerToScaled(item.lineAmountMinor);
  if (fact.factType === 'SALE' && ['item_category_cogs', 'item_category_inventory'].includes(sourceType)) {
    if (item.lineCogsScaled === null || item.lineCogsScaled === undefined) return 'NEEDS_COST_SNAPSHOT';
    if (!Number.isSafeInteger(item.lineCogsScaled) || item.lineCogsScaled < 0) return 'INVALID_COST_SNAPSHOT';
    return item.lineCogsScaled;
  }
  return null;
}

export async function resolvePosFactToJournalCommand(db, store, fact) {
  const config = FACT_CONFIG[fact.factType];
  if (!config) return bridgeFailure('FACT_TYPE_UNSUPPORTED', 'Jenis business fact belum didukung Accounting bridge.');
  const verified = verifyBusinessFact(fact);
  if (!verified.ok) return verified;

  const resolver = await loadSettingsResolver(db, store.id, config.transactionCategoryCode);
  if (!resolver) return configurationFailure('NEEDS_TRANSACTION_MAPPING', `Jenis transaksi ${config.transactionCategoryCode} belum tersedia/aktif di Setting Akuntansi.`);
  const rules = resolver.rules;
  if (!rules.some(rule => rule.side === 'DEBIT') || !rules.some(rule => rule.side === 'CREDIT')) {
    return configurationFailure('NEEDS_MAPPING', 'Aturan transaksi belum memiliki minimal satu Debit dan satu Kredit aktif.');
  }
  const ambiguous = detectAmbiguousGenericRules(rules);
  if (ambiguous) return ambiguous;

  const payment = await paymentAccount(db, store.id, fact.paymentMethodCode);
  if (rules.some(rule => rule.sourceType === 'payment_method')) {
    if (!payment) return configurationFailure('NEEDS_PAYMENT_METHOD', `Cara bayar ${fact.paymentMethodCode} belum terdaftar/aktif.`);
    if (!payment.accountId || !payment.accountCode) {
      return configurationFailure('NEEDS_PAYMENT_MAPPING', `Cara bayar ${fact.paymentMethodCode} belum dilink ke akun.`);
    }
  }

  const productKindIds = fact.itemLines.map(item => item.productKindId).filter(Boolean);
  const mappings = await itemMappings(db, store.id, productKindIds);
  const itemSourceRules = rules.filter(rule => rule.sourceType.startsWith('item_category_'));
  if (itemSourceRules.length) {
    for (const item of fact.itemLines) {
      if (!item.productKindId) return configurationFailure('NEEDS_PRODUCT_KIND', 'Barang transaksi belum memiliki Jenis Barang.', { productKindCode: item.productKindCode });
      if (!mappings.has(item.productKindId)) {
        return configurationFailure('NEEDS_ITEM_CATEGORY_MAPPING', `Jenis Barang ${item.productKindName || item.productKindCode || item.productKindId} belum dilink ke akun.`);
      }
    }
  }

  const totalAmountScaled = rupiahIntegerToScaled(fact.totalAmountMinor);
  if (!totalAmountScaled) return bridgeFailure('ACCOUNTING_BRIDGE_AMOUNT_INVALID', 'Nominal transaksi terlalu besar untuk precision Accounting.');

  const resultLines = new Map();
  try {
    for (const rule of rules) {
      if (rule.sourceType === 'payment_method') {
        aggregateLine(resultLines, rule.side, payment.accountId, totalAmountScaled, `${rule.label} · ${payment.name}`, rule.sortOrder);
        continue;
      }

      if (rule.sourceType.startsWith('item_category_')) {
        for (const item of fact.itemLines) {
          const mapping = mappings.get(item.productKindId);
          const accountId = itemAccountForSource(mapping, rule.sourceType);
          if (!accountId) {
            return configurationFailure('NEEDS_ITEM_CATEGORY_MAPPING', `${mapping?.name || item.productKindName || 'Jenis Barang'} belum memiliki akun untuk ${rule.sourceType}.`);
          }
          const amountScaled = itemAmountForSource(fact, item, rule.sourceType);
          if (amountScaled === 'NEEDS_COST_SNAPSHOT') {
            return configurationFailure('NEEDS_COST_SNAPSHOT', 'Snapshot HPP penjualan belum tersedia untuk posting HPP/Persediaan.');
          }
          if (amountScaled === 'INVALID_COST_SNAPSHOT') {
            return bridgeFailure('BUSINESS_FACT_COST_INVALID', 'Snapshot HPP penjualan tidak valid.');
          }
          if (amountScaled === null) {
            return configurationFailure('RULE_NOT_APPLICABLE_TO_FACT', `${rule.sourceType} belum memiliki amount resolver untuk ${fact.factType}.`);
          }
          if (amountScaled === 0) continue;
          aggregateLine(resultLines, rule.side, accountId, amountScaled, `${rule.label} · ${mapping.name}`, rule.sortOrder);
        }
        continue;
      }

      if (rule.sourceType === 'fixed_account') {
        if (!rule.fixedAccountId || !rule.fixedAccountCode) {
          return configurationFailure('NEEDS_FIXED_ACCOUNT', `Rule ${rule.label} belum memiliki akun aktif.`);
        }
        const fixedRulesOnSide = rules.filter(candidate => candidate.side === rule.side && candidate.sourceType === 'fixed_account');
        if (fact.factType === 'EXPENSE') {
          let selectedRuleId = fact.accountingComponentRuleId;
          if (!selectedRuleId && fixedRulesOnSide.length === 1) selectedRuleId = fixedRulesOnSide[0].journalRuleId;
          if (!selectedRuleId) {
            return configurationFailure('NEEDS_COMPONENT_SELECTION', 'Pengeluaran operasional harus memilih komponen beban dari Setting Akuntansi.');
          }
          if (rule.journalRuleId !== selectedRuleId) continue;
          aggregateLine(resultLines, rule.side, rule.fixedAccountId, totalAmountScaled, rule.label, rule.sortOrder);
          continue;
        }
        if (fixedRulesOnSide.length > 1) {
          return configurationFailure('NEEDS_COMPONENT_ALLOCATION', `Transaksi ${fact.factType} memiliki beberapa fixed-account rule tanpa alokasi nominal.`);
        }
        aggregateLine(resultLines, rule.side, rule.fixedAccountId, totalAmountScaled, rule.label, rule.sortOrder);
        continue;
      }

      if (rule.sourceType === 'cost_center_cash') {
        return configurationFailure('UNSUPPORTED_RULE_SOURCE', 'Source cost_center_cash belum memiliki canonical resolver pada Prototype Leker.');
      }
      return configurationFailure('UNSUPPORTED_RULE_SOURCE', `Source ${rule.sourceType} belum didukung.`);
    }
  } catch (error) {
    if (String(error?.message || '').startsWith('ACCOUNTING_BRIDGE_AMOUNT_')) {
      return bridgeFailure('ACCOUNTING_BRIDGE_AMOUNT_INVALID', 'Nominal hasil resolver melampaui batas integer aman.');
    }
    throw error;
  }

  const journalLines = [...resultLines.values()]
    .sort((a, b) => a.order - b.order || a.side.localeCompare(b.side) || a.accountId.localeCompare(b.accountId))
    .map(({ order, ...line }) => line);
  if (!journalLines.length) return configurationFailure('NEEDS_MAPPING', 'Aturan aktif tidak menghasilkan baris jurnal.');

  const createdDate = new Date(fact.createdAt);
  const businessDate = getJakartaBusinessDate(createdDate);
  return {
    ok: true,
    transactionCategoryCode: config.transactionCategoryCode,
    command: {
      businessDate,
      occurredAt: createdDate.toISOString(),
      sourceSystem: 'LEKER_POS',
      sourceReferenceId: `${fact.factType}:${fact.factId}`,
      correlationId: fact.factId,
      idempotencyKey: `LEKER_POS:${fact.factType}:${fact.factId}`,
      description: fact.description,
      systemAdjustmentPolicy: SYSTEM_ADJUSTMENT_POLICY,
      journalLines
    }
  };
}

async function existingDelivery(db, storeId, factType, factId) {
  return db.prepare(`
    SELECT id, status, journal_id, failure_code, failure_detail, attempts, updated_at
    FROM accounting_bridge_deliveries
    WHERE store_id = ? AND producer_module = 'POS' AND fact_type = ? AND fact_id = ?
    LIMIT 1
  `).bind(storeId, factType, factId).first();
}

async function saveDelivery(db, storeId, factType, factId, transactionCategoryCode, outcome) {
  const now = new Date().toISOString();
  const journalId = outcome.journalId || null;
  const failureCode = outcome.failureCode || '';
  const failureDetail = text(outcome.failureDetail, 500);
  await db.prepare(`
    INSERT INTO accounting_bridge_deliveries (
      id, store_id, producer_module, fact_type, fact_id, transaction_category_code,
      status, journal_id, failure_code, failure_detail, attempts, last_attempt_at, created_at, updated_at
    ) VALUES (?, ?, 'POS', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
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
    `accounting_delivery_${crypto.randomUUID()}`,
    storeId,
    factType,
    factId,
    transactionCategoryCode,
    outcome.status,
    journalId,
    failureCode,
    failureDetail,
    now,
    now,
    now
  ).run();
}

function deliveryDto(row) {
  if (!row) return null;
  return {
    status: row.status,
    journalId: row.journal_id || null,
    failureCode: row.failure_code || '',
    failureDetail: row.failure_detail || '',
    attempts: Number(row.attempts || 0),
    updatedAt: row.updated_at || null
  };
}

export async function dispatchPosAccountingFact(db, store, { factType, factId }) {
  const type = text(factType, 24).toUpperCase();
  const id = text(factId, 180);
  const config = FACT_CONFIG[type];
  if (!config || !id) return bridgeFailure('FACT_REFERENCE_INVALID', 'Referensi business fact Accounting bridge tidak valid.');
  const previous = await existingDelivery(db, store.id, type, id);
  if (previous?.status === 'POSTED' && previous.journal_id) {
    return { ok: true, status: 'POSTED', duplicate: true, journalId: previous.journal_id, delivery: deliveryDto(previous) };
  }

  const fact = await loadPosAccountingFact(db, store.id, type, id);
  if (!fact) {
    const failure = bridgeFailure('BUSINESS_FACT_NOT_FOUND', 'Business fact POS tidak ditemukan.');
    await saveDelivery(db, store.id, type, id, config.transactionCategoryCode, {
      status: 'FAILED', failureCode: failure.code, failureDetail: failure.error
    });
    return failure;
  }

  const resolved = await resolvePosFactToJournalCommand(db, store, fact);
  if (!resolved.ok) {
    await saveDelivery(db, store.id, type, id, config.transactionCategoryCode, {
      status: resolved.status,
      failureCode: resolved.code,
      failureDetail: resolved.error
    });
    return resolved;
  }

  const posted = await postAccountingJournal(db, store, resolved.command);
  if (!posted.ok) {
    await saveDelivery(db, store.id, type, id, config.transactionCategoryCode, {
      status: posted.code?.startsWith('NEEDS_') ? 'NEEDS_CONFIGURATION' : 'FAILED',
      failureCode: posted.code || 'ACCOUNTING_POST_FAILED',
      failureDetail: posted.error || 'Accounting posting gagal.'
    });
    return { ok: false, status: 'FAILED', code: posted.code || 'ACCOUNTING_POST_FAILED', error: posted.error || 'Accounting posting gagal.' };
  }
  await saveDelivery(db, store.id, type, id, resolved.transactionCategoryCode, {
    status: 'POSTED', journalId: posted.journal.journalId
  });
  return {
    ok: true,
    status: 'POSTED',
    duplicate: Boolean(posted.duplicate),
    journalId: posted.journal.journalId,
    journalNumber: posted.journal.journalNumber
  };
}

export async function getAccountingBridgeSummary(db, storeId) {
  const rows = await db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM accounting_bridge_deliveries
    WHERE store_id = ? AND producer_module = 'POS'
    GROUP BY status
  `).bind(storeId).all();
  const counts = { pending: 0, posted: 0, needsConfiguration: 0, failed: 0 };
  for (const row of rows.results ?? []) {
    if (row.status === 'PENDING') counts.pending = Number(row.count || 0);
    else if (row.status === 'POSTED') counts.posted = Number(row.count || 0);
    else if (row.status === 'NEEDS_CONFIGURATION') counts.needsConfiguration = Number(row.count || 0);
    else if (row.status === 'FAILED') counts.failed = Number(row.count || 0);
  }
  return counts;
}

async function pendingFacts(db, storeId, limit) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const rows = await db.prepare(`
    SELECT fact_type, fact_id, created_at
    FROM (
      SELECT 'SALE' AS fact_type, s.id AS fact_id, s.created_at
      FROM sales s
      WHERE s.store_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM accounting_bridge_deliveries d
          WHERE d.store_id = s.store_id AND d.producer_module = 'POS'
            AND d.fact_type = 'SALE' AND d.fact_id = s.id AND d.status = 'POSTED'
        )
      UNION ALL
      SELECT 'PURCHASE', p.id, p.created_at
      FROM purchases p
      WHERE p.store_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM accounting_bridge_deliveries d
          WHERE d.store_id = p.store_id AND d.producer_module = 'POS'
            AND d.fact_type = 'PURCHASE' AND d.fact_id = p.id AND d.status = 'POSTED'
        )
      UNION ALL
      SELECT 'EXPENSE', e.id, e.created_at
      FROM expenses e
      WHERE e.store_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM accounting_bridge_deliveries d
          WHERE d.store_id = e.store_id AND d.producer_module = 'POS'
            AND d.fact_type = 'EXPENSE' AND d.fact_id = e.id AND d.status = 'POSTED'
        )
    )
    ORDER BY created_at, fact_type, fact_id
    LIMIT ?
  `).bind(storeId, storeId, storeId, safeLimit).all();
  return rows.results ?? [];
}

export async function syncPendingPosAccountingFacts(db, store, limit = 50) {
  const rows = await pendingFacts(db, store.id, limit);
  const results = [];
  for (const row of rows) {
    const result = await dispatchPosAccountingFact(db, store, { factType: row.fact_type, factId: row.fact_id });
    results.push({ factType: row.fact_type, factId: row.fact_id, status: result.status, code: result.code || '', journalId: result.journalId || null });
  }
  return {
    attempted: results.length,
    posted: results.filter(row => row.status === 'POSTED').length,
    needsConfiguration: results.filter(row => row.status === 'NEEDS_CONFIGURATION').length,
    failed: results.filter(row => row.status === 'FAILED').length,
    results
  };
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function handleAccountingPosBridgeApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/accounting/bridge')) return null;
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (request.method === 'GET' && pathname === '/api/admin/accounting/bridge') {
    return json({ contract: ACCOUNTING_POS_BRIDGE_CONTRACT, summary: await getAccountingBridgeSummary(env.DB, store.id) });
  }
  if (request.method === 'POST' && pathname === '/api/admin/accounting/bridge/sync') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload sync Accounting bridge tidak valid.' }, 400);
    const factType = text(body.value?.factType, 24).toUpperCase();
    const factId = text(body.value?.factId, 180);
    if (factType && factId) {
      const result = await dispatchPosAccountingFact(env.DB, store, { factType, factId });
      return json(result, result.ok ? 200 : 409);
    }
    return json(await syncPendingPosAccountingFacts(env.DB, store, body.value?.limit || 50));
  }
  return json({ error: 'Route Accounting bridge tidak ditemukan.' }, 404);
}
