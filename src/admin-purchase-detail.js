import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { accountingReferenceForTransaction } from './accounting-bridge-seam.js';
import { getTransactionAccountingSnapshot } from './accounting-reference.js';

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function handleAdminPurchaseDetailApi(request, env, pathname) {
  const match = pathname.match(/^\/api\/admin\/transactions\/detail\/PURCHASE\/([^/]+)$/i);
  if (!match) return null;
  if (request.method !== 'GET') return json({ error: 'Detail pembelian hanya mendukung GET.' }, 405);

  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  const id = decodeURIComponent(match[1]);
  const row = await env.DB.prepare(`
    SELECT p.id, p.description, p.total_amount, p.note, p.payment_method,
           p.drawer_session_id, p.cashier_id, p.created_at,
           c.employee_name AS cashier_name,
           p.supplier_id, s.name AS supplier_name
    FROM purchases p
    LEFT JOIN cashiers c ON c.id = p.cashier_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
    WHERE p.store_id = ? AND p.id = ?
    LIMIT 1
  `).bind(store.id, id).first();
  if (!row) return json({ error: 'Detail pembelian tidak ditemukan.' }, 404);

  const itemRows = await env.DB.prepare(`
    SELECT product_id, product_name, product_kind_id, product_kind_code, product_kind_name,
           unit_id, unit_symbol, quantity, line_total, unit_cost,
           average_cost_before, average_cost_after, created_at
    FROM purchase_items
    WHERE store_id = ? AND purchase_id = ?
    ORDER BY product_name COLLATE NOCASE, product_id
  `).bind(store.id, id).all();
  const items = (itemRows.results ?? []).map(item => ({
    productId: Number(item.product_id),
    productName: item.product_name,
    productKindId: item.product_kind_id || null,
    productKindCode: item.product_kind_code || '',
    productKindName: item.product_kind_name || '',
    unitId: item.unit_id,
    unitSymbol: item.unit_symbol || '',
    quantity: Number(item.quantity || 0),
    lineTotal: Number(item.line_total || 0),
    unitCost: Number(item.unit_cost || 0),
    averageCostBefore: Number(item.average_cost_before || 0),
    averageCostAfter: Number(item.average_cost_after || 0),
    occurredAt: item.created_at
  }));

  const transaction = {
    id: row.id,
    kind: 'PURCHASE',
    occurredAt: row.created_at,
    amount: Number(row.total_amount || 0),
    status: 'posted',
    sourceReference: { type: 'PURCHASE', id: row.id }
  };
  const snapshot = await getTransactionAccountingSnapshot(env.DB, store.id, 'PURCHASE', row.id);

  const detail = {
    kind: 'PURCHASE',
    id: row.id,
    description: row.description,
    amount: Number(row.total_amount || 0),
    note: row.note || '',
    paymentMethod: row.payment_method || '',
    drawerSessionId: row.drawer_session_id || null,
    cashierId: row.cashier_id || null,
    cashierName: row.cashier_name || '',
    supplierId: row.supplier_id || null,
    supplierName: row.supplier_name || '',
    occurredAt: row.created_at,
    items,
    accounting: {
      ...accountingReferenceForTransaction(transaction),
      transactionLink: snapshot || {
        contract: 'MAXI_ACCOUNTING_REFERENCE_V1',
        businessEvent: 'PURCHASE_MATERIAL',
        paymentMethod: row.payment_method || '',
        mappingStatus: 'LEGACY_NO_SNAPSHOT',
        debitAccount: null,
        creditAccount: null,
        journalReference: null
      }
    }
  };
  detail.payload = {
    description: detail.description,
    supplierName: detail.supplierName,
    paymentMethod: detail.paymentMethod,
    amount: detail.amount,
    items: detail.items
  };
  return json({ store, detail });
}
