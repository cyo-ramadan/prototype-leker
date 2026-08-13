import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getAccountingSettingsBootstrap } from './accounting-settings.js';

export const ACCOUNTING_REFERENCE_CONTRACT = 'MAXI_ACCOUNTING_SETTINGS_V1';

const EVENT_TO_CATEGORY = Object.freeze({
  PURCHASE_MATERIAL: 'purchase_material',
  SALE_REVENUE: 'sale',
  EXPENSE: 'operational',
  OTHER_INCOME: 'other_income',
  PAYROLL: 'payroll',
  DEPOSIT: 'deposit',
  WH_TRANSFER: 'wh_transfer',
  WH_OPNAME: 'wh_opname',
  WH_PRODUCTION: 'wh_production',
  WH_RETURN: 'wh_return'
});
const LEGACY_PAYMENT_METHODS = new Set(['ANY', 'CASH', 'BANK', 'PAYABLE', 'NON_CASH']);

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

function categoryCode(value) {
  const raw = String(value || '').trim();
  return EVENT_TO_CATEGORY[raw.toUpperCase()] || raw.toLowerCase();
}

async function configurationStatus(db, storeId, transactionCategoryCode, paymentMethodCode = '') {
  const category = await db.prepare(`
    SELECT id, involves_payment, involves_item_category
    FROM transaction_categories
    WHERE store_id = ? AND code = ? AND is_active = 1
    LIMIT 1
  `).bind(storeId, transactionCategoryCode).first();
  if (!category) return { status: 'CATEGORY_NOT_FOUND', category: null };

  const ruleCounts = await db.prepare(`
    SELECT
      SUM(CASE WHEN side = 'DEBIT' AND is_active = 1 THEN 1 ELSE 0 END) AS debit_count,
      SUM(CASE WHEN side = 'CREDIT' AND is_active = 1 THEN 1 ELSE 0 END) AS credit_count
    FROM journal_rules
    WHERE store_id = ? AND transaction_category_id = ?
  `).bind(storeId, category.id).first();
  const structurallyComplete = Number(ruleCounts?.debit_count || 0) >= 1 && Number(ruleCounts?.credit_count || 0) >= 1;

  let paymentComplete = true;
  if (category.involves_payment) {
    const payment = await db.prepare(`
      SELECT id FROM payment_methods
      WHERE store_id = ? AND code = ? AND is_active = 1 AND account_id IS NOT NULL
      LIMIT 1
    `).bind(storeId, String(paymentMethodCode || '').trim().toUpperCase()).first();
    paymentComplete = Boolean(payment);
  }

  let itemCategoryComplete = true;
  if (category.involves_item_category) {
    const mapped = await db.prepare(`
      SELECT id FROM item_categories
      WHERE store_id = ? AND is_active = 1
      LIMIT 1
    `).bind(storeId).first();
    itemCategoryComplete = Boolean(mapped);
  }

  return {
    status: structurallyComplete && paymentComplete && itemCategoryComplete ? 'COMPLETE' : 'INCOMPLETE',
    category
  };
}

export async function buildTransactionAccountingSnapshot(db, {
  storeId, sourceType, sourceId, businessEvent, paymentMethod, now
}) {
  const legacyBusinessEvent = String(businessEvent || '').trim().toUpperCase();
  const transactionCategoryCode = categoryCode(legacyBusinessEvent);
  const paymentMethodCode = String(paymentMethod || '').trim().toUpperCase();
  const legacyPaymentMethod = LEGACY_PAYMENT_METHODS.has(paymentMethodCode) ? paymentMethodCode : 'ANY';
  const configuration = await configurationStatus(db, storeId, transactionCategoryCode, paymentMethodCode);
  const snapshotId = `accounting_snapshot_${crypto.randomUUID()}`;
  const legacyMappingStatus = configuration.status === 'COMPLETE' ? 'MAPPED' : 'NEEDS_MAPPING';
  return {
    status: configuration.status,
    mappingId: null,
    debitAccountRefId: null,
    creditAccountRefId: null,
    transactionCategoryCode,
    statement: db.prepare(`
      INSERT INTO transaction_accounting_snapshots (
        id, store_id, source_type, source_id,
        business_event, payment_method, mapping_id, debit_account_ref_id, credit_account_ref_id, mapping_status,
        transaction_category_code, payment_method_code, configuration_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?)
    `).bind(
      snapshotId, storeId, sourceType, sourceId,
      legacyBusinessEvent || transactionCategoryCode.toUpperCase(), legacyPaymentMethod, legacyMappingStatus,
      transactionCategoryCode, paymentMethodCode, configuration.status, now
    )
  };
}

export async function getTransactionAccountingSnapshot(db, storeId, sourceType, sourceId) {
  const row = await db.prepare(`
    SELECT id, transaction_category_code, payment_method_code, configuration_status, created_at
    FROM transaction_accounting_snapshots
    WHERE store_id = ? AND source_type = ? AND source_id = ?
    LIMIT 1
  `).bind(storeId, sourceType, sourceId).first();
  if (!row) return null;
  return {
    contract: ACCOUNTING_REFERENCE_CONTRACT,
    transactionCategoryCode: row.transaction_category_code,
    businessEvent: row.transaction_category_code,
    paymentMethod: row.payment_method_code,
    mappingId: null,
    mappingStatus: row.configuration_status,
    debitAccount: null,
    creditAccount: null,
    snapshotAt: row.created_at,
    journalReference: null
  };
}

async function compatibilityPortal(db, store) {
  const settings = await getAccountingSettingsBootstrap(db, store);
  return {
    contract: ACCOUNTING_REFERENCE_CONTRACT,
    sourceProgram: 'PROTOTYPE_LEKER',
    accountingOwner: 'ACCOUNTING_MODULE',
    syncStatus: 'SETTINGS_ONLY',
    journalGeneration: 'OUT_OF_SCOPE',
    store,
    businessEvents: settings.transactionCategories.map(category => ({ code: category.code, label: category.name })),
    paymentMethods: settings.paymentMethods.map(method => ({ code: method.code, label: method.name })),
    accounts: settings.accounts.map(account => ({
      ...account,
      accountType: account.type,
      isPostable: true,
      externalAccountId: null,
      syncStatus: account.reviewRequired ? 'REVIEW_REQUIRED' : 'LOCAL_SETTINGS'
    })),
    mappings: settings.transactionCategories.map(category => ({
      id: category.id,
      businessEvent: category.code,
      paymentMethod: '',
      debitAccountRefId: null,
      creditAccountRefId: null,
      debitAccount: null,
      creditAccount: null,
      status: category.completeness === 'COMPLETE' ? 'ACTIVE' : 'NEEDS_MAPPING'
    }))
  };
}

export async function handleAccountingReferenceApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/accounting/reference')) return null;
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (request.method === 'GET' && pathname === '/api/admin/accounting/reference') {
    return json(await compatibilityPortal(env.DB, store));
  }
  if (request.method === 'GET' && pathname === '/api/admin/accounting/reference/accounts') {
    const portal = await compatibilityPortal(env.DB, store);
    return json({
      contract: portal.contract,
      sourceProgram: portal.sourceProgram,
      accountingOwner: portal.accountingOwner,
      syncStatus: portal.syncStatus,
      store,
      accounts: portal.accounts
    });
  }
  if (request.method === 'PUT' && pathname === '/api/admin/accounting/reference/mappings') {
    return json({
      error: 'Pair mapping legacy sudah dipensiunkan. Gunakan Accounting Settings → Transaction Categories & Journal Rules.'
    }, 410);
  }

  return json({ error: 'Route referensi Accounting tidak ditemukan.' }, 404);
}
