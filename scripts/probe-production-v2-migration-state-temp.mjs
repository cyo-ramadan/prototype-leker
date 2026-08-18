import { spawnSync } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const namespace = 'accounting';
const staleNames = [
  'accounts',
  'dimensions',
  'opening_balances',
  'transaction_mappings'
].map(suffix => `${namespace}_${suffix}`);
const guardName = `${namespace}_schema_reconciliation_guard_20260817`;
const quotedExclusions = [...staleNames, guardName].map(name => `'${name}'`).join(', ');
const staleMatchers = staleNames.map(name => `lower(sql) LIKE '%${name}%'`).join('\n    OR ');
const sql = `
SELECT name, type
FROM sqlite_schema
WHERE type IN ('table', 'view', 'trigger')
  AND sql IS NOT NULL
  AND name NOT IN (${quotedExclusions})
  AND (${staleMatchers})
ORDER BY name;`;

const result = spawnSync(npx, [
  '--yes', 'wrangler', 'd1', 'execute', 'DB', '--remote', '--yes', '--json', '--command', sql
], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 120000,
  killSignal: 'SIGTERM'
});

if (result.error || result.status !== 0) {
  console.error('ACCOUNTING_0037_GUARD_PROBE_FAILED');
  process.exit(31);
}

let payload;
try {
  payload = JSON.parse(result.stdout);
} catch {
  console.error('ACCOUNTING_0037_GUARD_PROBE_JSON_FAILED');
  process.exit(32);
}

const containers = Array.isArray(payload) ? payload : [payload];
const rows = [];
for (const container of containers) {
  if (Array.isArray(container?.results)) rows.push(...container.results);
  else if (Array.isArray(container?.result?.results)) rows.push(...container.result.results);
  else if (Array.isArray(container?.result)) rows.push(...container.result);
}

const names = rows.map(row => String(row?.name || '')).filter(Boolean).sort();
const expected = ['pos_integration_settings'];
if (names.length === expected.length && expected.every((name, index) => names[index] === name)) {
  console.log('ACCOUNTING_0037_BLOCKER_IS_POS_INTEGRATION_SETTINGS');
  process.exit(0);
}

console.error(`ACCOUNTING_0037_UNEXPECTED_BLOCKER_SET count=${names.length}`);
process.exit(33);
