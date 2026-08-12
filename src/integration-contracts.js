export const MAXI_MODULES = Object.freeze({
  accounting: Object.freeze({ name: '@maxi/accounting', version: '1.3.0' }),
  warehouse: Object.freeze({ name: '@maxi/warehouse', version: '2.0.0' }),
  pos: Object.freeze({ name: '@maxi/pos-core', version: '1.0.0' })
});

export const ACCOUNT_TYPES = Object.freeze(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);
export const TRANSACTION_TYPES = Object.freeze(['SALE', 'PURCHASE', 'EXPENSE', 'OTHER_INCOME', 'REFUND', 'VOID']);
export const PAYMENT_METHODS = Object.freeze(['CASH', 'NON_CASH', 'ANY']);

export function integrationKey({ tenantId, destination, aggregateType, aggregateId, operation = 'CREATE', revision = 1 }) {
  return [tenantId, destination, aggregateType, aggregateId, operation, revision]
    .map(value => encodeURIComponent(String(value ?? ''))).join(':');
}

export function accountStatus(account) {
  if (!account?.code || !account?.name || !ACCOUNT_TYPES.includes(account.accountType)) return 'NEEDS_CONFIGURATION';
  return account.isPostable ? 'ACTIVE' : 'GROUP';
}

export function mappingStatus(mapping, accounts = []) {
  if (!mapping?.debitAccountId || !mapping?.creditAccountId) return 'NEEDS_MAPPING';
  const byId = new Map(accounts.map(account => [account.id, account]));
  const debit = byId.get(mapping.debitAccountId);
  const credit = byId.get(mapping.creditAccountId);
  return debit?.isPostable && debit?.isActive !== false && credit?.isPostable && credit?.isActive !== false
    ? 'PENDING'
    : 'NEEDS_MAPPING';
}

export function outboxEnvelope(input) {
  const required = ['tenantId', 'storeId', 'outletId', 'terminalId', 'shiftId', 'destination', 'aggregateType', 'aggregateId'];
  for (const field of required) if (!String(input?.[field] ?? '').trim()) throw new Error(`INTEGRATION_IDENTITY_MISSING:${field}`);
  const module = input.destination === 'ACCOUNTING' ? MAXI_MODULES.accounting : MAXI_MODULES.warehouse;
  return {
    schemaVersion: 1,
    tenantId: input.tenantId,
    storeId: input.storeId,
    outletId: input.outletId,
    terminalId: input.terminalId,
    shiftId: input.shiftId,
    source: MAXI_MODULES.pos,
    destination: module,
    messageType: input.messageType,
    aggregate: { type: input.aggregateType, id: input.aggregateId },
    idempotencyKey: integrationKey(input),
    occurredAt: input.occurredAt,
    data: input.data
  };
}

export function reconcileOpeningBalances(rows = []) {
  const debit = rows.reduce((sum, row) => sum + Number(row.debit_amount ?? row.debitAmount ?? 0), 0);
  const credit = rows.reduce((sum, row) => sum + Number(row.credit_amount ?? row.creditAmount ?? 0), 0);
  return { debit, credit, difference: debit - credit, status: debit === credit ? 'BALANCED' : 'NEEDS_RECONCILIATION' };
}
