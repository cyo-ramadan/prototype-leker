import { json } from './http.js';
import { requireManagement } from './owner-auth.js';

const REQUIRED = {
  products: ['stock_tracking_enabled','product_kind_id','average_cost','last_purchase_price','cost_updated_at','last_purchase_at','production_mode','recipe_link_enabled','linked_recipe_id','item_type_id','base_unit_id'],
  sales: ['order_id','customer_id','total_points','payment_method','voided_at','voided_by_role','voided_by_id','void_reason','void_permit_id'],
  sale_items: ['points_per_unit','line_points','recipe_id','production_run_id','product_kind_id','product_kind_code','product_kind_name','unit_cost_snapshot','line_cogs'],
  orders: ['store_id','customer_id','business_date','order_no','source','drawer_session_id','status','ready_at','completed_at','cancelled_at'],
  order_items: ['store_id','order_id','product_id','product_name','unit_price','quantity','note','line_total','created_at'],
  order_status_history: ['store_id','order_id','from_status','to_status','changed_at'],
  inventory_stock_balances: ['store_id','product_id','quantity','updated_at'],
  stock_movements: ['source_key','store_id','product_id','unit_id','unit_symbol','direction','quantity','source_type','source_id','drawer_session_id','actor_role','actor_id','occurred_at'],
  production_runs: ['store_id','recipe_id','output_product_id','output_product_name','output_quantity','output_unit_id','output_unit_symbol','production_mode','status','drawer_session_id','created_by_role','created_by_id','occurred_at'],
  approval_permits: ['id','store_id','drawer_session_id','cashier_id','permit_type','subject_type','subject_id'],
  purchases: ['voided_at','void_permit_id'],
  expenses: ['voided_at','void_permit_id']
};

function safe(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Unsafe identifier ${value}`);
  return value;
}

export async function handleD1SchemaDiagnosticTemp(request, env, pathname) {
  if (pathname !== '/api/admin/system/d1-schema-diagnostic-temp') return null;
  if (request.method !== 'GET') return json({ error: 'Read-only diagnostic.' }, 405);
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;

  const result = {};
  for (const [table, required] of Object.entries(REQUIRED)) {
    const tableRow = await env.DB.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").bind(table).first();
    if (!tableRow) {
      result[table] = { exists: false, columns: [], missing: required };
      continue;
    }
    const info = await env.DB.prepare(`PRAGMA table_info(${safe(table)})`).all();
    const columns = (info.results || []).map(row => row.name);
    result[table] = { exists: true, columns, missing: required.filter(column => !columns.includes(column)) };
  }

  const foreignKeyCheck = await env.DB.prepare('PRAGMA foreign_key_check').all();
  const migrations = await env.DB.prepare("SELECT id, name, applied_at FROM d1_migrations WHERE name IN ('0007_customer_identity_unified_entry.sql','0012_drawer_bound_sales_orders.sql','0017_product_stock_production_points.sql','0019_product_costing_and_kinds.sql','0027_transaction_void_permits.sql') ORDER BY id").all();
  return json({
    ok: true,
    diagnostic: 'TEMP_SCHEMA_V4',
    tables: result,
    mismatches: Object.entries(result).filter(([, value]) => !value.exists || value.missing.length).map(([table, value]) => ({ table, exists: value.exists, missing: value.missing })),
    foreignKeyViolations: foreignKeyCheck.results || [],
    migrations: migrations.results || []
  });
}
