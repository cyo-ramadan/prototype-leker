import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { requireDrawerOwner } from './cashier-drawer.js';
import { requireManagement } from './owner-auth.js';
import { resolveStore } from './stores.js';

export const TRANSACTION_VOID_PERMIT_CONTRACT = 'MAXI_TRANSACTION_VOID_PERMIT_V1';
const SUBJECT_TYPES = new Set(['SALE', 'PURCHASE', 'EXPENSE']);
const APPROVAL_STATUSES = new Set(['pending_approval', 'approved', 'rejected']);
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);

function parseSnapshot(value) { try { return JSON.parse(value || '{}'); } catch { return {}; } }
function permitDto(row) {
  return {
    id: row.id, storeId: row.store_id, drawerSessionId: row.drawer_session_id,
    cashierId: row.cashier_id, cashierName: row.cashier_name || '', permitType: row.permit_type,
    subjectType: row.subject_type, subjectId: row.subject_id, subject: parseSnapshot(row.subject_snapshot_json),
    reason: row.reason, approvalStatus: row.approval_status, executionStatus: row.execution_status,
    executionCode: row.execution_code || '', executionDetail: row.execution_detail || '',
    decisionNote: row.decision_note || '', approvedByRole: row.approved_by_role || null,
    approvedById: row.approved_by_id || null, requestedAt: row.requested_at, updatedAt: row.updated_at,
    decidedAt: row.decided_at || null, executedAt: row.executed_at || null
  };
}

async function getPermit(db, id) {
  const row = await db.prepare(`SELECT p.*, c.employee_name AS cashier_name FROM approval_permits p JOIN cashiers c ON c.id = p.cashier_id WHERE p.id = ? LIMIT 1`).bind(id).first();
  return row ? permitDto(row) : null;
}

async function listPermits(db, { storeId = null, cashierId = null, drawerId = null, status = null, limit = 200 } = {}) {
  const conditions = [`p.permit_type = 'TRANSACTION_VOID'`];
  const values = [];
  if (storeId) { conditions.push('p.store_id = ?'); values.push(storeId); }
  if (cashierId) { conditions.push('p.cashier_id = ?'); values.push(cashierId); }
  if (drawerId) { conditions.push('p.drawer_session_id = ?'); values.push(drawerId); }
  if (status) { conditions.push('p.approval_status = ?'); values.push(status); }
  values.push(Math.max(1, Math.min(500, Number(limit) || 200)));
  const rows = await db.prepare(`
    SELECT p.*, c.employee_name AS cashier_name
    FROM approval_permits p JOIN cashiers c ON c.id = p.cashier_id
    WHERE ${conditions.join(' AND ')} ORDER BY p.requested_at DESC, p.id DESC LIMIT ?
  `).bind(...values).all();
  return (rows.results || []).map(permitDto);
}

async function transactionSubject(db, storeId, drawerId, cashierId, subjectType, subjectId) {
  if (subjectType === 'SALE') {
    const row = await db.prepare(`SELECT id, customer_name, total_amount, payment_method, note, created_at, order_id FROM sales WHERE id = ? AND store_id = ? AND drawer_session_id = ? AND cashier_id = ? LIMIT 1`).bind(subjectId, storeId, drawerId, cashierId).first();
    return row ? { subjectType: 'SALE', subjectId: row.id, amount: Number(row.total_amount || 0), description: row.customer_name ? `Penjualan · ${row.customer_name}` : 'Penjualan', paymentMethod: row.payment_method || 'CASH', note: row.note || '', orderId: row.order_id || null, createdAt: row.created_at } : null;
  }
  if (subjectType === 'PURCHASE') {
    const row = await db.prepare(`SELECT id, description, total_amount, payment_method, note, supplier_id, created_at FROM purchases WHERE id = ? AND store_id = ? AND drawer_session_id = ? AND cashier_id = ? LIMIT 1`).bind(subjectId, storeId, drawerId, cashierId).first();
    return row ? { subjectType: 'PURCHASE', subjectId: row.id, amount: Number(row.total_amount || 0), description: row.description || 'Pembelian Bahan', paymentMethod: row.payment_method || 'CASH', note: row.note || '', supplierId: row.supplier_id || null, createdAt: row.created_at } : null;
  }
  if (subjectType === 'EXPENSE') {
    const row = await db.prepare(`SELECT id, description, amount, quantity, payment_method, created_at FROM expenses WHERE id = ? AND store_id = ? AND drawer_session_id = ? AND cashier_id = ? LIMIT 1`).bind(subjectId, storeId, drawerId, cashierId).first();
    return row ? { subjectType: 'EXPENSE', subjectId: row.id, amount: Number(row.amount || 0), description: row.description || 'Pengeluaran Operasional', quantity: row.quantity || '1', paymentMethod: row.payment_method || 'CASH', createdAt: row.created_at } : null;
  }
  return null;
}

async function listCandidates(db, storeId, drawerId, cashierId) {
  const [sales, purchases, expenses, permits] = await Promise.all([
    db.prepare(`SELECT id, customer_name AS description, total_amount AS amount, payment_method, created_at FROM sales WHERE store_id = ? AND drawer_session_id = ? AND cashier_id = ? ORDER BY created_at DESC LIMIT 80`).bind(storeId, drawerId, cashierId).all(),
    db.prepare(`SELECT id, description, total_amount AS amount, payment_method, created_at FROM purchases WHERE store_id = ? AND drawer_session_id = ? AND cashier_id = ? ORDER BY created_at DESC LIMIT 80`).bind(storeId, drawerId, cashierId).all(),
    db.prepare(`SELECT id, description, amount, payment_method, created_at FROM expenses WHERE store_id = ? AND drawer_session_id = ? AND cashier_id = ? ORDER BY created_at DESC LIMIT 80`).bind(storeId, drawerId, cashierId).all(),
    db.prepare(`SELECT subject_type, subject_id, approval_status, execution_status, execution_code, requested_at FROM approval_permits WHERE store_id = ? AND drawer_session_id = ? AND cashier_id = ? AND permit_type = 'TRANSACTION_VOID' ORDER BY requested_at DESC`).bind(storeId, drawerId, cashierId).all()
  ]);
  const latest = new Map();
  for (const row of permits.results || []) { const key = `${row.subject_type}:${row.subject_id}`; if (!latest.has(key)) latest.set(key, row); }
  const rows = [
    ...(sales.results || []).map(row => ({ subjectType: 'SALE', subjectId: row.id, description: row.description ? `Penjualan · ${row.description}` : 'Penjualan', amount: Number(row.amount || 0), paymentMethod: row.payment_method || 'CASH', createdAt: row.created_at })),
    ...(purchases.results || []).map(row => ({ subjectType: 'PURCHASE', subjectId: row.id, description: row.description || 'Pembelian Bahan', amount: Number(row.amount || 0), paymentMethod: row.payment_method || 'CASH', createdAt: row.created_at })),
    ...(expenses.results || []).map(row => ({ subjectType: 'EXPENSE', subjectId: row.id, description: row.description || 'Pengeluaran Operasional', amount: Number(row.amount || 0), paymentMethod: row.payment_method || 'CASH', createdAt: row.created_at }))
  ];
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 150).map(row => {
    const permit = latest.get(`${row.subjectType}:${row.subjectId}`);
    return { ...row, permit: permit ? { approvalStatus: permit.approval_status, executionStatus: permit.execution_status, executionCode: permit.execution_code || '', requestedAt: permit.requested_at } : null };
  });
}

async function existingOpenPermit(db, storeId, subjectType, subjectId) {
  return db.prepare(`SELECT id, approval_status, execution_status FROM approval_permits WHERE store_id = ? AND permit_type = 'TRANSACTION_VOID' AND subject_type = ? AND subject_id = ? AND (approval_status = 'pending_approval' OR (approval_status = 'approved' AND execution_status <> 'EXECUTED')) ORDER BY requested_at DESC LIMIT 1`).bind(storeId, subjectType, subjectId).first();
}

async function handleCashier(request, env, pathname) {
  if (!pathname.startsWith('/api/cashier/transaction-void')) return null;
  const auth = await requireCashier(request, env.DB); if (!auth.ok) return auth.response;
  const drawer = await requireDrawerOwner(env.DB, auth.cashier); if (!drawer.ok) return drawer.response;
  if (request.method === 'GET' && pathname === '/api/cashier/transaction-void/candidates') return json({ contract: TRANSACTION_VOID_PERMIT_CONTRACT, candidates: await listCandidates(env.DB, auth.cashier.store.id, drawer.drawer.id, auth.cashier.id) });
  if (request.method === 'GET' && pathname === '/api/cashier/transaction-void/permits') return json({ permits: await listPermits(env.DB, { storeId: auth.cashier.store.id, cashierId: auth.cashier.id }) });
  if (request.method === 'POST' && pathname === '/api/cashier/transaction-void/permits') {
    const body = await readJson(request); if (!body.ok) return json({ error: 'Payload permit hapus tidak valid.' }, 400);
    const subjectType = text(body.value?.subjectType, 20).toUpperCase(); const subjectId = text(body.value?.subjectId, 180); const reason = text(body.value?.reason, 500);
    if (!SUBJECT_TYPES.has(subjectType) || !subjectId || !reason) return json({ error: 'Jenis transaksi, ID transaksi, dan alasan wajib valid.' }, 400);
    const subject = await transactionSubject(env.DB, auth.cashier.store.id, drawer.drawer.id, auth.cashier.id, subjectType, subjectId);
    if (!subject) return json({ error: 'Transaksi tidak ditemukan pada laci aktif milik kasir ini.' }, 404);
    const existing = await existingOpenPermit(env.DB, auth.cashier.store.id, subjectType, subjectId);
    if (existing) return json({ error: existing.approval_status === 'pending_approval' ? 'Permit hapus transaksi ini masih menunggu Admin.' : 'Permit sudah di-ACC tetapi eksekusi reversal masih belum selesai.', code: 'VOID_PERMIT_ALREADY_OPEN' }, 409);
    const id = `permit_${crypto.randomUUID()}`; const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO approval_permits (id, store_id, drawer_session_id, cashier_id, permit_type, subject_type, subject_id, subject_snapshot_json, reason, approval_status, execution_status, requested_at, updated_at) VALUES (?, ?, ?, ?, 'TRANSACTION_VOID', ?, ?, ?, ?, 'pending_approval', 'NOT_ATTEMPTED', ?, ?)`).bind(id, auth.cashier.store.id, drawer.drawer.id, auth.cashier.id, subjectType, subjectId, JSON.stringify(subject), reason, now, now).run();
    return json({ ok: true, permit: await getPermit(env.DB, id) }, 201);
  }
  return json({ error: 'Route permit transaksi kasir tidak ditemukan.' }, 404);
}

async function managementScope(request, env) {
  const auth = await requireManagement(request, env.DB); if (!auth.ok) return auth;
  if (auth.authType === 'LEGACY_PIN') return { ok: false, response: json({ error: 'Permit transaksi membutuhkan akun Admin Gerai atau Owner.', code: 'ACCOUNT_APPROVAL_REQUIRED' }, 403) };
  if (auth.admin) return { ...auth, storeId: auth.admin.store.id };
  const storeToken = text(new URL(request.url).searchParams.get('store'), 80);
  if (!storeToken) return { ...auth, storeId: null };
  const store = await resolveStore(env.DB, storeToken, { includeInactive: true });
  if (!store) return { ok: false, response: json({ error: 'Gerai permit tidak ditemukan.' }, 404) };
  return { ...auth, storeId: store.id };
}

function executionHold(subjectType) {
  if (subjectType === 'SALE') return { code: 'SALE_REVERSAL_CONTRACT_REQUIRED', detail: 'Permit sudah di-ACC. Reversal Penjualan masih HOLD sampai reversal stok, poin, produksi terkait, dan jurnal Accounting dapat dibalik secara deterministic.' };
  if (subjectType === 'PURCHASE') return { code: 'PURCHASE_COST_REVERSAL_CONTRACT_REQUIRED', detail: 'Permit sudah di-ACC. Reversal Pembelian masih HOLD karena moving-average HPP, stock movement, dan jurnal Accounting tidak boleh direkalkulasi secara spekulatif.' };
  return { code: 'EXPENSE_REVERSAL_EXECUTOR_PENDING', detail: 'Permit sudah di-ACC. Executor reversal Pengeluaran Operasional akan memakai reversal jurnal dan status void auditable; hard-delete history tidak diizinkan.' };
}

async function handleManagement(request, env, pathname) {
  if (!pathname.startsWith('/api/management/transaction-void-permits')) return null;
  const scope = await managementScope(request, env); if (!scope.ok) return scope.response;
  if (request.method === 'GET' && pathname === '/api/management/transaction-void-permits') {
    const rawStatus = text(new URL(request.url).searchParams.get('status'), 40) || 'pending_approval'; const status = rawStatus === 'all' ? null : rawStatus;
    if (status && !APPROVAL_STATUSES.has(status)) return json({ error: 'Filter permit tidak valid.' }, 400);
    const permits = await listPermits(env.DB, { storeId: scope.storeId, status, limit: 300 });
    return json({ contract: TRANSACTION_VOID_PERMIT_CONTRACT, permits, summary: { total: permits.length, pending: permits.filter(item => item.approvalStatus === 'pending_approval').length, approved: permits.filter(item => item.approvalStatus === 'approved').length, rejected: permits.filter(item => item.approvalStatus === 'rejected').length, executionHold: permits.filter(item => item.executionStatus === 'HOLD').length, executed: permits.filter(item => item.executionStatus === 'EXECUTED').length } });
  }
  const match = pathname.match(/^\/api\/management\/transaction-void-permits\/([^/]+)$/);
  if (request.method === 'PATCH' && match) {
    const current = await getPermit(env.DB, decodeURIComponent(match[1])); if (!current) return json({ error: 'Permit tidak ditemukan.' }, 404);
    if (scope.storeId && current.storeId !== scope.storeId) return json({ error: 'Permit di luar scope gerai akun ini.' }, 403);
    if (current.approvalStatus !== 'pending_approval') return json({ error: 'Permit ini sudah memiliki keputusan.' }, 409);
    const body = await readJson(request); if (!body.ok) return json({ error: 'Payload keputusan permit tidak valid.' }, 400);
    const decision = text(body.value?.decision, 12).toUpperCase(); const note = text(body.value?.note, 500);
    if (!['ACC', 'REJECT'].includes(decision)) return json({ error: 'Decision wajib ACC atau REJECT.' }, 400);
    const now = new Date().toISOString(); const approverRole = scope.owner ? 'OWNER' : 'ADMIN'; const approverId = scope.owner?.id || scope.admin?.id || '';
    if (decision === 'REJECT') {
      const result = await env.DB.prepare(`UPDATE approval_permits SET approval_status = 'rejected', decision_note = ?, approved_by_role = ?, approved_by_id = ?, decided_at = ?, updated_at = ? WHERE id = ? AND approval_status = 'pending_approval'`).bind(note, approverRole, approverId, now, now, current.id).run();
      if (!result.success || Number(result.meta?.changes ?? 0) !== 1) return json({ error: 'Permit sudah diputuskan request lain.' }, 409);
      return json({ ok: true, permit: await getPermit(env.DB, current.id), executed: false });
    }
    const hold = executionHold(current.subjectType);
    const result = await env.DB.prepare(`UPDATE approval_permits SET approval_status = 'approved', execution_status = 'HOLD', execution_code = ?, execution_detail = ?, decision_note = ?, approved_by_role = ?, approved_by_id = ?, decided_at = ?, updated_at = ? WHERE id = ? AND approval_status = 'pending_approval'`).bind(hold.code, hold.detail, note, approverRole, approverId, now, now, current.id).run();
    if (!result.success || Number(result.meta?.changes ?? 0) !== 1) return json({ error: 'Permit sudah diputuskan request lain.' }, 409);
    return json({ ok: true, permit: await getPermit(env.DB, current.id), executed: false, executionHold: true, message: hold.detail });
  }
  return json({ error: 'Route permit management tidak ditemukan.' }, 404);
}

export async function handleTransactionVoidPermitApi(request, env, pathname) {
  const cashier = await handleCashier(request, env, pathname); if (cashier) return cashier;
  return handleManagement(request, env, pathname);
}
