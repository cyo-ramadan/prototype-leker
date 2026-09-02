import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { requireDrawerOwner } from './cashier-drawer.js';
import { buildTransactionAccountingSnapshot } from './accounting-reference.js';
import { handleCashierOperationalExpenseApi } from './cashier-operational-expense.js';
import { resolvePosPaymentMethod } from './pos-payment-methods.js';

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

export async function storeWarehouseEnabled(db, storeId) {
  const row = await db.prepare(`SELECT warehouse_enabled FROM stores WHERE id = ? LIMIT 1`).bind(storeId).first();
  return row?.warehouse_enabled !== 0;
}

export async function listPurchaseOptions(db, storeId, warehouseEnabled = null) {
  if (warehouseEnabled === null) warehouseEnabled = await storeWarehouseEnabled(db, storeId);
  const warehouseFlag = warehouseEnabled ? 1 : 0;
  let rows;
  try {
    rows = await db.prepare(`
      SELECT p.id, p.name, p.base_unit_id, p.purchase_price, p.average_cost, p.last_purchase_price,
             p.min_purchase_price_scaled, p.max_purchase_price_scaled,
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
        AND COALESCE(t.can_purchase, 1) = 1
        AND (? = 0 OR (p.stock_tracking_enabled = 1 AND COALESCE(t.track_stock, 1) = 1))
      ORDER BY p.name COLLATE NOCASE, p.id
    `).bind(storeId, warehouseFlag).all();
  } catch (error) {
    console.error('canonical purchase option query failed; using Product Master compatibility read', { storeId, error });
    rows = await db.prepare(`
      SELECT p.id, p.name, p.base_unit_id, p.purchase_price, p.average_cost, p.last_purchase_price,
             p.min_purchase_price_scaled, p.max_purchase_price_scaled,
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
    purchasePrice: costFromScaled(row.purchase_price),
    averageCost: costFromScaled(row.average_cost), lastPurchasePrice: costFromScaled(row.last_purchase_price),
    minPurchasePriceScaled: row.min_purchase_price_scaled == null ? null : Number(row.min_purchase_price_scaled),
    maxPurchasePriceScaled: row.max_purchase_price_scaled == null ? null : Number(row.max_purchase_price_scaled)
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
    const outsidePriceRange = (option.minPurchasePriceScaled != null && unitCostScaled < option.minPurchasePriceScaled)
      || (option.maxPurchasePriceScaled != null && unitCostScaled > option.maxPurchasePriceScaled);
    items.push({ ...option, quantity, lineTotal, unitCostScaled, outsidePriceRange });
  }
  return { ok: true, items, totalAmount };
}

export function purchasePriceRangeViolations(items, warningEnabled) {
  if (!warningEnabled) return [];
  return (Array.isArray(items) ? items : []).filter(item => item?.outsidePriceRange === true);
}

export function purchaseItemStatements(db, {
  purchaseId, storeId, drawerId, cashierId, item, now, warehouseEnabled = true
}) {
  const warehouseFlag = warehouseEnabled ? 1 : 0;
  const itemId = `purchase_item_${crypto.randomUUID()}`;
  const movementId = `stock_move_${crypto.randomUUID()}`;
  const statements = [
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
        AND COALESCE(t.can_purchase, 1) = 1
        AND (? = 0 OR (p.stock_tracking_enabled = 1 AND COALESCE(t.track_stock, 1) = 1))
    `).bind(
      itemId, purchaseId, item.quantity, item.lineTotal, item.unitCostScaled,
      item.unitCostScaled, item.lineTotal, item.quantity, item.quantity, now,
      item.productId, storeId, warehouseFlag
    ),
    db.prepare(`
      UPDATE products
      SET average_cost = (SELECT average_cost_after FROM purchase_items WHERE id = ? AND purchase_id = ? AND store_id = ?),
          last_purchase_price = (SELECT unit_cost FROM purchase_items WHERE id = ? AND purchase_id = ? AND store_id = ?),
          cost_updated_at = ?, last_purchase_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(itemId, purchaseId, storeId, itemId, purchaseId, storeId, now, now, item.productId, storeId),
    db.prepare(`
      INSERT INTO product_average_cost_history (
        id, store_id, product_id, previous_average_cost_scaled, new_average_cost_scaled,
        change_reason, reference_type, reference_id, created_at
      )
      SELECT ?, store_id, product_id, average_cost_before, average_cost_after,
             'PURCHASE', 'PURCHASE', purchase_id, ?
      FROM purchase_items
      WHERE id = ? AND purchase_id = ? AND store_id = ?
    `).bind(`product_cost_history_${crypto.randomUUID()}`, now, itemId, purchaseId, storeId),
  ];
  if (!warehouseEnabled) return statements;
  statements.push(
    db.prepare(`INSERT OR IGNORE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, 0, ?)`).bind(storeId, item.productId, now),
    db.prepare(`UPDATE inventory_stock_balances SET quantity = quantity + ?, updated_at = ? WHERE store_id = ? AND product_id = ?`).bind(item.quantity, now, storeId, item.productId),
    db.prepare(`
      INSERT INTO stock_movements (
        id, source_key, store_id, product_id, product_name, unit_id, unit_symbol,
        direction, quantity, source_type, source_id, drawer_session_id, note, actor_role, actor_id, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'IN', ?, 'PURCHASE', ?, ?, ?, 'CASHIER', ?, ?)
    `).bind(movementId, `PURCHASE:${purchaseId}:${item.productId}`, storeId, item.productId, item.productName, item.unitId, item.unitSymbol, item.quantity, purchaseId, drawerId, `Pembelian · biaya baris ${item.lineTotal}`, cashierId, now)
  );
  return statements;
}

export async function buildPurchasePostingPlan(db, {
  id, storeId, drawerId, cashierId, supplierId, description, totalAmount,
  note, paymentMethod, items, warehouseEnabled, now
}) {
  const accounting = await buildTransactionAccountingSnapshot(db, {
    storeId,
    sourceType: 'PURCHASE',
    sourceId: id,
    businessEvent: 'PURCHASE_MATERIAL',
    paymentMethod,
    now
  });
  const statements = [
    db.prepare(`INSERT INTO purchases (id, store_id, drawer_session_id, cashier_id, supplier_id, description, total_amount, note, created_at, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, storeId, drawerId, cashierId, supplierId, description, totalAmount, note, now, paymentMethod),
    accounting.statement
  ];
  for (const item of items) statements.push(...purchaseItemStatements(db, {
    purchaseId: id,
    storeId,
    drawerId,
    cashierId,
    item,
    now,
    warehouseEnabled
  }));
  return { statements, accounting };
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
      const warehouseEnabled = await storeWarehouseEnabled(env.DB, cashier.store.id);
      return json({
        warehouseEnabled,
        priceWarningEnabled: (await env.DB.prepare(`SELECT purchase_price_warning_enabled FROM stores WHERE id = ? LIMIT 1`).bind(cashier.store.id).first())?.purchase_price_warning_enabled === 1,
        products: await listPurchaseOptions(env.DB, cashier.store.id, warehouseEnabled)
      });
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
  const warehouseEnabled = await storeWarehouseEnabled(env.DB, cashier.store.id);
  const options = await listPurchaseOptions(env.DB, cashier.store.id, warehouseEnabled);
  const normalized = normalizeItems(options, body.value?.items);
  if (!normalized.ok) return json({ error: normalized.error }, 400);
  const supplierId = text(body.value?.supplierId, 120) || null;
  const note = text(body.value?.note, 500);
  const resolvedPayment = await resolvePosPaymentMethod(env.DB, cashier.store.id, body.value?.paymentMethod, 'CASH');
  if (!resolvedPayment) return json({ error: 'Cara bayar pembelian tidak aktif / tidak terdaftar.', code: 'PAYMENT_METHOD_NOT_AVAILABLE' }, 400);
  const paymentMethod = resolvedPayment.code;
  if (supplierId) {
    const supplier = await env.DB.prepare(`SELECT id FROM suppliers WHERE id = ? AND store_id = ? AND is_active = 1`).bind(supplierId, cashier.store.id).first();
    if (!supplier) return json({ error: 'Supplier tidak ditemukan di gerai kasir.' }, 400);
  }
  const id = `purchase_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const description = text(body.value?.description, 220) || `Pembelian ${normalized.items.map(item => item.productName).slice(0, 4).join(', ')}`;
  const warning = await env.DB.prepare(`SELECT purchase_price_warning_enabled FROM stores WHERE id = ? LIMIT 1`).bind(cashier.store.id).first();
  const violations = purchasePriceRangeViolations(normalized.items, warning?.purchase_price_warning_enabled === 1);
  if (violations.length) {
    const approvalId = `approval_${crypto.randomUUID()}`;
    const warningSummary = violations.map(item => `${item.productName}: ${costFromScaled(item.unitCostScaled)}`).join(', ');
    const postingItems = normalized.items.map(item => ({
      productId: item.productId,
      productName: item.productName,
      productKindId: item.productKindId,
      productKindCode: item.productKindCode,
      productKindName: item.productKindName,
      unitId: item.unitId,
      unitSymbol: item.unitSymbol,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
      unitCostScaled: item.unitCostScaled
    }));
    const payload = {
      purpose: 'PURCHASE_PRICE_RANGE',
      direction: 'IN',
      productName: `Harga Beli di luar range · ${warningSummary}`,
      quantity: normalized.items.reduce((sum, item) => sum + item.quantity, 0),
      purchase: {
        id, supplierId, description, totalAmount: normalized.totalAmount, note, paymentMethod,
        warehouseEnabled, items: postingItems
      },
      note: `Butuh ACC Admin sebelum Pembelian diposting. ${warningSummary}`
    };
    await env.DB.prepare(`
      INSERT INTO approval_requests (
        id, store_id, drawer_session_id, cashier_id, request_type,
        approval_status, posting_status, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'GOODS_FLOW', 'pending_approval', 'unposted', ?, ?, ?)
    `).bind(approvalId, cashier.store.id, ownership.drawer.id, cashier.id, JSON.stringify(payload), now, now).run();
    return json({
      ok: true,
      pendingApproval: true,
      approvalRequestId: approvalId,
      totalAmount: normalized.totalAmount,
      items: normalized.items,
      createdAt: now,
      message: 'Harga Beli di luar range. Pembelian masuk Approval Queue dan belum diposting.'
    }, 202);
  }
  const plan = await buildPurchasePostingPlan(env.DB, {
    id,
    storeId: cashier.store.id,
    drawerId: ownership.drawer.id,
    cashierId: cashier.id,
    supplierId,
    description,
    totalAmount: normalized.totalAmount,
    note,
    paymentMethod,
    items: normalized.items,
    warehouseEnabled,
    now
  });
  const statements = plan.statements;
  await env.DB.batch(statements);
  return json({
    ok: true, id, businessEvent: 'PURCHASE_MATERIAL', paymentMethod, totalAmount: normalized.totalAmount,
    warehouseEnabled,
    items: normalized.items.map(item => ({ productId: item.productId, productName: item.productName, productKindId: item.productKindId, productKindCode: item.productKindCode, quantity: item.quantity, unitSymbol: item.unitSymbol, lineTotal: item.lineTotal, unitCost: costFromScaled(item.unitCostScaled), unitCostScaled: item.unitCostScaled })),
    accounting: { contract: 'MAXI_ACCOUNTING_REFERENCE_V1', mappingStatus: plan.accounting.status, mappingId: plan.accounting.mappingId, debitAccountRefId: plan.accounting.debitAccountRefId, creditAccountRefId: plan.accounting.creditAccountRefId, journalReference: null },
    createdAt: now
  }, 201);
}
