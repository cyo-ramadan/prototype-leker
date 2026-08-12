import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { requireDrawerOwner } from './cashier-drawer.js';
import { requireManagement } from './owner-auth.js';
import { resolveStore } from './stores.js';

const REQUEST_TYPES = new Set(['CASH_FLOW', 'GOODS_FLOW', 'ASSET']);
const APPROVAL_STATUSES = new Set(['pending_approval', 'approved', 'rejected']);
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);

function parsePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const serialized = JSON.stringify(value);
  return serialized.length <= 8000 ? serialized : null;
}

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
  if (!pathname.startsWith('/api/cashier/approval-requests')) return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;

  if (request.method === 'POST' && pathname === '/api/cashier/approval-requests') {
    const drawerAuth = await requireDrawerOwner(env.DB, auth.cashier);
    if (!drawerAuth.ok) return drawerAuth.response;
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload pengajuan tidak valid.' }, 400);
    const requestType = String(body.value?.requestType || '').trim().toUpperCase();
    const payloadJson = parsePayload(body.value?.payload);
    if (!REQUEST_TYPES.has(requestType)) return json({ error: 'Jenis pengajuan tidak valid.' }, 400);
    if (!payloadJson) return json({ error: 'Detail pengajuan wajib berupa object valid dan maksimal 8 KB.' }, 400);

    const now = new Date().toISOString();
    const id = `approval_${crypto.randomUUID()}`;
    await env.DB.prepare(`
      INSERT INTO approval_requests (
        id, store_id, drawer_session_id, cashier_id, request_type,
        approval_status, posting_status, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending_approval', 'unposted', ?, ?, ?)
    `).bind(
      id,
      auth.cashier.store.id,
      drawerAuth.drawer.id,
      auth.cashier.id,
      requestType,
      payloadJson,
      now,
      now
    ).run();
    return json({ ok: true, request: await getRequest(env.DB, id) }, 201);
  }

  if (request.method === 'GET' && pathname === '/api/cashier/approval-requests') {
    const drawerAuth = await requireDrawerOwner(env.DB, auth.cashier);
    if (!drawerAuth.ok) return drawerAuth.response;
    return json({
      requests: await listRequests(env.DB, {
        storeId: auth.cashier.store.id,
        drawerId: drawerAuth.drawer.id,
        cashierId: auth.cashier.id
      })
    });
  }

  return json({ error: 'Route approval kasir tidak ditemukan.' }, 404);
}

async function managementScope(request, env) {
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth;
  if (auth.authType === 'LEGACY_PIN') {
    return { ok: false, response: json({ error: 'Approval membutuhkan akun Admin Gerai atau Owner.', code: 'ACCOUNT_APPROVAL_REQUIRED' }, 403) };
  }
  if (auth.admin) return { ...auth, storeId: auth.admin.store.id };

  const url = new URL(request.url);
  const storeToken = text(url.searchParams.get('store'), 80);
  if (!storeToken) return { ...auth, storeId: null };
  const store = await resolveStore(env.DB, storeToken, { includeInactive: true });
  if (!store) return { ok: false, response: json({ error: 'Gerai approval tidak ditemukan.' }, 404) };
  return { ...auth, storeId: store.id };
}

async function handleManagementApprovalQueue(request, env, pathname) {
  if (!pathname.startsWith('/api/management/approval-requests')) return null;
  const scope = await managementScope(request, env);
  if (!scope.ok) return scope.response;

  if (request.method === 'GET' && pathname === '/api/management/approval-requests') {
    const url = new URL(request.url);
    const rawStatus = text(url.searchParams.get('status'), 40) || 'pending_approval';
    const status = rawStatus === 'all' ? null : rawStatus;
    if (status && !APPROVAL_STATUSES.has(status)) return json({ error: 'Filter status approval tidak valid.' }, 400);
    return json({ requests: await listRequests(env.DB, { storeId: scope.storeId, status }) });
  }

  const decisionMatch = pathname.match(/^\/api\/management\/approval-requests\/([^/]+)$/);
  if (request.method === 'PATCH' && decisionMatch) {
    const requestId = decodeURIComponent(decisionMatch[1]);
    const current = await getRequest(env.DB, requestId);
    if (!current) return json({ error: 'Pengajuan tidak ditemukan.' }, 404);
    if (scope.storeId && current.storeId !== scope.storeId) {
      return json({ error: 'Pengajuan berada di gerai di luar kewenangan akun ini.', code: 'APPROVAL_STORE_SCOPE_MISMATCH' }, 403);
    }
    if (current.approvalStatus !== 'pending_approval') {
      return json({ error: 'Pengajuan ini sudah memiliki keputusan.' }, 409);
    }

    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload keputusan approval tidak valid.' }, 400);
    const decision = String(body.value?.decision || '').trim().toUpperCase();
    if (!['ACC', 'REJECT'].includes(decision)) return json({ error: 'Decision wajib ACC atau REJECT.' }, 400);
    const note = text(body.value?.note, 500);
    const now = new Date().toISOString();
    const approverRole = scope.owner ? 'OWNER' : 'ADMIN';
    const approverId = scope.owner?.id || scope.admin?.id || '';

    if (decision === 'REJECT') {
      await env.DB.prepare(`
        UPDATE approval_requests
        SET approval_status = 'rejected', decision_note = ?, updated_at = ?, rejected_at = ?,
            approved_by_role = ?, approved_by_id = ?
        WHERE id = ? AND approval_status = 'pending_approval'
      `).bind(note, now, now, approverRole, approverId, requestId).run();
      return json({ ok: true, request: await getRequest(env.DB, requestId) });
    }

    await env.DB.prepare(`
      UPDATE approval_requests
      SET approval_status = 'approved', posting_status = 'blocked',
          posting_block_reason = 'POSTING_CONTRACT_REQUIRED', decision_note = ?,
          updated_at = ?, approved_at = ?, approved_by_role = ?, approved_by_id = ?
      WHERE id = ? AND approval_status = 'pending_approval'
    `).bind(note, now, now, approverRole, approverId, requestId).run();

    return json({
      ok: true,
      request: await getRequest(env.DB, requestId),
      postingBlocked: true,
      code: 'POSTING_CONTRACT_REQUIRED',
      message: 'ACC tercatat. Posting belum dijalankan karena contract ledger/stok/aset belum ditetapkan.'
    });
  }

  return json({ error: 'Route management approval tidak ditemukan.' }, 404);
}

export async function handleApprovalQueueApi(request, env, pathname) {
  const cashierResponse = await handleCashierApprovalQueue(request, env, pathname);
  if (cashierResponse) return cashierResponse;
  return handleManagementApprovalQueue(request, env, pathname);
}
