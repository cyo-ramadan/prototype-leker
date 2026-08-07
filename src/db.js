function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function mapOrderRow(row) {
  return {
    id: row.id,
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

async function loadItemsForOrders(db, orderIds) {
  if (orderIds.length === 0) return new Map();

  const result = await db
    .prepare(`
      SELECT order_id, product_id, product_name, unit_price, quantity, note
      FROM order_items
      WHERE order_id IN (${placeholders(orderIds.length)})
      ORDER BY id ASC
    `)
    .bind(...orderIds)
    .all();

  const grouped = new Map(orderIds.map(orderId => [orderId, []]));
  for (const row of result.results ?? []) {
    grouped.get(row.order_id)?.push(mapOrderItemRow(row));
  }
  return grouped;
}

export async function listProducts(db) {
  const result = await db.prepare(`
    SELECT id, name, price, category, emoji, image_data
    FROM products
    WHERE is_active = 1
    ORDER BY display_order ASC, id ASC
  `).all();

  return (result.results ?? []).map(row => ({
    id: row.id,
    name: row.name,
    price: row.price,
    category: row.category,
    emoji: row.emoji,
    imageData: row.image_data || ''
  }));
}

export async function getProductsByIds(db, productIds) {
  const uniqueIds = [...new Set(productIds)];
  if (uniqueIds.length === 0) return [];

  const result = await db
    .prepare(`
      SELECT id, name, price, category, emoji
      FROM products
      WHERE is_active = 1 AND id IN (${placeholders(uniqueIds.length)})
    `)
    .bind(...uniqueIds)
    .all();

  return result.results ?? [];
}

export async function listOrders(db, limit = 100) {
  const result = await db.prepare(`
    SELECT id, order_no, customer_name, table_label, general_note,
           total_amount, status, created_at, updated_at, ready_at,
           completed_at, cancelled_at
    FROM orders
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(limit).all();

  const orders = (result.results ?? []).map(mapOrderRow);
  const itemsByOrder = await loadItemsForOrders(db, orders.map(order => order.id));
  for (const order of orders) order.items = itemsByOrder.get(order.id) ?? [];
  return orders;
}

export async function getOrder(db, orderId) {
  const row = await db.prepare(`
    SELECT id, order_no, customer_name, table_label, general_note,
           total_amount, status, created_at, updated_at, ready_at,
           completed_at, cancelled_at
    FROM orders
    WHERE id = ?
  `).bind(orderId).first();

  if (!row) return null;
  const order = mapOrderRow(row);
  const itemsByOrder = await loadItemsForOrders(db, [orderId]);
  order.items = itemsByOrder.get(orderId) ?? [];
  return order;
}

export async function getNextOrderSequence(db, businessDate) {
  const row = await db.prepare(`
    SELECT COALESCE(MAX(CAST(SUBSTR(order_no, 5) AS INTEGER)), 0) + 1 AS next_sequence
    FROM orders
    WHERE business_date = ?
  `).bind(businessDate).first();

  return Number(row?.next_sequence ?? 1);
}

export async function insertOrder(db, order, items) {
  const statements = [
    db.prepare(`
      INSERT INTO orders (
        id, business_date, order_no, customer_name, table_label, general_note,
        total_amount, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      order.id,
      order.businessDate,
      order.orderNo,
      order.customerName,
      order.tableLabel,
      order.generalNote,
      order.total,
      order.status,
      order.createdAt,
      order.updatedAt
    ),
    ...items.map(item => db.prepare(`
      INSERT INTO order_items (
        id, order_id, product_id, product_name, unit_price,
        quantity, note, line_total, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      item.id,
      order.id,
      item.menuId,
      item.name,
      item.price,
      item.qty,
      item.note,
      item.price * item.qty,
      order.createdAt
    )),
    db.prepare(`
      INSERT INTO order_status_history (order_id, from_status, to_status, changed_at)
      VALUES (?, NULL, ?, ?)
    `).bind(order.id, order.status, order.createdAt)
  ];

  await db.batch(statements);
}

export async function updateOrderStatus(db, orderId, currentStatus, nextStatus, changedAt) {
  return db.prepare(`
    UPDATE orders
    SET status = ?,
        updated_at = ?,
        ready_at = CASE WHEN ? = 'READY' THEN ? ELSE ready_at END,
        completed_at = CASE WHEN ? = 'COMPLETED' THEN ? ELSE completed_at END,
        cancelled_at = CASE WHEN ? = 'CANCELLED' THEN ? ELSE cancelled_at END
    WHERE id = ? AND status = ?
  `).bind(
    nextStatus,
    changedAt,
    nextStatus,
    changedAt,
    nextStatus,
    changedAt,
    nextStatus,
    changedAt,
    orderId,
    currentStatus
  ).run();
}

export async function deleteAllOrders(db) {
  await db.prepare('DELETE FROM orders').run();
}
