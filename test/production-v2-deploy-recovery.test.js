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

  for (const marker of [
    'production_runs.template_modified',
    'production_runs.output_product_kind_id',
    'production_runs.output_product_kind_code',
    'production_runs.output_product_kind_name',
    'production_run_components.component_product_kind_id',
    'production_run_components.component_product_kind_code',
    'production_run_components.component_product_kind_name'
  ]) {
    const [, column] = marker.split('.');
    assert.match(recovery, new RegExp(column));
  }

  assert.doesNotMatch(recovery, /ALTER\s+TABLE|DROP\s+TABLE|UPDATE\s+d1_migrations|INSERT\s+INTO\s+d1_migrations|DELETE\s+FROM\s+d1_migrations/i);
});

test('temporary deployment routing points only at the bounded Production V2 wrapper', () => {
  assert.equal(packageJson.scripts.deploy, 'node scripts/deploy-production-v2-migration-recovery-temp.mjs');
  assert.match(packageJson.scripts.check, /deploy-production-v2-migration-recovery-temp\.mjs/);
  assert.equal(packageJson.scripts['db:migrations:apply'], 'npx --yes wrangler d1 migrations apply DB --remote');
  assert.equal(packageJson.scripts['db:schema:verify'], 'node scripts/verify-remote-schema.mjs');
});
