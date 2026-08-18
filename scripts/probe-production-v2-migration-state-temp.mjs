import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

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
const localMigrations = readdirSync('migrations')
  .filter(name => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const pending = localMigrations.filter(name => output.includes(name));

if (pending.length === 1 && pending[0] === '0039_flexible_manual_production.sql') {
  console.log('PRODUCTION_V2_MIGRATION_0039_IS_SOLE_PENDING');
  process.exit(0);
}

console.error(`PRODUCTION_V2_PENDING_MIGRATION_SET_UNEXPECTED count=${pending.length}`);
process.exit(32);
