import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { accountingReferenceForTransaction } from './accounting-bridge-seam.js';

const FILTERS = new Set(['ALL', 'SALES', 'PURCHASES', 'OPERATIONS', 'INVENTORY', 'ASSETS']);
const KIND_FILTER = {
  SALES: new Set(['SALE']),
  PURCHASES: new Set(['PURCHASE']),
  OPERATIONS: new Set(['EXPENSE', 'OTHER_INCOME', 'CASH_FLOW']),
  INVENTORY: new Set(['GOODS_FLOW']),
  ASSETS: new Set(['ASSET'])
};

function parseIso(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function parseCursor(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const separator = raw.lastIndexOf('|');
  if (separator < 1) return null;
  const occurredAt = parseIso(raw.slice(0, separator));
  const id = raw.slice(separator + 1).trim();
  return occurredAt && id ? { occurredAt, id } : null;
}

function safeJson(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function approvalDescription(kind, payload) {
  if (kind === 'CASH_FLOW') return String(payload.description || payload.note || 'Arus kas');
  if (kind === 'GOODS_FLOW') {
    const direction = String(payload.direction || '').toUpperCase();
    const qty = Number(payload.quantity || 0);
    return `${payload.productName || 'Barang'} · ${direction || 'FLOW'} ${qty || ''}`.trim();
  }
  if (kind === 'ASSET') return String(payload.description || payload.note || 'Perubahan aset');
  return kind;
}

function normalizeRow(row) {
  const payload = row.payload_json ? safeJson(row.payload_json) : null;
  const kind = row.kind;
  let amount = row.amount == null ? null : Number(row.amount);
  let description = row.description || '';
  if (payload) {
    if (kind === 'CASH_FLOW' || kind === 'ASSET') amount = Number(payload.amount || 0) || null;
    description = approvalDescription(kind, payload);
  }
  const transaction = {
    id: row.id,
    kind,
    occurredAt: row.occurred_at,
    amount,
    description,
    status: row.status,
    paymentMethod: row.payment_method || '',
    drawerSessionId: row.drawer_session_id || null,
    cashierId: row.cashier_id || null,
    cashierName: row.cashier_name || '',
    sourceReference: { type: row.reference_type || kind, id: row.reference_id || row.id },
    operationalPayload: payload
  };
  return { ...transaction, accounting: accountingReferenceForTransaction(transaction) };
}

export async function handleAdminTransactionsApi(request, env, pathname) {
  if (request.method !== 'GET' || pathname !== '/api/admin/transactions') return null;
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const storeToken = url.searchParams.get('store') || DEFAULT_STORE_CODE;
  const store = await resolveStore(env.DB, storeToken, { includeInactive: true });
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  const filter = String(url.searchParams.get('filter') || 'ALL').trim().toUpperCase();
  if (!FILTERS.has(filter)) return json({ error: 'Filter transaksi tidak valid.' }, 400);
  const from = parseIso(url.searchParams.get('from'));
  const to = parseIso(url.searchParams.get('to'));
  const rawCursor = url.searchParams.get('before');
  const before = parseCursor(rawCursor);
  if (url.searchParams.get('from') && !from) return json({ error: 'Tanggal awal tidak valid.' }, 400);
  if (url.searchParams.get('to') && !to) return json({ error: 'Tanggal akhir tidak valid.' }, 400);
  if (rawCursor && !before) return json({ error: 'Cursor transaksi tidak valid.' }, 400);
  const requestedLimit = Number(url.searchParams.get('limit') || 50);
  const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(10, requestedLimit)) : 50;

  const kindSet = KIND_FILTER[filter] || null;
  const kindClause = kindSet ? `AND kind IN (${[...kindSet].map(() => '?').join(', ')})` : '';
  const kindValues = kindSet ? [...kindSet] : [];
  const result = await env.DB.prepare(`
    WITH transaction_facts AS (
      SELECT s.id AS id, 'SALE' AS kind, s.created_at AS occurred_at,
             s.total_amount AS amount,
             CASE WHEN s.customer_name = '' THEN 'Penjualan' ELSE 'Penjualan · ' || s.customer_name END AS description,
             'posted' AS status, s.payment_method AS payment_method,
             s.drawer_session_id AS drawer_session_id, s.cashier_id AS cashier_id,
             c.employee_name AS cashier_name, 'SALE' AS reference_type, s.id AS reference_id,
             NULL AS payload_json
      FROM sales s
      LEFT JOIN cashiers c ON c.id = s.cashier_id
      WHERE s.store_id = ?

      UNION ALL

      SELECT p.id, 'PURCHASE', p.created_at, p.total_amount,
             p.description, 'posted', p.payment_method,
             p.drawer_session_id, p.cashier_id, c.employee_name,
             'PURCHASE', p.id, NULL
      FROM purchases p
      LEFT JOIN cashiers c ON c.id = p.cashier_id
      WHERE p.store_id = ?

      UNION ALL

      SELECT e.id, 'EXPENSE', e.created_at, e.amount,
             e.description, 'posted', e.payment_method,
             e.drawer_session_id, e.cashier_id, c.employee_name,
             'EXPENSE', e.id, NULL
      FROM expenses e
      LEFT JOIN cashiers c ON c.id = e.cashier_id
      WHERE e.store_id = ?

      UNION ALL

      SELECT i.id, 'OTHER_INCOME', i.created_at, i.amount,
             i.description, 'posted', 'CASH',
             i.drawer_session_id, i.cashier_id, c.employee_name,
             'OTHER_INCOME', i.id, NULL
      FROM other_income i
      LEFT JOIN cashiers c ON c.id = i.cashier_id
      WHERE i.store_id = ?

      UNION ALL

      SELECT a.id, a.request_type, a.created_at, NULL,
             a.request_type,
             a.approval_status || '/' || a.posting_status,
             '', a.drawer_session_id, a.cashier_id, c.employee_name,
             'APPROVAL_REQUEST', a.id, a.payload_json
      FROM approval_requests a
      LEFT JOIN cashiers c ON c.id = a.cashier_id
      WHERE a.store_id = ?
    )
    SELECT *
    FROM transaction_facts
    WHERE (? IS NULL OR occurred_at >= ?)
      AND (? IS NULL OR occurred_at <= ?)
      AND (
        ? IS NULL
        OR occurred_at < ?
        OR (occurred_at = ? AND id < ?)
      )
      ${kindClause}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ?
  `).bind(
    store.id, store.id, store.id, store.id, store.id,
    from, from, to, to,
    before?.occurredAt || null, before?.occurredAt || null, before?.occurredAt || null, before?.id || null,
    ...kindValues,
    limit + 1
  ).all();

  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit).map(normalizeRow);
  const last = visible.at(-1);
  return json({
    store,
    filter,
    transactions: visible,
    hasMore,
    nextCursor: hasMore && last ? `${last.occurredAt}|${last.id}` : null
  });
}
