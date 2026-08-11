function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function mapOrderRow(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    customerId: row.customer_id || null,
    orderNo: row.order_no,
    customerName: row.customer_name,
    tableLabel: row.table_label,
    generalNote: row.general_note,
    total: row.total_amount,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readyAt: row.ready_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    items: []
  };
}

function mapOrderItemRow(row) {
  return {
    menuId: row.product_id,
    name: row.product_name,
    price: row.unit_price,
    qty: row.quantity,
    note: row.note
  };
}

async function loadItemsForOrders(db, storeId, orderIds) {
  if (!orderIds.length) return new Map();
  const result = await db.prepare(`
    SELECT order_id, product_id, product_name, unit_price, quantity, note
    FROM order_items
    WHERE store_id = ? AND order_id IN (${placeholders(orderIds.length)})
    ORDER BY id ASC
  `).bind(storeId, ...orderIds).all();
  const grouped = new Map(orderIds.map(orderId => [orderId, []]));
  for (const row of result.results ?? []) grouped.get(row.order_id)?.push(mapOrderItemRow(row));
  return grouped;
}

export async function listProducts(db, storeId) {
  const result = await db.prepare(`
    SELECT id, name, price, category, emoji, image_data
    FROM products
    WHERE store_id = ? AND is_active = 1
    ORDER BY display_order ASC, id ASC
  `).bind(storeId).all();
  return (result.results ?? []).map(row => ({
    id: row.id,
    name: row.name,
    price: row.price,
    category: row.category,
    emoji: row.emoji,
    imageData: row.image_data || ''
  }));
}

export async function getProductsByIds(db, storeId, productIds) {
  const uniqueIds = [...new Set(productIds)];
  if (!uniqueIds.length) return [];
  const result = await db.prepare(`
    SELECT id, name, price, category, emoji
    FROM products
    WHERE store_id = ? AND is_active = 1 AND id IN (${placeholders(uniqueIds.length)})
  `).bind(storeId, ...uniqueIds).all();
  return result.results ?? [];
}

export async function listOrders(db, storeId, limit = 100) {
  const result = await db.prepare(`
    SELECT id, store_id, customer_id, order_no, customer_name, table_label, general_note,
           total_amount, status, created_at, updated_at, ready_at,
           completed_at, cancelled_at
    FROM orders
    WHERE store_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(storeId, limit).all();
  const orders = (result.results ?? []).map(mapOrderRow);
  const itemsByOrder = await loadItemsForOrders(db, storeId, orders.map(order => order.id));
  for (const order of orders) order.items = itemsByOrder.get(order.id) ?? [];
  return orders;
}

export async function getOrder(db, storeId, orderId) {
  const row = await db.prepare(`
    SELECT id, store_id, customer_id, order_no, customer_name, table_label, general_note,
           total_amount, status, created_at, updated_at, ready_at,
           completed_at, cancelled_at
    FROM orders
    WHERE store_id = ? AND id = ?
  `).bind(storeId, orderId).first();
  if (!row) return null;
  const order = mapOrderRow(row);
  const itemsByOrder = await loadItemsForOrders(db, storeId, [orderId]);
  order.items = itemsByOrder.get(orderId) ?? [];
  return order;
}

export async function getNextOrderSequence(db, storeId, businessDate) {
  const row = await db.prepare(`
    SELECT COUNT(*) + 1 AS next_sequence
    FROM orders
    WHERE store_id = ? AND business_date = ?
  `).bind(storeId, businessDate).first();
  return Number(row?.next_sequence ?? 1);
}

export async function insertOrder(db, order, items) {
  const statements = [
    db.prepare(`
      INSERT INTO orders (
        id, store_id, customer_id, business_date, order_no, customer_name, table_label, general_note,
        total_amount, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      order.id, order.storeId, order.customerId || null, order.businessDate, order.orderNo, order.customerName,
      order.tableLabel, order.generalNote, order.total, order.status, order.createdAt, order.updatedAt
    ),
    ...items.map(item => db.prepare(`
      INSERT INTO order_items (
        id, store_id, order_id, product_id, product_name, unit_price,
        quantity, note, line_total, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      item.id, order.storeId, order.id, item.menuId, item.name, item.price,
      item.qty, item.note, item.price * item.qty, order.createdAt
    )),
    db.prepare(`
      INSERT INTO order_status_history (store_id, order_id, from_status, to_status, changed_at)
      VALUES (?, ?, NULL, ?, ?)
    `).bind(order.storeId, order.id, order.status, order.createdAt)
  ];
  await db.batch(statements);
}

export async function updateOrderStatus(db, storeId, orderId, currentStatus, nextStatus, changedAt) {
  return db.prepare(`
    UPDATE orders
    SET status = ?, updated_at = ?,
        ready_at = CASE WHEN ? = 'READY' THEN ? ELSE ready_at END,
        completed_at = CASE WHEN ? = 'COMPLETED' THEN ? ELSE completed_at END,
        cancelled_at = CASE WHEN ? = 'CANCELLED' THEN ? ELSE cancelled_at END
    WHERE store_id = ? AND id = ? AND status = ?
  `).bind(
    nextStatus, changedAt,
    nextStatus, changedAt,
    nextStatus, changedAt,
    nextStatus, changedAt,
    storeId, orderId, currentStatus
  ).run();
}

export async function deleteStoreOrders(db, storeId) {
  await db.prepare('DELETE FROM orders WHERE store_id = ?').bind(storeId).run();
}
