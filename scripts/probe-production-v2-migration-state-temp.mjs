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
const expected = [
  '0038_operational_accounting_boundary.sql',
  '0039_flexible_manual_production.sql'
];

if (pending.length === expected.length && expected.every((name, index) => pending[index] === name)) {
  console.log('PRODUCTION_V2_PENDING_SET_IS_0038_AND_0039');
  process.exit(0);
}

console.error(`PRODUCTION_V2_PENDING_MIGRATION_SET_UNEXPECTED count=${pending.length}`);
process.exit(32);
