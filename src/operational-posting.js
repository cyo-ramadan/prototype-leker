import { resolveCashFlowCounterpartOption } from './accounting-cash-flow-bridge.js';

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);

export async function storeWarehouseEnabled(db, storeId) {
  const row = await db.prepare(`SELECT warehouse_enabled FROM stores WHERE id = ? LIMIT 1`).bind(storeId).first();
  return row?.warehouse_enabled !== 0;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

async function stockProductSnapshot(db, storeId, productId, { trackedOnly = false, warehouseEnabled = true } = {}) {
  return db.prepare(`
    SELECT p.id, p.name, p.base_unit_id, p.stock_tracking_enabled, p.average_cost,
           u.symbol AS unit_symbol,
           COALESCE(b.quantity, 0) AS current_quantity
    FROM products p
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN inventory_stock_balances b ON b.store_id = p.store_id AND b.product_id = p.id
    WHERE p.store_id = ? AND p.id = ?
      AND (? = 0 OR p.stock_tracking_enabled = 1)
    LIMIT 1
  `).bind(storeId, productId, trackedOnly && warehouseEnabled ? 1 : 0).first();
}

export async function listStockAdjustmentOptions(db, storeId) {
  const warehouseFlag = await storeWarehouseEnabled(db, storeId) ? 1 : 0;
  const rows = await db.prepare(`
    SELECT p.id, p.name, p.base_unit_id,
           u.symbol AS unit_symbol,
           COALESCE(b.quantity, 0) AS current_quantity
    FROM products p
    JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN inventory_stock_balances b ON b.store_id = p.store_id AND b.product_id = p.id
    WHERE p.store_id = ?
      AND p.is_active = 1
      AND (? = 0 OR p.stock_tracking_enabled = 1)
    ORDER BY p.name COLLATE NOCASE, p.id
  `).bind(storeId, warehouseFlag).all();
  return (rows.results || []).map(row => ({
    productId: Number(row.id),
    productName: row.name,
    unitId: row.base_unit_id,
    unitSymbol: row.unit_symbol || '',
    currentQuantity: Number(row.current_quantity || 0)
  }));
}

export async function normalizeApprovalPayload(db, storeId, requestType, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'Detail pengajuan wajib berupa object.' };

  if (requestType === 'CASH_FLOW') {
    const direction = String(payload.direction || '').toUpperCase();
    const amount = positiveInteger(payload.amount);
    const description = text(payload.description, 220);
    if (!['IN', 'OUT'].includes(direction) || !amount || !description) return { ok: false, error: 'Arus Kas membutuhkan arah, nominal positif, dan deskripsi.' };
    const counterpart = await resolveCashFlowCounterpartOption(db, storeId, direction, payload.accountingCounterpartRuleId);
    if (!counterpart) return { ok: false, error: 'Pilih akun lawan Arus Kas yang aktif dan sesuai arah dari Setting Akuntansi.' };
    return {
      ok: true,
      payload: {
        direction, amount, description, note: text(payload.note, 500),
        accountingCounterpartRuleId: counterpart.journalRuleId,
        accountingCounterpartLabel: counterpart.label,
        accountingCounterpartAccountCode: counterpart.accountCode,
        accountingCounterpartAccountName: counterpart.accountName
      }
    };
  }

  if (requestType === 'GOODS_FLOW') {
    const warehouseEnabled = await storeWarehouseEnabled(db, storeId);
    const productId = Number(payload.productId);
    if (!Number.isInteger(productId)) return { ok: false, error: 'Arus Barang membutuhkan barang yang valid.' };

    if (String(payload.purpose || '').toUpperCase() === 'STOCK_ADJUSTMENT') {
      const targetQuantity = nonNegativeInteger(payload.targetQuantity);
      const reason = text(payload.reason, 220);
      if (targetQuantity === null) {
        return { ok: false, error: 'Penyesuaian Stok membutuhkan target qty non-negatif.' };
      }
      const product = await stockProductSnapshot(db, storeId, productId, { trackedOnly: true, warehouseEnabled });
      if (!product || !product.base_unit_id) {
        return { ok: false, error: 'Barang Penyesuaian Stok harus aktif dalam stock tracking dan memiliki satuan dasar.' };
      }
      const currentQuantitySnapshot = Number(product.current_quantity || 0);
      if (!Number.isSafeInteger(currentQuantitySnapshot) || currentQuantitySnapshot < 0) {
        return { ok: false, error: 'Saldo stok saat ini tidak valid untuk Penyesuaian Stok.' };
      }
      if (targetQuantity === currentQuantitySnapshot) {
        return { ok: false, error: 'Target qty sama dengan stok saat ini; tidak ada penyesuaian yang perlu diajukan.' };
      }
      const direction = targetQuantity > currentQuantitySnapshot ? 'IN' : 'OUT';
      const quantity = Math.abs(targetQuantity - currentQuantitySnapshot);
      const unitCostSnapshotScaled = Number(product.average_cost);
      const totalCostSnapshotScaled = unitCostSnapshotScaled * quantity;
      if (
        !Number.isSafeInteger(unitCostSnapshotScaled)
        || unitCostSnapshotScaled < 0
        || !Number.isSafeInteger(totalCostSnapshotScaled)
      ) {
        return { ok: false, error: 'HPP barang tidak valid atau melampaui batas integer aman untuk Penyesuaian Stok.' };
      }
      return {
        ok: true,
        payload: {
          purpose: 'STOCK_ADJUSTMENT',
          productId: Number(product.id),
          productName: product.name,
          unitId: product.base_unit_id,
          unitSymbol: product.unit_symbol || '',
          currentQuantitySnapshot,
          targetQuantity,
          direction,
          quantity,
          unitCostSnapshotScaled,
          totalCostSnapshotScaled,
          ...(!warehouseEnabled ? { warehouseEnabled: false } : {}),
          reason,
          note: text(payload.note, 500)
        }
      };
    }

    const direction = String(payload.direction || '').toUpperCase();
    const quantity = positiveInteger(payload.quantity);
    if (!['IN', 'OUT'].includes(direction) || !quantity) return { ok: false, error: 'Arus Barang membutuhkan barang, arah, dan qty bulat positif.' };
    const product = await stockProductSnapshot(db, storeId, productId);
    if (!product || !product.base_unit_id) return { ok: false, error: 'Barang pengajuan atau satuan dasarnya tidak ditemukan di gerai ini.' };
    return {
      ok: true,
      payload: {
        productId: Number(product.id),
        productName: product.name,
        unitId: product.base_unit_id,
        unitSymbol: product.unit_symbol || '',
        direction,
        quantity,
        ...(!warehouseEnabled ? { warehouseEnabled: false } : {}),
        note: text(payload.note, 500)
      }
    };
  }

  if (requestType === 'ASSET') {
    const direction = String(payload.direction || '').toUpperCase();
    const amount = positiveInteger(payload.amount);
    const description = text(payload.description, 220);
    if (!['INCREASE', 'DECREASE'].includes(direction) || !amount || !description) return { ok: false, error: 'Aset membutuhkan arah perubahan, nilai positif, dan deskripsi.' };
    return { ok: true, payload: { direction, amount, description, note: text(payload.note, 500) } };
  }

  return { ok: false, error: 'Jenis pengajuan tidak memiliki posting contract.' };
}

function approvalUpdateStatement(db, request, approverRole, approverId, now, note) {
  return db.prepare(`
    UPDATE approval_requests
    SET approval_status = 'approved', posting_status = 'posted', posting_block_reason = '',
        decision_note = ?, updated_at = ?, approved_at = ?, posted_at = ?, approved_by_role = ?, approved_by_id = ?
    WHERE id = ? AND approval_status = 'pending_approval' AND posting_status = 'unposted'
  `).bind(note, now, now, now, approverRole, approverId, request.id);
}

export function buildOperationalPostingStatements(db, request, { approverRole, approverId, now, note = '' }) {
  const payload = request.payload || {};
  const statements = [];

  if (request.requestType === 'CASH_FLOW') {
    statements.push(db.prepare(`
      INSERT INTO cash_ledger_entries (id, store_id, drawer_session_id, approval_request_id, direction, amount, description, note, posted_at, approved_by_role, approved_by_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(`cash_ledger_${crypto.randomUUID()}`, request.storeId, request.drawerSessionId, request.id, payload.direction, payload.amount, payload.description, payload.note || '', now, approverRole, approverId));
  } else if (request.requestType === 'GOODS_FLOW') {
    const isStockAdjustment = payload.purpose === 'STOCK_ADJUSTMENT';
    const delta = payload.direction === 'OUT' ? -Number(payload.quantity) : Number(payload.quantity);
    const movementSourceType = isStockAdjustment ? 'STOCK_ADJUSTMENT' : 'GOODS_FLOW';
    const adjustmentNotes = [payload.reason, payload.note].map(value => text(value, 500)).filter(Boolean);
    const movementNote = isStockAdjustment
      ? `Penyesuaian Stok ${payload.currentQuantitySnapshot} -> ${payload.targetQuantity} ${payload.unitSymbol || ''}${adjustmentNotes.length ? ` · ${adjustmentNotes.join(' · ')}` : ''}`.slice(0, 500)
      : payload.note || '';
    if (payload.warehouseEnabled !== false) {
      statements.push(
        db.prepare(`INSERT OR IGNORE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, 0, ?)`).bind(request.storeId, payload.productId, now),
        db.prepare(`UPDATE inventory_stock_balances SET quantity = quantity + ?, updated_at = ? WHERE store_id = ? AND product_id = ?`).bind(delta, now, request.storeId, payload.productId),
        db.prepare(`
          INSERT INTO inventory_ledger_entries (id, store_id, drawer_session_id, approval_request_id, product_id, product_name, direction, quantity, note, posted_at, approved_by_role, approved_by_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(`inventory_ledger_${crypto.randomUUID()}`, request.storeId, request.drawerSessionId, request.id, payload.productId, payload.productName, payload.direction, payload.quantity, movementNote, now, approverRole, approverId),
        db.prepare(`
          INSERT INTO stock_movements (
            id, source_key, store_id, product_id, product_name, unit_id, unit_symbol,
            direction, quantity, source_type, source_id, drawer_session_id, note,
            actor_role, actor_id, occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          `stock_move_${crypto.randomUUID()}`, `${movementSourceType}:${request.id}`,
          request.storeId, payload.productId, payload.productName, payload.unitId, payload.unitSymbol || '',
          payload.direction, payload.quantity, movementSourceType, request.id, request.drawerSessionId, movementNote,
          approverRole, approverId, now
        )
      );
    }
  } else if (request.requestType === 'ASSET') {
    const delta = payload.direction === 'DECREASE' ? -Number(payload.amount) : Number(payload.amount);
    statements.push(
      db.prepare(`INSERT OR IGNORE INTO asset_value_balances (store_id, total_amount, updated_at) VALUES (?, 0, ?)`).bind(request.storeId, now),
      db.prepare(`UPDATE asset_value_balances SET total_amount = total_amount + ?, updated_at = ? WHERE store_id = ?`).bind(delta, now, request.storeId),
      db.prepare(`
        INSERT INTO asset_ledger_entries (id, store_id, drawer_session_id, approval_request_id, direction, amount, description, note, posted_at, approved_by_role, approved_by_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(`asset_ledger_${crypto.randomUUID()}`, request.storeId, request.drawerSessionId, request.id, payload.direction, payload.amount, payload.description, payload.note || '', now, approverRole, approverId)
    );
  } else {
    throw new Error(`Unsupported operational posting type: ${request.requestType}`);
  }

  statements.push(approvalUpdateStatement(db, request, approverRole, approverId, now, note));
  return statements;
}

export function postingFailureResponse(requestType, error) {
  const message = String(error?.message ?? error).toLowerCase();
  if (message.includes('approval_not_pending')) return { status: 409, error: 'Pengajuan sudah diputuskan oleh request lain.' };
  if (message.includes('check constraint')) {
    if (requestType === 'GOODS_FLOW') return { status: 409, error: 'Stok tidak cukup untuk Arus Barang / Penyesuaian Stok keluar.' };
    if (requestType === 'ASSET') return { status: 409, error: 'Nilai aset tidak cukup untuk pengurangan ini.' };
  }
  if (message.includes('unique') || message.includes('constraint')) return { status: 409, error: 'Pengajuan sudah ter-posting atau terjadi konflik posting.' };
  return null;
}
