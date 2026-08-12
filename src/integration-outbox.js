import { MAXI_MODULES, outboxEnvelope } from './integration-contracts.js';

const nowIso = value => value || new Date().toISOString();

async function settingsFor(db, storeId) {
  return await db.prepare('SELECT * FROM pos_integration_settings WHERE store_id = ?').bind(storeId).first() || {
    tenant_id: 'tenant_leker', terminal_id: `terminal_${storeId}`, warehouse_id: ''
  };
}

async function accountingMapping(db, storeId, transactionType, paymentMethod) {
  return db.prepare(`
    SELECT m.*, da.is_postable AS debit_postable, da.is_active AS debit_active,
           ca.is_postable AS credit_postable, ca.is_active AS credit_active
    FROM accounting_transaction_mappings m
    LEFT JOIN accounting_accounts da ON da.id = m.debit_account_id AND da.store_id = m.store_id
    LEFT JOIN accounting_accounts ca ON ca.id = m.credit_account_id AND ca.store_id = m.store_id
    WHERE m.store_id = ? AND m.transaction_type = ? AND m.payment_method IN (?, 'ANY')
    ORDER BY CASE WHEN m.payment_method = ? THEN 0 ELSE 1 END LIMIT 1
  `).bind(storeId, transactionType, paymentMethod, paymentMethod).first();
}

function insertStatement(db, envelope, status, errorCode = '') {
  const timestamp = nowIso(envelope.occurredAt);
  const module = envelope.destination;
  return db.prepare(`
    INSERT OR IGNORE INTO integration_outbox (
      id, tenant_id, store_id, outlet_id, terminal_id, shift_id, destination,
      module_name, module_version, message_type, aggregate_type, aggregate_id,
      idempotency_key, status, payload_json, error_code, attempts, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).bind(
    `outbox_${crypto.randomUUID()}`, envelope.tenantId, envelope.storeId, envelope.outletId,
    envelope.terminalId, envelope.shiftId, module.name.includes('accounting') ? 'ACCOUNTING' : 'WAREHOUSE',
    module.name, module.version, envelope.messageType, envelope.aggregate.type, envelope.aggregate.id,
    envelope.idempotencyKey, status, JSON.stringify(envelope), errorCode, timestamp, timestamp
  );
}

export async function transactionIntegrationStatements(db, transaction) {
  const settings = await settingsFor(db, transaction.storeId);
  const identity = {
    tenantId: settings.tenant_id || 'tenant_leker', storeId: transaction.storeId,
    outletId: transaction.storeId, terminalId: settings.terminal_id || `terminal_${transaction.storeId}`,
    shiftId: transaction.shiftId, occurredAt: transaction.occurredAt
  };
  const statements = [];
  const mapping = await accountingMapping(db, transaction.storeId, transaction.type, transaction.paymentMethod || 'ANY');
  const mapped = Boolean(mapping?.status === 'ACTIVE' && mapping.debit_postable && mapping.debit_active && mapping.credit_postable && mapping.credit_active);
  const accounting = outboxEnvelope({
    ...identity, destination: 'ACCOUNTING', aggregateType: transaction.type, aggregateId: transaction.id,
    messageType: 'POS_TRANSACTION_RECORDED', operation: 'POST',
    data: {
      transactionType: transaction.type, paymentMethod: transaction.paymentMethod || 'ANY', amount: transaction.amount,
      currency: 'IDR', mapping: mapped ? { debitAccountId: mapping.debit_account_id, creditAccountId: mapping.credit_account_id } : null,
      status: mapped ? 'READY_TO_POST' : 'NEEDS_MAPPING'
    }
  });
  statements.push(insertStatement(db, accounting, mapped ? 'PENDING' : 'NEEDS_MAPPING', mapped ? '' : 'ACCOUNT_MAPPING_MISSING'));

  if (transaction.type === 'SALE') {
    for (const line of transaction.lines || []) {
      const warehouse = await db.prepare(`SELECT * FROM warehouse_item_mappings WHERE store_id = ? AND product_id = ? AND status = 'ACTIVE'`).bind(transaction.storeId, line.productId).first();
      const warehouseMapped = Boolean(warehouse?.warehouse_id && warehouse?.warehouse_item_id);
      const envelope = outboxEnvelope({
        ...identity, destination: 'WAREHOUSE', aggregateType: 'SALE_ITEM', aggregateId: `${transaction.id}:${line.productId}`,
        messageType: 'STOCK_DEDUCTION_REQUESTED', operation: 'DEDUCT',
        data: warehouseMapped ? {
          saleId: transaction.id, productId: line.productId, warehouseId: warehouse.warehouse_id,
          warehouseItemId: warehouse.warehouse_item_id, quantity: line.quantity * Number(warehouse.deduction_quantity || 1),
          unit: 'configured-unit', status: 'READY_TO_DEDUCT'
        } : { saleId: transaction.id, productId: line.productId, quantity: line.quantity, status: 'NEEDS_MAPPING' }
      });
      statements.push(insertStatement(db, envelope, warehouseMapped ? 'PENDING' : 'NEEDS_MAPPING', warehouseMapped ? '' : 'WAREHOUSE_ITEM_MAPPING_MISSING'));
    }
  }
  return statements;
}

export { MAXI_MODULES };

