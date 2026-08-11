import { ORDER_STATUS } from './constants.js';
import { sanitizeText } from './http.js';
import { getJakartaBusinessDate, isoNow } from './time.js';
import { canTransition, validateRequestedItems } from './orders.js';
import {
  deleteStoreOrders,
  getNextOrderSequence,
  getOrder,
  getProductsByIds,
  insertOrder,
  updateOrderStatus as persistOrderStatus
} from './db-multistore.js';

function isOrderNumberConflict(error) {
  const message = String(error?.message ?? error).toLowerCase();
  return message.includes('unique') || message.includes('constraint');
}

export function buildOrderNo(storeCode, sequence) {
  return `${storeCode}-${String(sequence).padStart(3, '0')}`;
}

export async function createOrder(db, store, payload) {
  const validation = validateRequestedItems(payload?.items);
  if (!validation.ok) return { ok: false, status: 400, error: validation.error };

  const products = await getProductsByIds(db, store.id, validation.items.map(item => item.menuId));
  const productById = new Map(products.map(product => [Number(product.id), product]));
  if (productById.size !== new Set(validation.items.map(item => item.menuId)).size) {
    return { ok: false, status: 400, error: 'Ada menu yang tidak tersedia di gerai ini.' };
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
    storeId: store.id,
    customerId: sanitizeText(payload?.customerId, 120) || null,
    businessDate,
    customerName: sanitizeText(payload?.customerName, 60) || 'Customer',
    tableLabel: '',
    generalNote: sanitizeText(payload?.generalNote, 240),
    total: items.reduce((sum, item) => sum + item.price * item.qty, 0),
    status: ORDER_STATUS.NEW,
    source: 'customer',
    drawerSessionId: null,
    createdAt: now,
    updatedAt: now,
    readyAt: null,
    completedAt: null,
    cancelledAt: null
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sequence = await getNextOrderSequence(db, store.id, businessDate);
    const order = { ...orderBase, orderNo: buildOrderNo(store.code, sequence) };
    try {
      await insertOrder(db, order, items);
      return { ok: true, order: { ...order, items } };
    } catch (error) {
      if (attempt === 2 || !isOrderNumberConflict(error)) throw error;
    }
  }
  return { ok: false, status: 409, error: 'Nomor pesanan bentrok. Silakan coba lagi.' };
}

export async function changeOrderStatus(db, storeId, orderId, nextStatus, drawerSessionId = null) {
  if (!Object.values(ORDER_STATUS).includes(nextStatus)) {
    return { ok: false, status: 400, error: 'Status tidak valid.' };
  }
  const currentOrder = await getOrder(db, storeId, orderId);
  if (!currentOrder) return { ok: false, status: 404, error: 'Order not found' };
  if (!canTransition(currentOrder.status, nextStatus)) {
    return { ok: false, status: 409, error: `Transisi ${currentOrder.status} → ${nextStatus} tidak diizinkan.` };
  }
  const changedAt = isoNow();
  const result = await persistOrderStatus(db, storeId, orderId, currentOrder.status, nextStatus, changedAt, drawerSessionId);
  if (!result.success || Number(result.meta?.changes ?? 0) !== 1) {
    return { ok: false, status: 409, error: 'Status order berubah di request lain. Refresh lalu coba lagi.' };
  }
  return { ok: true, order: await getOrder(db, storeId, orderId) };
}

export async function resetOrders(db, storeId) {
  await deleteStoreOrders(db, storeId);
  return { ok: true };
}
