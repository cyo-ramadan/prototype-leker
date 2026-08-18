import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const REQUIRED_REMOTE_TABLES = Object.freeze([
  'customer_feedback_reports',
  'customer_feedback_report_issues',
  'debugger_audit_log'
]);
export const ACCOUNTING_REQUIRED_REMOTE_TABLES = Object.freeze([
  'chart_of_accounts',
  'accounting_journal_headers',
  'accounting_journal_lines'
]);
export const ALL_REQUIRED_REMOTE_TABLES = Object.freeze([
  ...REQUIRED_REMOTE_TABLES,
  ...ACCOUNTING_REQUIRED_REMOTE_TABLES
]);
export const PRODUCTION_REQUIRED_COLUMNS = Object.freeze({
  production_runs: Object.freeze([
    'template_modified',
    'output_product_kind_id',
    'output_product_kind_code',
    'output_product_kind_name'
  ]),
  production_run_components: Object.freeze([
    'component_product_kind_id',
    'component_product_kind_code',
    'component_product_kind_name'
  ])
});
export const FORBIDDEN_REMOTE_TABLES = Object.freeze([
  'accounting_accounts',
  'accounting_dimensions',
  'accounting_opening_balances',
  'accounting_transaction_mappings'
]);
export const ALLOWED_ACCOUNT_REFERENCE_TABLES = Object.freeze(['accounting_account_refs']);
export const ACCOUNTING_ACCOUNT_TYPES = Object.freeze(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);
export const WRANGLER_SCHEMA_VERIFY_TIMEOUT_MS = 120000;

export function extractWranglerD1Rows(payload) {
  const containers = Array.isArray(payload) ? payload : [payload];
  const rows = [];

  for (const container of containers) {
    if (Array.isArray(container?.results)) rows.push(...container.results);
    else if (Array.isArray(container?.result)) rows.push(...container.result);
    else if (Array.isArray(container?.result?.results)) rows.push(...container.result.results);
  }

  return rows;
}

export function missingRequiredTables(payload, requiredTables = REQUIRED_REMOTE_TABLES) {
  const names = new Set(extractWranglerD1Rows(payload).map(row => String(row?.name || '').trim()).filter(Boolean));
  return requiredTables.filter(name => !names.has(name));
}

export function missingRequiredColumns(payload, requiredColumns = PRODUCTION_REQUIRED_COLUMNS) {
  const rows = new Map(extractWranglerD1Rows(payload).map(row => [String(row?.name || '').trim(), String(row?.sql || '').toLowerCase()]));
  const missing = [];
  for (const [tableName, columns] of Object.entries(requiredColumns)) {
    const sql = rows.get(tableName) || '';
    if (!sql) {
      missing.push(`${tableName}.*`);
      continue;
    }
    for (const column of columns) {
      if (!sql.includes(String(column).toLowerCase())) missing.push(`${tableName}.${column}`);
    }
  }
  return missing;
}

export function accountingSchemaViolations(payload) {
  const rows = extractWranglerD1Rows(payload);
  const forbiddenSet = new Set(FORBIDDEN_REMOTE_TABLES);
  const allowedTypedTables = new Set(['chart_of_accounts', ...ALLOWED_ACCOUNT_REFERENCE_TABLES]);
  const forbiddenTables = rows
    .map(row => String(row?.name || '').trim())
    .filter(name => forbiddenSet.has(name));
  const parallelAccountTables = rows
    .filter(row => {
      const name = String(row?.name || '').trim();
      const sql = String(row?.sql || '').toUpperCase();
      if (!name || allowedTypedTables.has(name) || !sql) return false;
      return ACCOUNTING_ACCOUNT_TYPES.every(accountType => sql.includes(`'${accountType}'`));
    })
    .map(row => String(row.name).trim());
  return { forbiddenTables, parallelAccountTables };
}

function verifyRemoteSchema() {
  const sql = `SELECT name, sql FROM sqlite_schema WHERE type = 'table' ORDER BY name;`;
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(executable, [
    '--yes', 'wrangler', 'd1', 'execute', 'DB', '--remote', '--yes', '--json', '--command', sql
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: WRANGLER_SCHEMA_VERIFY_TIMEOUT_MS,
    killSignal: 'SIGTERM'
  });

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      console.error(`Remote D1 schema verification exceeded ${WRANGLER_SCHEMA_VERIFY_TIMEOUT_MS / 1000}s. Stop deployment before Worker promotion.`);
      process.exit(1);
    }
    console.error('Remote D1 schema verification could not start:', result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || 'Remote D1 schema verification failed.');
    process.exit(result.status || 1);
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    console.error('Remote D1 schema verification returned non-JSON output.');
    console.error(result.stdout);
    process.exit(1);
  }

  const missing = missingRequiredTables(payload, ALL_REQUIRED_REMOTE_TABLES);
  if (missing.length) {
    console.error(`Remote D1 schema is not ready. Missing: ${missing.join(', ')}`);
    console.error('Stop deployment. Apply canonical migrations and verify the remote schema before deploying the Worker.');
    process.exit(1);
  }

  const missingColumns = missingRequiredColumns(payload);
  if (missingColumns.length) {
    console.error(`Remote D1 Production V2 schema is not ready. Missing columns: ${missingColumns.join(', ')}`);
    console.error('Stop deployment. Apply migration 0039 before promoting the Production Panel V2 Worker.');
    process.exit(1);
  }

  const violations = accountingSchemaViolations(payload);
  if (violations.forbiddenTables.length || violations.parallelAccountTables.length) {
    if (violations.forbiddenTables.length) {
      console.error(`Remote D1 still contains forbidden orphan Accounting tables: ${violations.forbiddenTables.join(', ')}`);
    }
    if (violations.parallelAccountTables.length) {
      console.error(`Remote D1 contains a parallel Chart-of-Accounts definition: ${violations.parallelAccountTables.join(', ')}`);
    }
    console.error('Stop deployment. chart_of_accounts must remain the sole canonical account registry; registered compatibility references are read/reference surfaces only.');
    process.exit(1);
  }

  console.log('Remote D1 schema ready. Required tables and Production V2 columns present; canonical Accounting registry = chart_of_accounts.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) verifyRemoteSchema();
