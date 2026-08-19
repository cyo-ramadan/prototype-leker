import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// `npm run deploy` is what Cloudflare Workers Builds executes for the canonical
// production deployment, so whatever this script says is what actually reaches
// remote D1 and the live Worker.
//
// Three times the command was pointed at a one-time recovery script
// (0e07c9e2 transaction recovery, cf1f9d0 schema diagnostic, dd57dd9 Recipe
// recovery) and never pointed back — and one of those reverts was even titled
// "Restore canonical deployment command" while restoring a temp script. A
// one-time repair standing in as the permanent deploy path means every future
// release re-runs a recovery preamble that can hard-fail long after the drift
// it was written for is gone.
//
// These assertions pin the shape of the canonical command so that swap is
// caught here instead of in a red production build.

const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;

test('deploy runs migrations, then schema verification, then the Worker deploy', () => {
  const deploy = scripts.deploy;

  const migrationsAt = deploy.indexOf('db:migrations:apply');
  const verifyAt = deploy.indexOf('db:schema:verify');
  const workerAt = deploy.indexOf('wrangler deploy');

  assert.ok(migrationsAt !== -1, 'deploy must apply remote D1 migrations');
  assert.ok(verifyAt !== -1, 'deploy must verify the remote schema');
  assert.ok(workerAt !== -1, 'deploy must deploy the Worker');

  // Order carries the safety property, not just presence. Migrations run first
  // so pending reconciliation (such as the orphan-table cleanup in 0037) is
  // applied before the verifier judges the schema; the verifier runs before the
  // Worker so a drifted database stops the release instead of receiving code
  // that assumes a schema it does not have.
  assert.ok(migrationsAt < verifyAt, 'migrations must be applied before the schema is verified');
  assert.ok(verifyAt < workerAt, 'the schema must be verified before the Worker is promoted');
});

test('deploy is not routed through a one-time recovery or diagnostic script', () => {
  const deploy = scripts.deploy;
  assert.ok(
    !/scripts\/deploy-[^\s]*\.mjs/.test(deploy),
    `deploy must not run a one-off recovery script; found: ${deploy}`
  );
  assert.ok(!deploy.includes('-temp'), `deploy must not run a temporary script; found: ${deploy}`);
});

test('the stages deploy depends on are real scripts', () => {
  // A stage that silently does not exist would make `npm run deploy` fail at
  // release time rather than here.
  assert.equal(typeof scripts['db:migrations:apply'], 'string');
  assert.equal(typeof scripts['db:schema:verify'], 'string');
  assert.match(scripts['db:migrations:apply'], /wrangler d1 migrations apply DB --remote/);
  assert.match(scripts['db:schema:verify'], /verify-remote-schema\.mjs/);
});
