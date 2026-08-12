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

  const transaction = {
    id: row.id,
    kind: 'PURCHASE',
    occurredAt: row.created_at,
    amount: Number(row.total_amount || 0),
    status: 'posted',
    sourceReference: { type: 'PURCHASE', id: row.id }
  };
  const snapshot = await getTransactionAccountingSnapshot(env.DB, store.id, 'PURCHASE', row.id);

  return json({
    store,
    detail: {
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
    }
  });
}
