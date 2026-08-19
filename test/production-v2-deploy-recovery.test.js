import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const recovery = readFileSync(new URL('../scripts/deploy-production-v2-migration-recovery-temp.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('Production V2 recovery is migration-aware and fails closed on schema-ledger drift', () => {
  const preflightAt = recovery.indexOf('missingProductionColumns()');
  const listAt = recovery.indexOf("['d1', 'migrations', 'list', 'DB', '--remote']");
  const driftAt = recovery.indexOf('Production V2 schema drift detected');
  const migrationAt = recovery.indexOf("['d1', 'migrations', 'apply', 'DB', '--remote']");
  const foreignKeyAt = recovery.indexOf("PRAGMA foreign_key_check;");
  const fullVerifyAt = recovery.indexOf('runRemoteSchemaVerifier();');
  const deployAt = recovery.indexOf("wrangler(['deploy']);");

  assert.ok(preflightAt >= 0, 'Production V2 columns must be inspected before mutation');
  assert.ok(listAt > preflightAt, 'migration state must be read before applying migrations');
  assert.ok(driftAt > listAt, 'schema-ledger drift must have an explicit fail-closed branch');
  assert.ok(migrationAt > listAt, 'canonical migrations must run only after migration-state inspection');
  assert.ok(foreignKeyAt > migrationAt, 'foreign-key verification must run after canonical migration apply');
  assert.ok(fullVerifyAt > foreignKeyAt, 'full remote schema verifier must run after focused checks');
  assert.ok(deployAt > fullVerifyAt, 'Worker promotion must be last');

  assert.match(recovery, /0039_flexible_manual_production\.sql/);
  assert.doesNotMatch(recovery, /migrations', 'apply', 'DB', '--remote', '--yes'/);
  assert.doesNotMatch(recovery, /ALTER\s+TABLE|DROP\s+TABLE|UPDATE\s+d1_migrations|INSERT\s+INTO\s+d1_migrations|DELETE\s+FROM\s+d1_migrations/i);
});

// A prior version of this test pinned `npm run deploy` to this recovery script
// as an "explicitly bounded operational lane" — which is exactly the pattern
// CLAUDE.md's deploy discipline section forbids: a one-time recovery script
// standing in as the permanent deploy path, this time with a test enshrining
// it instead of catching it. `test/canonical-deploy-command.test.js` is the
// one guard for what `scripts.deploy` may be; this file only verifies the
// recovery script's own content, for when it is run manually and on purpose.
test('the canonical deploy stages this recovery script mirrors still exist under their real names', () => {
  assert.equal(packageJson.scripts['db:migrations:apply'], 'npx --yes wrangler d1 migrations apply DB --remote');
  assert.equal(packageJson.scripts['db:schema:verify'], 'node scripts/verify-remote-schema.mjs');
});
