import { calculateOrderTotals, ORDER_CHANNELS, assertIdrInteger } from './domain.js';
import { createOrder, createProduct, updateProduct, getOperationalFinancialReport, listCustomers, listOrders, listProducts, listReceivables, getCustomerLoyalty, getCustomerLoyaltyByPhone, resolveCustomer, markOrderShipped, completeOrder, settleReceivable } from './db.js';

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function normalizeProductInput(body, productId = id('PRD')) {
  const sku = String(body.sku || '').trim().toUpperCase();
  const productName = String(body.productName || '').trim();
  const categoryName = String(body.categoryName || '').trim();
  const barcodeValue = String(body.barcodeValue || '').trim();
  if (!sku || !productName || !categoryName || !barcodeValue) throw new Error('PRODUCT_FIELDS_REQUIRED');
  return {
    productId,
    sku,
    productName: productName.slice(0, 160),
    categoryName: categoryName.slice(0, 100),
    barcodeValue: barcodeValue.slice(0, 80),
    purchasePriceAmount: assertIdrInteger(body.purchasePriceAmount, 'purchasePriceAmount'),
    salePriceAmount: assertIdrInteger(body.salePriceAmount, 'salePriceAmount'),
    isActive: body.isActive !== false,
    occurredAt: new Date().toISOString()
  };
}

async function parseJson(request) {
  try { return await request.json(); }
  catch { throw new Error('INVALID_JSON'); }
}

function apiError(error) {
  const code = error?.message || 'UNEXPECTED_ERROR';
  const clientPrefixes = ['purchasePriceAmount:', 'salePriceAmount:', 'settledAmount:', 'feeAmount:', 'otherDeductionAmount:'];
  const clientErrors = new Set([
    'INVALID_JSON','ORDER_LINES_REQUIRED','INVALID_QUANTITY','ORDER_NOT_FOUND','ORDER_CANCELLED',
    'ORDER_CHANNEL_INVALID','PRODUCT_NOT_FOUND','PRODUCT_FIELDS_REQUIRED','RECEIVABLE_NOT_FOUND',
    'RECEIVABLE_ALREADY_SETTLED','SETTLEMENT_EXCEEDS_GROSS','D1_BINDING_NOT_CONFIGURED',
    'CUSTOMER_NOT_FOUND','LOYALTY_CUSTOMER_REQUIRED','LOYALTY_BALANCE_INSUFFICIENT'
  ]);
  const isClientError = clientErrors.has(code) || clientPrefixes.some(prefix => code.startsWith(prefix));
  return json({ error: code }, isClientError ? 400 : 500);
}

async function handleApi(request, env, url) {
  try {
    if (request.method === 'GET' && url.pathname === '/api/products') return json({ products: await listProducts(env) });
    if (request.method === 'POST' && url.pathname === '/api/products') {
      const product = normalizeProductInput(await parseJson(request));
      await createProduct(env, product);
      return json({ product }, 201);
    }
    const productMatch = /^\/api\/products\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'PUT' && productMatch) {
      const productId = decodeURIComponent(productMatch[1]);
      const product = normalizeProductInput(await parseJson(request), productId);
      await updateProduct(env, productId, product);
      return json({ product });
    }
    if (request.method === 'GET' && url.pathname === '/api/reports/financial') return json(await getOperationalFinancialReport(env));
    if (request.method === 'GET' && url.pathname === '/api/orders') return json({ orders: await listOrders(env, url.searchParams.get('limit')) });
    if (request.method === 'GET' && url.pathname === '/api/receivables') return json({ receivables: await listReceivables(env) });
    if (request.method === 'GET' && url.pathname === '/api/customers') return json({ customers: await listCustomers(env) });
    if (request.method === 'GET' && url.pathname === '/api/loyalty') {
      const loyalty = await getCustomerLoyaltyByPhone(env, url.searchParams.get('phone'));
      return loyalty ? json(loyalty) : json({ error: 'CUSTOMER_NOT_FOUND' }, 404);
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/customers/') && url.pathname.endsWith('/loyalty')) {
      const customerId = decodeURIComponent(url.pathname.split('/')[3]);
      const loyalty = await getCustomerLoyalty(env, customerId);
      return loyalty ? json(loyalty) : json({ error: 'CUSTOMER_NOT_FOUND' }, 404);
    }
    if (request.method === 'POST' && url.pathname === '/api/orders') {
      const body = await parseJson(request);
      const orderChannel = String(body.orderChannel || 'WEB').toUpperCase();
      if (!ORDER_CHANNELS.includes(orderChannel)) throw new Error('ORDER_CHANNEL_INVALID');
      const products = await listProducts(env);
      const productById = new Map(products.map(product => [product.productId, product]));
      const lines = (body.lines ?? []).map((line) => {
        const product = productById.get(line.productId);
        if (!product) throw new Error('PRODUCT_NOT_FOUND');
        const quantity = Number(line.quantity);
        if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('INVALID_QUANTITY');
        return {
          orderLineId: id('LINE'), productId: product.productId, productNameSnapshot: product.productName,
          quantity, unitPriceAmount: Number(product.salePriceAmount), lineAmount: Number(product.salePriceAmount) * quantity
        };
      });
      const customer = await resolveCustomer(env, {
        customerId: body.customerId || null,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        generatedCustomerId: id('CUS')
      });
      const loyaltyRedeemedAmount = Number(body.loyaltyRedeemedAmount ?? 0);
      if (loyaltyRedeemedAmount > 0) {
        if (!customer) throw new Error('LOYALTY_CUSTOMER_REQUIRED');
        const loyalty = await getCustomerLoyalty(env, customer.customerId);
        if (Number(loyalty?.loyaltyBalance ?? 0) < loyaltyRedeemedAmount) throw new Error('LOYALTY_BALANCE_INSUFFICIENT');
      }
      const totals = calculateOrderTotals(lines, body.discountAmount ?? 0, body.shippingAmount ?? 0, loyaltyRedeemedAmount);
      const now = new Date().toISOString();
      const orderId = id('ORD');
      const order = {
        orderId,
        orderNumber: `OL-${Date.now()}`,
        orderChannel,
        orderStatus: body.paymentStatus === 'PAID' ? 'PAID' : 'CONFIRMED',
        customerId: customer?.customerId || null,
        customerNameSnapshot: customer?.customerName || String(body.customerName || 'Guest').slice(0, 120),
        customerPhoneSnapshot: customer?.phoneNumber || String(body.customerPhone || '').slice(0, 40),
        marketplaceOrderReference: body.marketplaceOrderReference ? String(body.marketplaceOrderReference).slice(0, 120) : null,
        paymentStatus: ['PAID','PENDING'].includes(String(body.paymentStatus).toUpperCase()) ? String(body.paymentStatus).toUpperCase() : 'PENDING',
        ...totals,
        lines,
        loyaltyRedemptionEntryId: id('LOY'),
        factId: id('FACT'), correlationId: id('CORR'), createdAt: now
      };
      await createOrder(env, order);
      return json({ order }, 201);
    }
    const shipMatch = /^\/api\/orders\/([^/]+)\/ship$/.exec(url.pathname);
    if (request.method === 'POST' && shipMatch) {
      const orderId = decodeURIComponent(shipMatch[1]);
      const now = new Date().toISOString();
      const order = await markOrderShipped(env, { orderId, shippedAt: now, receivableId: id('RCV'), factId: id('FACT'), correlationId: id('CORR') });
      return json({ order });
    }
    const completeMatch = /^\/api\/orders\/([^/]+)\/complete$/.exec(url.pathname);
    if (request.method === 'POST' && completeMatch) {
      const orderId = decodeURIComponent(completeMatch[1]);
      const now = new Date().toISOString();
      const order = await completeOrder(env, { orderId, completedAt: now, cashbackEntryId: id('LOY'), factId: id('FACT'), correlationId: id('CORR') });
      return json({ order, cashbackAmount: 50000 });
    }
    const settleMatch = /^\/api\/receivables\/([^/]+)\/settle$/.exec(url.pathname);
    if (request.method === 'POST' && settleMatch) {
      const body = await parseJson(request);
      const settlement = await settleReceivable(env, {
        settlementId: id('SET'), receivableId: decodeURIComponent(settleMatch[1]),
        payoutReference: String(body.payoutReference || '').slice(0, 120),
        settledAmount: assertIdrInteger(body.settledAmount, 'settledAmount'),
        feeAmount: assertIdrInteger(body.feeAmount ?? 0, 'feeAmount'),
        otherDeductionAmount: assertIdrInteger(body.otherDeductionAmount ?? 0, 'otherDeductionAmount'),
        settledAt: new Date().toISOString(), factId: id('FACT'), correlationId: id('CORR')
      });
      return json({ settlement });
    }
    return json({ error: 'NOT_FOUND' }, 404);
  } catch (error) { return apiError(error); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    if (url.pathname === '/') return Response.redirect(new URL('/admin.html', url), 302);
    return env.ASSETS.fetch(request);
  }
};
