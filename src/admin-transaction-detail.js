import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { accountingReferenceForTransaction } from './accounting-bridge-seam.js';

const COST_SCALE = 1_000_000;
const costFromScaled = value => value == null ? null : Number(value) / COST_SCALE;
function exactCost(scaled, legacy) {
  if (scaled != null) return Number(scaled) / COST_SCALE;
  return legacy == null ? null : Number(legacy);
}

function safeJson(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

async function saleDetail(db, storeId, saleId) {
  const sale = await db.prepare(`
    SELECT s.id, s.order_id, s.customer_id, s.customer_name, s.total_amount, s.total_points,
           s.note, s.payment_method, s.drawer_session_id, s.cashier_id, s.created_at,
           c.employee_name AS cashier_name, o.order_no
    FROM sales s
    LEFT JOIN cashiers c ON c.id = s.cashier_id
    LEFT JOIN orders o ON o.id = s.order_id AND o.store_id = s.store_id
    WHERE s.store_id = ? AND s.id = ?
    LIMIT 1
  `).bind(storeId, saleId).first();
  if (!sale) return null;

  const items = await db.prepare(`
    SELECT si.id, si.product_id, si.product_name, si.unit_price, si.quantity, si.line_total,
           si.points_per_unit, si.line_points, si.recipe_id, si.production_run_id,
           si.product_kind_id, si.product_kind_code, si.product_kind_name,
           si.unit_cost_snapshot, si.line_cogs,
           r.revision AS recipe_revision
    FROM sale_items si
    LEFT JOIN manufacturing_recipes r ON r.id = si.recipe_id AND r.store_id = si.store_id
    WHERE si.store_id = ? AND si.sale_id = ?
    ORDER BY si.id
  `).bind(storeId, saleId).all();

  const runs = await db.prepare(`
    SELECT id, mode, output_product_id, output_product_name, output_unit_symbol,
           recipe_id, recipe_revision, batches, output_quantity_per_batch, total_output_quantity,
           requested_sale_quantity, hpp_total, hpp_per_unit, hpp_total_scaled, hpp_per_unit_scaled,
           status, created_at
    FROM production_runs
    WHERE store_id = ? AND sale_id = ?
    ORDER BY created_at, id
  `).bind(storeId, saleId).all();
  const runRows = runs.results ?? [];
  const runIds = runRows.map(row => row.id);
  let componentRows = [];
  if (runIds.length) {
    const placeholders = runIds.map(() => '?').join(', ');
    const components = await db.prepare(`
      SELECT production_run_id, component_product_id, component_product_name,
             component_unit_symbol, quantity_per_batch, total_quantity,
             unit_cost_snapshot, total_cost_snapshot,
             unit_cost_snapshot_scaled, total_cost_snapshot_scaled
      FROM production_run_components
      WHERE store_id = ? AND production_run_id IN (${placeholders})
      ORDER BY production_run_id, component_product_id
    `).bind(storeId, ...runIds).all();
    componentRows = components.results ?? [];
  }
  const componentsByRun = new Map(runIds.map(id => [id, []]));
  for (const row of componentRows) {
    componentsByRun.get(row.production_run_id)?.push({
      productId: Number(row.component_product_id),
      productName: row.component_product_name,
      unitSymbol: row.component_unit_symbol,
      quantityPerBatch: Number(row.quantity_per_batch),
      totalQuantity: Number(row.total_quantity),
      unitCostSnapshot: exactCost(row.unit_cost_snapshot_scaled, row.unit_cost_snapshot),
      totalCostSnapshot: exactCost(row.total_cost_snapshot_scaled, row.total_cost_snapshot)
    });
  }

  const transaction = {
    id: sale.id,
    kind: 'SALE',
    occurredAt: sale.created_at,
    amount: Number(sale.total_amount || 0),
    status: 'posted',
    sourceReference: { type: 'SALE', id: sale.id }
  };
  return {
    kind: 'SALE',
    id: sale.id,
    orderId: sale.order_id || null,
    orderNo: sale.order_no || '',
    customerId: sale.customer_id || null,
    customerName: sale.customer_name || '',
    total: Number(sale.total_amount || 0),
    totalPoints: Number(sale.total_points || 0),
    note: sale.note || '',
    paymentMethod: sale.payment_method || '',
    drawerSessionId: sale.drawer_session_id,
    cashierId: sale.cashier_id,
    cashierName: sale.cashier_name || '',
    occurredAt: sale.created_at,
    items: (items.results ?? []).map(row => ({
      id: row.id,
      productId: Number(row.product_id),
      productName: row.product_name,
      unitPrice: Number(row.unit_price),
      quantity: Number(row.quantity),
      lineTotal: Number(row.line_total),
      pointsPerUnit: Number(row.points_per_unit || 0),
      linePoints: Number(row.line_points || 0),
      productKindId: row.product_kind_id || null,
      productKindCode: row.product_kind_code || '',
      productKindName: row.product_kind_name || '',
      unitCostSnapshot: costFromScaled(row.unit_cost_snapshot),
      unitCostSnapshotScaled: row.unit_cost_snapshot == null ? null : Number(row.unit_cost_snapshot),
      lineCogs: costFromScaled(row.line_cogs),
      lineCogsScaled: row.line_cogs == null ? null : Number(row.line_cogs),
      recipeId: row.recipe_id || null,
      recipeRevision: row.recipe_revision == null ? null : Number(row.recipe_revision),
      productionRunId: row.production_run_id || null
    })),
    productionRuns: runRows.map(row => ({
      id: row.id,
      mode: row.mode,
      outputProductId: Number(row.output_product_id),
      outputProductName: row.output_product_name,
      unitSymbol: row.output_unit_symbol,
      recipeId: row.recipe_id,
      recipeRevision: Number(row.recipe_revision),
      batches: Number(row.batches),
      outputQuantityPerBatch: Number(row.output_quantity_per_batch),
      totalOutputQuantity: Number(row.total_output_quantity),
      requestedSaleQuantity: row.requested_sale_quantity == null ? null : Number(row.requested_sale_quantity),
      hppTotal: exactCost(row.hpp_total_scaled, row.hpp_total),
      hppPerUnit: exactCost(row.hpp_per_unit_scaled, row.hpp_per_unit),
      status: row.status,
      occurredAt: row.created_at,
      components: componentsByRun.get(row.id) || []
    })),
    accounting: accountingReferenceForTransaction(transaction)
  };
}

async function simpleDetail(db, storeId, kind, id) {
  const configs = {
    PURCHASE: {
      sql: `SELECT p.id, p.description, p.total_amount AS amount, p.note, p.payment_method,
                   p.drawer_session_id, p.cashier_id, p.created_at, c.employee_name AS cashier_name,
                   p.supplier_id, s.name AS supplier_name, NULL AS quantity
            FROM purchases p LEFT JOIN cashiers c ON c.id = p.cashier_id
            LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
            WHERE p.store_id = ? AND p.id = ? LIMIT 1`
    },
    EXPENSE: {
      sql: `SELECT e.id, e.description, e.amount, '' AS note, e.payment_method,
                   e.drawer_session_id, e.cashier_id, e.created_at, c.employee_name AS cashier_name,
                   NULL AS supplier_id, '' AS supplier_name, e.quantity
            FROM expenses e LEFT JOIN cashiers c ON c.id = e.cashier_id
            WHERE e.store_id = ? AND e.id = ? LIMIT 1`
    },
    OTHER_INCOME: {
      sql: `SELECT i.id, i.description, i.amount, '' AS note, 'CASH' AS payment_method,
                   i.drawer_session_id, i.cashier_id, i.created_at, c.employee_name AS cashier_name,
                   NULL AS supplier_id, '' AS supplier_name, NULL AS quantity
            FROM other_income i LEFT JOIN cashiers c ON c.id = i.cashier_id
            WHERE i.store_id = ? AND i.id = ? LIMIT 1`
    }
  };
  const config = configs[kind];
  if (!config) return null;
  const row = await db.prepare(config.sql).bind(storeId, id).first();
  if (!row) return null;
  const transaction = {
    id: row.id,
    kind,
    occurredAt: row.created_at,
    amount: Number(row.amount || 0),
    status: 'posted',
    sourceReference: { type: kind, id: row.id }
  };
  return {
    kind,
    id: row.id,
    description: row.description,
    amount: Number(row.amount || 0),
    quantity: row.quantity == null ? null : String(row.quantity),
    note: row.note || '',
    paymentMethod: row.payment_method || '',
    drawerSessionId: row.drawer_session_id || null,
    cashierId: row.cashier_id || null,
    cashierName: row.cashier_name || '',
    supplierId: row.supplier_id || null,
    supplierName: row.supplier_name || '',
    occurredAt: row.created_at,
    accounting: accountingReferenceForTransaction(transaction)
  };
}

async function approvalDetail(db, storeId, kind, id) {
  if (!['CASH_FLOW', 'GOODS_FLOW', 'ASSET'].includes(kind)) return null;
  const row = await db.prepare(`
    SELECT a.id, a.request_type, a.payload_json, a.approval_status, a.posting_status,
           a.posting_block_reason, a.decision_note, a.drawer_session_id, a.cashier_id,
           a.created_at, a.updated_at, a.approved_at, a.posted_at,
           a.approved_by_role, a.approved_by_id, c.employee_name AS cashier_name
    FROM approval_requests a
    LEFT JOIN cashiers c ON c.id = a.cashier_id
    WHERE a.store_id = ? AND a.id = ? AND a.request_type = ?
    LIMIT 1
  `).bind(storeId, id, kind).first();
  if (!row) return null;
  const transaction = {
    id: row.id,
    kind,
    occurredAt: row.created_at,
    amount: null,
    status: `${row.approval_status}/${row.posting_status}`,
    sourceReference: { type: 'APPROVAL_REQUEST', id: row.id }
  };
  return {
    kind,
    id: row.id,
    payload: safeJson(row.payload_json),
    approvalStatus: row.approval_status,
    postingStatus: row.posting_status,
    postingBlockReason: row.posting_block_reason || '',
    decisionNote: row.decision_note || '',
    drawerSessionId: row.drawer_session_id || null,
    cashierId: row.cashier_id || null,
    cashierName: row.cashier_name || '',
    occurredAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at || null,
    postedAt: row.posted_at || null,
    approvedByRole: row.approved_by_role || '',
    approvedById: row.approved_by_id || '',
    accounting: accountingReferenceForTransaction(transaction)
  };
}

export async function handleAdminTransactionDetailApi(request, env, pathname) {
  const match = pathname.match(/^\/api\/admin\/transactions\/detail\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  if (request.method !== 'GET') return json({ error: 'Detail transaksi hanya mendukung GET.' }, 405);
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const kind = decodeURIComponent(match[1]).toUpperCase();
  const id = decodeURIComponent(match[2]);
  const detail = kind === 'SALE'
    ? await saleDetail(env.DB, store.id, id)
    : await simpleDetail(env.DB, store.id, kind, id) || await approvalDetail(env.DB, store.id, kind, id);
  return detail ? json({ store, detail }) : json({ error: 'Detail transaksi tidak ditemukan.' }, 404);
}
