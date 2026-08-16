import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const TIMEOUT_MS = 120000;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function wrangler(args, { json = false } = {}) {
  const result = spawnSync(npx, ['--yes', 'wrangler', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: TIMEOUT_MS,
    killSignal: 'SIGTERM'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `wrangler exited ${result.status}`);
  return json ? JSON.parse(result.stdout) : result.stdout;
}

function rows(payload) {
  const containers = Array.isArray(payload) ? payload : [payload];
  const result = [];
  for (const container of containers) {
    if (Array.isArray(container?.results)) result.push(...container.results);
    else if (Array.isArray(container?.result?.results)) result.push(...container.result.results);
    else if (Array.isArray(container?.result)) result.push(...container.result);
  }
  return result;
}

function query(sql) {
  return rows(wrangler(['d1', 'execute', 'DB', '--remote', '--json', '--command', sql], { json: true }));
}

const tables = [
  'products','sales','sale_items','orders','order_items','order_status_history',
  'inventory_stock_balances','stock_movements','production_runs','approval_permits',
  'purchases','expenses','item_types','units','product_kinds',
  'manufacturing_recipes','manufacturing_recipe_components'
];
const schema = {};
for (const table of tables) {
  schema[table] = query(`PRAGMA table_info(${table});`).map(row => ({
    cid: row.cid,
    name: row.name,
    type: row.type,
    notnull: row.notnull,
    defaultValue: row.dflt_value,
    pk: row.pk
  }));
}
const migrationNames = [
  '0007_customer_identity_unified_entry.sql',
  '0012_drawer_bound_sales_orders.sql',
  '0016_manufacturing_master_v1.sql',
  '0017_product_stock_production_points.sql',
  '0019_product_costing_and_kinds.sql',
  '0027_transaction_void_permits.sql',
  '0030_g001_purchase_material_master.sql',
  '0031_g001_purchase_material_products.sql'
];
const migrations = query(`SELECT id, name, applied_at FROM d1_migrations WHERE name IN (${migrationNames.map(name => `'${name}'`).join(',')}) ORDER BY id;`);
const foreignKeyViolations = query('PRAGMA foreign_key_check;');
const indexes = query(`SELECT name, tbl_name, sql FROM sqlite_schema WHERE type='index' AND tbl_name IN ('products','sales','sale_items','orders','order_items','order_status_history','item_types','units','product_kinds','manufacturing_recipes','manufacturing_recipe_components') ORDER BY tbl_name,name;`);
const g001Master = {
  itemTypes: query(`SELECT id, code, name, can_sell, can_purchase, can_produce, can_consume, track_stock, is_active FROM item_types WHERE store_id='store_001' ORDER BY code;`),
  units: query(`SELECT id, code, name, symbol, decimal_scale, is_active FROM units WHERE store_id='store_001' ORDER BY code;`),
  productKinds: query(`SELECT id, code, name, is_active FROM product_kinds WHERE store_id='store_001' ORDER BY code;`),
  products: query(`SELECT id, name, purchase_price, price, category, is_active, item_type_id, product_kind_id, base_unit_id, stock_tracking_enabled FROM products WHERE store_id='store_001' ORDER BY display_order,id;`),
  recipeRows: query(`SELECT * FROM manufacturing_recipes WHERE store_id='store_001' ORDER BY revision,id;`),
  recipeComponents: query(`SELECT * FROM manufacturing_recipe_components WHERE store_id='store_001' ORDER BY recipe_id,display_order,id;`)
};
const payload = {
  generatedAt: new Date().toISOString(),
  diagnostic: 'TEMP_REMOTE_SCHEMA_ARTIFACT_V3_MASTER_BARANG_RECIPE',
  schema,
  migrations,
  foreignKeyViolations,
  indexes,
  g001Master
};
writeFileSync('public/schema-diagnostic-temp.json', `${JSON.stringify(payload, null, 2)}\n`);
console.log('Temporary schema diagnostic asset generated.');
wrangler(['deploy']);
