import { spawnSync } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const TARGETS = Object.freeze({
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

function queryColumns(tableName) {
  const result = spawnSync(npx, [
    '--yes', 'wrangler', 'd1', 'execute', 'DB', '--remote', '--yes', '--json',
    '--command', `PRAGMA table_info(${tableName});`
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
    killSignal: 'SIGTERM'
  });
  if (result.error || result.status !== 0) process.exit(41);
  let payload;
  try { payload = JSON.parse(result.stdout); } catch { process.exit(42); }
  const containers = Array.isArray(payload) ? payload : [payload];
  const rows = [];
  for (const container of containers) {
    if (Array.isArray(container?.results)) rows.push(...container.results);
    else if (Array.isArray(container?.result?.results)) rows.push(...container.result.results);
    else if (Array.isArray(container?.result)) rows.push(...container.result);
  }
  return new Set(rows.map(row => String(row?.name || '')));
}

const existingTargets = [];
for (const [tableName, targetColumns] of Object.entries(TARGETS)) {
  const actual = queryColumns(tableName);
  for (const column of targetColumns) {
    if (actual.has(column)) existingTargets.push(`${tableName}.${column}`);
  }
}

if (existingTargets.length) {
  console.error(`PRODUCTION_V2_PARTIAL_SCHEMA_PRESENT count=${existingTargets.length}`);
  process.exit(43);
}

console.log('PRODUCTION_V2_ZERO_TARGET_COLUMNS_CONFIRMED');
