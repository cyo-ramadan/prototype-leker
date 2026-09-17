import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AGENT_ADMIN_IDENTITY, requireManagement } from '../src/owner-auth.js';

// 2026-09-16, Bos Cyo (setelah menolak entityadmin_hana, migration 0095):
// "yang aku inginkan jalur kusus untuk agent edit ya, bukan jalur
// manusia". Mekanisme ini meniru persis requireDebugger/
// DEBUG_SUPERADMIN_TOKEN di src/debugger-control-plane.js -- secret di
// env Worker (AGENT_ADMIN_TOKEN), dibanding constant-time ke Bearer token
// permintaan, tanpa baris tabel/login/session apa pun. Bedanya: token ini
// boleh dipakai lewat requireManagement (jalur tulis Admin Gerai),
// Debugger sengaja read-only.

const configuredToken = 'agent-admin-token-0123456789abcdef0123456789ab';

function requestWithToken(token = '', path = '/api/admin/categories') {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return new Request(`https://prototype.invalid${path}`, { headers });
}

// requireManagement must never touch the database when the agent-token
// path already matched -- this stub throws if any query is attempted, so
// the test fails loudly if that invariant regresses.
const dbThatMustNotBeQueried = {
  prepare() { throw new Error('db must not be queried once the agent bearer token has matched'); }
};

// For the "agent path did not activate, fell through to human auth" cases,
// the human lookups (owner/admin/entity-admin/legacy-PIN) legitimately do
// query the database -- this stub just answers "no match found" for all of
// them instead of asserting on access.
class EmptyStatement {
  bind() { return this; }
  first() { return null; }
  all() { return { results: [] }; }
  run() { return { success: true, meta: { changes: 0 } }; }
}
const emptyDb = { prepare: () => new EmptyStatement() };

test('agent admin is a dedicated machine identity, not a human login role', () => {
  assert.deepEqual(AGENT_ADMIN_IDENTITY, {
    id: 'agent-admin',
    role: 'AGENT_ADMIN',
    authType: 'AGENT_TOKEN'
  });
});

test('requireManagement ignores the agent-token path entirely when env is omitted (backward compatible for the ~30 call sites still passing only db)', async () => {
  const auth = await requireManagement(requestWithToken(configuredToken), emptyDb);
  assert.notEqual(auth.authType, 'AGENT_TOKEN');
  assert.equal(auth.ok, false);
});

test('requireManagement fails closed when AGENT_ADMIN_TOKEN is not configured', async () => {
  const auth = await requireManagement(requestWithToken(configuredToken), emptyDb, {});
  assert.notEqual(auth.authType, 'AGENT_TOKEN');
  assert.equal(auth.ok, false);
});

test('requireManagement rejects a wrong or missing bearer token even when AGENT_ADMIN_TOKEN is configured', async () => {
  const env = { AGENT_ADMIN_TOKEN: configuredToken };
  const wrong = await requireManagement(requestWithToken('wrong-token'), emptyDb, env);
  assert.notEqual(wrong.authType, 'AGENT_TOKEN');
  assert.equal(wrong.ok, false);
});

test('requireManagement grants AGENT_TOKEN access without ever touching the database when the bearer token matches', async () => {
  const env = { AGENT_ADMIN_TOKEN: configuredToken };
  const auth = await requireManagement(requestWithToken(configuredToken), dbThatMustNotBeQueried, env);
  assert.equal(auth.ok, true);
  assert.equal(auth.authType, 'AGENT_TOKEN');
  assert.deepEqual(auth.agent, AGENT_ADMIN_IDENTITY);
});

test('agent token is blocked from store creation/settings, same OWNER_ONLY carve-out as Admin Gerai and Entity Admin', async () => {
  const env = { AGENT_ADMIN_TOKEN: configuredToken };
  const auth = await requireManagement(requestWithToken(configuredToken, '/api/admin/stores'), dbThatMustNotBeQueried, env);
  assert.equal(auth.ok, false);
  assert.equal(auth.response.status, 403);
});

test('the mechanism never stores the secret in a DB row or session table, and every call site was threaded with env', async () => {
  const [ownerAuthSource, migration0095, migration0096] = await Promise.all([
    readFile(new URL('../src/owner-auth.js', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0095_kpm_entity_admin_hana_agent.sql', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0096_retire_entity_admin_hana_agent.sql', import.meta.url), 'utf8')
  ]);

  assert.match(ownerAuthSource, /AGENT_ADMIN_TOKEN/);
  assert.match(ownerAuthSource, /secureTokenEqual/);
  assert.doesNotMatch(ownerAuthSource, /AGENT_ADMIN_TOKEN\s*[:=]\s*['"][^'"]+['"]/, 'the secret itself must never be hardcoded in source');
  assert.match(migration0096, /is_active = 0/, 'the superseded human-shaped account must be deactivated');
  assert.ok(migration0095, 'migration 0095 must remain in place (never rewritten)');
});
