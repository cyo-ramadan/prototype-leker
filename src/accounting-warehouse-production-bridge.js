import { getJakartaBusinessDate } from './time.js';
import { postAccountingJournal, SYSTEM_ADJUSTMENT_POLICY } from './accounting-ledger.js';

export const ACCOUNTING_WAREHOUSE_PRODUCTION_BRIDGE_CONTRACT = 'MAXI_ACCOUNTING_WAREHOUSE_PRODUCTION_BRIDGE_V1';

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

export function resolveProductionInventoryTransfer(outputInventoryAccountId, components) {
  const outputAccountId = text(outputInventoryAccountId, 180);
  if (!outputAccountId) return { ok: false, code: 'OUTPUT_INVENTORY_ACCOUNT_MISSING' };
  if (!Array.isArray(components) || !components.length) return { ok: false, code: 'PRODUCTION_COMPONENTS_MISSING' };

  const credits = new Map();
  let transferAmountScaled = 0;
  for (const component of components) {
    const accountId = text(component?.inventoryAccountId, 180);
    const amountScaled = Number(component?.totalCostScaled);
    if (!accountId) return { ok: false, code: 'COMPONENT_INVENTORY_ACCOUNT_MISSING' };
    if (!Number.isSafeInteger(amountScaled) || amountScaled < 0) return { ok: false, code: 'PRODUCTION_COST_INVALID' };
    if (amountScaled === 0 || accountId === outputAccountId) continue;
    transferAmountScaled = safeAdd(transferAmountScaled, amountScaled);
    credits.set(accountId, safeAdd(credits.get(accountId) || 0, amountScaled));
  }

  if (transferAmountScaled === 0) {
    return { ok: true, accountingChange: 'NONE_SAME_INVENTORY_ACCOUNT', transferAmountScaled: 0, journalLines: [] };
  }

  return {
    ok: true,
    accountingChange: 'INVENTORY_ACCOUNT_TRANSFER',
    transferAmountScaled,
    journalLines: [
      {
        accountId: outputAccountId,
        side: 'DEBIT',
        amountScaled: transferAmountScaled,
        description: 'Persediaan hasil produksi'
      },
      ...[...credits.entries()].map(([accountId, amountScaled]) => ({
        accountId,
        side: 'CREDIT',
        amountScaled,
        description: 'Persediaan bahan produksi'
      }))
    ]
  };
}

async function loadProductionFact(db, storeId, productionRunId) {
  const run = await db.prepare(`
    SELECT id, store_id, output_product_name, output_product_kind_id,
           output_product_kind_code, output_product_kind_name,
           hpp_total_scaled, created_at, template_modified
    FROM production_runs
    WHERE id = ? AND store_id = ? AND status = 'POSTED'
    LIMIT 1
  `).bind(productionRunId, storeId).first();
  if (!run) return null;
  const rows = await db.prepare(`
    SELECT component_product_name, component_product_kind_id,
           component_product_kind_code, component_product_kind_name,
           total_cost_snapshot_scaled
    FROM production_run_components
    WHERE production_run_id = ? AND store_id = ?
    ORDER BY id
  `).bind(productionRunId, storeId).all();
  return {
    productionRunId: run.id,
    outputProductName: run.output_product_name,
    outputProductKindId: run.output_product_kind_id || null,
    outputProductKindCode: run.output_product_kind_code || '',
    outputProductKindName: run.output_product_kind_name || '',
    hppTotalScaled: Number(run.hpp_total_scaled || 0),
    createdAt: run.created_at,
    templateModified: Boolean(run.template_modified),
    components: (rows.results ?? []).map(row => ({
      productName: row.component_product_name,
      productKindId: row.component_product_kind_id || null,
      productKindCode: row.component_product_kind_code || '',
      productKindName: row.component_product_kind_name || '',
      totalCostScaled: Number(row.total_cost_snapshot_scaled || 0)
    }))
  };
}

async function productionRuleConfiguration(db, storeId) {
  const category = await db.prepare(`
    SELECT id, code, name
    FROM transaction_categories
    WHERE store_id = ? AND code = 'wh_production' AND is_active = 1
    LIMIT 1
  `).bind(storeId).first();
  if (!category) return null;
  const rows = await db.prepare(`
    SELECT id, label, side, source_type, sort_order
    FROM journal_rules
    WHERE store_id = ? AND transaction_category_id = ? AND is_active = 1
    ORDER BY sort_order, id
  `).bind(storeId, category.id).all();
  return { category, rules: rows.results ?? [] };
}

async function itemCategoryMappings(db, storeId, productKindIds) {
  const ids = [...new Set(productKindIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await db.prepare(`
    SELECT product_kind_id, name, inventory_account_id
    FROM item_categories
    WHERE store_id = ? AND is_active = 1 AND product_kind_id IN (${placeholders})
  `).bind(storeId, ...ids).all();
  return new Map((rows.results ?? []).map(row => [row.product_kind_id, {
    name: row.name,
    inventoryAccountId: row.inventory_account_id
  }]));
}

async function existingDelivery(db, storeId, productionRunId) {
  return db.prepare(`
    SELECT status, journal_id, failure_code, failure_detail, attempts, updated_at
    FROM accounting_bridge_deliveries
    WHERE store_id = ? AND producer_module = 'WAREHOUSE'
      AND fact_type = 'PRODUCTION' AND fact_id = ?
    LIMIT 1
  `).bind(storeId, productionRunId).first();
}

async function saveDelivery(db, storeId, productionRunId, outcome) {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO accounting_bridge_deliveries (
      id, store_id, producer_module, fact_type, fact_id, transaction_category_code,
      status, journal_id, failure_code, failure_detail, attempts, last_attempt_at, created_at, updated_at
    ) VALUES (?, ?, 'WAREHOUSE', 'PRODUCTION', ?, 'wh_production', ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(store_id, producer_module, fact_type, fact_id) DO UPDATE SET
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
    productionRunId,
    outcome.status,
    outcome.journalId || null,
    outcome.failureCode || '',
    text(outcome.failureDetail, 500),
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

export async function dispatchWarehouseProductionAccountingFact(db, store, productionRunId) {
  const runId = text(productionRunId, 180);
  if (!store?.id || !runId) return bridgeFailure('FACT_REFERENCE_INVALID', 'Referensi produksi Accounting bridge tidak valid.');
  const previous = await existingDelivery(db, store.id, runId);
  if (previous?.status === 'POSTED') {
    return { ok: true, status: 'POSTED', duplicate: true, journalId: previous.journal_id || null, delivery: deliveryDto(previous) };
  }

  const fact = await loadProductionFact(db, store.id, runId);
  if (!fact) {
    const failure = bridgeFailure('PRODUCTION_FACT_NOT_FOUND', 'Business fact produksi tidak ditemukan setelah commit.');
    await saveDelivery(db, store.id, runId, { status: 'FAILED', failureCode: failure.code, failureDetail: failure.error });
    return failure;
  }
  if (!fact.outputProductKindId) {
    const failure = configurationFailure('NEEDS_OUTPUT_PRODUCT_KIND', 'Barang hasil produksi belum memiliki Klasifikasi Accounting.');
    await saveDelivery(db, store.id, runId, { status: failure.status, failureCode: failure.code, failureDetail: failure.error });
    return failure;
  }
  const missingComponentKind = fact.components.find(component => !component.productKindId);
  if (missingComponentKind) {
    const failure = configurationFailure('NEEDS_COMPONENT_PRODUCT_KIND', `Bahan ${missingComponentKind.productName} belum memiliki Klasifikasi Accounting.`);
    await saveDelivery(db, store.id, runId, { status: failure.status, failureCode: failure.code, failureDetail: failure.error });
    return failure;
  }

  const rules = await productionRuleConfiguration(db, store.id);
  if (!rules) {
    const failure = configurationFailure('NEEDS_TRANSACTION_MAPPING', 'Jenis transaksi wh_production belum tersedia/aktif di Setting Akuntansi.');
    await saveDelivery(db, store.id, runId, { status: failure.status, failureCode: failure.code, failureDetail: failure.error });
    return failure;
  }
  const activeRules = rules.rules;
  const debitInventoryRules = activeRules.filter(rule => rule.side === 'DEBIT' && rule.source_type === 'item_category_inventory');
  const creditInventoryRules = activeRules.filter(rule => rule.side === 'CREDIT' && rule.source_type === 'item_category_inventory');
  if (activeRules.length !== 2 || debitInventoryRules.length !== 1 || creditInventoryRules.length !== 1) {
    const failure = configurationFailure('NEEDS_PRODUCTION_RULE_CONFIGURATION', 'Rule wh_production wajib tepat satu Debit persediaan hasil dan satu Credit persediaan bahan.');
    await saveDelivery(db, store.id, runId, { status: failure.status, failureCode: failure.code, failureDetail: failure.error });
    return failure;
  }

  const mappings = await itemCategoryMappings(db, store.id, [fact.outputProductKindId, ...fact.components.map(component => component.productKindId)]);
  const outputMapping = mappings.get(fact.outputProductKindId);
  if (!outputMapping?.inventoryAccountId) {
    const failure = configurationFailure('NEEDS_OUTPUT_INVENTORY_MAPPING', `Klasifikasi ${fact.outputProductKindName || fact.outputProductKindCode} belum dilink ke akun Persediaan.`);
    await saveDelivery(db, store.id, runId, { status: failure.status, failureCode: failure.code, failureDetail: failure.error });
    return failure;
  }

  const resolvedComponents = [];
  for (const component of fact.components) {
    const mapping = mappings.get(component.productKindId);
    if (!mapping?.inventoryAccountId) {
      const failure = configurationFailure('NEEDS_COMPONENT_INVENTORY_MAPPING', `Klasifikasi ${component.productKindName || component.productKindCode || component.productName} belum dilink ke akun Persediaan.`);
      await saveDelivery(db, store.id, runId, { status: failure.status, failureCode: failure.code, failureDetail: failure.error });
      return failure;
    }
    resolvedComponents.push({ ...component, inventoryAccountId: mapping.inventoryAccountId });
  }

  let transfer;
  try {
    transfer = resolveProductionInventoryTransfer(outputMapping.inventoryAccountId, resolvedComponents);
  } catch (error) {
    if (String(error?.message || '') === 'ACCOUNTING_BRIDGE_AMOUNT_OVERFLOW') {
      const failure = bridgeFailure('ACCOUNTING_BRIDGE_AMOUNT_INVALID', 'Nilai transfer persediaan produksi melampaui batas integer aman.');
      await saveDelivery(db, store.id, runId, { status: failure.status, failureCode: failure.code, failureDetail: failure.error });
      return failure;
    }
    throw error;
  }
  if (!transfer.ok) {
    const failure = bridgeFailure(transfer.code || 'PRODUCTION_ACCOUNTING_RESOLUTION_FAILED', 'Accounting bridge produksi gagal resolve nilai persediaan.');
    await saveDelivery(db, store.id, runId, { status: failure.status, failureCode: failure.code, failureDetail: failure.error });
    return failure;
  }

  if (transfer.accountingChange === 'NONE_SAME_INVENTORY_ACCOUNT') {
    await saveDelivery(db, store.id, runId, { status: 'POSTED', journalId: null });
    return {
      ok: true,
      status: 'POSTED',
      duplicate: false,
      journalId: null,
      accountingChange: transfer.accountingChange,
      transferAmountScaled: 0
    };
  }

  const createdDate = new Date(fact.createdAt);
  if (Number.isNaN(createdDate.valueOf())) {
    const failure = bridgeFailure('PRODUCTION_FACT_DATE_INVALID', 'Waktu business fact produksi tidak valid.');
    await saveDelivery(db, store.id, runId, { status: failure.status, failureCode: failure.code, failureDetail: failure.error });
    return failure;
  }

  const posted = await postAccountingJournal(db, store, {
    businessDate: getJakartaBusinessDate(createdDate),
    occurredAt: createdDate.toISOString(),
    sourceSystem: 'LEKER_WAREHOUSE',
    sourceReferenceId: `PRODUCTION:${runId}`,
    correlationId: runId,
    idempotencyKey: `LEKER_WAREHOUSE:PRODUCTION:${runId}`,
    description: `Produksi ${fact.outputProductName}`,
    systemAdjustmentPolicy: SYSTEM_ADJUSTMENT_POLICY,
    journalLines: transfer.journalLines
  });
  if (!posted.ok) {
    await saveDelivery(db, store.id, runId, {
      status: posted.code?.startsWith('NEEDS_') ? 'NEEDS_CONFIGURATION' : 'FAILED',
      failureCode: posted.code || 'ACCOUNTING_POST_FAILED',
      failureDetail: posted.error || 'Accounting posting produksi gagal.'
    });
    return { ok: false, status: 'FAILED', code: posted.code || 'ACCOUNTING_POST_FAILED', error: posted.error || 'Accounting posting produksi gagal.' };
  }

  await saveDelivery(db, store.id, runId, { status: 'POSTED', journalId: posted.journal.journalId });
  return {
    ok: true,
    status: 'POSTED',
    duplicate: Boolean(posted.duplicate),
    journalId: posted.journal.journalId,
    journalNumber: posted.journal.journalNumber,
    accountingChange: transfer.accountingChange,
    transferAmountScaled: transfer.transferAmountScaled
  };
}
