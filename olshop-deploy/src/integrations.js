export class AccountingPort {
  constructor(baseUrl = '') { this.baseUrl = baseUrl; }
  async sendBusinessFact() {
    if (!this.baseUrl) return { isConfigured: false, reason: 'ACCOUNTING_API_NOT_APPROVED' };
    return { isConfigured: false, reason: 'ACCOUNTING_ADAPTER_PENDING_CONTRACT' };
  }
}

export class WarehousePort {
  constructor(baseUrl = '') { this.baseUrl = baseUrl; }
  async sendInventoryFact() {
    if (!this.baseUrl) return { isConfigured: false, reason: 'WAREHOUSE_API_NOT_APPROVED' };
    return { isConfigured: false, reason: 'WAREHOUSE_ADAPTER_PENDING_CONTRACT' };
  }
}

export function buildLocalOutboxFact({ factId, factType, aggregateId, correlationId, payload }) {
  if (!factId || !factType || !aggregateId || !correlationId) throw new Error('OUTBOX_FACT_INVALID');
  return {
    factId,
    factType,
    aggregateId,
    correlationId,
    payload,
    contractVersion: 'internal.olshop.v1',
    syncStatus: 'NOT_CONFIGURED'
  };
}
