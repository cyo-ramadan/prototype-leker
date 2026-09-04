import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { requireDrawerOwner } from './cashier-drawer.js';
import { requireManagement } from './owner-auth.js';
import { resolveStore } from './stores.js';
import { dispatchApprovedCashFlowToAccounting } from './accounting-cash-flow-bridge.js';
import {
  normalizeApprovalPayload,
  buildOperationalPostingStatements,
  postingFailureResponse,
  listStockAdjustmentOptions
} from './operational-posting.js';

const REQUEST_TYPES = new Set(['CASH_FLOW', 'GOODS_FLOW', 'ASSET']);
const APPROVAL_STATUSES = new Set(['pending_approval', 'approved', 'rejected']);
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);

function mapRequest(row) {
  if (!row) return null;
  let payload = {};
  try { payload = JSON.parse(row.payload_json || '{}'); } catch {}
  return {
    id: row.id,
    storeId: row.store_id,
    drawerSessionId: row.drawer_session_id,
    cashierId: row.cashier_id,
    cashierName: row.cashier_name || '',
    requestType: row.request_type,
    approvalStatus: row.approval_status,
    postingStatus: row.posting_status,
    payload,
    decisionNote: row.decision_note || '',
    postingBlockReason: row.posting_block_reason || '',
    approvedByRole: row.approved_by_role || null,
    approvedById: row.approved_by_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at || null,
    rejectedAt: row.rejected_at || null,
    postedAt: row.posted_at || null
  };
}

async function getRequest(db, requestId) {
  const row = await db.prepare(`
    SELECT r.*, c.employee_name AS cashier_name
    FROM approval_requests r
    JOIN cashiers c ON c.id = r.cashier_id
    WHERE r.id = ?
    LIMIT 1
  `).bind(requestId).first();
  return mapRequest(row);
}

async function listRequests(db, { storeId = null, drawerId = null, cashierId = null, status = null } = {}) {
  const conditions = [];
  const values = [];
  if (storeId) { conditions.push('r.store_id = ?'); values.push(storeId); }
  if (drawerId) { conditions.push('r.drawer_session_id = ?'); values.push(drawerId); }
  if (cashierId) { conditions.push('r.cashier_id = ?'); values.push(cashierId); }
  if (status) { conditions.push('r.approval_status = ?'); values.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db.prepare(`
    SELECT r.*, c.employee_name AS cashier_name
    FROM approval_requests r
    JOIN cashiers c ON c.id = r.cashier_id
    ${where}
    ORDER BY r.created_at DESC
    LIMIT 200
  `).bind(...values).all();
  return (result.results || []).map(mapRequest);
}

async function handleCashierApprovalQueue(request, env, pathname) {
  const isApprovalRoute = pathname.startsWith('/api/cashier/approval-requests');
  const isStockAdjustmentOptions = pathname === '/api/cashier/stock-adjustment/options';
  if (!isApprovalRoute && !isStockAdjustmentOptions) return null;

  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;

  if (request.method === 'GET' && isStockAdjustmentOptions) {
    const drawerAuth = await requireDrawerOwner(env.DB, auth.cashier);
    if (!drawerAuth.ok) return drawerAuth.response;
    return json({ products: await listStockAdjustmentOptions(env.DB, auth.cashier.store.id) });
  }

  if (request.method === 'POST' && pathname === '/api/cashier/approval-requests') {
    const drawerAuth = await requireDrawerOwner(env.DB, auth.cashier);
    if (!drawerAuth.ok) return drawerAuth.response;
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload pengajuan tidak valid.' }, 400);
    const requestType = String(body.value?.requestType || '').trim().toUpperCase();
    if (!REQUEST_TYPES.has(requestType)) return json({ error: 'Jenis pengajuan tidak valid.' }, 400);

    const normalized = await normalizeApprovalPayload(env.DB, auth.cashier.store.id, requestType, body.value?.payload);
    if (!normalized.ok) return json({ error: normalized.error }, 400);
    const payloadJson = JSON.stringify(normalized.payload);
    if (payloadJson.length > 8000) return json({ error: 'Detail pengajuan maksimal 8 KB.' }, 400);

    const now = new Date().toISOString();
    const id = `approval_${crypto.randomUUID()}`;
    await env.DB.prepare(`
      INSERT INTO approval_requests (
        id, store_id, drawer_session_id, cashier_id, request_type,
        approval_status, posting_status, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending_approval', 'unposted', ?, ?, ?)
    `).bind(id, auth.cashier.store.id, drawerAuth.drawer.id, auth.cashier.id, requestType, payloadJson, now, now).run();

    const settings = await getApprovalSettings(env.DB, auth.cashier.store.id);
    if (!settings.autoPermitEnabled) return json({ ok: true, request: await getRequest(env.DB, id) }, 201);

    const created = await getRequest(env.DB, id);
    const outcome = await applyAccDecision(env, created, {
      approverRole: 'AUTO_PERMIT',
      approverId: settings.enabledById || '',
      now,
      note: 'Auto Permit'
    });
    return json({
      ok: true,
      request: outcome.request,
      autoPermit: outcome.ok
        ? { attempted: true, posted: true }
        : { attempted: true, posted: false, code: outcome.code, reason: outcome.error }
    }, 201);
  }

  if (request.method === 'GET' && pathname === '/api/cashier/approval-requests') {
    const drawerAuth = await requireDrawerOwner(env.DB, auth.cashier);
    if (!drawerAuth.ok) return drawerAuth.response;
    return json({ requests: await listRequests(env.DB, { storeId: auth.cashier.store.id, drawerId: drawerAuth.drawer.id, cashierId: auth.cashier.id }) });
  }

  return json({ error: 'Route approval kasir tidak ditemukan.' }, 404);
}

async function managementScope(request, env) {
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth;
  if (auth.authType === 'LEGACY_PIN') return { ok: false, response: json({ error: 'Approval membutuhkan akun Admin Gerai atau Owner.', code: 'ACCOUNT_APPROVAL_REQUIRED' }, 403) };
  if (auth.admin) return { ...auth, storeId: auth.admin.store.id };

  const url = new URL(request.url);
  const storeToken = text(url.searchParams.get('store'), 80);
  if (!storeToken) return { ...auth, storeId: null };
  const store = await resolveStore(env.DB, storeToken, { includeInactive: true });
  if (!store) return { ok: false, response: json({ error: 'Gerai approval tidak ditemukan.' }, 404) };
  return { ...auth, storeId: store.id };
}

async function rejectStaleStockAdjustment(db, current, { approverRole, approverId, now }) {
  if (current.requestType !== 'GOODS_FLOW' || current.payload?.purpose !== 'STOCK_ADJUSTMENT') return null;
  const row = await db.prepare(`
    SELECT COALESCE(quantity, 0) AS quantity
    FROM inventory_stock_balances
    WHERE store_id = ? AND product_id = ?
    LIMIT 1
  `).bind(current.storeId, current.payload.productId).first();
  const actualQuantity = Number(row?.quantity || 0);
  const snapshotQuantity = Number(current.payload.currentQuantitySnapshot);
  if (actualQuantity === snapshotQuantity) return null;

  const reason = `STOCK_ADJUSTMENT_STALE: stok berubah dari snapshot ${snapshotQuantity} menjadi ${actualQuantity}; ajukan ulang Penyesuaian Stok.`;
  const result = await db.prepare(`
    UPDATE approval_requests
    SET approval_status = 'rejected', posting_status = 'unposted',
        posting_block_reason = ?, decision_note = ?, updated_at = ?, rejected_at = ?,
        approved_by_role = ?, approved_by_id = ?
    WHERE id = ? AND approval_status = 'pending_approval' AND posting_status = 'unposted'
  `).bind(reason, reason, now, now, approverRole, approverId, current.id).run();
  if (!result.success || Number(result.meta?.changes ?? 0) !== 1) {
    return { status: 409, code: 'APPROVAL_ALREADY_DECIDED', error: 'Pengajuan sudah diputuskan oleh request lain.' };
  }
  return {
    status: 409,
    code: 'STOCK_ADJUSTMENT_STALE',
    error: `Penyesuaian Stok tidak diposting karena stok berubah dari ${snapshotQuantity} menjadi ${actualQuantity}. Ajukan ulang berdasarkan stok terbaru.`,
    actualQuantity,
    snapshotQuantity
  };
}

async function cashFlowAccountingAfterCommit(env, current) {
  if (current.requestType !== 'CASH_FLOW') return null;
  try {
    return await dispatchApprovedCashFlowToAccounting(env.DB, current.storeId, current.id);
  } catch (error) {
    return {
      ok: false,
      status: 'FAILED',
      code: 'ACCOUNTING_DELIVERY_FAILED',
      error: text(error?.message || error, 500)
    };
  }
}

function mapApprovalSettings(storeId, row) {
  return {
    storeId,
    autoPermitEnabled: Boolean(row?.auto_permit_enabled),
    enabledByRole: row?.enabled_by_role || null,
    enabledById: row?.enabled_by_id || null,
    enabledAt: row?.enabled_at || null
  };
}

async function getApprovalSettings(db, storeId) {
  const row = await db.prepare(`
    SELECT auto_permit_enabled, enabled_by_role, enabled_by_id, enabled_at
    FROM store_approval_settings WHERE store_id = ?
  `).bind(storeId).first();
  return mapApprovalSettings(storeId, row);
}

// Shared by the management ACC decision (PATCH .../approval-requests/:id) and
// the cashier Auto Permit path (POST .../approval-requests when the store's
// toggle is on) so both go through the exact same posting contract instead of
// two implementations that can drift. A stale STOCK_ADJUSTMENT snapshot marks
// the row rejected here (existing rejectStaleStockAdjustment behavior,
// unchanged); any other posting failure leaves the row pending_approval/
// unposted because env.DB.batch() rolls the whole attempt back atomically --
// Auto Permit never silently rejects a request a human could still review.
async function applyAccDecision(env, current, { approverRole, approverId, now, note = '' }) {
  const stale = await rejectStaleStockAdjustment(env.DB, current, { approverRole, approverId, now });
  if (stale) return { ok: false, ...stale, request: await getRequest(env.DB, current.id) };

  const statements = buildOperationalPostingStatements(env.DB, current, { approverRole, approverId, now, note });
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const known = postingFailureResponse(current.requestType, error);
    if (known) return { ok: false, status: known.status, error: known.error, code: 'POSTING_REJECTED', request: await getRequest(env.DB, current.id) };
    throw error;
  }

  const postedRequest = await getRequest(env.DB, current.id);
  const accounting = await cashFlowAccountingAfterCommit(env, postedRequest);
  return { ok: true, request: postedRequest, accounting };
}

async function handleManagementApprovalQueue(request, env, pathname) {
  if (!pathname.startsWith('/api/management/approval-requests') && pathname !== '/api/management/approval-settings') return null;
  const scope = await managementScope(request, env);
  if (!scope.ok) return scope.response;

  if (request.method === 'GET' && pathname === '/api/management/approval-requests') {
    const url = new URL(request.url);
    const rawStatus = text(url.searchParams.get('status'), 40) || 'pending_approval';
    const status = rawStatus === 'all' ? null : rawStatus;
    if (status && !APPROVAL_STATUSES.has(status)) return json({ error: 'Filter status approval tidak valid.' }, 400);
    return json({ requests: await listRequests(env.DB, { storeId: scope.storeId, status }) });
  }

  if (pathname === '/api/management/approval-settings') {
    if (!scope.storeId) return json({ error: 'Auto Permit butuh konteks gerai (?store=).' }, 400);

    if (request.method === 'GET') {
      return json({ settings: await getApprovalSettings(env.DB, scope.storeId) });
    }

    if (request.method === 'PATCH') {
      const body = await readJson(request);
      if (!body.ok) return json({ error: 'Payload Auto Permit tidak valid.' }, 400);
      const enabled = Boolean(body.value?.enabled);
      const now = new Date().toISOString();
      const approverRole = scope.owner ? 'OWNER' : scope.entityAdmin ? 'ENTITY_ADMIN' : 'ADMIN';
      const approverId = scope.owner?.id || scope.entityAdmin?.id || scope.admin?.id || '';

      if (enabled) {
        await env.DB.prepare(`
          INSERT INTO store_approval_settings (store_id, auto_permit_enabled, enabled_by_role, enabled_by_id, enabled_at, updated_at)
          VALUES (?, 1, ?, ?, ?, ?)
          ON CONFLICT(store_id) DO UPDATE SET
            auto_permit_enabled = 1, enabled_by_role = excluded.enabled_by_role,
            enabled_by_id = excluded.enabled_by_id, enabled_at = excluded.enabled_at, updated_at = excluded.updated_at
        `).bind(scope.storeId, approverRole, approverId, now, now).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO store_approval_settings (store_id, auto_permit_enabled, updated_at)
          VALUES (?, 0, ?)
          ON CONFLICT(store_id) DO UPDATE SET auto_permit_enabled = 0, updated_at = excluded.updated_at
        `).bind(scope.storeId, now).run();
      }

      return json({ ok: true, settings: await getApprovalSettings(env.DB, scope.storeId) });
    }

    return json({ error: 'Method Auto Permit tidak didukung.' }, 405);
  }

  const accountingSyncMatch = pathname.match(/^\/api\/management\/approval-requests\/([^/]+)\/accounting-sync$/);
  if (request.method === 'POST' && accountingSyncMatch) {
    const requestId = decodeURIComponent(accountingSyncMatch[1]);
    const current = await getRequest(env.DB, requestId);
    if (!current) return json({ error: 'Pengajuan tidak ditemukan.' }, 404);
    if (scope.storeId && current.storeId !== scope.storeId) return json({ error: 'Pengajuan berada di gerai di luar kewenangan akun ini.', code: 'APPROVAL_STORE_SCOPE_MISMATCH' }, 403);
    if (current.requestType !== 'CASH_FLOW') return json({ error: 'Accounting sync ini hanya berlaku untuk Arus Kas.', code: 'ACCOUNTING_SYNC_UNSUPPORTED_TYPE' }, 400);
    if (current.approvalStatus !== 'approved' || current.postingStatus !== 'posted') {
      return json({ error: 'Arus Kas harus approved + posted sebelum Accounting sync.', code: 'CASH_FLOW_NOT_POSTED' }, 409);
    }
    const accounting = await cashFlowAccountingAfterCommit(env, current);
    return json({ ok: Boolean(accounting?.ok), request: current, accounting }, accounting?.ok ? 200 : 409);
  }

  const decisionMatch = pathname.match(/^\/api\/management\/approval-requests\/([^/]+)$/);
  if (request.method === 'PATCH' && decisionMatch) {
    const requestId = decodeURIComponent(decisionMatch[1]);
    const current = await getRequest(env.DB, requestId);
    if (!current) return json({ error: 'Pengajuan tidak ditemukan.' }, 404);
    if (scope.storeId && current.storeId !== scope.storeId) return json({ error: 'Pengajuan berada di gerai di luar kewenangan akun ini.', code: 'APPROVAL_STORE_SCOPE_MISMATCH' }, 403);
    if (current.approvalStatus !== 'pending_approval' || current.postingStatus !== 'unposted') return json({ error: 'Pengajuan ini sudah memiliki keputusan atau sudah diproses.' }, 409);

    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload keputusan approval tidak valid.' }, 400);
    const decision = String(body.value?.decision || '').trim().toUpperCase();
    if (!['ACC', 'REJECT'].includes(decision)) return json({ error: 'Decision wajib ACC atau REJECT.' }, 400);
    const note = text(body.value?.note, 500);
    const now = new Date().toISOString();
    const approverRole = scope.owner ? 'OWNER' : scope.entityAdmin ? 'ENTITY_ADMIN' : 'ADMIN';
    const approverId = scope.owner?.id || scope.entityAdmin?.id || scope.admin?.id || '';

    if (decision === 'REJECT') {
      const result = await env.DB.prepare(`
        UPDATE approval_requests
        SET approval_status = 'rejected', decision_note = ?, updated_at = ?, rejected_at = ?, approved_by_role = ?, approved_by_id = ?
        WHERE id = ? AND approval_status = 'pending_approval' AND posting_status = 'unposted'
      `).bind(note, now, now, approverRole, approverId, requestId).run();
      if (!result.success || Number(result.meta?.changes ?? 0) !== 1) return json({ error: 'Pengajuan sudah diputuskan oleh request lain.' }, 409);
      return json({ ok: true, request: await getRequest(env.DB, requestId), posted: false });
    }

    const outcome = await applyAccDecision(env, current, { approverRole, approverId, now, note });
    if (!outcome.ok) return json(outcome, outcome.status);

    return json({
      ok: true,
      request: outcome.request,
      posted: true,
      accounting: outcome.accounting,
      message: outcome.accounting && !outcome.accounting.ok
        ? 'ACC dan posting operasional berhasil. Accounting menunggu konfigurasi / retry.'
        : 'ACC berhasil dan posting snapshot sudah diterapkan.'
    });
  }

  return json({ error: 'Route management approval tidak ditemukan.' }, 404);
}

export async function handleApprovalQueueApi(request, env, pathname) {
  const cashierResponse = await handleCashierApprovalQueue(request, env, pathname);
  if (cashierResponse) return cashierResponse;
  return handleManagementApprovalQueue(request, env, pathname);
}
