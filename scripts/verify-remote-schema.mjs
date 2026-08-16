import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const REQUIRED_REMOTE_TABLES = Object.freeze([
  'customer_feedback_reports',
  'customer_feedback_report_issues',
  'debugger_audit_log',
  'chart_of_accounts',
  'accounting_journal_headers',
  'accounting_journal_lines'
]);
export const FORBIDDEN_REMOTE_TABLES = Object.freeze([
  'accounting_accounts',
  'accounting_dimensions',
  'accounting_opening_balances',
  'accounting_transaction_mappings'
]);
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

export function accountingSchemaViolations(payload) {
  const rows = extractWranglerD1Rows(payload);
  const forbiddenSet = new Set(FORBIDDEN_REMOTE_TABLES);
  const forbiddenTables = rows
    .map(row => String(row?.name || '').trim())
    .filter(name => forbiddenSet.has(name));
  const parallelAccountTables = rows
    .filter(row => {
      const name = String(row?.name || '').trim();
      const sql = String(row?.sql || '').toUpperCase();
      if (!name || name === 'chart_of_accounts' || !sql) return false;
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

  const missing = missingRequiredTables(payload);
  if (missing.length) {
    console.error(`Remote D1 schema is not ready. Missing: ${missing.join(', ')}`);
    console.error('Stop deployment. Apply canonical migrations and verify the remote schema before deploying the Worker.');
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
    console.error('Stop deployment. chart_of_accounts must remain the sole canonical account registry.');
    process.exit(1);
  }

  console.log(`Remote D1 schema ready. Required tables present; canonical Accounting registry = chart_of_accounts.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) verifyRemoteSchema();
