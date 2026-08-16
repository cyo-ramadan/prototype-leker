import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const REQUIRED_REMOTE_TABLES = Object.freeze([
  'customer_feedback_reports',
  'customer_feedback_report_issues'
]);

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

function verifyRemoteSchema() {
  const quotedNames = REQUIRED_REMOTE_TABLES.map(name => `'${name.replaceAll("'", "''")}'`).join(', ');
  const sql = `SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN (${quotedNames}) ORDER BY name;`;
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(executable, [
    'wrangler', 'd1', 'execute', 'DB', '--remote', '--yes', '--json', '--command', sql
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  if (result.error) {
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

  console.log(`Remote D1 schema ready: ${REQUIRED_REMOTE_TABLES.join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) verifyRemoteSchema();
