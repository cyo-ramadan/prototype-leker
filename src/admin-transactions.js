import { json } from './http.js';
import { salePaymentLabel } from './sale-payments.js';
import { qrisMethodFor } from './qris-otomatis.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { accountingReferenceForTransaction } from './accounting-bridge-seam.js';
import { ACCOUNTING_POS_BRIDGE_CONTRACT } from './accounting-pos-bridge.js';

const FILTERS = new Set(['ALL', 'SALES', 'PURCHASES', 'OPERATIONS', 'STOCK_ADJUSTMENTS', 'GOODS_FLOW', 'PRODUCTION', 'ASSETS']);
// STOCK_ADJUSTMENTS and GOODS_FLOW both key off kind = GOODS_FLOW at the SQL
// level -- purpose = 'STOCK_ADJUSTMENT' lives inside payload_json, not its
// own column, so the two filters need their own WHERE clause (see
// filterClause below) rather than a plain `kind IN (...)` set like the rest.
const KIND_FILTER = {
  SALES: new Set(['SALE']), PURCHASES: new Set(['PURCHASE']),
  OPERATIONS: new Set(['EXPENSE', 'OTHER_INCOME', 'CASH_FLOW', 'ADMIN_PAYMENT', 'ADMIN_EXPENSE']),
  PRODUCTION: new Set(['PRODUCTION']),
  ASSETS: new Set(['ASSET'])
};
function filterClause(filter) {
  if (filter === 'STOCK_ADJUSTMENTS') return { clause: `AND kind = 'GOODS_FLOW' AND json_extract(payload_json, '$.purpose') = 'STOCK_ADJUSTMENT'`, values: [] };
  // `!= 'STOCK_ADJUSTMENT'` would silently drop every row where purpose is
  // absent (plain GOODS_FLOW rows have no purpose key) -- json_extract
  // returns NULL there, and NULL compared with anything is NULL, not true,
  // in SQL's three-valued logic. `IS NOT` is the NULL-safe form: NULL IS
  // NOT 'x' is true.
  if (filter === 'GOODS_FLOW') return { clause: `AND kind = 'GOODS_FLOW' AND json_extract(payload_json, '$.purpose') IS NOT 'STOCK_ADJUSTMENT'`, values: [] };
  const kindSet = KIND_FILTER[filter] || null;
  if (!kindSet) return { clause: '', values: [] };
  return { clause: `AND kind IN (${[...kindSet].map(() => '?').join(', ')})`, values: [...kindSet] };
}
const POS_ACCOUNTING_FACT_KINDS = new Set(['SALE', 'PURCHASE', 'EXPENSE']);
function parseIso(value) { const raw = String(value || '').trim(); if (!raw) return null; const time = Date.parse(raw); return Number.isFinite(time) ? new Date(time).toISOString() : null; }
function parseCursor(value) { const raw = String(value || '').trim(); if (!raw) return null; const separator = raw.lastIndexOf('|'); if (separator < 1) return null; const occurredAt = parseIso(raw.slice(0, separator)); const id = raw.slice(separator + 1).trim(); return occurredAt && id ? { occurredAt, id } : null; }
function safeJson(value) { try { return JSON.parse(value || '{}'); } catch { return {}; } }
function approvalDescription(kind, payload) {
  if (kind === 'CASH_FLOW') return String(payload.description || payload.note || 'Arus kas');
  if (kind === 'GOODS_FLOW') { const direction = String(payload.direction || '').toUpperCase(); const qty = Number(payload.quantity || 0); return `${payload.productName || 'Barang'} · ${direction || 'FLOW'} ${qty || ''}`.trim(); }
  if (kind === 'ASSET') return String(payload.description || payload.note || 'Perubahan aset');
  return kind;
}
function accountingForPosFact(transaction, deliveryMap) {
  if (!POS_ACCOUNTING_FACT_KINDS.has(transaction.kind)) return accountingReferenceForTransaction(transaction);
  const delivery = deliveryMap.get(`${transaction.kind}:${transaction.id}`) || null;
  return {
    contract: ACCOUNTING_POS_BRIDGE_CONTRACT, sourceProgram: 'PROTOTYPE_LEKER', factType: transaction.kind, factId: transaction.id,
    sourceReference: `${transaction.kind}:${transaction.id}`, eligible: transaction.status !== 'voided',
    syncStatus: delivery?.status || 'NOT_ATTEMPTED', journalReference: delivery?.journal_id || null,
    failureCode: delivery?.failure_code || '', failureDetail: delivery?.failure_detail || '',
    attempts: Number(delivery?.attempts || 0), lastAttemptAt: delivery?.last_attempt_at || null
  };
}
function normalizeRow(row, deliveryMap) {
  const payload = row.payload_json ? safeJson(row.payload_json) : null;
  const kind = row.kind;
  let amount = row.amount == null ? null : Number(row.amount);
  let description = row.description || '';
  if (payload) { if (kind === 'CASH_FLOW' || kind === 'ASSET') amount = Number(payload.amount || 0) || null; description = approvalDescription(kind, payload); }
  const transaction = {
    id: row.id, kind, occurredAt: row.occurred_at, amount, description, status: row.status,
    paymentMethod: row.payment_method || '', drawerSessionId: row.drawer_session_id || null,
    cashierId: row.cashier_id || null, cashierName: row.cashier_name || '',
    creatorName: row.creator_name || '',
    createdBy: { value: `${row.creator_role || ''}:${row.creator_id || ''}`, role: row.creator_role || '', id: row.creator_id || '', name: row.creator_name || '' },
    sourceReference: { type: row.reference_type || kind, id: row.reference_id || row.id }, operationalPayload: payload
  };
  return { ...transaction, accounting: kind.startsWith('ADMIN_') ? null : accountingForPosFact(transaction, deliveryMap) };
}
// A Stock Opname submission creates one approval_requests row per item
// (each keeps its own stale-snapshot guard and its own ACC/Reject decision --
// that authority model is untouched), but Bos Cyo wants the audit-facing
// Data Transaksi list to read as one line per session, with the per-item
// breakdown (and selisih) only on Detail. Grouping happens here, after
// normalizeRow, purely for display -- it never touches approval_requests
// rows or how Admin decides them.
function groupStockAdjustmentSessions(transactions) {
  const bySession = new Map();
  const result = [];
  for (const tx of transactions) {
    const purpose = tx.kind === 'GOODS_FLOW' ? tx.operationalPayload?.purpose : null;
    const sessionId = purpose === 'STOCK_ADJUSTMENT' ? tx.operationalPayload?.sessionId : null;
    if (!sessionId) { result.push(tx); continue; }
    const existing = bySession.get(sessionId);
    if (!existing) {
      const group = {
        ...tx,
        id: sessionId,
        amount: null,
        operationalPayload: { purpose: 'STOCK_ADJUSTMENT', sessionId, items: [tx.operationalPayload] },
        sourceReference: { type: 'STOCK_ADJUSTMENT_SESSION', id: sessionId }
      };
      bySession.set(sessionId, group);
      result.push(group);
    } else {
      existing.operationalPayload.items.push(tx.operationalPayload);
      if (tx.occurredAt < existing.occurredAt) existing.occurredAt = tx.occurredAt;
      if (tx.status !== existing.status) existing.status = 'campuran';
    }
  }
  for (const tx of result) {
    if (tx.operationalPayload?.items) tx.description = `Penyesuaian Stok · ${tx.operationalPayload.items.length} barang`;
  }
  return result;
}

// 2026-09-29: this marker was once an EXISTS subquery inside pos_facts, which
// ran for EVERY sale in the store and scanned every production_runs row per
// sale (no sale_id index) -- sales x runs row reads per page load. It burned
// D1's whole free daily read quota within minutes and took every login down.
// Only the visible page's sales are checked now, via sale_items' sale_id index.
async function loadDadakanSaleIds(db, storeId, rows) {
  const saleIds = rows.filter(row => row.kind === 'SALE').map(row => row.id);
  const found = new Set();
  // Pages go up to 100 rows; D1 rejects >100 bind variables per statement.
  for (let start = 0; start < saleIds.length; start += 90) {
    const chunk = saleIds.slice(start, start + 90);
    const result = await db.prepare(`
      SELECT DISTINCT sale_id FROM sale_items
      WHERE sale_id IN (${chunk.map(() => '?').join(', ')}) AND store_id = ? AND production_run_id IS NOT NULL
    `).bind(...chunk, storeId).all();
    for (const row of result.results ?? []) found.add(row.sale_id);
  }
  return found;
}

// Kartu Pembelian di daftar dulu cuma menampilkan deskripsi + total, tanpa qty
// (Bos Cyo, 2026-10-05: "di kartu pembelian kenapa engga ada qty yang dibelinya").
// Rinciannya ada di purchase_items; hanya halaman yang terlihat yang dibaca
// (pola sama dengan loadDadakanSaleIds), lewat indeks purchase_id.
async function loadPurchaseItemsByPurchase(db, storeId, rows) {
  const ids = rows.filter(row => row.kind === 'PURCHASE').map(row => row.id);
  const byPurchase = new Map();
  for (let start = 0; start < ids.length; start += 90) {
    const chunk = ids.slice(start, start + 90);
    const result = await db.prepare(`
      SELECT purchase_id, product_name, unit_symbol, quantity, line_total
      FROM purchase_items
      WHERE purchase_id IN (${chunk.map(() => '?').join(', ')}) AND store_id = ?
      ORDER BY product_name COLLATE NOCASE, product_id
    `).bind(...chunk, storeId).all();
    for (const row of result.results ?? []) {
      if (!byPurchase.has(row.purchase_id)) byPurchase.set(row.purchase_id, []);
      byPurchase.get(row.purchase_id).push({
        productName: row.product_name, unitSymbol: row.unit_symbol || '',
        quantity: Number(row.quantity || 0), lineTotal: Number(row.line_total || 0)
      });
    }
  }
  return byPurchase;
}

async function loadPosDeliveryMap(db, storeId, rows) {
  const refs = rows.filter(row => POS_ACCOUNTING_FACT_KINDS.has(row.kind)).map(row => ({ factType: row.kind, factId: row.id }));
  const map = new Map();
  // 2 binds per ref + storeId: 45 refs = 91, under D1's 100-bind cap.
  for (let start = 0; start < refs.length; start += 45) {
    const chunk = refs.slice(start, start + 45);
    const clauses = chunk.map(() => '(fact_type = ? AND fact_id = ?)').join(' OR ');
    const bindings = chunk.flatMap(ref => [ref.factType, ref.factId]);
    const result = await db.prepare(`
      SELECT fact_type, fact_id, status, journal_id, failure_code, failure_detail, attempts, last_attempt_at
      FROM accounting_bridge_deliveries
      WHERE store_id = ? AND producer_module = 'POS' AND (${clauses})
    `).bind(storeId, ...bindings).all();
    for (const row of result.results ?? []) map.set(`${row.fact_type}:${row.fact_id}`, row);
  }
  return map;
}

// Shared by Admin's own Transaksi explorer and the Kasir read-only mirror --
// single source of truth for the query so the two views can never drift.
// storeId is always resolved by the caller BEFORE this runs (query param for
// Admin, the authenticated cashier's own store for Kasir); this function
// itself trusts whatever storeId it is given.
export async function listStoreTransactions(db, storeId, { filter = 'ALL', from = null, to = null, before = null, limit = 50, q = null, bayar = null, qrisCode = '', createdBy = null, includeAdmin = false, includeCreators = true } = {}) {
  if (!FILTERS.has(filter)) return { ok: false, error: 'Filter transaksi tidak valid.' };
  const { clause: kindClause, values: kindValues } = filterClause(filter);
  // Filter cara bayar penjualan (Bos Cyo, 2026-10-17, menu Data kasir): Tunai / QRIS / Campuran.
  // QRIS = cara bayar QRIS gerai, atau campuran yang punya bagian QRIS (migration 0166).
  let bayarClause = '';
  let bayarValues = [];
  if (bayar === 'TUNAI') bayarClause = includeAdmin ? `AND payment_method IN ('CASH', 'KAS')` : `AND kind = 'SALE' AND payment_method = 'CASH'`;
  else if (bayar === 'CAMPURAN') bayarClause = `AND kind = 'SALE' AND payment_method = 'CAMPURAN'`;
  else if (bayar === 'QRIS') {
    bayarClause = `AND ${includeAdmin ? '' : "kind = 'SALE' AND "}(payment_method = ? OR (kind = 'SALE' AND payment_method = 'CAMPURAN' AND EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = transaction_facts.id AND sp.store_id = ? AND sp.payment_method_code = ?)))`;
    bayarValues = [qrisCode || 'QRIS', storeId, qrisCode || 'QRIS'];
  } else if (bayar === 'REKENING' && includeAdmin) {
    bayarClause = `AND (payment_method IN ('BANK', 'REKBER') OR payment_method IN (SELECT code FROM payment_methods WHERE store_id = ? AND shared_account_id IS NOT NULL))`;
    bayarValues = [storeId];
  } else if (bayar && includeAdmin) {
    bayarClause = 'AND payment_method = ?';
    bayarValues = [bayar];
  } else if (bayar) return { ok: false, error: 'Filter cara bayar tidak valid.' };
  // Deliberately "contains" across several columns, not an ID-only lookup --
  // typing a date fragment, a cashier's name, or part of a description all
  // work the same way.
  const search = q ? String(q).trim() : '';
  const searchClause = search ? `AND (id LIKE ? OR description LIKE ? OR occurred_at LIKE ? OR creator_name LIKE ?)` : '';
  const searchValues = search ? Array(4).fill(`%${search}%`) : [];
  const creatorClause = createdBy ? `AND creator_role || ':' || creator_id = ?` : '';
  const creatorValues = createdBy ? [String(createdBy)] : [];
  const factsSql = `
    WITH pos_facts AS (
      SELECT s.id, 'SALE' AS kind, s.created_at AS occurred_at, s.total_amount AS amount,
             (CASE WHEN s.customer_name = '' THEN 'Penjualan' ELSE 'Penjualan · ' || s.customer_name END) AS description,
             CASE WHEN s.voided_at IS NULL THEN 'posted' ELSE 'voided' END AS status,
             s.payment_method, s.drawer_session_id, s.cashier_id, c.employee_name AS cashier_name,
             'SALE' AS reference_type, s.id AS reference_id, NULL AS payload_json, 'CASHIER' AS creator_role, s.cashier_id AS creator_id
      FROM sales s LEFT JOIN cashiers c ON c.id = s.cashier_id AND c.store_id = s.store_id WHERE s.store_id = ?
      UNION ALL
      SELECT p.id, 'PURCHASE', p.created_at, p.total_amount, p.description,
             CASE WHEN p.voided_at IS NULL THEN 'posted' ELSE 'voided' END,
             p.payment_method, p.drawer_session_id, p.cashier_id, c.employee_name,
             'PURCHASE', p.id, NULL, 'CASHIER', p.cashier_id
      FROM purchases p LEFT JOIN cashiers c ON c.id = p.cashier_id AND c.store_id = p.store_id WHERE p.store_id = ?
      UNION ALL
      SELECT e.id, 'EXPENSE', e.created_at, e.amount, e.description,
             CASE WHEN e.voided_at IS NULL THEN 'posted' ELSE 'voided' END,
             e.payment_method, e.drawer_session_id, e.cashier_id, c.employee_name,
             'EXPENSE', e.id, NULL, 'CASHIER', e.cashier_id
      FROM expenses e LEFT JOIN cashiers c ON c.id = e.cashier_id AND c.store_id = e.store_id WHERE e.store_id = ?
    ),
    -- D1's compound-SELECT term cap is 5 (not SQLite's usual 500) -- a single
    -- 6-way UNION ALL fails outright on production D1 even though it runs
    -- fine against the node:sqlite harness the test suite uses locally.
    -- Splitting into two <=5-term CTEs combined by one more UNION ALL below
    -- keeps every individual compound-select node under that cap.
    other_facts AS (
      SELECT i.id, 'OTHER_INCOME' AS kind, i.created_at AS occurred_at, i.amount, i.description, 'posted' AS status, 'CASH' AS payment_method,
             i.drawer_session_id, i.cashier_id, c.employee_name AS cashier_name, 'OTHER_INCOME' AS reference_type, i.id AS reference_id, NULL AS payload_json, 'CASHIER' AS creator_role, i.cashier_id AS creator_id
      FROM other_income i LEFT JOIN cashiers c ON c.id = i.cashier_id AND c.store_id = i.store_id WHERE i.store_id = ?
      UNION ALL
      SELECT a.id, a.request_type, a.created_at, NULL, a.request_type,
             a.approval_status || '/' || a.posting_status, '', a.drawer_session_id, a.cashier_id,
             c.employee_name, 'APPROVAL_REQUEST', a.id, a.payload_json, 'CASHIER', a.cashier_id
      FROM approval_requests a LEFT JOIN cashiers c ON c.id = a.cashier_id AND c.store_id = a.store_id WHERE a.store_id = ?
      UNION ALL
      -- Bos Cyo, 2026-09-29: sempat dicoba sembunyikan produksi AUTO_DADAKAN
      -- dari daftar (karena tombol Hapus tidak pernah nyala di baris Produksi
      -- -- VOID_SUBJECT_TYPES cuma SALE/PURCHASE/EXPENSE, dan hasil produksi
      -- dadakan = qty yang dijual, tidak pernah nyisa ke transaksi lain).
      -- Setelah didiskusikan ulang: TETAP ditampilkan sebagai baris sendiri
      -- (filter "Arus Barang & Produksi" butuh ini biar lengkap buat audit
      -- pergerakan bahan), cuma diberi penanda jelas kalau itu bagian dari
      -- satu Penjualan -- bukan aktivitas berdiri sendiri yang bisa dihapus
      -- sendiri-sendiri. Hapus tetap lewat baris Penjualannya (mirror penuh,
      -- lihat transaction-correction-executor.js).
      SELECT pr.id, 'PRODUCTION', pr.created_at, NULL,
             'Produksi · ' || pr.output_product_name || ' · ' || pr.total_output_quantity || ' ' || pr.output_unit_symbol ||
             (CASE WHEN pr.mode = 'AUTO_DADAKAN' THEN ' · Dadakan (terkait Penjualan ' || COALESCE(pr.sale_id, '-') || ')' ELSE '' END),
             LOWER(pr.status), '', pr.drawer_session_id, pr.created_by_id, c.employee_name,
             'PRODUCTION_RUN', pr.id, NULL, pr.created_by_role, pr.created_by_id
      FROM production_runs pr LEFT JOIN cashiers c ON c.id = pr.created_by_id AND c.store_id = pr.store_id AND pr.created_by_role = 'CASHIER'
      WHERE pr.store_id = ?
    ),
    ${includeAdmin ? `admin_facts AS (
      SELECT ap.id, 'ADMIN_PAYMENT' AS kind, ap.created_at AS occurred_at, ap.amount,
             'Pembayaran ' || ap.kind || ' - ' || ap.counterparty_name || CASE WHEN ap.note <> '' THEN ' - ' || ap.note ELSE '' END AS description,
             CASE WHEN ap.voided_at IS NULL THEN 'posted' ELSE 'voided' END AS status,
             ap.payment_method, NULL AS drawer_session_id, NULL AS cashier_id, '' AS cashier_name,
             'ADMIN_PAYMENT' AS reference_type, ap.id AS reference_id, NULL AS payload_json, ap.created_by_role AS creator_role, ap.created_by_id AS creator_id
      FROM admin_payments ap WHERE ap.store_id = ?
      UNION ALL
      SELECT e.id, 'ADMIN_EXPENSE', e.created_at, e.amount, e.description,
             CASE WHEN e.voided_at IS NULL THEN 'posted' ELSE 'voided' END,
             e.payment_method, NULL, NULL, '', 'ADMIN_EXPENSE', e.id, NULL, e.created_by_role, e.created_by_id
      FROM admin_operational_expenses e
      WHERE e.store_id = ? AND e.id NOT IN (SELECT expense_id FROM admin_payments WHERE store_id = ? AND expense_id IS NOT NULL)
    ),` : ''}
    raw_facts AS (
      SELECT * FROM pos_facts
      UNION ALL
      SELECT * FROM other_facts
      ${includeAdmin ? 'UNION ALL SELECT * FROM admin_facts' : ''}
    ),
    transaction_facts AS (
      SELECT f.*, COALESCE(NULLIF(f.cashier_name, ''), sa.display_name, ea.display_name, oa.display_name,
             NULLIF(f.creator_id, ''), NULLIF(f.creator_role, ''), 'Tidak tercatat') AS creator_name
      FROM raw_facts f
      LEFT JOIN store_admins sa ON f.creator_role = 'ADMIN' AND sa.id = f.creator_id AND sa.store_id = ?
      LEFT JOIN entity_admins ea ON f.creator_role = 'ENTITY_ADMIN' AND ea.id = f.creator_id
        AND ea.entity_id = (SELECT entity_id FROM stores WHERE id = ?)
      LEFT JOIN owner_accounts oa ON f.creator_role = 'OWNER' AND oa.id = f.creator_id
    )`;
  const factBindings = [storeId, storeId, storeId, storeId, storeId, storeId,
    ...(includeAdmin ? [storeId, storeId, storeId] : []), storeId, storeId];
  const result = await db.prepare(`${factsSql}
    SELECT * FROM transaction_facts
    WHERE (? IS NULL OR occurred_at >= ?) AND (? IS NULL OR occurred_at <= ?)
      AND (? IS NULL OR occurred_at < ? OR (occurred_at = ? AND id < ?))
      ${kindClause}
      ${bayarClause}
      ${searchClause}
      ${creatorClause}
    ORDER BY occurred_at DESC, id DESC LIMIT ?
  `).bind(
    ...factBindings,
    from, from, to, to,
    before?.occurredAt || null, before?.occurredAt || null, before?.occurredAt || null, before?.id || null,
    ...kindValues, ...bayarValues, ...searchValues, ...creatorValues, limit + 1
  ).all();
  // Options span this store's history, independent of pagination and the active filters.
  const creatorRows = includeCreators ? (await db.prepare(`${factsSql}
    SELECT DISTINCT creator_role || ':' || creator_id AS value, creator_name AS name, creator_role AS role
    FROM transaction_facts ORDER BY creator_name COLLATE NOCASE, creator_role, value
  `).bind(...factBindings).all()).results ?? [] : null;
  const creators = creatorRows?.map(row => ({ value: row.value, label: `${row.name} (${row.role || 'Tidak tercatat'})` }));
  const rows = result.results ?? []; const hasMore = rows.length > limit; const visibleRows = rows.slice(0, limit);
  const deliveryMap = await loadPosDeliveryMap(db, storeId, visibleRows);
  const dadakanSaleIds = await loadDadakanSaleIds(db, storeId, visibleRows);
  const purchaseItems = await loadPurchaseItemsByPurchase(db, storeId, visibleRows);
  const normalized = visibleRows.map(row => {
    const transaction = normalizeRow(
      dadakanSaleIds.has(row.id) && row.kind === 'SALE' ? { ...row, description: `${row.description} · +Produksi Dadakan` } : row,
      deliveryMap
    );
    return row.kind === 'PURCHASE' ? { ...transaction, purchaseItems: purchaseItems.get(row.id) || [] } : transaction;
  });
  // Cursor must key off the raw, ungrouped rows -- grouping only changes how
  // many list entries this page renders as, never where the SQL keyset
  // pagination actually left off.
  // Pembayaran campuran (migration 0166): tampilkan rinciannya, kode cara bayar tetap 'CAMPURAN'.
  const splitIds = normalized.filter(item => item.kind === 'SALE' && item.paymentMethod === 'CAMPURAN').map(item => item.id);
  if (splitIds.length) {
    const parts = [];
    for (let start = 0; start < splitIds.length; start += 90) {
      const chunk = splitIds.slice(start, start + 90);
      parts.push(...((await db.prepare(`SELECT sale_id, payment_method_code, amount FROM sale_payments WHERE store_id = ? AND sale_id IN (${chunk.map(() => '?').join(', ')}) ORDER BY amount DESC, payment_method_code`)
        .bind(storeId, ...chunk).all()).results ?? []));
    }
    for (const item of normalized) {
      const own = parts.filter(part => part.sale_id === item.id);
      if (own.length) item.paymentLabel = `CAMPURAN: ${salePaymentLabel(own.map(part => ({ code: part.payment_method_code, amount: part.amount })))}`;
    }
  }
  const last = normalized.at(-1);
  const visible = groupStockAdjustmentSessions(normalized);
  return { ok: true, filter, creators, transactions: visible, hasMore, nextCursor: hasMore && last ? `${last.occurredAt}|${last.id}` : null };
}

export { parseIso, parseCursor };

export async function handleAdminTransactionsApi(request, env, pathname) {
  if (request.method !== 'GET' || pathname !== '/api/admin/transactions') return null;
  const auth = await requireManagement(request, env.DB, env); if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const store = await resolveStore(env.DB, url.searchParams.get('store') || DEFAULT_STORE_CODE, { includeInactive: true });
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const filter = String(url.searchParams.get('filter') || 'ALL').trim().toUpperCase();
  if (!FILTERS.has(filter)) return json({ error: 'Filter transaksi tidak valid.' }, 400);
  const from = parseIso(url.searchParams.get('from')); const to = parseIso(url.searchParams.get('to'));
  const rawCursor = url.searchParams.get('before'); const before = parseCursor(rawCursor);
  if (url.searchParams.get('from') && !from) return json({ error: 'Tanggal awal tidak valid.' }, 400);
  if (url.searchParams.get('to') && !to) return json({ error: 'Tanggal akhir tidak valid.' }, 400);
  if (rawCursor && !before) return json({ error: 'Cursor transaksi tidak valid.' }, 400);
  const requestedLimit = Number(url.searchParams.get('limit') || 50);
  const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(5, requestedLimit)) : 50;
  const q = url.searchParams.get('q') || null;
  const bayar = String(url.searchParams.get('bayar') || '').trim().toUpperCase() || null;
  const createdBy = url.searchParams.get('createdBy') || null;
  const qrisCode = (await qrisMethodFor(env.DB, store.id)).code;
  const listing = await listStoreTransactions(env.DB, store.id, { filter, from, to, before, limit, q, bayar, qrisCode, createdBy, includeAdmin: true, includeCreators: url.searchParams.get('includeCreators') !== '0' });
  if (!listing.ok) return json({ error: listing.error }, 400);
  const configuredMethods = ((await env.DB.prepare('SELECT code, name FROM payment_methods WHERE store_id = ? ORDER BY name COLLATE NOCASE').bind(store.id).all()).results ?? [])
    .map(row => ({ value: row.code, label: row.name }));
  const paymentMethods = [...new Map([
    ...[{ value: 'BANK', label: 'Transfer Bank' }, { value: 'REKBER', label: 'Rekening Bersama' }, { value: 'KAS', label: 'Tunai / Kas Admin' }, { value: 'DEPOSIT', label: 'Deposit' }],
    ...configuredMethods
  ].map(method => [method.value, method])).values()];
  return json({ store, filter: listing.filter, bayar, createdBy, creators: listing.creators, paymentMethods, transactions: listing.transactions, hasMore: listing.hasMore, nextCursor: listing.nextCursor });
}
