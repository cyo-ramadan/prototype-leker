export const CASHBACK_AMOUNT = 50_000;
export const ORDER_CHANNELS = Object.freeze(['POS', 'WEB', 'SHOPEE', 'TIKTOK']);
export const ORDER_STATUSES = Object.freeze(['DRAFT', 'CONFIRMED', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED']);
export const RECEIVABLE_STATUSES = Object.freeze(['OPEN', 'SETTLED', 'DISPUTED']);

export function assertIdrInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${fieldName}:INVALID_IDR_AMOUNT`);
  return parsed;
}

export function calculateOrderTotals(lines, discountAmount = 0, shippingAmount = 0, loyaltyRedeemedAmount = 0) {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('ORDER_LINES_REQUIRED');
  let merchandiseAmount = 0;
  for (const line of lines) {
    const quantity = Number(line.quantity);
    const unitPriceAmount = assertIdrInteger(line.unitPriceAmount, 'unitPriceAmount');
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('INVALID_QUANTITY');
    merchandiseAmount += unitPriceAmount * quantity;
    if (!Number.isSafeInteger(merchandiseAmount)) throw new Error('ORDER_TOTAL_OVERFLOW');
  }
  const discount = Math.min(assertIdrInteger(discountAmount, 'discountAmount'), merchandiseAmount);
  const shipping = assertIdrInteger(shippingAmount, 'shippingAmount');
  const beforeLoyalty = merchandiseAmount - discount + shipping;
  const loyalty = Math.min(assertIdrInteger(loyaltyRedeemedAmount, 'loyaltyRedeemedAmount'), beforeLoyalty);
  return {
    merchandiseAmount,
    discountAmount: discount,
    shippingAmount: shipping,
    loyaltyRedeemedAmount: loyalty,
    totalAmount: beforeLoyalty - loyalty
  };
}

export function qualifiesForMarketplaceReceivable(order) {
  return ['SHOPEE', 'TIKTOK'].includes(order.orderChannel) && ['SHIPPED', 'COMPLETED'].includes(order.orderStatus);
}

export function createMarketplaceReceivable(order, receivableId) {
  if (!qualifiesForMarketplaceReceivable(order)) throw new Error('RECEIVABLE_NOT_ALLOWED');
  return {
    receivableId,
    orderId: order.orderId,
    marketplaceName: order.orderChannel,
    grossAmount: assertIdrInteger(order.totalAmount, 'totalAmount'),
    settledAmount: 0,
    feeAmount: 0,
    otherDeductionAmount: 0,
    receivableStatus: 'OPEN'
  };
}

export function settleMarketplaceReceivable(receivable, input) {
  if (receivable.receivableStatus === 'SETTLED') throw new Error('RECEIVABLE_ALREADY_SETTLED');
  const settledAmount = assertIdrInteger(input.settledAmount, 'settledAmount');
  const feeAmount = assertIdrInteger(input.feeAmount ?? 0, 'feeAmount');
  const otherDeductionAmount = assertIdrInteger(input.otherDeductionAmount ?? 0, 'otherDeductionAmount');
  if (settledAmount + feeAmount + otherDeductionAmount > receivable.grossAmount) {
    throw new Error('SETTLEMENT_EXCEEDS_GROSS');
  }
  return {
    ...receivable,
    settledAmount,
    feeAmount,
    otherDeductionAmount,
    receivableStatus: 'SETTLED',
    reconciliationDifferenceAmount: receivable.grossAmount - settledAmount - feeAmount - otherDeductionAmount
  };
}

export function buildCashbackEntry({ ledgerEntryId, customerId, orderId, existingEntries = [] }) {
  if (existingEntries.some((entry) => entry.orderId === orderId && entry.entryType === 'CASHBACK_EARNED')) {
    throw new Error('CASHBACK_ALREADY_GRANTED');
  }
  return {
    ledgerEntryId,
    customerId,
    orderId,
    entryType: 'CASHBACK_EARNED',
    amount: CASHBACK_AMOUNT
  };
}

export function calculateLoyaltyBalance(entries) {
  return entries.reduce((balance, entry) => {
    const amount = Number(entry.amount);
    if (!Number.isSafeInteger(amount)) throw new Error('LOYALTY_AMOUNT_INVALID');
    return balance + amount;
  }, 0);
}

export function makeIdempotencyKey(prefix, entityId, action) {
  if (!prefix || !entityId || !action) throw new Error('IDEMPOTENCY_INPUT_REQUIRED');
  return `${prefix}:${entityId}:${action}`;
}
