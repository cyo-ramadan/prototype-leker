import {
  ALLOWED_TRANSITIONS,
  MAX_ITEM_QUANTITY,
  MAX_ORDER_ITEMS,
  ORDER_STATUS
} from './constants.js';
import { sanitizeText } from './http.js';
import { getJakartaBusinessDate, isoNow } from './time.js';
import {
  deleteAllOrders,
  getNextOrderSequence,
  getOrder,
  getProductsByIds,
  insertOrder,
  updateOrderStatus as persistOrderStatus
} from './db.js';

export function canTransition(fromStatus, toStatus) {
  return ALLOWED_TRANSITIONS[fromStatus]?.includes(toStatus) ?? false;
}

export function validateRequestedItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ORDER_ITEMS) {
    return { ok: false, error: 'Pesanan harus memiliki item menu yang valid.' };
  }

  const normalized = [];
  for (const item of items) {
    const menuId = Number(item?.menuId);
    const qty = Number(item?.qty);
    if (!Number.isInteger(menuId) || !Number.isInteger(qty) || qty < 1 || qty > MAX_ITEM_QUANTITY) {
      return { ok: false, error: 'Item atau jumlah pesanan tidak valid.' };
    }

    normalized.push({
      menuId,
      qty,
      note: sanitizeText(item?.note, 120)
    });
  }

  return { ok: true, items: normalized };
}

function isOrderNumberConflict(error) {
  const message = String(error?.message ?? error).toLowerCase();
  return message.includes('unique') || message.includes('constraint');
}

export async function createOrder(db, payload) {
  const validation = validateRequestedItems(payload?.items);
  if (!validation.ok) return { ok: false, status: 400, error: validation.error };

  const products = await getProductsByIds(db, validation.items.map(item => item.menuId));
  const productById = new Map(products.map(product => [Number(product.id), product]));

  if (productById.size !== new Set(validation.items.map(item => item.menuId)).size) {
    return { ok: false, status: 400, error: 'Ada menu yang tidak tersedia.' };
  }

  const items = validation.items.map(item => {
    const product = productById.get(item.menuId);
    return {
      id: `item_${crypto.randomUUID()}`,
      menuId: item.menuId,
      name: product.name,
      price: Number(product.price),
      qty: item.qty,
      note: item.note
    };
  });

  const now = isoNow();
  const businessDate = getJakartaBusinessDate();
  const orderBase = {
    id: `ord_${crypto.randomUUID()}`,
    businessDate,
    customerName: sanitizeText(payload?.customerName, 60) || 'Customer',
    tableLabel: sanitizeText(payload?.tableLabel, 40) || 'Kiosk',
    generalNote: sanitizeText(payload?.generalNote, 240),
    total: items.reduce((sum, item) => sum + item.price * item.qty, 0),
    status: ORDER_STATUS.NEW,
    createdAt: now,
    updatedAt: now,
    readyAt: null,
    completedAt: null,
    cancelledAt: null
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sequence = await getNextOrderSequence(db, businessDate);
    const order = {
      ...orderBase,
      orderNo: `LKR-${String(sequence).padStart(3, '0')}`
    };

    try {
      await insertOrder(db, order, items);
      return { ok: true, order: { ...order, items } };
    } catch (error) {
      if (attempt === 2 || !isOrderNumberConflict(error)) throw error;
    }
  }

  return { ok: false, status: 409, error: 'Nomor pesanan bentrok. Silakan coba lagi.' };
}

export async function changeOrderStatus(db, orderId, nextStatus) {
  if (!Object.values(ORDER_STATUS).includes(nextStatus)) {
    return { ok: false, status: 400, error: 'Status tidak valid.' };
  }

  const currentOrder = await getOrder(db, orderId);
  if (!currentOrder) return { ok: false, status: 404, error: 'Order not found' };

  if (!canTransition(currentOrder.status, nextStatus)) {
    return {
      ok: false,
      status: 409,
      error: `Transisi ${currentOrder.status} → ${nextStatus} tidak diizinkan.`
    };
  }

  const changedAt = isoNow();
  const result = await persistOrderStatus(db, orderId, currentOrder.status, nextStatus, changedAt);
  if (!result.success || Number(result.meta?.changes ?? 0) !== 1) {
    return { ok: false, status: 409, error: 'Status order berubah di request lain. Refresh lalu coba lagi.' };
  }

  const updatedOrder = await getOrder(db, orderId);
  return { ok: true, order: updatedOrder };
}

export async function resetOrders(db) {
  await deleteAllOrders(db);
  return { ok: true };
}
