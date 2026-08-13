import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { accountingReferenceForTransaction } from './accounting-bridge-seam.js';

const COST_SCALE = 1_000_000;
function exactCost(scaled, legacy) {
  if (scaled != null) return Number(scaled) / COST_SCALE;
  return legacy == null ? null : Number(legacy);
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function handleAdminProductionDetailApi(request, env, pathname) {
  const match = pathname.match(/^\/api\/admin\/transactions\/detail\/PRODUCTION\/([^/]+)$/i);
  if (!match) return null;
  if (request.method !== 'GET') return json({ error: 'Detail produksi hanya mendukung GET.' }, 405);
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const id = decodeURIComponent(match[1]);
  const run = await env.DB.prepare(`
    SELECT pr.id, pr.sale_id, pr.mode, pr.output_product_id, pr.output_product_name,
           pr.output_unit_id, pr.output_unit_symbol, pr.recipe_id, pr.recipe_revision,
           pr.batches, pr.output_quantity_per_batch, pr.total_output_quantity,
           pr.requested_sale_quantity, pr.hpp_total, pr.hpp_per_unit,
           pr.hpp_total_scaled, pr.hpp_per_unit_scaled, pr.status,
           pr.drawer_session_id, pr.created_by_role, pr.created_by_id, pr.created_at,
           s.order_id
    FROM production_runs pr
    LEFT JOIN sales s ON s.id = pr.sale_id AND s.store_id = pr.store_id
    WHERE pr.store_id = ? AND pr.id = ?
    LIMIT 1
  `).bind(store.id, id).first();
  if (!run) return json({ error: 'Production run tidak ditemukan.' }, 404);
  const components = await env.DB.prepare(`
    SELECT component_product_id, component_product_name, component_unit_symbol,
           quantity_per_batch, total_quantity, unit_cost_snapshot, total_cost_snapshot,
           unit_cost_snapshot_scaled, total_cost_snapshot_scaled
    FROM production_run_components
    WHERE store_id = ? AND production_run_id = ?
    ORDER BY component_product_id
  `).bind(store.id, id).all();
  const hppTotal = exactCost(run.hpp_total_scaled, run.hpp_total);
  const hppPerUnit = exactCost(run.hpp_per_unit_scaled, run.hpp_per_unit);
  const transaction = {
    id: run.id,
    kind: 'PRODUCTION',
    occurredAt: run.created_at,
    amount: hppTotal,
    status: String(run.status || '').toLowerCase(),
    sourceReference: { type: 'PRODUCTION_RUN', id: run.id }
  };
  return json({
    store,
    detail: {
      kind: 'PRODUCTION',
      id: run.id,
      saleId: run.sale_id || null,
      orderId: run.order_id || null,
      mode: run.mode,
      outputProductId: Number(run.output_product_id),
      outputProductName: run.output_product_name,
      unitId: run.output_unit_id,
      unitSymbol: run.output_unit_symbol,
      recipeId: run.recipe_id,
      recipeRevision: Number(run.recipe_revision),
      batches: Number(run.batches),
      outputQuantityPerBatch: Number(run.output_quantity_per_batch),
      totalOutputQuantity: Number(run.total_output_quantity),
      requestedSaleQuantity: run.requested_sale_quantity == null ? null : Number(run.requested_sale_quantity),
      hppTotal,
      hppTotalScaled: run.hpp_total_scaled == null ? null : Number(run.hpp_total_scaled),
      hppPerUnit,
      hppPerUnitScaled: run.hpp_per_unit_scaled == null ? null : Number(run.hpp_per_unit_scaled),
      status: run.status,
      drawerSessionId: run.drawer_session_id || null,
      createdByRole: run.created_by_role,
      createdById: run.created_by_id,
      occurredAt: run.created_at,
      components: (components.results ?? []).map(row => ({
        productId: Number(row.component_product_id),
        productName: row.component_product_name,
        unitSymbol: row.component_unit_symbol,
        quantityPerBatch: Number(row.quantity_per_batch),
        totalQuantity: Number(row.total_quantity),
        unitCostSnapshot: exactCost(row.unit_cost_snapshot_scaled, row.unit_cost_snapshot),
        unitCostSnapshotScaled: row.unit_cost_snapshot_scaled == null ? null : Number(row.unit_cost_snapshot_scaled),
        totalCostSnapshot: exactCost(row.total_cost_snapshot_scaled, row.total_cost_snapshot),
        totalCostSnapshotScaled: row.total_cost_snapshot_scaled == null ? null : Number(row.total_cost_snapshot_scaled)
      })),
      accounting: accountingReferenceForTransaction(transaction)
    }
  });
}
