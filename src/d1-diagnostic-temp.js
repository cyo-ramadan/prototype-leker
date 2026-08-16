import { json } from './http.js';
import { requireManagement } from './owner-auth.js';

const TARGET_TABLES = [
  'products',
  'inventory_stock_balances',
  'stock_movements',
  'sales',
  'purchases',
  'expenses',
  'other_income',
  'approval_requests',
  'production_runs',
  'accounting_bridge_deliveries',
  'purchase_items',
  'sale_items',
  'item_types',
  'units',
  'product_kinds',
  'manufacturing_recipes',
  'd1_migrations'
];

const REQUIRED_COLUMNS = {
  products: ['product_kind_id', 'average_cost', 'last_purchase_price', 'stock_tracking_enabled', 'production_mode', 'recipe_link_enabled', 'linked_recipe_id', 'item_type_id', 'base_unit_id'],
  inventory_stock_balances: ['store_id', 'product_id', 'quantity', 'updated_at'],
  stock_movements: ['store_id', 'product_id', 'direction', 'quantity', 'source_type', 'source_id', 'occurred_at'],
  sales: ['voided_at', 'payment_method', 'drawer_session_id', 'cashier_id'],
  purchases: ['voided_at', 'payment_method', 'drawer_session_id', 'cashier_id'],
  expenses: ['voided_at', 'payment_method', 'drawer_session_id', 'cashier_id', 'accounting_component_rule_id'],
  accounting_bridge_deliveries: ['fact_type', 'fact_id', 'status', 'journal_id', 'failure_code', 'failure_detail', 'attempts', 'last_attempt_at'],
  purchase_items: ['product_kind_id', 'unit_cost', 'average_cost_before', 'average_cost_after'],
  sale_items: ['product_kind_id', 'unit_cost_snapshot', 'line_cogs']
};

export async function handleTemporaryD1DiagnosticApi(request, env, pathname) {
  if (pathname !== '/api/admin/system/d1-diagnostic-temp') return null;
  if (request.method !== 'GET') return json({ error: 'Diagnostic read-only.' }, 405);
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;

  const schema = await env.DB.prepare(`
    SELECT name, type
    FROM sqlite_schema
    WHERE name IN (${TARGET_TABLES.map(() => '?').join(', ')})
    ORDER BY name
  `).bind(...TARGET_TABLES).all();
  const existing = new Set((schema.results || []).filter(row => row.type === 'table').map(row => row.name));
  const tables = {};
  for (const table of TARGET_TABLES) {
    if (!existing.has(table)) {
      tables[table] = { exists: false, columns: [], missingRequiredColumns: REQUIRED_COLUMNS[table] || [] };
      continue;
    }
    const columns = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    const names = (columns.results || []).map(row => row.name);
    const required = REQUIRED_COLUMNS[table] || [];
    tables[table] = {
      exists: true,
      columns: names,
      missingRequiredColumns: required.filter(name => !names.includes(name))
    };
  }

  let migrations = [];
  if (existing.has('d1_migrations')) {
    const rows = await env.DB.prepare('SELECT id, name, applied_at FROM d1_migrations ORDER BY id').all();
    migrations = rows.results || [];
  }

  return json({
    ok: true,
    diagnostic: 'TEMP_READ_ONLY_SCHEMA',
    tables,
    migrations,
    missingTables: TARGET_TABLES.filter(table => !existing.has(table)),
    mismatchedTables: Object.entries(tables).filter(([, value]) => value.missingRequiredColumns.length).map(([table, value]) => ({ table, missingRequiredColumns: value.missingRequiredColumns }))
  });
}
