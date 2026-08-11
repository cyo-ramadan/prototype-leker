import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { requireDrawerOwner } from './cashier-drawer.js';
import { getNextOrderSequence, getOrder, listProducts } from './db-multistore.js';
import { buildOrderNo } from './orders-multistore.js';
import { getJakartaBusinessDate, isoNow } from './time.js';

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const paymentMethod = value => String(value || '').toUpperCase() === 'NON_CASH' ? 'NON_CASH' : 'CASH';

function isConstraintConflict(error) {
  const message = String(error?.message ?? error).toLowerCase();
  return message.includes('unique') || message.includes('constraint');
}

function validateDirectLines(products, requested) {
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
    const unitPrice = Number(product.price);
    const lineTotal = unitPrice * quantity;
    total += lineTotal;
    lines.push({ productId, productName: product.name, unitPrice, quantity, lineTotal, note: '' });
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
      productId,
      productName: snapshot.name,
      unitPrice,
      quantity,
      lineTotal,
      note: snapshot.note || ''
    });
  }
  return { ok: true, lines, total };
}

function buildSaleStatements(db, { saleId, storeId, drawerId, cashierId, linkedOrderId, customerName, total, note, now, channel, lines }) {
  const statements = [
    db.prepare(`
      INSERT INTO sales (
        id, store_id, drawer_session_id, cashier_id, customer_name,
        total_amount, note, created_at, payment_method, order_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(saleId, storeId, drawerId, cashierId, customerName, total, note, now, channel, linkedOrderId)
  ];
  for (const line of lines) {
    statements.push(db.prepare(`
      INSERT INTO sale_items (id, sale_id, store_id, product_id, product_name, unit_price, quantity, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(`sale_item_${crypto.randomUUID()}`, saleId, storeId, line.productId, line.productName, line.unitPrice, line.quantity, line.lineTotal));
  }
  return statements;
}

export async function handleCashierTrackedSaleApi(request, env, pathname) {
  if (request.method !== 'POST' || pathname !== '/api/cashier/sales') return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const ownership = await requireDrawerOwner(env.DB, auth.cashier);
  if (!ownership.ok) return ownership.response;

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload penjualan tidak valid.' }, 400);

  const storeId = auth.cashier.store.id;
  const sourceOrderId = text(body.value?.sourceOrderId, 160) || null;
  const now = isoNow();
  const saleId = `sale_${crypto.randomUUID()}`;
  const channel = paymentMethod(body.value?.paymentMethod);

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
    const customerName = text(body.value?.customerName, 100) || sourceOrder.customerName || 'Customer';
    const note = text(body.value?.note, 500) || sourceOrder.generalNote || '';
    const statements = buildSaleStatements(env.DB, {
      saleId,
      storeId,
      drawerId: ownership.drawer.id,
      cashierId: auth.cashier.id,
      linkedOrderId: sourceOrder.id,
      customerName,
      total: validated.total,
      note,
      now,
      channel,
      lines: validated.lines
    });
    await env.DB.batch(statements);
    return json({
      ok: true,
      sale: { id: saleId, orderId: sourceOrder.id, total: validated.total, paymentMethod: channel, items: validated.lines, createdAt: now },
      sourceOrderId: sourceOrder.id,
      order: null
    }, 201);
  }

  const products = await listProducts(env.DB, storeId);
  const validated = validateDirectLines(products, body.value?.items);
  if (!validated.ok) return json({ error: validated.error }, 400);

  const businessDate = getJakartaBusinessDate();
  const customerName = text(body.value?.customerName, 100) || 'Walk-in';
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
      customerName,
      total: validated.total,
      note,
      now,
      channel,
      lines: validated.lines
    });
    statements.push(
      env.DB.prepare(`
        INSERT INTO orders (
          id, store_id, customer_id, business_date, order_no, customer_name, table_label, general_note,
          total_amount, status, created_at, updated_at, ready_at, completed_at, cancelled_at,
          source, drawer_session_id
        ) VALUES (?, ?, NULL, ?, ?, ?, '', ?, ?, 'PREPARING', ?, ?, NULL, NULL, NULL, 'cashier', ?)
      `).bind(orderId, storeId, businessDate, orderNo, customerName, note, validated.total, now, now, ownership.drawer.id),
      env.DB.prepare(`
        INSERT INTO order_status_history (store_id, order_id, from_status, to_status, changed_at)
        VALUES (?, ?, NULL, 'PREPARING', ?)
      `).bind(storeId, orderId, now)
    );
    for (const line of validated.lines) {
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
        sale: { id: saleId, orderId, total: validated.total, paymentMethod: channel, items: validated.lines, createdAt: now },
        order: {
          id: orderId,
          storeId,
          customerId: null,
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
          items: validated.lines.map(line => ({ menuId: line.productId, name: line.productName, price: line.unitPrice, qty: line.quantity, note: line.note }))
        }
      }, 201);
    } catch (error) {
      if (attempt === 2 || !isConstraintConflict(error)) throw error;
    }
  }

  return json({ error: 'Nomor tracking penjualan bentrok. Silakan coba lagi.' }, 409);
}
