import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { requireOpenDrawer } from './cashier-drawer.js';
import { getNextOrderSequence, getOrder, listProducts } from './db-multistore.js';
import { buildOrderNo } from './orders-multistore.js';
import { getJakartaBusinessDate, isoNow } from './time.js';
import { resolveCustomerScope } from './customer-sharing.js';
import { prepareSaleStockProduction, stockPostingFailure } from './stock-production.js';
import { saleHppSnapshotSelect } from './manufacture-costing.js';
import { resolvePosPaymentMethod } from './pos-payment-methods.js';

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const placeholders = count => Array.from({ length: count }, () => '?').join(', ');

// Fulfillment mode is picked per sale line by the kasir (Biasa/Dadakan), not
// read from the item itself -- pass whatever the client sent through as-is;
// prepareSaleStockProduction() in stock-production.js resolves the default
// (Dadakan when the product has a recipe link) and validates it.
function lineProductionMode(item) {
  const raw = String(item?.productionMode || '').toUpperCase();
  return raw === 'STOCK' || raw === 'DADAKAN' ? raw : null;
}

function isOrderNumberConflict(error) {
  const message = String(error?.message ?? error).toLowerCase();
  return message.includes('unique') || message.includes('constraint');
}

export function validateDirectLines(products, requested) {
  if (!Array.isArray(requested) || !requested.length) return { ok: false, error: 'Draft penjualan masih kosong.' };
  const productMap = new Map(products.map(item => [Number(item.id), item]));
  const lines = [];
  let total = 0;
  for (const item of requested) {
    const productId = Number(item?.productId ?? item?.id);
    const quantity = Number(item?.quantity ?? item?.qty);
    const product = productMap.get(productId);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return { ok: false, error: 'Item draft penjualan tidak valid atau bukan milik gerai kasir.' };
    }
    // products.price is the catalog reference price and may be sub-rupiah
    // (migration 0060); the actual cash figure (lineTotal) is always rounded
    // to whole rupiah, and the unit_price snapshot stored on the sale_item is
    // derived back from that exact lineTotal (not the raw catalog price) so
    // the stored snapshot always multiplies back to the recorded total.
    const catalogPrice = Number(product.price);
    const lineTotal = Math.round(catalogPrice * quantity);
    total += lineTotal;
    lines.push({
      productId, productName: product.name, unitPrice: Math.round(lineTotal / quantity), quantity, lineTotal, note: '',
      productionMode: lineProductionMode(item)
    });
  }
  return { ok: true, lines, total };
}

function validateOrderSnapshotLines(order, requested) {
  if (!Array.isArray(requested) || !requested.length) return { ok: false, error: 'Draft penjualan masih kosong.' };
  const itemMap = new Map((order.items || []).map(item => [Number(item.menuId), item]));
  const lines = [];
  let total = 0;
  for (const item of requested) {
    const productId = Number(item?.productId ?? item?.id);
    const quantity = Number(item?.quantity ?? item?.qty);
    const snapshot = itemMap.get(productId);
    if (!snapshot || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return { ok: false, error: 'Draft penjualan tidak cocok dengan snapshot pesanan yang diterima.' };
    }
    const unitPrice = Number(snapshot.price);
    const lineTotal = unitPrice * quantity;
    total += lineTotal;
    lines.push({
      productId, productName: snapshot.name, unitPrice, quantity, lineTotal, note: snapshot.note || '',
      productionMode: lineProductionMode(item)
    });
  }
  return { ok: true, lines, total };
}

async function resolveDirectCustomer(db, storeId, customerId) {
  const id = text(customerId, 160);
  if (!id) return { customer: null, scope: null };
  const scope = await resolveCustomerScope(db, storeId);
  const customer = await db.prepare(`
    SELECT id, customer_name, store_id
    FROM customers
    WHERE id = ? AND is_active = 1
      AND store_id IN (${placeholders(scope.storeIds.length)})
    LIMIT 1
  `).bind(id, ...scope.storeIds).first();
  return customer ? { customer, scope } : { error: 'Customer poin tidak ditemukan pada scope gerai ini.' };
}

async function pointContext(db, storeId, customerId) {
  if (!customerId) return null;
  const scope = await resolveCustomerScope(db, storeId);
  return { customerId, shareGroupId: scope.group?.id || null };
}

export function buildSaleStatements(db, {
  saleId, storeId, drawerId, cashierId, linkedOrderId, customerId, customerName,
  total, totalPoints, note, now, channel, lines, operationalStatements, pointShareGroupId
}) {
  const statements = [
    db.prepare(`
      INSERT INTO sales (
        id, store_id, drawer_session_id, cashier_id, customer_name,
        total_amount, note, created_at, payment_method, order_id, customer_id, total_points
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      saleId, storeId, drawerId, cashierId, customerName,
      total, note, now, channel, linkedOrderId, customerId, totalPoints
    ),
    ...(operationalStatements || [])
  ];
  for (const line of lines) {
    statements.push(db.prepare(`
      INSERT INTO sale_items (
        id, sale_id, store_id, product_id, product_name, unit_price, quantity, line_total,
        points_per_unit, line_points, recipe_id, production_run_id,
        product_kind_id, product_kind_code, product_kind_name, unit_cost_snapshot, line_cogs
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             p.product_kind_id, COALESCE(k.code, ''), COALESCE(k.name, ''),
             ${saleHppSnapshotSelect()}
      FROM products p
      LEFT JOIN product_kinds k ON k.id = p.product_kind_id AND k.store_id = p.store_id
      WHERE p.id = ? AND p.store_id = ?
    `).bind(
      `sale_item_${crypto.randomUUID()}`, saleId, storeId, line.productId, line.productName,
      line.unitPrice, line.quantity, line.lineTotal,
      line.pointsPerUnit || 0, line.linePoints || 0, line.recipeId || null, line.productionRunId || null,
      line.quantity, line.productId, storeId
    ));
  }
  if (customerId && totalPoints > 0) {
    statements.push(db.prepare(`
      INSERT INTO customer_point_ledger (
        id, customer_id, share_group_id, source_store_id, points_delta,
        activity_type, reference_type, reference_id, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, 'EARN', 'SALE', ?, ?, ?)
    `).bind(
      `point_sale_${crypto.randomUUID()}`, customerId, pointShareGroupId, storeId, totalPoints,
      saleId, `Poin barang dari penjualan ${saleId}`, now
    ));
  }
  return statements;
}

async function prepareEffects(db, context, lines, customerId) {
  const prepared = await prepareSaleStockProduction(db, { ...context, lines });
  if (!prepared.ok) return prepared;
  const totalPoints = customerId ? prepared.totalPoints : 0;
  return {
    ...prepared,
    totalPoints,
    lines: prepared.lines.map(line => ({ ...line, linePoints: customerId ? line.linePoints : 0 }))
  };
}

export async function handleCashierTrackedSaleApi(request, env, pathname) {
  if (request.method !== 'POST' || pathname !== '/api/cashier/sales') return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const ownership = await requireOpenDrawer(env.DB, auth.cashier);
  if (!ownership.ok) return ownership.response;

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload penjualan tidak valid.' }, 400);

  const storeId = auth.cashier.store.id;
  const resolvedPayment = await resolvePosPaymentMethod(env.DB, storeId, body.value?.paymentMethod, 'CASH');
  if (!resolvedPayment) {
    return json({ error: 'Cara bayar penjualan tidak aktif / tidak terdaftar.', code: 'PAYMENT_METHOD_NOT_AVAILABLE' }, 400);
  }
  const sourceOrderId = text(body.value?.sourceOrderId, 160) || null;
  const now = isoNow();
  const saleId = `sale_${crypto.randomUUID()}`;
  const channel = resolvedPayment.code;
  const effectContext = {
    storeId,
    drawerId: ownership.drawer.id,
    cashierId: auth.cashier.id,
    saleId,
    now
  };

  if (sourceOrderId) {
    const sourceOrder = await getOrder(env.DB, storeId, sourceOrderId);
    if (!sourceOrder || sourceOrder.source !== 'customer') {
      return json({ error: 'Pesanan sumber draft tidak ditemukan.' }, 404);
    }
    if (sourceOrder.status !== 'PREPARING') {
      return json({ error: 'Pesanan sumber harus berstatus Diterima sebelum diproses sebagai penjualan.' }, 409);
    }
    if (sourceOrder.drawerSessionId !== ownership.drawer.id) {
      return json({ error: 'Pesanan sumber terikat ke laci aktif yang berbeda.' }, 409);
    }

    const validated = validateOrderSnapshotLines(sourceOrder, body.value?.items);
    if (!validated.ok) return json({ error: validated.error }, 400);
    const customerId = sourceOrder.customerId || null;
    const point = await pointContext(env.DB, storeId, customerId);
    const effects = await prepareEffects(env.DB, effectContext, validated.lines, customerId);
    if (!effects.ok) return json({ error: effects.error }, effects.status);
    const customerName = text(body.value?.customerName, 100) || sourceOrder.customerName || 'Customer';
    const note = text(body.value?.note, 500) || sourceOrder.generalNote || '';
    const statements = buildSaleStatements(env.DB, {
      saleId,
      storeId,
      drawerId: ownership.drawer.id,
      cashierId: auth.cashier.id,
      linkedOrderId: sourceOrder.id,
      customerId,
      customerName,
      total: validated.total,
      totalPoints: effects.totalPoints,
      note,
      now,
      channel,
      lines: effects.lines,
      operationalStatements: effects.statements,
      pointShareGroupId: point?.shareGroupId || null
    });
    try {
      await env.DB.batch(statements);
    } catch (error) {
      const stockFailure = stockPostingFailure(error);
      if (stockFailure) return json({ error: stockFailure.error }, stockFailure.status);
      throw error;
    }
    return json({
      ok: true,
      sale: {
        id: saleId,
        orderId: sourceOrder.id,
        customerId,
        total: validated.total,
        points: effects.totalPoints,
        paymentMethod: channel,
        items: effects.lines,
        createdAt: now
      },
      sourceOrderId: sourceOrder.id,
      order: null
    }, 201);
  }

  const products = await listProducts(env.DB, storeId);
  const validated = validateDirectLines(products, body.value?.items);
  if (!validated.ok) return json({ error: validated.error }, 400);

  const customerResolution = await resolveDirectCustomer(env.DB, storeId, body.value?.customerId);
  if (customerResolution.error) return json({ error: customerResolution.error }, 404);
  const customerId = customerResolution.customer?.id || null;
  const effects = await prepareEffects(env.DB, effectContext, validated.lines, customerId);
  if (!effects.ok) return json({ error: effects.error }, effects.status);

  const businessDate = getJakartaBusinessDate();
  const customerName = customerResolution.customer?.customer_name || text(body.value?.customerName, 100) || 'Walk-in';
  const note = text(body.value?.note, 500);
  const orderId = `ord_${crypto.randomUUID()}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sequence = await getNextOrderSequence(env.DB, storeId, businessDate);
    const orderNo = buildOrderNo(auth.cashier.store.code, sequence);
    const statements = buildSaleStatements(env.DB, {
      saleId,
      storeId,
      drawerId: ownership.drawer.id,
      cashierId: auth.cashier.id,
      linkedOrderId: orderId,
      customerId,
      customerName,
      total: validated.total,
      totalPoints: effects.totalPoints,
      note,
      now,
      channel,
      lines: effects.lines,
      operationalStatements: effects.statements,
      pointShareGroupId: customerResolution.scope?.group?.id || null
    });
    statements.push(
      env.DB.prepare(`
        INSERT INTO orders (
          id, store_id, customer_id, business_date, order_no, customer_name, table_label, general_note,
          total_amount, status, created_at, updated_at, ready_at, completed_at, cancelled_at,
          source, drawer_session_id
        ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, 'PREPARING', ?, ?, NULL, NULL, NULL, 'cashier', ?)
      `).bind(orderId, storeId, customerId, businessDate, orderNo, customerName, note, validated.total, now, now, ownership.drawer.id),
      env.DB.prepare(`
        INSERT INTO order_status_history (store_id, order_id, from_status, to_status, changed_at)
        VALUES (?, ?, NULL, 'PREPARING', ?)
      `).bind(storeId, orderId, now)
    );
    for (const line of effects.lines) {
      statements.push(env.DB.prepare(`
        INSERT INTO order_items (
          id, store_id, order_id, product_id, product_name, unit_price,
          quantity, note, line_total, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `order_item_${crypto.randomUUID()}`, storeId, orderId, line.productId, line.productName,
        line.unitPrice, line.quantity, line.note, line.lineTotal, now
      ));
    }
    statements.push(
      env.DB.prepare(`UPDATE orders SET status = 'READY', updated_at = ?, ready_at = ? WHERE id = ? AND store_id = ? AND status = 'PREPARING'`)
        .bind(now, now, orderId, storeId),
      env.DB.prepare(`UPDATE orders SET status = 'COMPLETED', updated_at = ?, completed_at = ? WHERE id = ? AND store_id = ? AND status = 'READY'`)
        .bind(now, now, orderId, storeId)
    );

    try {
      await env.DB.batch(statements);
      return json({
        ok: true,
        sale: {
          id: saleId,
          orderId,
          customerId,
          total: validated.total,
          points: effects.totalPoints,
          paymentMethod: channel,
          items: effects.lines,
          createdAt: now
        },
        order: {
          id: orderId,
          storeId,
          customerId,
          orderNo,
          customerName,
          tableLabel: '',
          generalNote: note,
          total: validated.total,
          status: 'COMPLETED',
          source: 'cashier',
          drawerSessionId: ownership.drawer.id,
          createdAt: now,
          updatedAt: now,
          readyAt: now,
          completedAt: now,
          cancelledAt: null,
          items: effects.lines.map(line => ({ menuId: line.productId, name: line.productName, price: line.unitPrice, lineTotal: line.lineTotal, qty: line.quantity, note: line.note }))
        }
      }, 201);
    } catch (error) {
      const stockFailure = stockPostingFailure(error);
      if (stockFailure) return json({ error: stockFailure.error }, stockFailure.status);
      if (attempt === 2 || !isOrderNumberConflict(error)) throw error;
    }
  }

  return json({ error: 'Nomor tracking penjualan bentrok. Silakan coba lagi.' }, 409);
}
