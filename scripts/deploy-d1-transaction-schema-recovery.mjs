import { spawnSync } from 'node:child_process';

const TIMEOUT_MS = 120000;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function wrangler(args, { json = false } = {}) {
  const result = spawnSync(npx, ['--yes', 'wrangler', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: TIMEOUT_MS,
    killSignal: 'SIGTERM'
  });
  if (result.error) throw new Error(`Wrangler failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Wrangler exited ${result.status}`);
  if (!json) return result.stdout;
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`Wrangler returned non-JSON output: ${result.stdout}`); }
}

function resultRows(payload) {
  const containers = Array.isArray(payload) ? payload : [payload];
  const rows = [];
  for (const container of containers) {
    if (Array.isArray(container?.results)) rows.push(...container.results);
    else if (Array.isArray(container?.result?.results)) rows.push(...container.result.results);
    else if (Array.isArray(container?.result)) rows.push(...container.result);
  }
  return rows;
}

function d1Json(sql) {
  return resultRows(wrangler(['d1', 'execute', 'DB', '--remote', '--json', '--command', sql], { json: true }));
}

function d1Exec(sql) {
  process.stdout.write(`\n${sql}\n`);
  wrangler(['d1', 'execute', 'DB', '--remote', '--command', sql]);
}

console.log('Capture D1 Time Travel checkpoint before repair.');
const checkpointPayload = wrangler(['d1', 'time-travel', 'info', 'DB', '--json'], { json: true });
const checkpoint = checkpointPayload?.bookmark
  || checkpointPayload?.result?.bookmark
  || (Array.isArray(checkpointPayload) ? checkpointPayload.find(row => row?.bookmark)?.bookmark : '');
if (!checkpoint) throw new Error('Unable to capture D1 Time Travel checkpoint. Recovery aborted before mutation.');
console.log(`D1 recovery checkpoint: ${checkpoint}`);

const inspection = d1Json(`
SELECT 'TABLE' AS object_type, name AS object_name, '' AS parent_name
FROM sqlite_schema
WHERE type='table' AND name IN ('approval_permits','products','sales','purchases','expenses')
UNION ALL
SELECT 'COLUMN', name, 'products' FROM pragma_table_info('products')
UNION ALL
SELECT 'COLUMN', name, 'sales' FROM pragma_table_info('sales')
UNION ALL
SELECT 'COLUMN', name, 'purchases' FROM pragma_table_info('purchases')
UNION ALL
SELECT 'COLUMN', name, 'expenses' FROM pragma_table_info('expenses')
UNION ALL
SELECT 'INDEX', name, '' FROM sqlite_schema
WHERE type='index' AND name IN (
  'idx_products_store_production_policy',
  'idx_sales_store_void_created',
  'idx_purchases_store_void_created',
  'idx_expenses_store_void_created',
  'idx_approval_permits_store_status_requested',
  'idx_approval_permits_cashier_requested',
  'idx_approval_permits_subject',
  'idx_approval_permits_one_pending_void'
);
`);

const tables = new Set(inspection.filter(row => row.object_type === 'TABLE').map(row => row.object_name));
const colsByTable = new Map();
for (const row of inspection.filter(row => row.object_type === 'COLUMN')) {
  if (!colsByTable.has(row.parent_name)) colsByTable.set(row.parent_name, new Set());
  colsByTable.get(row.parent_name).add(row.object_name);
}
const indexes = new Set(inspection.filter(row => row.object_type === 'INDEX').map(row => row.object_name));
const hasCol = (table, column) => colsByTable.get(table)?.has(column) === true;

const statements = [];
if (!tables.has('approval_permits')) {
  statements.push(`CREATE TABLE approval_permits (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    drawer_session_id TEXT NOT NULL,
    cashier_id TEXT NOT NULL,
    permit_type TEXT NOT NULL CHECK (permit_type IN ('TRANSACTION_VOID')),
    subject_type TEXT NOT NULL CHECK (subject_type IN ('SALE','PURCHASE','EXPENSE')),
    subject_id TEXT NOT NULL,
    subject_snapshot_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    approval_status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (approval_status IN ('pending_approval','approved','rejected')),
    execution_status TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED' CHECK (execution_status IN ('NOT_ATTEMPTED','HOLD','EXECUTED','FAILED')),
    execution_code TEXT NOT NULL DEFAULT '',
    execution_detail TEXT NOT NULL DEFAULT '',
    accounting_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (accounting_status IN ('NOT_REQUIRED','REVERSED','FAILED')),
    original_journal_id TEXT,
    reversal_journal_id TEXT,
    decision_note TEXT NOT NULL DEFAULT '',
    approved_by_role TEXT,
    approved_by_id TEXT,
    requested_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    decided_at TEXT,
    executed_at TEXT,
    FOREIGN KEY (store_id) REFERENCES stores(id),
    FOREIGN KEY (drawer_session_id) REFERENCES cash_drawer_sessions(id),
    FOREIGN KEY (cashier_id) REFERENCES cashiers(id),
    FOREIGN KEY (original_journal_id) REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT,
    FOREIGN KEY (reversal_journal_id) REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT
  )`);
}

if (!hasCol('products', 'stock_tracking_enabled')) {
  statements.push(`ALTER TABLE products ADD COLUMN stock_tracking_enabled INTEGER NOT NULL DEFAULT 1 CHECK (stock_tracking_enabled IN (0, 1))`);
  statements.push(`UPDATE products SET stock_tracking_enabled = 0`);
}

for (const table of ['sales','purchases','expenses']) {
  if (!hasCol(table, 'voided_at')) statements.push(`ALTER TABLE ${table} ADD COLUMN voided_at TEXT`);
  if (!hasCol(table, 'voided_by_role')) statements.push(`ALTER TABLE ${table} ADD COLUMN voided_by_role TEXT`);
  if (!hasCol(table, 'voided_by_id')) statements.push(`ALTER TABLE ${table} ADD COLUMN voided_by_id TEXT`);
  if (!hasCol(table, 'void_reason')) statements.push(`ALTER TABLE ${table} ADD COLUMN void_reason TEXT NOT NULL DEFAULT ''`);
  if (!hasCol(table, 'void_permit_id')) statements.push(`ALTER TABLE ${table} ADD COLUMN void_permit_id TEXT REFERENCES approval_permits(id) ON DELETE RESTRICT`);
}

const indexSql = {
  idx_products_store_production_policy: `CREATE INDEX IF NOT EXISTS idx_products_store_production_policy ON products(store_id, production_mode, recipe_link_enabled, stock_tracking_enabled, is_active)`,
  idx_sales_store_void_created: `CREATE INDEX IF NOT EXISTS idx_sales_store_void_created ON sales(store_id, voided_at, created_at DESC)`,
  idx_purchases_store_void_created: `CREATE INDEX IF NOT EXISTS idx_purchases_store_void_created ON purchases(store_id, voided_at, created_at DESC)`,
  idx_expenses_store_void_created: `CREATE INDEX IF NOT EXISTS idx_expenses_store_void_created ON expenses(store_id, voided_at, created_at DESC)`,
  idx_approval_permits_store_status_requested: `CREATE INDEX IF NOT EXISTS idx_approval_permits_store_status_requested ON approval_permits(store_id, approval_status, requested_at DESC)`,
  idx_approval_permits_cashier_requested: `CREATE INDEX IF NOT EXISTS idx_approval_permits_cashier_requested ON approval_permits(cashier_id, requested_at DESC)`,
  idx_approval_permits_subject: `CREATE INDEX IF NOT EXISTS idx_approval_permits_subject ON approval_permits(store_id, subject_type, subject_id, requested_at DESC)`,
  idx_approval_permits_one_pending_void: `CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_permits_one_pending_void ON approval_permits(store_id, permit_type, subject_type, subject_id) WHERE approval_status = 'pending_approval'`
};
for (const [name, sql] of Object.entries(indexSql)) if (!indexes.has(name)) statements.push(sql);

if (statements.length) {
  console.log(`Applying ${statements.length} exact canonical recovery statements.`);
  d1Exec(`PRAGMA foreign_keys = ON;\n${statements.map(sql => `${sql};`).join('\n')}`);
} else {
  console.log('No schema mutation required; canonical objects already exist.');
}

const verification = d1Json(`
SELECT 'products.stock_tracking_enabled' AS requirement,
       EXISTS(SELECT 1 FROM pragma_table_info('products') WHERE name='stock_tracking_enabled') AS ok
UNION ALL SELECT 'sales.voided_at', EXISTS(SELECT 1 FROM pragma_table_info('sales') WHERE name='voided_at')
UNION ALL SELECT 'sales.void_permit_id', EXISTS(SELECT 1 FROM pragma_table_info('sales') WHERE name='void_permit_id')
UNION ALL SELECT 'purchases.voided_at', EXISTS(SELECT 1 FROM pragma_table_info('purchases') WHERE name='voided_at')
UNION ALL SELECT 'purchases.void_permit_id', EXISTS(SELECT 1 FROM pragma_table_info('purchases') WHERE name='void_permit_id')
UNION ALL SELECT 'expenses.voided_at', EXISTS(SELECT 1 FROM pragma_table_info('expenses') WHERE name='voided_at')
UNION ALL SELECT 'expenses.void_permit_id', EXISTS(SELECT 1 FROM pragma_table_info('expenses') WHERE name='void_permit_id')
UNION ALL SELECT 'approval_permits', EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='approval_permits');
`);
const failed = verification.filter(row => Number(row.ok) !== 1);
if (failed.length) throw new Error(`Recovery verification failed: ${JSON.stringify(failed)}`);
console.log('Exact transaction schema recovery verified.');

wrangler(['d1', 'migrations', 'apply', 'DB', '--remote']);
const verify = spawnSync(process.execPath, ['scripts/verify-remote-schema.mjs'], {
  encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: TIMEOUT_MS, killSignal: 'SIGTERM'
});
if (verify.error || verify.status !== 0) throw new Error(verify.stderr || verify.stdout || verify.error?.message || 'Remote schema verifier failed.');
process.stdout.write(verify.stdout);
wrangler(['deploy']);
console.log(`TRANSACTION_SCHEMA_RECOVERY_PASS checkpoint=${checkpoint}`);
