import { spawnSync } from 'node:child_process';

const TIMEOUT_MS = 120000;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npx, [
  '--yes', 'wrangler', 'd1', 'execute', 'DB', '--remote', '--yes', '--json', '--command', 'SELECT 1 AS ok;'
], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: TIMEOUT_MS,
  killSignal: 'SIGTERM'
});

if (result.error) {
  console.error('PRODUCTION_V2_D1_CONNECTIVITY_FAILED_START');
  process.exit(21);
}
if (result.status !== 0) {
  console.error('PRODUCTION_V2_D1_CONNECTIVITY_FAILED_REMOTE');
  process.exit(22);
}

let payload;
try {
  payload = JSON.parse(result.stdout);
} catch {
  console.error('PRODUCTION_V2_D1_CONNECTIVITY_FAILED_JSON');
  process.exit(23);
}

const containers = Array.isArray(payload) ? payload : [payload];
const rows = [];
for (const container of containers) {
  if (Array.isArray(container?.results)) rows.push(...container.results);
  else if (Array.isArray(container?.result?.results)) rows.push(...container.result.results);
  else if (Array.isArray(container?.result)) rows.push(...container.result);
}
if (!rows.some(row => Number(row?.ok) === 1)) {
  console.error('PRODUCTION_V2_D1_CONNECTIVITY_FAILED_RESULT');
  process.exit(24);
}

console.log('PRODUCTION_V2_D1_CONNECTIVITY_READY');
