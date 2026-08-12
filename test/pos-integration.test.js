import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { integrationKey, mappingStatus, outboxEnvelope, reconcileOpeningBalances } from '../src/integration-contracts.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('integration idempotency is tenant scoped and deterministic', () => {
  const input = { tenantId: 't1', destination: 'ACCOUNTING', aggregateType: 'SALE', aggregateId: 's1', operation: 'POST', revision: 1 };
  assert.equal(integrationKey(input), integrationKey({ ...input }));
  assert.notEqual(integrationKey(input), integrationKey({ ...input, tenantId: 't2' }));
  assert.notEqual(integrationKey(input), integrationKey({ ...input, destination: 'WAREHOUSE' }));
});

test('outbox contract preserves separate operational identities and pinned modules', () => {
  const event = outboxEnvelope({
    tenantId: 'tenant_leker', storeId: 'store_g1', outletId: 'store_g1', terminalId: 'terminal_g1', shiftId: 'drawer_1',
    destination: 'ACCOUNTING', aggregateType: 'SALE', aggregateId: 'sale_1', messageType: 'POS_TRANSACTION_RECORDED',
    occurredAt: '2026-08-12T00:00:00.000Z', data: { status: 'NEEDS_MAPPING' }
  });
  assert.equal(event.destination.name, '@maxi/accounting');
  assert.equal(event.destination.version, '1.3.0');
  assert.equal(event.source.name, '@maxi/pos-core');
  assert.equal(event.source.version, '1.0.0');
  assert.equal(event.terminalId, 'terminal_g1');
  assert.equal(event.shiftId, 'drawer_1');
});

test('missing or non-postable account mapping fails closed', () => {
  const accounts = [{ id: 'cash', isPostable: true, isActive: true }, { id: 'sales', isPostable: false, isActive: true }];
  assert.equal(mappingStatus(null, accounts), 'NEEDS_MAPPING');
  assert.equal(mappingStatus({ debitAccountId: 'cash', creditAccountId: 'sales' }, accounts), 'NEEDS_MAPPING');
  assert.equal(mappingStatus({ debitAccountId: 'cash', creditAccountId: 'revenue' }, [...accounts, { id: 'revenue', isPostable: true, isActive: true }]), 'PENDING');
});

test('opening balance reconciliation never hides an imbalance', () => {
  assert.deepEqual(reconcileOpeningBalances([{ debit_amount: 100 }, { credit_amount: 100 }]), { debit: 100, credit: 100, difference: 0, status: 'BALANCED' });
  assert.equal(reconcileOpeningBalances([{ debit_amount: 100 }, { credit_amount: 90 }]).status, 'NEEDS_RECONCILIATION');
});

test('migration is additive and creates accounting, warehouse and outbox boundaries', async () => {
  const sql = await read('migrations/0012_pos_integration_foundation.sql');
  for (const table of ['pos_tenants', 'pos_terminals', 'accounting_accounts', 'accounting_dimensions', 'accounting_opening_balances', 'accounting_transaction_mappings', 'warehouse_item_mappings', 'pos_integration_settings', 'integration_outbox']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /UNIQUE \(tenant_id, destination, idempotency_key\)/);
  assert.match(sql, /NEEDS_MAPPING/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
});

test('POS writes integration records through a bridge instead of module databases', async () => {
  const [drawer, outbox, settings, ui] = await Promise.all([
    read('src/cashier-drawer.js'), read('src/integration-outbox.js'), read('src/integration-settings.js'), read('public/admin-integrations.js')
  ]);
  assert.match(drawer, /transactionIntegrationStatements/);
  assert.match(outbox, /integration_outbox/);
  assert.match(outbox, /WAREHOUSE_ITEM_MAPPING_MISSING/);
  assert.match(outbox, /ACCOUNT_MAPPING_MISSING/);
  assert.match(settings, /requireManagement/);
  assert.match(ui, /Chart of Accounts/);
  assert.match(ui, /NEEDS_CONFIGURATION/);
});

test('cashier exposes a state-safe printable receipt after a canonical sale', async () => {
  const [html, cashier] = await Promise.all([read('public/cashier.html'), read('public/cashier.js')]);
  assert.match(html, /id="lastReceiptBtn"[^>]*disabled/);
  assert.match(cashier, /state\.lastReceipt = \{ \.\.\.payload\.sale/);
  assert.match(cashier, /function printLastReceipt/);
  assert.match(cashier, /popup\.document\.close/);
});
