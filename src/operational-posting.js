const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export async function normalizeApprovalPayload(db, storeId, requestType, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Detail pengajuan wajib berupa object.' };
  }

  if (requestType === 'CASH_FLOW') {
    const direction = String(payload.direction || '').toUpperCase();
    const amount = positiveInteger(payload.amount);
    const description = text(payload.description, 220);
    if (!['IN', 'OUT'].includes(direction) || !amount || !description) {
      return { ok: false, error: 'Arus Kas membutuhkan arah, nominal positif, dan deskripsi.' };
    }
    return { ok: true, payload: { direction, amount, description, note: text(payload.note, 500) } };
  }

  if (requestType === 'GOODS_FLOW') {
    const productId = Number(payload.productId);
    const direction = String(payload.direction || '').toUpperCase();
    const quantity = positiveInteger(payload.quantity);
    if (!Number.isInteger(productId) || !['IN', 'OUT'].includes(direction) || !quantity) {
      return { ok: false, error: 'Arus Barang membutuhkan barang, arah, dan qty positif.' };
    }
    const product = await db.prepare(`
      SELECT id, name
      FROM products
      WHERE store_id = ? AND id = ?
      LIMIT 1
    `).bind(storeId, productId).first();
    if (!product) return { ok: false, error: 'Barang pengajuan tidak ditemukan di gerai ini.' };
    return {
      ok: true,
      payload: {
        productId: Number(product.id),
        productName: product.name,
        direction,
        quantity,
        note: text(payload.note, 500)
      }
    };
  }

  if (requestType === 'ASSET') {
    const direction = String(payload.direction || '').toUpperCase();
    const amount = positiveInteger(payload.amount);
    const description = text(payload.description, 220);
    if (!['INCREASE', 'DECREASE'].includes(direction) || !amount || !description) {
      return { ok: false, error: 'Aset membutuhkan arah perubahan, nilai positif, dan deskripsi.' };
    }
    return { ok: true, payload: { direction, amount, description, note: text(payload.note, 500) } };
  }

  return { ok: false, error: 'Jenis pengajuan tidak memiliki posting contract.' };
}

function approvalUpdateStatement(db, request, approverRole, approverId, now, note) {
  return db.prepare(`
    UPDATE approval_requests
    SET approval_status = 'approved', posting_status = 'posted', posting_block_reason = '',
        decision_note = ?, updated_at = ?, approved_at = ?, posted_at = ?,
        approved_by_role = ?, approved_by_id = ?
    WHERE id = ? AND approval_status = 'pending_approval' AND posting_status = 'unposted'
  `).bind(note, now, now, now, approverRole, approverId, request.id);
}

export function buildOperationalPostingStatements(db, request, { approverRole, approverId, now, note = '' }) {
  const payload = request.payload || {};
  const statements = [];

  if (request.requestType === 'CASH_FLOW') {
    statements.push(db.prepare(`
      INSERT INTO cash_ledger_entries (
        id, store_id, drawer_session_id, approval_request_id, direction, amount,
        description, note, posted_at, approved_by_role, approved_by_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `cash_ledger_${crypto.randomUUID()}`, request.storeId, request.drawerSessionId, request.id,
      payload.direction, payload.amount, payload.description, payload.note || '', now, approverRole, approverId
    ));
  } else if (request.requestType === 'GOODS_FLOW') {
    const delta = payload.direction === 'OUT' ? -Number(payload.quantity) : Number(payload.quantity);
    statements.push(
      db.prepare(`
        INSERT INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(store_id, product_id) DO UPDATE SET
          quantity = inventory_stock_balances.quantity + excluded.quantity,
          updated_at = excluded.updated_at
      `).bind(request.storeId, payload.productId, delta, now),
      db.prepare(`
        INSERT INTO inventory_ledger_entries (
          id, store_id, drawer_session_id, approval_request_id, product_id, product_name,
          direction, quantity, note, posted_at, approved_by_role, approved_by_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `inventory_ledger_${crypto.randomUUID()}`, request.storeId, request.drawerSessionId, request.id,
        payload.productId, payload.productName, payload.direction, payload.quantity, payload.note || '',
        now, approverRole, approverId
      )
    );
  } else if (request.requestType === 'ASSET') {
    const delta = payload.direction === 'DECREASE' ? -Number(payload.amount) : Number(payload.amount);
    statements.push(
      db.prepare(`
        INSERT INTO asset_value_balances (store_id, total_amount, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(store_id) DO UPDATE SET
          total_amount = asset_value_balances.total_amount + excluded.total_amount,
          updated_at = excluded.updated_at
      `).bind(request.storeId, delta, now),
      db.prepare(`
        INSERT INTO asset_ledger_entries (
          id, store_id, drawer_session_id, approval_request_id, direction, amount,
          description, note, posted_at, approved_by_role, approved_by_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `asset_ledger_${crypto.randomUUID()}`, request.storeId, request.drawerSessionId, request.id,
        payload.direction, payload.amount, payload.description, payload.note || '', now, approverRole, approverId
      )
    );
  } else {
    throw new Error(`Unsupported operational posting type: ${request.requestType}`);
  }

  statements.push(approvalUpdateStatement(db, request, approverRole, approverId, now, note));
  return statements;
}

export function postingFailureResponse(requestType, error) {
  const message = String(error?.message ?? error).toLowerCase();
  if (message.includes('check constraint')) {
    if (requestType === 'GOODS_FLOW') return { status: 409, error: 'Stok tidak cukup untuk Arus Barang keluar.' };
    if (requestType === 'ASSET') return { status: 409, error: 'Nilai aset tidak cukup untuk pengurangan ini.' };
  }
  if (message.includes('unique') || message.includes('constraint')) {
    return { status: 409, error: 'Pengajuan sudah ter-posting atau terjadi konflik posting.' };
  }
  return null;
}
