function requireDb(env) {
  if (!env?.DB) throw new Error('D1_BINDING_NOT_CONFIGURED');
  return env.DB;
}

export async function listProducts(env) {
  const db = requireDb(env);
  const { results } = await db.prepare(`
    SELECT productId, sku, productName, categoryName, barcodeValue,
           purchasePriceAmount, salePriceAmount, isActive
    FROM olshop_products
    WHERE isActive = 1
    ORDER BY productName
  `).all();
  return results ?? [];
}

export async function createProduct(env, product) {
  const db = requireDb(env);
  await db.prepare(`INSERT INTO olshop_products (
    productId, sku, productName, categoryName, barcodeValue, purchasePriceAmount, salePriceAmount, isActive, createdAt, updatedAt
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)` )
    .bind(product.productId, product.sku, product.productName, product.categoryName, product.barcodeValue,
      product.purchasePriceAmount, product.salePriceAmount, product.occurredAt, product.occurredAt).run();
  return product;
}

export async function updateProduct(env, productId, product) {
  const db = requireDb(env);
  const existing = await db.prepare(`SELECT productId FROM olshop_products WHERE productId = ?`).bind(productId).first();
  if (!existing) throw new Error('PRODUCT_NOT_FOUND');
  await db.prepare(`UPDATE olshop_products SET
    sku=?, productName=?, categoryName=?, barcodeValue=?, purchasePriceAmount=?, salePriceAmount=?, isActive=?, updatedAt=?
    WHERE productId=?`)
    .bind(product.sku, product.productName, product.categoryName, product.barcodeValue, product.purchasePriceAmount,
      product.salePriceAmount, product.isActive ? 1 : 0, product.occurredAt, productId).run();
  return { productId, ...product };
}

export async function getOperationalFinancialReport(env) {
  const db = requireDb(env);
  const orderTotals = await db.prepare(`
    SELECT
      COUNT(*) AS orderCount,
      COALESCE(SUM(merchandiseAmount), 0) AS merchandiseAmount,
      COALESCE(SUM(discountAmount), 0) AS discountAmount,
      COALESCE(SUM(shippingAmount), 0) AS shippingAmount,
      COALESCE(SUM(loyaltyRedeemedAmount), 0) AS loyaltyRedeemedAmount,
      COALESCE(SUM(totalAmount), 0) AS grossOrderAmount
    FROM olshop_orders
    WHERE orderStatus <> 'CANCELLED'
  `).first();
  const receivableTotals = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN receivableStatus='OPEN' THEN grossAmount ELSE 0 END), 0) AS openReceivableAmount,
      COALESCE(SUM(CASE WHEN receivableStatus='SETTLED' THEN settledAmount ELSE 0 END), 0) AS marketplacePayoutAmount,
      COALESCE(SUM(CASE WHEN receivableStatus='SETTLED' THEN feeAmount ELSE 0 END), 0) AS marketplaceFeeAmount,
      COALESCE(SUM(CASE WHEN receivableStatus='SETTLED' THEN otherDeductionAmount ELSE 0 END), 0) AS marketplaceOtherDeductionAmount
    FROM olshop_marketplace_receivables
  `).first();
  const { results: channelRows } = await db.prepare(`
    SELECT orderChannel, COUNT(*) AS orderCount, COALESCE(SUM(totalAmount),0) AS grossOrderAmount
    FROM olshop_orders
    WHERE orderStatus <> 'CANCELLED'
    GROUP BY orderChannel
    ORDER BY grossOrderAmount DESC
  `).all();
  return {
    ...orderTotals,
    ...receivableTotals,
    channelRows: channelRows ?? [],
    accountingStatus: 'NOT_CONFIGURED',
    inventoryStatus: 'NOT_CONFIGURED'
  };
}

export async function listOrders(env, limit = 100) {
  const db = requireDb(env);
  const { results } = await db.prepare(`
    SELECT orderId, orderNumber, orderChannel, orderStatus, customerNameSnapshot,
           totalAmount, paymentStatus, marketplaceOrderReference, createdAt, shippedAt
    FROM olshop_orders
    ORDER BY createdAt DESC
    LIMIT ?
  `).bind(Math.min(Number(limit) || 100, 500)).all();
  return results ?? [];
}

export async function listReceivables(env) {
  const db = requireDb(env);
  const { results } = await db.prepare(`
    SELECT receivableId, orderId, marketplaceName, grossAmount, settledAmount,
           feeAmount, otherDeductionAmount, receivableStatus, openedAt, settledAt
    FROM olshop_marketplace_receivables
    ORDER BY openedAt DESC
  `).all();
  return results ?? [];
}

export async function listCustomers(env) {
  const db = requireDb(env);
  const { results } = await db.prepare(`
    SELECT c.customerId, c.customerName, c.phoneNumber, c.emailAddress,
           COALESCE(SUM(l.amount), 0) AS loyaltyBalance
    FROM olshop_customers c
    LEFT JOIN olshop_loyalty_ledger l ON l.customerId = c.customerId
    GROUP BY c.customerId
    ORDER BY c.customerName
  `).all();
  return results ?? [];
}

export async function resolveCustomer(env, { customerId, customerName, customerPhone, generatedCustomerId }) {
  const db = requireDb(env);
  if (customerId) {
    const byId = await db.prepare(`SELECT customerId, customerName, phoneNumber, emailAddress FROM olshop_customers WHERE customerId = ?`).bind(customerId).first();
    if (byId) return byId;
  }
  const normalizedPhone = String(customerPhone || '').trim();
  if (!normalizedPhone) return null;
  const existing = await db.prepare(`SELECT customerId, customerName, phoneNumber, emailAddress FROM olshop_customers WHERE phoneNumber = ?`).bind(normalizedPhone).first();
  if (existing) return existing;
  const nextCustomerId = generatedCustomerId;
  if (!nextCustomerId) throw new Error('CUSTOMER_ID_REQUIRED');
  const nextName = String(customerName || 'Customer').trim().slice(0, 120) || 'Customer';
  await db.prepare(`INSERT INTO olshop_customers (customerId, customerName, phoneNumber) VALUES (?, ?, ?)`).bind(nextCustomerId, nextName, normalizedPhone).run();
  return { customerId: nextCustomerId, customerName: nextName, phoneNumber: normalizedPhone, emailAddress: null };
}

export async function getCustomerLoyaltyByPhone(env, phoneNumber) {
  const db = requireDb(env);
  const normalizedPhone = String(phoneNumber || '').trim();
  if (!normalizedPhone) return null;
  const customer = await db.prepare(`SELECT customerId FROM olshop_customers WHERE phoneNumber = ?`).bind(normalizedPhone).first();
  return customer ? getCustomerLoyalty(env, customer.customerId) : null;
}

export async function getCustomerLoyalty(env, customerId) {
  const db = requireDb(env);
  const customer = await db.prepare(`SELECT customerId, customerName, phoneNumber, emailAddress FROM olshop_customers WHERE customerId = ?`).bind(customerId).first();
  if (!customer) return null;
  const { results } = await db.prepare(`SELECT ledgerEntryId, orderId, entryType, amount, createdAt FROM olshop_loyalty_ledger WHERE customerId = ? ORDER BY createdAt DESC`).bind(customerId).all();
  const entries = results ?? [];
  const loyaltyBalance = entries.reduce((sum, entry) => sum + Number(entry.amount), 0);
  return { ...customer, loyaltyBalance, entries };
}

export async function createOrder(env, order) {
  const db = requireDb(env);
  const statements = [
    db.prepare(`INSERT INTO olshop_orders (
      orderId, orderNumber, orderChannel, orderStatus, customerId, customerNameSnapshot,
      customerPhoneSnapshot, marketplaceOrderReference, merchandiseAmount, discountAmount,
      shippingAmount, loyaltyRedeemedAmount, totalAmount, paymentStatus, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(order.orderId, order.orderNumber, order.orderChannel, order.orderStatus, order.customerId,
        order.customerNameSnapshot, order.customerPhoneSnapshot, order.marketplaceOrderReference,
        order.merchandiseAmount, order.discountAmount, order.shippingAmount, order.loyaltyRedeemedAmount,
        order.totalAmount, order.paymentStatus, order.createdAt, order.createdAt)
  ];
  for (const line of order.lines) {
    statements.push(db.prepare(`INSERT INTO olshop_order_lines (
      orderLineId, orderId, productId, productNameSnapshot, quantity, unitPriceAmount, lineAmount
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(line.orderLineId, order.orderId, line.productId, line.productNameSnapshot, line.quantity,
        line.unitPriceAmount, line.lineAmount));
  }
  if (order.loyaltyRedeemedAmount > 0) {
    statements.push(db.prepare(`INSERT INTO olshop_loyalty_ledger (
      ledgerEntryId, customerId, orderId, entryType, amount, createdAt
    ) VALUES (?, ?, ?, 'CASHBACK_REDEEMED', ?, ?)`)
      .bind(order.loyaltyRedemptionEntryId, order.customerId, order.orderId, -order.loyaltyRedeemedAmount, order.createdAt));
  }
  statements.push(db.prepare(`INSERT INTO olshop_integration_outbox (
    factId, factType, aggregateId, correlationId, payloadJson, contractVersion, syncStatus, createdAt
  ) VALUES (?, 'ORDER_CONFIRMED_LOCAL', ?, ?, ?, 'internal.olshop.v1', 'NOT_CONFIGURED', ?)`)
    .bind(order.factId, order.orderId, order.correlationId, JSON.stringify({ orderId: order.orderId, orderChannel: order.orderChannel, totalAmount: order.totalAmount }), order.createdAt));
  await db.batch(statements);
  return order;
}

export async function markOrderShipped(env, { orderId, shippedAt, receivableId, factId, correlationId }) {
  const db = requireDb(env);
  const order = await db.prepare(`SELECT * FROM olshop_orders WHERE orderId = ?`).bind(orderId).first();
  if (!order) throw new Error('ORDER_NOT_FOUND');
  if (order.orderStatus === 'CANCELLED') throw new Error('ORDER_CANCELLED');
  const statements = [
    db.prepare(`UPDATE olshop_orders SET orderStatus='SHIPPED', shippedAt=?, updatedAt=? WHERE orderId=?`).bind(shippedAt, shippedAt, orderId),
    db.prepare(`INSERT OR IGNORE INTO olshop_integration_outbox (
      factId, factType, aggregateId, correlationId, payloadJson, contractVersion, syncStatus, createdAt
    ) VALUES (?, 'ORDER_SHIPPED_LOCAL', ?, ?, ?, 'internal.olshop.v1', 'NOT_CONFIGURED', ?)`)
      .bind(factId, orderId, correlationId, JSON.stringify({ orderId }), shippedAt)
  ];
  if (['SHOPEE', 'TIKTOK'].includes(order.orderChannel)) {
    statements.push(db.prepare(`INSERT OR IGNORE INTO olshop_marketplace_receivables (
      receivableId, orderId, marketplaceName, grossAmount, settledAmount, feeAmount,
      otherDeductionAmount, receivableStatus, openedAt
    ) VALUES (?, ?, ?, ?, 0, 0, 0, 'OPEN', ?)`)
      .bind(receivableId, orderId, order.orderChannel, order.totalAmount, shippedAt));
  }
  await db.batch(statements);
  return { ...order, orderStatus: 'SHIPPED', shippedAt };
}

export async function completeOrder(env, { orderId, completedAt, cashbackEntryId, factId, correlationId }) {
  const db = requireDb(env);
  const order = await db.prepare(`SELECT * FROM olshop_orders WHERE orderId = ?`).bind(orderId).first();
  if (!order) throw new Error('ORDER_NOT_FOUND');
  const statements = [
    db.prepare(`UPDATE olshop_orders SET orderStatus='COMPLETED', updatedAt=? WHERE orderId=?`).bind(completedAt, orderId),
    db.prepare(`INSERT OR IGNORE INTO olshop_integration_outbox (
      factId, factType, aggregateId, correlationId, payloadJson, contractVersion, syncStatus, createdAt
    ) VALUES (?, 'ORDER_COMPLETED_LOCAL', ?, ?, ?, 'internal.olshop.v1', 'NOT_CONFIGURED', ?)`)
      .bind(factId, orderId, correlationId, JSON.stringify({ orderId, totalAmount: order.totalAmount }), completedAt)
  ];
  if (order.customerId) {
    statements.push(db.prepare(`INSERT OR IGNORE INTO olshop_loyalty_ledger (
      ledgerEntryId, customerId, orderId, entryType, amount, createdAt
    ) VALUES (?, ?, ?, 'CASHBACK_EARNED', 50000, ?)`)
      .bind(cashbackEntryId, order.customerId, orderId, completedAt));
  }
  await db.batch(statements);
  return { ...order, orderStatus: 'COMPLETED' };
}

export async function settleReceivable(env, settlement) {
  const db = requireDb(env);
  const receivable = await db.prepare(`SELECT * FROM olshop_marketplace_receivables WHERE receivableId=?`).bind(settlement.receivableId).first();
  if (!receivable) throw new Error('RECEIVABLE_NOT_FOUND');
  if (receivable.receivableStatus === 'SETTLED') throw new Error('RECEIVABLE_ALREADY_SETTLED');
  const grossAmount = Number(receivable.grossAmount);
  const settlementComponents = settlement.settledAmount + settlement.feeAmount + settlement.otherDeductionAmount;
  if (settlementComponents > grossAmount) throw new Error('SETTLEMENT_EXCEEDS_GROSS');
  const difference = grossAmount - settlementComponents;
  await db.batch([
    db.prepare(`UPDATE olshop_marketplace_receivables SET settledAmount=?, feeAmount=?, otherDeductionAmount=?, receivableStatus='SETTLED', settledAt=? WHERE receivableId=?`)
      .bind(settlement.settledAmount, settlement.feeAmount, settlement.otherDeductionAmount, settlement.settledAt, settlement.receivableId),
    db.prepare(`INSERT INTO olshop_marketplace_settlements (
      settlementId, receivableId, marketplaceName, payoutReference, grossAmount, feeAmount,
      otherDeductionAmount, settledAmount, reconciliationDifferenceAmount, settledAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(settlement.settlementId, settlement.receivableId, receivable.marketplaceName, settlement.payoutReference,
        receivable.grossAmount, settlement.feeAmount, settlement.otherDeductionAmount, settlement.settledAmount, difference, settlement.settledAt),
    db.prepare(`INSERT INTO olshop_integration_outbox (
      factId, factType, aggregateId, correlationId, payloadJson, contractVersion, syncStatus, createdAt
    ) VALUES (?, 'MARKETPLACE_SETTLED_LOCAL', ?, ?, ?, 'internal.olshop.v1', 'NOT_CONFIGURED', ?)`)
      .bind(settlement.factId, settlement.receivableId, settlement.correlationId, JSON.stringify({
        receivableId: settlement.receivableId,
        marketplaceName: receivable.marketplaceName,
        grossAmount: receivable.grossAmount,
        feeAmount: settlement.feeAmount,
        otherDeductionAmount: settlement.otherDeductionAmount,
        settledAmount: settlement.settledAmount,
        reconciliationDifferenceAmount: difference
      }), settlement.settledAt)
  ]);
  return { ...receivable, ...settlement, receivableStatus: 'SETTLED', reconciliationDifferenceAmount: difference };
}
