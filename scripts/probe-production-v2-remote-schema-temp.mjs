import { spawnSync } from 'node:child_process';

const TIMEOUT_MS = 120000;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const REQUIRED = Object.freeze({
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

function wranglerJson(args) {
  const result = spawnSync(npx, ['--yes', 'wrangler', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: TIMEOUT_MS,
    killSignal: 'SIGTERM'
  });
  if (result.error) throw new Error(`Wrangler failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Wrangler exited ${result.status}`);
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

function columns(tableName) {
  const payload = wranglerJson(['d1', 'execute', 'DB', '--remote', '--json', '--command', `PRAGMA table_info(${tableName});`]);
  return new Set(rows(payload).map(row => String(row?.name || '')));
}

const missing = [];
for (const [tableName, requiredColumns] of Object.entries(REQUIRED)) {
  const actual = columns(tableName);
  for (const column of requiredColumns) {
    if (!actual.has(column)) missing.push(`${tableName}.${column}`);
  }
}

if (missing.length) {
  console.error(`PRODUCTION_V2_REMOTE_SCHEMA_MISSING count=${missing.length}`);
  process.exit(17);
}

console.log('PRODUCTION_V2_REMOTE_SCHEMA_READY');
