import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const recovery = readFileSync(new URL('../scripts/deploy-production-v2-migration-recovery-temp.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('Production V2 recovery uses Cloudflare build credentials only for the canonical guarded deployment road', () => {
  const checkpointAt = recovery.indexOf("['d1', 'time-travel', 'info', 'DB', '--json']");
  const migrationAt = recovery.indexOf("['d1', 'migrations', 'apply', 'DB', '--remote']");
  const foreignKeyAt = recovery.indexOf("PRAGMA foreign_key_check;");
  const fullVerifyAt = recovery.indexOf('runRemoteSchemaVerifier();');
  const deployAt = recovery.indexOf("wrangler(['deploy']);");
  assert.ok(checkpointAt >= 0, 'D1 Time Travel checkpoint is mandatory');
  assert.ok(migrationAt > checkpointAt, 'canonical migrations must run after checkpoint');
  assert.ok(foreignKeyAt > migrationAt, 'foreign-key verification must run after migrations');
  assert.ok(fullVerifyAt > foreignKeyAt, 'full remote schema verifier must run after focused checks');
  assert.ok(deployAt > fullVerifyAt, 'Worker promotion must be last');
  assert.doesNotMatch(recovery, /ALTER\s+TABLE|DROP\s+TABLE|UPDATE\s+d1_migrations|INSERT\s+INTO\s+d1_migrations|DELETE\s+FROM\s+d1_migrations/i);
});

test('temporary deployment routing remains inside an explicitly bounded Production V2 operational lane', () => {
  const allowed = new Set([
    'node scripts/deploy-production-v2-migration-recovery-temp.mjs',
    'node scripts/probe-production-v2-remote-schema-temp.mjs',
    'node scripts/probe-production-v2-d1-connectivity-temp.mjs',
    'node scripts/probe-production-v2-migration-state-temp.mjs'
  ]);
  assert.equal(allowed.has(packageJson.scripts.deploy), true);
  assert.match(packageJson.scripts.check, /deploy-production-v2-migration-recovery-temp\.mjs/);
  for (const script of [
    'probe-production-v2-remote-schema-temp.mjs',
    'probe-production-v2-d1-connectivity-temp.mjs',
    'probe-production-v2-migration-state-temp.mjs'
  ]) {
    if (packageJson.scripts.deploy.includes(script)) assert.match(packageJson.scripts.check, new RegExp(script.replaceAll('.', '\\.')));
  }
  assert.equal(packageJson.scripts['db:migrations:apply'], 'npx --yes wrangler d1 migrations apply DB --remote');
  assert.equal(packageJson.scripts['db:schema:verify'], 'node scripts/verify-remote-schema.mjs');
});
