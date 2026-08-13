import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';

export const ACCOUNTING_REFERENCE_CONTRACT = 'MAXI_ACCOUNTING_REFERENCE_V1';

export const ACCOUNTING_BUSINESS_EVENTS = Object.freeze([
  Object.freeze({ code: 'PURCHASE_MATERIAL', label: 'Pembelian Bahan' }),
  Object.freeze({ code: 'SALE_REVENUE', label: 'Penjualan' }),
  Object.freeze({ code: 'EXPENSE', label: 'Pengeluaran Operasional' }),
  Object.freeze({ code: 'OTHER_INCOME', label: 'Pendapatan Lain' })
]);

export const ACCOUNTING_PAYMENT_METHODS = Object.freeze([
  Object.freeze({ code: 'ANY', label: 'Semua metode' }),
  Object.freeze({ code: 'CASH', label: 'Cash / Kas' }),
  Object.freeze({ code: 'BANK', label: 'Bank / Transfer' }),
  Object.freeze({ code: 'PAYABLE', label: 'Hutang / Utang Usaha' }),
  Object.freeze({ code: 'NON_CASH', label: 'Non Tunai (legacy)' })
]);

const EVENT_CODES = new Set(ACCOUNTING_BUSINESS_EVENTS.map(item => item.code));
const PAYMENT_CODES = new Set(ACCOUNTING_PAYMENT_METHODS.map(item => item.code));

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function listAccountingAccountRefs(db, storeId) {
  const rows = await db.prepare(`
    SELECT id, code, name, account_type, is_postable, external_account_id,
           sync_status, is_active
    FROM accounting_account_refs
    WHERE store_id = ?
    ORDER BY
      CASE account_type
        WHEN 'ASSET' THEN 1
        WHEN 'LIABILITY' THEN 2
        WHEN 'EQUITY' THEN 3
        WHEN 'REVENUE' THEN 4
        WHEN 'EXPENSE' THEN 5
        ELSE 9
      END,
      code
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    code: row.code,
    name: row.name,
    accountType: row.account_type,
    isPostable: Boolean(row.is_postable),
    externalAccountId: row.external_account_id || null,
    syncStatus: row.sync_status || 'PROVISIONAL',
    isActive: Boolean(row.is_active)
  }));
}

export async function listTransactionAccountingMappings(db, storeId) {
  const rows = await db.prepare(`
    SELECT m.id, m.business_event, m.payment_method,
           m.debit_account_ref_id, da.code AS debit_code, da.name AS debit_name,
           m.credit_account_ref_id, ca.code AS credit_code, ca.name AS credit_name,
           m.status, m.updated_at
    FROM transaction_accounting_mappings m
    LEFT JOIN accounting_account_refs da ON da.id = m.debit_account_ref_id AND da.store_id = m.store_id
    LEFT JOIN accounting_account_refs ca ON ca.id = m.credit_account_ref_id AND ca.store_id = m.store_id
    WHERE m.store_id = ?
    ORDER BY m.business_event, m.payment_method
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    businessEvent: row.business_event,
    paymentMethod: row.payment_method,
    debitAccountRefId: row.debit_account_ref_id || null,
    debitAccount: row.debit_account_ref_id ? { id: row.debit_account_ref_id, code: row.debit_code || '', name: row.debit_name || '' } : null,
    creditAccountRefId: row.credit_account_ref_id || null,
    creditAccount: row.credit_account_ref_id ? { id: row.credit_account_ref_id, code: row.credit_code || '', name: row.credit_name || '' } : null,
    status: row.status,
    updatedAt: row.updated_at
  }));
}

async function validateAccountPair(db, storeId, debitAccountRefId, creditAccountRefId) {
  const debitId = debitAccountRefId ? String(debitAccountRefId) : '';
  const creditId = creditAccountRefId ? String(creditAccountRefId) : '';
  if (!debitId && !creditId) return { ok: true, debitAccountRefId: null, creditAccountRefId: null, status: 'NEEDS_MAPPING' };
  if (!debitId || !creditId || debitId === creditId) {
    return { ok: false, error: 'Debit dan kredit wajib dipilih, berbeda, dan tidak boleh setengah terisi.' };
  }
  const rows = await db.prepare(`
    SELECT id FROM accounting_account_refs
    WHERE store_id = ? AND id IN (?, ?) AND is_active = 1 AND is_postable = 1
  `).bind(storeId, debitId, creditId).all();
  if ((rows.results ?? []).length !== 2) return { ok: false, error: 'Akun debit/kredit tidak valid atau bukan milik gerai ini.' };
  return { ok: true, debitAccountRefId: debitId, creditAccountRefId: creditId, status: 'ACTIVE' };
}

export async function resolveTransactionAccountingMapping(db, storeId, businessEvent, paymentMethod) {
  const event = String(businessEvent || '').trim().toUpperCase();
  const method = String(paymentMethod || '').trim().toUpperCase();
  if (!EVENT_CODES.has(event)) return null;
  const exact = await db.prepare(`
    SELECT id, business_event, payment_method, debit_account_ref_id, credit_account_ref_id
    FROM transaction_accounting_mappings
    WHERE store_id = ? AND business_event = ? AND payment_method = ? AND status = 'ACTIVE'
    LIMIT 1
  `).bind(storeId, event, method).first();
  if (exact) return exact;
  return db.prepare(`
    SELECT id, business_event, payment_method, debit_account_ref_id, credit_account_ref_id
    FROM transaction_accounting_mappings
    WHERE store_id = ? AND business_event = ? AND payment_method = 'ANY' AND status = 'ACTIVE'
    LIMIT 1
  `).bind(storeId, event).first();
}

export async function buildTransactionAccountingSnapshot(db, {
  storeId, sourceType, sourceId, businessEvent, paymentMethod, now
}) {
  const event = String(businessEvent || '').trim().toUpperCase();
  const method = String(paymentMethod || '').trim().toUpperCase();
  const mapping = await resolveTransactionAccountingMapping(db, storeId, event, method);
  const snapshotId = `accounting_snapshot_${crypto.randomUUID()}`;
  const status = mapping ? 'MAPPED' : 'NEEDS_MAPPING';
  return {
    status,
    mappingId: mapping?.id || null,
    debitAccountRefId: mapping?.debit_account_ref_id || null,
    creditAccountRefId: mapping?.credit_account_ref_id || null,
    statement: db.prepare(`
      INSERT INTO transaction_accounting_snapshots (
        id, store_id, source_type, source_id, business_event, payment_method,
        mapping_id, debit_account_ref_id, credit_account_ref_id, mapping_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      snapshotId, storeId, sourceType, sourceId, event, method,
      mapping?.id || null, mapping?.debit_account_ref_id || null, mapping?.credit_account_ref_id || null,
      status, now
    )
  };
}

export async function getTransactionAccountingSnapshot(db, storeId, sourceType, sourceId) {
  const row = await db.prepare(`
    SELECT s.id, s.business_event, s.payment_method, s.mapping_id, s.mapping_status, s.created_at,
           s.debit_account_ref_id, da.code AS debit_code, da.name AS debit_name,
           s.credit_account_ref_id, ca.code AS credit_code, ca.name AS credit_name
    FROM transaction_accounting_snapshots s
    LEFT JOIN accounting_account_refs da ON da.id = s.debit_account_ref_id AND da.store_id = s.store_id
    LEFT JOIN accounting_account_refs ca ON ca.id = s.credit_account_ref_id AND ca.store_id = s.store_id
    WHERE s.store_id = ? AND s.source_type = ? AND s.source_id = ?
    LIMIT 1
  `).bind(storeId, sourceType, sourceId).first();
  if (!row) return null;
  return {
    contract: ACCOUNTING_REFERENCE_CONTRACT,
    businessEvent: row.business_event,
    paymentMethod: row.payment_method,
    mappingId: row.mapping_id || null,
    mappingStatus: row.mapping_status,
    debitAccount: row.debit_account_ref_id ? { id: row.debit_account_ref_id, code: row.debit_code || '', name: row.debit_name || '' } : null,
    creditAccount: row.credit_account_ref_id ? { id: row.credit_account_ref_id, code: row.credit_code || '', name: row.credit_name || '' } : null,
    snapshotAt: row.created_at,
    journalReference: null
  };
}

async function portalPayload(db, store) {
  const [accounts, mappings] = await Promise.all([
    listAccountingAccountRefs(db, store.id),
    listTransactionAccountingMappings(db, store.id)
  ]);
  return {
    contract: ACCOUNTING_REFERENCE_CONTRACT,
    sourceProgram: 'PROTOTYPE_LEKER',
    accountingOwner: 'ACCOUNTING_MODULE',
    syncStatus: 'PROVISIONAL',
    store,
    businessEvents: ACCOUNTING_BUSINESS_EVENTS,
    paymentMethods: ACCOUNTING_PAYMENT_METHODS,
    accounts,
    mappings
  };
}

export async function handleAccountingReferenceApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/accounting/reference')) return null;
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (request.method === 'GET' && pathname === '/api/admin/accounting/reference') {
    return json(await portalPayload(env.DB, store));
  }
  if (request.method === 'GET' && pathname === '/api/admin/accounting/reference/accounts') {
    return json({
      contract: ACCOUNTING_REFERENCE_CONTRACT,
      sourceProgram: 'PROTOTYPE_LEKER',
      accountingOwner: 'ACCOUNTING_MODULE',
      syncStatus: 'PROVISIONAL',
      store,
      accounts: await listAccountingAccountRefs(env.DB, store.id)
    });
  }
  if (request.method === 'PUT' && pathname === '/api/admin/accounting/reference/mappings') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload mapping Accounting tidak valid.' }, 400);
    const businessEvent = String(body.value?.businessEvent || '').trim().toUpperCase();
    const paymentMethod = String(body.value?.paymentMethod || '').trim().toUpperCase();
    if (!EVENT_CODES.has(businessEvent) || !PAYMENT_CODES.has(paymentMethod)) {
      return json({ error: 'Business event atau metode pembayaran tidak dikenal.' }, 400);
    }
    const pair = await validateAccountPair(
      env.DB,
      store.id,
      body.value?.debitAccountRefId,
      body.value?.creditAccountRefId
    );
    if (!pair.ok) return json({ error: pair.error }, 400);
    const id = `acctmap_${store.id}_${businessEvent}_${paymentMethod}`;
    await env.DB.prepare(`
      INSERT INTO transaction_accounting_mappings (
        id, store_id, business_event, payment_method,
        debit_account_ref_id, credit_account_ref_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(store_id, business_event, payment_method) DO UPDATE SET
        debit_account_ref_id = excluded.debit_account_ref_id,
        credit_account_ref_id = excluded.credit_account_ref_id,
        status = excluded.status,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      id, store.id, businessEvent, paymentMethod,
      pair.debitAccountRefId, pair.creditAccountRefId, pair.status
    ).run();
    return json({ ok: true, portal: await portalPayload(env.DB, store) });
  }

  return json({ error: 'Route referensi Accounting tidak ditemukan.' }, 404);
}
