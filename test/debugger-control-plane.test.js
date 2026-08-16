import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEBUGGER_IDENTITY,
  DEBUG_MODULES,
  requireDebugger,
  secureTokenEqual
} from '../src/debugger-control-plane.js';

const configuredToken = 'debugger-token-0123456789abcdef0123456789abcdef';

function requestWithToken(token = '') {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return new Request('https://prototype.invalid/api/debug/me', { headers });
}

test('debugger is a dedicated machine identity and not a human login role', () => {
  assert.deepEqual(DEBUGGER_IDENTITY, {
    id: 'debugger',
    role: 'DEBUGGER',
    authType: 'DEBUG_TOKEN'
  });
});

test('debugger token comparison and auth fail closed', async () => {
  assert.equal(await secureTokenEqual(configuredToken, configuredToken), true);
  assert.equal(await secureTokenEqual(configuredToken, `${configuredToken}x`), false);

  const missingConfig = await requireDebugger(requestWithToken(configuredToken), {});
  assert.equal(missingConfig.ok, false);
  assert.equal(missingConfig.response.status, 503);

  const missingCredential = await requireDebugger(requestWithToken(), { DEBUG_SUPERADMIN_TOKEN: configuredToken });
  assert.equal(missingCredential.ok, false);
  assert.equal(missingCredential.response.status, 401);

  const wrongCredential = await requireDebugger(requestWithToken('wrong-token'), { DEBUG_SUPERADMIN_TOKEN: configuredToken });
  assert.equal(wrongCredential.ok, false);
  assert.equal(wrongCredential.response.status, 401);

  const valid = await requireDebugger(requestWithToken(configuredToken), { DEBUG_SUPERADMIN_TOKEN: configuredToken });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.principal, DEBUGGER_IDENTITY);
});

test('debugger registry spans customer, transactions, inventory, approvals, and accounting', () => {
  const modules = Object.keys(DEBUG_MODULES);
  for (const required of [
    'DEBUGGER',
    'CORE',
    'CUSTOMER',
    'CUSTOMER_FEEDBACK',
    'STAFF_AUTH',
    'CASHIER',
    'TRANSACTIONS',
    'APPROVALS',
    'INVENTORY',
    'ACCOUNTING',
    'ACCOUNTING_SETTINGS',
    'WAREHOUSE'
  ]) {
    assert.ok(modules.includes(required), `missing debug module ${required}`);
  }

  assert.ok(DEBUG_MODULES.TRANSACTIONS.tables.sales);
  assert.ok(DEBUG_MODULES.TRANSACTIONS.tables.purchases);
  assert.ok(DEBUG_MODULES.TRANSACTIONS.tables.expenses);
  assert.ok(DEBUG_MODULES.ACCOUNTING.tables.accounting_journal_headers);
  assert.ok(DEBUG_MODULES.ACCOUNTING.tables.accounting_journal_lines);
  assert.ok(DEBUG_MODULES.INVENTORY.tables.inventory_stock_balances);
  assert.ok(DEBUG_MODULES.CUSTOMER_FEEDBACK.tables.customer_feedback_reports);
});

test('debugger namespace is read-only, audited, and routed before normal domain auth', async () => {
  const [controlPlane, indexSource, migration, packageJson] = await Promise.all([
    readFile(new URL('../src/debugger-control-plane.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/0036_debugger_control_plane.sql', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8')
  ]);

  assert.match(controlPlane, /DEBUG_SUPERADMIN_TOKEN/);
  assert.match(controlPlane, /pathname\.startsWith\('\/api\/debug\/'\)/);
  assert.match(controlPlane, /request\.method !== 'GET'/);
  assert.match(controlPlane, /DEBUGGER_READ_ONLY/);
  assert.match(controlPlane, /INSERT INTO debugger_audit_log/);
  assert.doesNotMatch(controlPlane, /DEBUG_SUPERADMIN_TOKEN\s*[:=]\s*['"][^'"]+['"]/);

  const debugDispatch = indexSource.indexOf('handleDebuggerApi(request, env, pathname)');
  const normalLoginDispatch = indexSource.indexOf('handleUnifiedLoginApi(request, env, pathname)');
  assert.ok(debugDispatch >= 0 && debugDispatch < normalLoginDispatch, 'debug namespace must be isolated before normal auth dispatch');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS debugger_audit_log/);
  assert.match(migration, /actor_id TEXT NOT NULL CHECK \(actor_id = 'debugger'\)/);
  assert.match(migration, /request_id TEXT NOT NULL UNIQUE/);
  assert.match(packageJson, /node --check src\/debugger-control-plane\.js/);
});

test('debugger provides system health, module, transaction, feedback, and audit diagnostics', async () => {
  const source = await readFile(new URL('../src/debugger-control-plane.js', import.meta.url), 'utf8');
  assert.match(source, /pathname === '\/api\/debug\/health'/);
  assert.match(source, /\/api\\\/debug\\\/modules\\\/\(\[\^\/\]\+\)/);
  assert.match(source, /\/api\\\/debug\\\/transactions\\\/\(\[\^\/\]\+\)/);
  assert.match(source, /\/api\\\/debug\\\/customer-feedback\\\/\(\[\^\/\]\+\)/);
  assert.match(source, /pathname === '\/api\/debug\/audit'/);
  assert.match(source, /accounting_journal_headers/);
  assert.match(source, /stock_movements/);
  assert.match(source, /customer_point_ledger/);
});
