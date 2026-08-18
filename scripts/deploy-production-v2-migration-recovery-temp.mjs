import { spawnSync } from 'node:child_process';

const TIMEOUT_MS = 120000;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const REQUIRED_COLUMNS = Object.freeze({
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
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Wrangler returned non-JSON output: ${result.stdout}`);
  }
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

function d1Json(sql) {
  return rows(wrangler(['d1', 'execute', 'DB', '--remote', '--json', '--command', sql], { json: true }));
}

function columns(tableName) {
  return new Set(d1Json(`PRAGMA table_info(${tableName});`).map(row => String(row?.name || '')));
}

function missingProductionColumns() {
  const missing = [];
  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
    const actual = columns(tableName);
    for (const column of requiredColumns) {
      if (!actual.has(column)) missing.push(`${tableName}.${column}`);
    }
  }
  return missing;
}

function runRemoteSchemaVerifier() {
  const verify = spawnSync(process.execPath, ['scripts/verify-remote-schema.mjs'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: TIMEOUT_MS,
    killSignal: 'SIGTERM'
  });
  if (verify.error || verify.status !== 0) {
    throw new Error(verify.stderr || verify.stdout || verify.error?.message || 'Remote schema verifier failed.');
  }
  process.stdout.write(verify.stdout);
}

console.log('[PRODUCTION_V2_RECOVERY] stage=checkpoint');
const checkpointPayload = wrangler(['d1', 'time-travel', 'info', 'DB', '--json'], { json: true });
const checkpoint = checkpointPayload?.bookmark
  || checkpointPayload?.result?.bookmark
  || (Array.isArray(checkpointPayload) ? checkpointPayload.find(item => item?.bookmark)?.bookmark : '');
if (!checkpoint) {
  throw new Error('Unable to capture D1 Time Travel checkpoint. Production V2 deployment aborted before migration.');
}
console.log(`[PRODUCTION_V2_RECOVERY] checkpoint=${checkpoint}`);

const missingBefore = missingProductionColumns();
console.log(`[PRODUCTION_V2_RECOVERY] stage=preflight missing_before=${JSON.stringify(missingBefore)}`);

console.log('[PRODUCTION_V2_RECOVERY] stage=migrations_apply');
wrangler(['d1', 'migrations', 'apply', 'DB', '--remote']);

console.log('[PRODUCTION_V2_RECOVERY] stage=production_schema_verify');
const missingAfter = missingProductionColumns();
if (missingAfter.length) {
  throw new Error(`Production V2 migration verification failed. Missing: ${missingAfter.join(', ')}`);
}

const foreignKeyViolations = d1Json('PRAGMA foreign_key_check;');
if (foreignKeyViolations.length) {
  throw new Error(`Foreign-key verification failed after canonical migrations: ${JSON.stringify(foreignKeyViolations)}`);
}
console.log('[PRODUCTION_V2_RECOVERY] production_schema=READY foreign_keys=PASS');

console.log('[PRODUCTION_V2_RECOVERY] stage=full_schema_verify');
runRemoteSchemaVerifier();

console.log('[PRODUCTION_V2_RECOVERY] stage=worker_deploy');
wrangler(['deploy']);
console.log(`PRODUCTION_V2_MIGRATION_RECOVERY_PASS checkpoint=${checkpoint}`);
