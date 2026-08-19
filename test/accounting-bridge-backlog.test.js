import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const posBridge = readFileSync(new URL('../src/accounting-pos-bridge.js', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../src/accounting-reconciliation-guard.js', import.meta.url), 'utf8');
const bridgeUi = readFileSync(new URL('../public/admin-accounting-bridge-ui.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

// A store whose sales predate the delivery ledger has no delivery rows at all.
// Counting the backlog from accounting_bridge_deliveries therefore reports a
// clean zero while revenue is missing from the books, which is the failure mode
// that hid six unposted sales in production.
test('the backlog is counted from the facts, not from delivery attempts', () => {
  assert.match(posBridge, /export async function countUnsyncedPosFacts/);
  assert.match(posBridge, /counts\.unsynced = await countUnsyncedPosFacts/);
  assert.match(posBridge, /unsynced: 0/);

  const predicate = posBridge.slice(posBridge.indexOf('const UNSYNCED_POS_FACTS_SQL'));
  for (const table of ['sales', 'purchases', 'expenses']) {
    assert.ok(predicate.includes(`FROM ${table}`), `backlog must consider ${table}`);
  }
});

test('the backlog predicate has one definition shared by both callers', () => {
  // Two copies drifted before: the guard filtered voided facts and the bridge
  // copy did not, so which one ran decided whether a voided sale could be
  // re-posted. The predicate now lives in one place and is imported.
  assert.match(guard, /import \{ activePendingPosFacts, dispatchPosAccountingFact \}/);
  assert.match(guard, /activePendingPosFacts\(env\.DB/);
  assert.ok(
    !guard.includes('FROM sales s'),
    'the guard must not carry its own copy of the backlog query'
  );
});

test('exactly one handler owns the bridge sync route', () => {
  // Both handlers used to answer POST /api/admin/accounting/bridge/sync, and the
  // shadowed copy skipped the voided_at check. Reordering the two lines in
  // index.js would have silently re-enabled re-posting voided transactions.
  assert.match(guard, /pathname !== '\/api\/admin\/accounting\/bridge\/sync'/);
  assert.ok(
    !posBridge.includes("pathname === '/api/admin/accounting/bridge/sync'"),
    'the POS bridge handler must not also claim the sync route'
  );
  const guardAt = index.indexOf('handleAccountingReconciliationGuardApi(request');
  const bridgeAt = index.indexOf('handleAccountingPosBridgeApi(request');
  assert.ok(guardAt !== -1 && bridgeAt !== -1);
  assert.ok(guardAt < bridgeAt, 'the void-aware guard must be reached first');
});

test('an unposted backlog is visible in the workspace badge', () => {
  assert.match(bridgeUi, /summary\.unsynced/);
  assert.match(bridgeUi, /belum masuk jurnal/);
});
