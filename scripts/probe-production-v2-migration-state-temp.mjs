import { spawnSync } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npx, [
  '--yes', 'wrangler', 'd1', 'migrations', 'list', 'DB', '--remote'
], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 120000,
  killSignal: 'SIGTERM'
});

if (result.error || result.status !== 0) {
  console.error('PRODUCTION_V2_MIGRATION_STATE_QUERY_FAILED');
  process.exit(31);
}

const output = `${result.stdout || ''}\n${result.stderr || ''}`;
if (/0039_flexible_manual_production\.sql/.test(output)) {
  console.log('PRODUCTION_V2_MIGRATION_0039_UNAPPLIED');
  process.exit(0);
}

console.error('PRODUCTION_V2_MIGRATION_0039_NOT_LISTED_AS_UNAPPLIED');
process.exit(32);
