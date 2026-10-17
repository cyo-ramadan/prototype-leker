import { resolveStore } from './stores.js';
import { getTenantPolicyChoice, UI_SKIN_KEY } from './tenant-policy.js';

const parse = value => { try { return JSON.parse(value || '{}') || {}; } catch { return {}; } };
const numeric = value => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const signed = (direction, value) => value == null ? null : direction === 'OUT' ? -value : value;

// Read model only: approval/execution state remains owned by its canonical module.
// Resolve the current tenant choice every time; historical H records do not enable H.
export async function listDrawerPermitHistory(db, storeId, drawerId) {
  const store = await resolveStore(db, storeId, { includeInactive: true });
  if (!store || await getTenantPolicyChoice(db, store.tenantId, UI_SKIN_KEY) !== 'H') return null;
  const [requests, voids, closures, actors, movements] = await Promise.all([
    db.prepare('SELECT r.*, c.employee_name AS cashier_name FROM approval_requests r LEFT JOIN cashiers c ON c.id = r.cashier_id AND c.store_id = r.store_id WHERE r.store_id = ? AND r.drawer_session_id = ?').bind(storeId, drawerId).all(),
    db.prepare('SELECT p.*, c.employee_name AS cashier_name FROM approval_permits p LEFT JOIN cashiers c ON c.id = p.cashier_id AND c.store_id = p.store_id WHERE p.store_id = ? AND p.drawer_session_id = ?').bind(storeId, drawerId).all(),
    db.prepare('SELECT p.*, c.employee_name AS cashier_name, t.employee_name AS target_name FROM drawer_close_permits p LEFT JOIN cashiers c ON c.id = p.requested_by_cashier_id AND c.store_id = p.store_id LEFT JOIN cashiers t ON t.id = p.target_cashier_id AND t.store_id = p.store_id WHERE p.store_id = ? AND p.drawer_session_id = ?').bind(storeId, drawerId).all(),
    db.prepare(`SELECT 'OWNER' AS role, id, display_name AS name FROM owner_accounts
      UNION ALL SELECT 'ENTITY_ADMIN', id, display_name FROM entity_admins WHERE entity_id = ?
      UNION ALL SELECT 'ADMIN', id, display_name FROM store_admins WHERE store_id = ?
      UNION ALL SELECT 'CASHIER_SELF', id, employee_name FROM cashiers WHERE store_id = ?`).bind(store.entityId, storeId, storeId).all(),
    db.prepare(`SELECT source_key, product_name, direction, quantity, unit_symbol FROM stock_movements
      WHERE store_id = ? AND drawer_session_id = ? AND source_type IN ('SALE_VOID', 'PURCHASE_VOID', 'PRODUCTION_VOID')`).bind(storeId, drawerId).all()
  ]);
  const names = new Map((actors.results || []).map(row => [row.role + ':' + row.id, row.name]));
  const actor = (role, id) => !role ? null : ({ role, id: id || '', name: names.get(role + ':' + id) || (role === 'SYSTEM' ? 'Sistem' : role === 'AUTO_PERMIT' ? 'Izin otomatis' : '') });
  const base = (row, source, type, title) => ({
    id: row.id, source, type, title, storeId, drawerSessionId: drawerId,
    requestedBy: { role: 'CASHIER', id: row.cashier_id || row.requested_by_cashier_id, name: row.cashier_name || '' },
    requestedAt: row.requested_at || row.created_at, decisionNote: row.decision_note || '',
    decidedBy: actor(row.approved_by_role || row.decided_by_role, row.approved_by_id || row.decided_by_id),
    decidedAt: row.decided_at || row.approved_at || row.rejected_at || null,
    executedAt: row.executed_at || row.posted_at || null
  });
  const history = (requests.results || []).map(row => {
    const payload = parse(row.payload_json);
    const adjustment = row.request_type === 'GOODS_FLOW' && payload.purpose === 'STOCK_ADJUSTMENT';
    const type = adjustment ? 'STOCK_ADJUSTMENT' : row.request_type;
    const actual = numeric(payload.targetQuantity);
    const recorded = numeric(payload.currentQuantitySnapshot);
    const delta = adjustment ? (actual == null || recorded == null ? null : actual - recorded) : signed(payload.direction, numeric(payload.quantity));
    return {
      ...base(row, 'approval_requests', type, ({ STOCK_ADJUSTMENT: 'Penyesuaian stok', GOODS_FLOW: 'Arus barang', CASH_FLOW: 'Arus uang', ASSET: 'Aset' })[type] || type),
      status: row.approval_status === 'pending_approval' ? 'PENDING' : row.approval_status === 'rejected' ? 'REJECTED' : 'APPROVED',
      executionStatus: row.posting_status === 'posted' ? 'EXECUTED' : row.posting_status === 'blocked' ? 'BLOCKED' : 'NOT_ATTEMPTED',
      executionDetail: row.posting_block_reason || '',
      reason: payload.reason || payload.note || payload.description || '',
      description: payload.description || payload.productName || payload.assetName || '',
      sessionId: payload.sessionId || null,
      amount: numeric(payload.amount),
      cashDelta: row.request_type === 'CASH_FLOW' ? signed(payload.direction, numeric(payload.amount)) : null,
      stockChanges: row.request_type === 'GOODS_FLOW' ? [{ productName: payload.productName || '', unitSymbol: payload.unitSymbol || '', delta,
        recorded: adjustment ? numeric(payload.currentQuantitySnapshot) : null, actual: adjustment ? numeric(payload.targetQuantity) : null }] : []
    };
  });
  for (const row of voids.results || []) {
    const subject = parse(row.subject_snapshot_json);
    const cancelled = row.approval_status === 'rejected' && row.approved_by_role === 'CASHIER_SELF';
    const stockChanges = (movements.results || []).filter(m => ['SALE_VOID:', 'PURCHASE_VOID:', 'PRODUCTION_VOID:'].some(prefix => String(m.source_key || '').startsWith(prefix + row.id + ':')))
      .map(m => ({ productName: m.product_name, unitSymbol: m.unit_symbol || '', delta: signed(m.direction, numeric(m.quantity)), recorded: null, actual: null }));
    history.push({
      ...base(row, 'approval_permits', row.permit_type, 'Pembatalan transaksi'),
      status: cancelled ? 'CANCELLED' : row.approval_status === 'pending_approval' ? 'PENDING' : row.approval_status === 'approved' ? 'APPROVED' : 'REJECTED',
      executionStatus: row.execution_status, executionDetail: row.execution_detail || row.execution_code || '',
      accountingStatus: row.accounting_status,
      reason: row.reason || '', description: subject.description || '',
      subject: { type: row.subject_type, id: row.subject_id, amount: numeric(subject.amount), paymentMethod: subject.paymentMethod || '', createdAt: subject.createdAt || null },
      amount: numeric(subject.amount),
      // A proposed reversal is kept separate from the report's posted money totals.
      cashDelta: subject.paymentMethod === 'CASH' ? signed(row.subject_type === 'SALE' ? 'OUT' : 'IN', numeric(subject.amount))
        : subject.paymentMethod === 'CAMPURAN' && numeric(subject.cashAmount) ? signed('OUT', numeric(subject.cashAmount)) : null,
      stockChanges
    });
  }
  for (const row of closures.results || []) history.push({
    ...base(row, 'drawer_close_permits', 'DRAWER_CLOSE', 'Izin tutup laci'),
    status: row.status, executionStatus: row.status === 'APPROVED' ? 'EXECUTED' : 'NOT_ATTEMPTED',
    executedAt: row.status === 'APPROVED' ? row.decided_at : null,
    reason: row.reason || '', description: row.target_name ? 'Laci ' + row.target_name : '',
    closingAmount: numeric(row.closing_amount), depositAmount: numeric(row.deposit_amount),
    cashDelta: null, stockChanges: []
  });
  return history.sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)) || a.id.localeCompare(b.id));
}
