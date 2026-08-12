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

function isAccountingEligible(transaction) {
  const kind = String(transaction?.kind || '').toUpperCase();
  if (['SALE', 'PURCHASE', 'EXPENSE', 'OTHER_INCOME'].includes(kind)) return transaction?.status === 'posted';
  if (['CASH_FLOW', 'GOODS_FLOW', 'ASSET'].includes(kind)) return String(transaction?.status || '').endsWith('/posted');
  return false;
}

export function accountingReferenceForTransaction(transaction) {
  const kind = String(transaction?.kind || '').toUpperCase();
  const eligible = isAccountingEligible(transaction);
  return {
    contract: ACCOUNTING_BRIDGE_CONTRACT,
    sourceProgram: 'PROTOTYPE_LEKER',
    factType: FACT_TYPE[kind] || kind,
    factId: `${kind}:${transaction?.id || ''}`,
    eligible,
    syncStatus: eligible ? 'NOT_CONNECTED' : 'NOT_POSTABLE',
    journalReference: null
  };
}
