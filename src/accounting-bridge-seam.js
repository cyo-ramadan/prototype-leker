export const ACCOUNTING_BRIDGE_CONTRACT = 'MAXI_ACCOUNTING_BUSINESS_FACT_V1';

const FACT_TYPE = Object.freeze({
  SALE: 'SALE_COMPLETED',
  PURCHASE: 'PURCHASE_RECORDED',
  EXPENSE: 'EXPENSE_RECORDED',
  OTHER_INCOME: 'OTHER_INCOME_RECORDED',
  CASH_FLOW: 'CASH_FLOW_POSTED',
  GOODS_FLOW: 'INVENTORY_MOVEMENT_POSTED',
  ASSET: 'ASSET_MOVEMENT_POSTED'
});

export function accountingReferenceForTransaction(transaction) {
  const kind = String(transaction?.kind || '').toUpperCase();
  return {
    contract: ACCOUNTING_BRIDGE_CONTRACT,
    sourceProgram: 'PROTOTYPE_LEKER',
    factType: FACT_TYPE[kind] || kind,
    factId: `${kind}:${transaction?.id || ''}`,
    syncStatus: 'NOT_CONNECTED',
    journalReference: null
  };
}
