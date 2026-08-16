import { json } from './http.js';
import { requireManagement } from './owner-auth.js';

const TABLE_REQUIREMENTS = {
  products: [
    'id', 'store_id', 'name', 'purchase_price', 'price', 'category', 'emoji', 'image_data',
    'display_order', 'is_active', 'item_type_id', 'product_kind_id', 'base_unit_id',
    'points_per_unit', 'recipe_link_enabled', 'linked_recipe_id', 'stock_tracking_enabled',
    'average_cost', 'last_purchase_price', 'cost_updated_at', 'last_purchase_at', 'updated_at'
  ],
  inventory_stock_balances: ['store_id', 'product_id', 'quantity', 'updated_at'],
  stock_movements: ['id', 'store_id', 'product_id', 'direction', 'quantity', 'source_type', 'source_id', 'occurred_at'],
  sales: ['id', 'store_id', 'created_at', 'total_amount', 'customer_name', 'payment_method', 'drawer_session_id', 'cashier_id', 'voided_at', 'voided_by_role', 'voided_by_id', 'void_reason', 'void_permit_id'],
  purchases: ['id', 'store_id', 'created_at', 'total_amount', 'description', 'payment_method', 'drawer_session_id', 'cashier_id', 'voided_at', 'voided_by_role', 'voided_by_id', 'void_reason', 'void_permit_id'],
  expenses: ['id', 'store_id', 'created_at', 'amount', 'description', 'payment_method', 'drawer_session_id', 'cashier_id', 'accounting_component_rule_id', 'voided_at', 'voided_by_role', 'voided_by_id', 'void_reason', 'void_permit_id'],
  other_income: ['id', 'store_id', 'created_at', 'amount', 'description', 'drawer_session_id', 'cashier_id'],
  approval_requests: ['id', 'store_id', 'request_type', 'created_at', 'approval_status', 'posting_status', 'drawer_session_id', 'cashier_id', 'payload_json'],
  approval_permits: ['id', 'store_id', 'drawer_session_id', 'cashier_id', 'permit_type', 'subject_type', 'subject_id', 'approval_status', 'execution_status', 'accounting_status', 'requested_at', 'updated_at'],
  production_runs: ['id', 'store_id', 'created_at', 'output_product_name', 'total_output_quantity', 'output_unit_symbol', 'status', 'drawer_session_id', 'created_by_id'],
  accounting_bridge_deliveries: ['id', 'store_id', 'producer_module', 'fact_type', 'fact_id', 'status', 'journal_id', 'failure_code', 'failure_detail', 'attempts', 'last_attempt_at'],
  purchase_items: ['id', 'purchase_id', 'store_id', 'product_id', 'product_kind_id', 'unit_cost', 'average_cost_before', 'average_cost_after'],
  sale_items: ['id', 'sale_id', 'store_id', 'product_id', 'product_kind_id', 'unit_cost_snapshot', 'line_cogs'],
  item_types: ['id', 'store_id', 'code', 'name', 'is_active'],
  units: ['id', 'store_id', 'code', 'name', 'symbol', 'is_active'],
  product_kinds: ['id', 'store_id', 'code', 'name', 'is_active'],
  manufacturing_recipes: ['id', 'store_id', 'output_product_id', 'output_quantity', 'output_unit_id', 'revision', 'status'],
  d1_migrations: ['id', 'name', 'applied_at']
};

const INDEXES = [
  'idx_products_store_production_policy',
  'idx_products_store_kind',
  'idx_sales_store_void_created',
  'idx_purchases_store_void_created',
  'idx_expenses_store_void_created',
  'idx_approval_permits_store_status_requested',
  'idx_approval_permits_cashier_requested',
  'idx_approval_permits_subject',
  'idx_approval_permits_one_pending_void'
];

function safeIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Unsafe diagnostic identifier: ${value}`);
  return value;
}

export async function handleTemporaryD1DiagnosticApi(request, env, pathname) {
  if (pathname !== '/api/admin/system/d1-diagnostic-temp') return null;
  if (request.method !== 'GET') return json({ error: 'Diagnostic ini read-only.' }, 405);

  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;

  const tableNames = Object.keys(TABLE_REQUIREMENTS);
  const schemaRows = await env.DB.prepare(`
    SELECT name, type
    FROM sqlite_schema
    WHERE name IN (${[...tableNames, ...INDEXES].map(() => '?').join(', ')})
    ORDER BY type, name
  `).bind(...tableNames, ...INDEXES).all();

  const tablesPresent = new Set((schemaRows.results || []).filter(row => row.type === 'table').map(row => row.name));
  const indexesPresent = new Set((schemaRows.results || []).filter(row => row.type === 'index').map(row => row.name));
  const tables = {};

  for (const [table, required] of Object.entries(TABLE_REQUIREMENTS)) {
    if (!tablesPresent.has(table)) {
      tables[table] = { exists: false, columns: [], missingRequiredColumns: required };
      continue;
    }
    const info = await env.DB.prepare(`PRAGMA table_info(${safeIdentifier(table)})`).all();
    const columns = (info.results || []).map(row => row.name);
    tables[table] = {
      exists: true,
      columns,
      missingRequiredColumns: required.filter(column => !columns.includes(column))
    };
  }

  let migrations = [];
  if (tablesPresent.has('d1_migrations')) {
    const result = await env.DB.prepare('SELECT id, name, applied_at FROM d1_migrations ORDER BY id').all();
    migrations = result.results || [];
  }

  const mismatchedTables = Object.entries(tables)
    .filter(([, info]) => !info.exists || info.missingRequiredColumns.length)
    .map(([table, info]) => ({ table, exists: info.exists, missingRequiredColumns: info.missingRequiredColumns }));

  return json({
    ok: true,
    diagnostic: 'TEMP_READ_ONLY_SCHEMA_V3',
    tables,
    indexes: INDEXES.map(name => ({ name, exists: indexesPresent.has(name) })),
    missingTables: tableNames.filter(name => !tablesPresent.has(name)),
    missingIndexes: INDEXES.filter(name => !indexesPresent.has(name)),
    mismatchedTables,
    migrations,
    notes: {
      productMasterDependencies: ['products','item_types','product_kinds','units','inventory_stock_balances','manufacturing_recipes','stock_movements'],
      transactionExplorerDependencies: ['sales','purchases','expenses','other_income','approval_requests','production_runs','accounting_bridge_deliveries']
    }
  });
}
