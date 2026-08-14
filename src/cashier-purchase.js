import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { requireDrawerOwner } from './cashier-drawer.js';
import { buildTransactionAccountingSnapshot } from './accounting-reference.js';
import { handleCashierOperationalExpenseApi } from './cashier-operational-expense.js';
import { resolvePosPaymentMethod } from './accounting-pos-bridge.js';

const COST_SCALE = 1_000_000;
const MAX_LINE_TOTAL = 9_000_000_000;
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);

function money(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= MAX_LINE_TOTAL ? number : null;
}
function positiveInteger(value, max = 1_000_000_000) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= max ? number : null;
}
function scaledUnitCost(lineTotal, quantity) {
  const numerator = lineTotal * COST_SCALE;
  if (!Number.isSafeInteger(numerator)) return null;
  return Math.floor((numerator + Math.floor(quantity / 2)) / quantity);
}
function costFromScaled(value) { return Number(value || 0) / COST_SCALE; }

async function listPurchaseOptions(db, storeId) {
  let rows;
  try {
    rows = await db.prepare(`
      SELECT p.id, p.name, p.base_unit_id, p.average_cost, p.last_purchase_price,
             p.product_kind_id, p.stock_tracking_enabled,
             u.symbol AS unit_symbol,
             k.code AS product_kind_code, k.name AS product_kind_name,
             COALESCE(t.can_purchase, 1) AS can_purchase,
             COALESCE(t.track_stock, 1) AS type_track_stock
      FROM products p
      LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
      LEFT JOIN product_kinds k ON k.id = p.product_kind_id AND k.store_id = p.store_id
      JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
      WHERE p.store_id = ? AND p.is_active = 1
        AND p.stock_tracking_enabled = 1
        AND COALESCE(t.can_purchase, 1) = 1
        AND COALESCE(t.track_stock, 1) = 1
      ORDER BY p.name COLLATE NOCASE, p.id
    `).bind(storeId).all();
  } catch (error) {
    console.error('canonical purchase option query failed; using Product Master compatibility read', { storeId, error });
    rows = await db.prepare(`
      SELECT p.id, p.name, p.base_unit_id, p.average_cost, p.last_purchase_price,
             p.product_kind_id, 1 AS stock_tracking_enabled,
             u.symbol AS unit_symbol,
             COALESCE(k.code, '') AS product_kind_code,
             COALESCE(k.name, '') AS product_kind_name,
             1 AS can_purchase, 1 AS type_track_stock
      FROM products p
      JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
      LEFT JOIN product_kinds k ON k.id = p.product_kind_id AND k.store_id = p.store_id
      WHERE p.store_id = ? AND p.is_active = 1
      ORDER BY p.name COLLATE NOCASE, p.id
    `).bind(storeId).all();
  }
  return (rows.results ?? []).map(row => ({
    productId: Number(row.id), productName: row.name, unitId: row.base_unit_id,
    unitSymbol: row.unit_symbol || '', productKindId: row.product_kind_id || null,
    productKindCode: row.product_kind_code || '', productKindName: row.product_kind_name || '',
    averageCost: costFromScaled(row.average_cost), lastPurchasePrice: costFromScaled(row.last_purchase_price)
  }));
}

function normalizeItems(options, requested) {
  if (!Array.isArray(requested) || !requested.length || requested.length > 50) return { ok: false, error: 'Pembelian wajib memiliki 1–50 baris barang.' };
  const byId = new Map(options.map(item => [item.productId, item]));
  const seen = new Set();
  const items = [];
  let totalAmount = 0;
  for (const raw of requested) {
    const productId = Number(raw?.productId);
    const quantity = positiveInteger(raw?.quantity);
    const lineTotal = money(raw?.lineTotal);
    const option = byId.get(productId);
    if (!option || !quantity || lineTotal === null || lineTotal <= 0 || seen.has(productId)) return { ok: false, error: 'Barang, qty, atau total baris pembelian tidak valid / duplikat.' };
    const unitCostScaled = scaledUnitCost(lineTotal, quantity);
    if (unitCostScaled === null) return { ok: false, error: 'Nilai biaya per unit terlalu besar untuk skala HPP.' };
    if (!Number.isSafeInteger(totalAmount + lineTotal)) return { ok: false, error: 'Total pembelian terlalu besar.' };
    seen.add(productId);
    totalAmount += lineTotal;
    items.push({ ...option, quantity, lineTotal, unitCostScaled });
  }
  return { ok: true, items, totalAmount };
}

function purchaseItemStatements(db, { purchaseId, storeId, drawerId, cashierId, item, now }) {
  const itemId = `purchase_item_${crypto.randomUUID()}`;
  const movementId = `stock_move_${crypto.randomUUID()}`;
  return [
    db.prepare(`
      INSERT INTO purchase_items (
        id, purchase_id, store_id, product_id, product_name,
        product_kind_id, product_kind_code, product_kind_name,
        unit_id, unit_symbol, quantity, line_total, unit_cost,
        average_cost_before, average_cost_after, created_at
      )
      SELECT ?, ?, p.store_id, p.id, p.name,
        p.product_kind_id, COALESCE(k.code, ''), COALESCE(k.name, ''),
        p.base_unit_id, u.symbol, ?, ?, ?, p.average_cost,
        CASE WHEN COALESCE(b.quantity, 0) <= 0 THEN ? ELSE CAST(((COALESCE(b.quantity, 0) * p.average_cost) + (? * 1000000) + CAST((COALESCE(b.quantity, 0) + ?) / 2 AS INTEGER)) / (COALESCE(b.quantity, 0) + ?) AS INTEGER) END,
        ?
      FROM products p
      JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
      LEFT JOIN product_kinds k ON k.id = p.product_kind_id AND k.store_id = p.store_id
      LEFT JOIN inventory_stock_balances b ON b.store_id = p.store_id AND b.product_id = p.id
      LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
      WHERE p.id = ? AND p.store_id = ? AND p.is_active = 1
        AND p.stock_tracking_enabled = 1 AND COALESCE(t.can_purchase, 1) = 1 AND COALESCE(t.track_stock, 1) = 1
    `).bind(itemId, purchaseId, item.quantity, item.lineTotal, item.unitCostScaled, item.unitCostScaled, item.lineTotal, item.quantity, item.quantity, now, item.productId, storeId),
    db.prepare(`
      UPDATE products
      SET average_cost = (SELECT average_cost_after FROM purchase_items WHERE id = ? AND purchase_id = ? AND store_id = ?),
          last_purchase_price = (SELECT unit_cost FROM purchase_items WHERE id = ? AND purchase_id = ? AND store_id = ?),
          purchase_price = CAST(((SELECT unit_cost FROM purchase_items WHERE id = ? AND purchase_id = ? AND store_id = ?) + 500000) / 1000000 AS INTEGER),
          cost_updated_at = ?, last_purchase_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(itemId, purchaseId, storeId, itemId, purchaseId, storeId, itemId, purchaseId, storeId, now, now, item.productId, storeId),
    db.prepare(`INSERT OR IGNORE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, 0, ?)`).bind(storeId, item.productId, now),
    db.prepare(`UPDATE inventory_stock_balances SET quantity = quantity + ?, updated_at = ? WHERE store_id = ? AND product_id = ?`).bind(item.quantity, now, storeId, item.productId),
    db.prepare(`
      INSERT INTO stock_movements (
        id, source_key, store_id, product_id, product_name, unit_id, unit_symbol,
        direction, quantity, source_type, source_id, drawer_session_id, note, actor_role, actor_id, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'IN', ?, 'PURCHASE', ?, ?, ?, 'CASHIER', ?, ?)
    `).bind(movementId, `PURCHASE:${purchaseId}:${item.productId}`, storeId, item.productId, item.productName, item.unitId, item.unitSymbol, item.quantity, purchaseId, drawerId, `Pembelian · biaya baris ${item.lineTotal}`, cashierId, now)
  ];
}

export async function handleCashierPurchaseApi(request, env, pathname) {
  const operationalExpenseResponse = await handleCashierOperationalExpenseApi(request, env, pathname);
  if (operationalExpenseResponse) return operationalExpenseResponse;
  if (!pathname.startsWith('/api/cashier/purchases')) return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const cashier = auth.cashier;
  if (request.method === 'GET' && pathname === '/api/cashier/purchases/options') {
    try {
      return json({ products: await listPurchaseOptions(env.DB, cashier.store.id) });
    } catch (error) {
      console.error('cashier purchase options failed', { storeId: cashier.store.id, error });
      return json({ error: 'Master Barang pembelian gagal dimuat.', code: 'PURCHASE_OPTIONS_UNAVAILABLE' }, 500);
    }
  }
  if (request.method !== 'POST' || pathname !== '/api/cashier/purchases') return null;
  const ownership = await requireDrawerOwner(env.DB, cashier);
  if (!ownership.ok) return ownership.response;
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload pembelian tidak valid.' }, 400);
  const options = await listPurchaseOptions(env.DB, cashier.store.id);
  const normalized = normalizeItems(options, body.value?.items);
  if (!normalized.ok) return json({ error: normalized.error }, 400);
  const supplierId = text(body.value?.supplierId, 120) || null;
  const note = text(body.value?.note, 500);
  const resolvedPayment = await resolvePosPaymentMethod(env.DB, cashier.store.id, body.value?.paymentMethod, 'CASH');
  if (!resolvedPayment) return json({ error: 'Cara bayar pembelian tidak aktif / tidak tersedia di Setting Akuntansi.', code: 'PAYMENT_METHOD_NOT_AVAILABLE' }, 400);
  const paymentMethod = resolvedPayment.code;
  if (supplierId) {
    const supplier = await env.DB.prepare(`SELECT id FROM suppliers WHERE id = ? AND store_id = ? AND is_active = 1`).bind(supplierId, cashier.store.id).first();
    if (!supplier) return json({ error: 'Supplier tidak ditemukan di gerai kasir.' }, 400);
  }
  const id = `purchase_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const description = text(body.value?.description, 220) || `Pembelian ${normalized.items.map(item => item.productName).slice(0, 4).join(', ')}`;
  const accounting = await buildTransactionAccountingSnapshot(env.DB, { storeId: cashier.store.id, sourceType: 'PURCHASE', sourceId: id, businessEvent: 'PURCHASE_MATERIAL', paymentMethod, now });
  const statements = [
    env.DB.prepare(`INSERT INTO purchases (id, store_id, drawer_session_id, cashier_id, supplier_id, description, total_amount, note, created_at, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, cashier.store.id, ownership.drawer.id, cashier.id, supplierId, description, normalized.totalAmount, note, now, paymentMethod),
    accounting.statement
  ];
  for (const item of normalized.items) statements.push(...purchaseItemStatements(env.DB, { purchaseId: id, storeId: cashier.store.id, drawerId: ownership.drawer.id, cashierId: cashier.id, item, now }));
  await env.DB.batch(statements);
  return json({
    ok: true, id, businessEvent: 'PURCHASE_MATERIAL', paymentMethod, totalAmount: normalized.totalAmount,
    items: normalized.items.map(item => ({ productId: item.productId, productName: item.productName, productKindId: item.productKindId, productKindCode: item.productKindCode, quantity: item.quantity, unitSymbol: item.unitSymbol, lineTotal: item.lineTotal, unitCost: costFromScaled(item.unitCostScaled), unitCostScaled: item.unitCostScaled })),
    accounting: { contract: 'MAXI_ACCOUNTING_REFERENCE_V1', mappingStatus: accounting.status, mappingId: accounting.mappingId, debitAccountRefId: accounting.debitAccountRefId, creditAccountRefId: accounting.creditAccountRefId, journalReference: null },
    createdAt: now
  }, 201);
}
