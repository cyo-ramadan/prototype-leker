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

  // Bos Cyo, 2026-09-19: "kalo sampe skema 1 barang 1 permit diganti aja,
  // yang diajukan ya yg satu transaksi" -- satu form Stock Opname (banyak
  // barang berselisih) sekarang satu submission atomic: semua item divalidasi
  // dulu (normalizeApprovalPayload tetap dipakai per item, tidak diubah),
  // baru semuanya di-INSERT dalam satu env.DB.batch() -- gagal satu, gagal
  // semua, tidak ada partial-submit yang bikin cashier harus retry manual
  // sisanya. Tiap row approval_requests masih baris sendiri (skema/constraint
  // approval_request_id UNIQUE di inventory_ledger_entries tidak diutak-atik)
  // -- yang berubah cuma orkestrasi submit + decide-nya, dikelompokkan lewat
  // payload.sessionId yang sudah ada sejak sebelumnya (dulu cuma dekorasi
  // tampilan, sekarang jadi kunci grouping submit/decide beneran).
  if (request.method === 'POST' && pathname === '/api/cashier/approval-requests/stock-adjustment-batch') {
    const drawerAuth = await requireDrawerOwner(env.DB, auth.cashier);
    if (!drawerAuth.ok) return drawerAuth.response;
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload pengajuan tidak valid.' }, 400);
    const items = Array.isArray(body.value?.items) ? body.value.items : [];
    if (!items.length) return json({ error: 'Batch Penyesuaian Stok membutuhkan minimal satu barang.' }, 400);
    if (items.length > 50) return json({ error: 'Batch Penyesuaian Stok maksimal 50 barang sekaligus.' }, 400);

    const sessionId = `stockopname_${crypto.randomUUID()}`;
    const seenProductIds = new Set();
    const normalizedPayloads = [];
    for (const item of items) {
      const productId = Number(item?.productId);
      if (seenProductIds.has(productId)) {
        return json({ error: `Barang #${productId} muncul lebih dari sekali dalam satu pengajuan.` }, 400);
      }
      seenProductIds.add(productId);
      const normalized = await normalizeApprovalPayload(env.DB, auth.cashier.store.id, 'GOODS_FLOW', {
        purpose: 'STOCK_ADJUSTMENT',
        productId: item?.productId,
        targetQuantity: item?.targetQuantity,
        reason: item?.reason,
        note: item?.note,
        sessionId
      });
      if (!normalized.ok) return json({ error: normalized.error }, 400);
      if (JSON.stringify(normalized.payload).length > 8000) return json({ error: 'Detail pengajuan maksimal 8 KB per barang.' }, 400);
      normalizedPayloads.push(normalized.payload);
    }

    const now = new Date().toISOString();
    const rows = normalizedPayloads.map(payload => ({ id: `approval_${crypto.randomUUID()}`, payload }));
    await env.DB.batch(rows.map(row => env.DB.prepare(`
      INSERT INTO approval_requests (
        id, store_id, drawer_session_id, cashier_id, request_type,
        approval_status, posting_status, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'GOODS_FLOW', 'pending_approval', 'unposted', ?, ?, ?)
    `).bind(row.id, auth.cashier.store.id, drawerAuth.drawer.id, auth.cashier.id, JSON.stringify(row.payload), now, now)));

    // Bos Cyo, 2026-09-25: "kalo untuk penyesuaian stok itu engga usah minta
    // acc an, langsung aja ya. kecuali arus barang harus acc an." Amends
    // ADR-041 point 2 ("not per-request-type") for STOCK_ADJUSTMENT
    // specifically -- it now ALWAYS posts immediately, regardless of the
    // store's Auto Permit toggle (unlike plain Arus Barang, which still
    // respects that toggle via the generic POST /api/cashier/approval-requests
    // below). approverRole is 'SYSTEM' (established convention, e.g.
    // payroll-ledger.js accruals), not 'AUTO_PERMIT' -- there is no human
    // account that decided to turn this on, so it must not be misattributed
    // to whoever last toggled Auto Permit (which may even be OFF).
    //
    // The management group-decide endpoint below (PATCH .../session/:id)
    // stays in place as the recovery path: if posting fails for a reason
    // other than a stale snapshot (which rejects outright here), the rows
    // remain pending_approval/unposted and an Admin can still ACC/Reject them
    // manually -- same "ACC lalu eksekusi dua statement terpisah" retry-safe
    // shape as Permit Hapus Transaksi (KNOWN_PITFALLS.md).
    const currents = await Promise.all(rows.map(row => getRequest(env.DB, row.id)));
    const outcome = await applyGroupAccDecision(env, currents, {
      approverRole: 'SYSTEM',
      approverId: '',
      now,
      note: 'Penyesuaian Stok langsung posting (tidak butuh ACC)'
    });
    return json({
      ok: true,
      sessionId,
      requests: outcome.requests || currents,
      posted: outcome.ok
        ? { attempted: true, posted: true }
        : { attempted: true, posted: false, code: outcome.code, reason: outcome.error }
    }, 201);
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
  const auth = await requireManagement(request, env.DB, env);
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

// Read-only staleness check, shared by the single-request path below and the
// group/session decide path (applyGroupAccDecision) -- the group path must
// know about staleness in EVERY item before writing anything, since finding
// one stale item after already rejecting/positng others would leave the
// "satu transaksi" guarantee broken.
async function checkStockAdjustmentStale(db, current) {
  if (current.requestType !== 'GOODS_FLOW' || current.payload?.purpose !== 'STOCK_ADJUSTMENT') return null;
  const row = await db.prepare(`
    SELECT COALESCE(quantity, 0) AS quantity
    FROM inventory_stock_balances
    WHERE store_id = ? AND product_id = ?
    LIMIT 1
  `).bind(current.storeId, current.payload.productId).first();
  const actualQuantity = Number(row?.quantity || 0);
  const snapshotQuantity = Number(current.payload.currentQuantitySnapshot);
  if (actualQuantity === snapshotQuantity) return { stale: false };
  return { stale: true, actualQuantity, snapshotQuantity };
}

async function rejectStaleStockAdjustment(db, current, { approverRole, approverId, now }) {
  const check = await checkStockAdjustmentStale(db, current);
  if (!check || !check.stale) return null;
  const { actualQuantity, snapshotQuantity } = check;

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

// Sibling of applyAccDecision for a whole Stock Opname session (multiple
// approval_requests rows sharing one payload.sessionId, one submission one
// decision). Staleness is checked for EVERY item first, without writing
// anything -- if even one item drifted, the WHOLE session is rejected
// together with one combined reason instead of quietly posting the rest,
// so the group either fully commits or fully bounces back to the cashier.
// Posting itself concatenates every row's buildOperationalPostingStatements
// output into a single env.DB.batch() call, same atomic-or-nothing shape
// applyAccDecision already relies on for a single row.
async function applyGroupAccDecision(env, currents, { approverRole, approverId, now, note = '' }) {
  const staleChecks = await Promise.all(currents.map(current => checkStockAdjustmentStale(env.DB, current)));
  const staleEntries = currents
    .map((current, index) => ({ current, check: staleChecks[index] }))
    .filter(entry => entry.check?.stale);

  if (staleEntries.length) {
    const ids = currents.map(current => current.id);
    const detail = staleEntries
      .map(({ current, check }) => `${current.payload?.productName || `#${current.payload?.productId}`}: snapshot ${check.snapshotQuantity} -> aktual ${check.actualQuantity}`)
      .join('; ');
    const reason = `STOCK_ADJUSTMENT_STALE (satu sesi): ${detail}. Ajukan ulang Penyesuaian Stok dari saldo terbaru.`;
    const placeholders = ids.map(() => '?').join(',');
    const result = await env.DB.prepare(`
      UPDATE approval_requests
      SET approval_status = 'rejected', posting_status = 'unposted',
          posting_block_reason = ?, decision_note = ?, updated_at = ?, rejected_at = ?,
          approved_by_role = ?, approved_by_id = ?
      WHERE id IN (${placeholders}) AND approval_status = 'pending_approval' AND posting_status = 'unposted'
    `).bind(reason, reason, now, now, approverRole, approverId, ...ids).run();
    if (!result.success || Number(result.meta?.changes ?? 0) !== ids.length) {
      return { ok: false, status: 409, code: 'APPROVAL_ALREADY_DECIDED', error: 'Sebagian pengajuan dalam sesi ini sudah diputuskan oleh request lain.' };
    }
    return {
      ok: false,
      status: 409,
      code: 'STOCK_ADJUSTMENT_STALE',
      error: `Penyesuaian Stok tidak diposting karena sebagian barang berubah stoknya: ${detail}. Ajukan ulang berdasarkan stok terbaru.`,
      requests: await Promise.all(ids.map(id => getRequest(env.DB, id)))
    };
  }

  const statements = currents.flatMap(current => buildOperationalPostingStatements(env.DB, current, { approverRole, approverId, now, note }));
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const known = postingFailureResponse('GOODS_FLOW', error);
    if (known) return { ok: false, status: known.status, error: known.error, code: 'POSTING_REJECTED' };
    throw error;
  }

  const postedRequests = await Promise.all(currents.map(current => getRequest(env.DB, current.id)));
  return { ok: true, requests: postedRequests };
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

  // Group decide untuk satu sesi Stock Opname (banyak approval_requests
  // dengan payload.sessionId yang sama, diajukan lewat batch endpoint kasir
  // di atas). Satu keputusan (ACC/Reject) berlaku untuk semua row sekaligus
  // -- lihat applyGroupAccDecision untuk kenapa staleness dicek dulu untuk
  // semua item sebelum menulis apa pun.
  const groupDecisionMatch = pathname.match(/^\/api\/management\/approval-requests\/session\/([^/]+)$/);
  if (request.method === 'PATCH' && groupDecisionMatch) {
    const sessionId = decodeURIComponent(groupDecisionMatch[1]);
    const conditions = [`json_extract(r.payload_json, '$.sessionId') = ?`, `r.approval_status = 'pending_approval'`, `r.posting_status = 'unposted'`];
    const values = [sessionId];
    if (scope.storeId) { conditions.push('r.store_id = ?'); values.push(scope.storeId); }
    const rowsResult = await env.DB.prepare(`
      SELECT r.*, c.employee_name AS cashier_name
      FROM approval_requests r
      JOIN cashiers c ON c.id = r.cashier_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY r.created_at ASC
    `).bind(...values).all();
    const currents = (rowsResult.results || []).map(mapRequest);
    if (!currents.length) return json({ error: 'Sesi pengajuan tidak ditemukan atau sudah diputuskan.' }, 404);

    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload keputusan approval tidak valid.' }, 400);
    const decision = String(body.value?.decision || '').trim().toUpperCase();
    if (!['ACC', 'REJECT'].includes(decision)) return json({ error: 'Decision wajib ACC atau REJECT.' }, 400);
    const note = text(body.value?.note, 500);
    const now = new Date().toISOString();
    const approverRole = scope.owner ? 'OWNER' : scope.entityAdmin ? 'ENTITY_ADMIN' : 'ADMIN';
    const approverId = scope.owner?.id || scope.entityAdmin?.id || scope.admin?.id || '';
    const ids = currents.map(current => current.id);

    if (decision === 'REJECT') {
      const placeholders = ids.map(() => '?').join(',');
      const result = await env.DB.prepare(`
        UPDATE approval_requests
        SET approval_status = 'rejected', decision_note = ?, updated_at = ?, rejected_at = ?, approved_by_role = ?, approved_by_id = ?
        WHERE id IN (${placeholders}) AND approval_status = 'pending_approval' AND posting_status = 'unposted'
      `).bind(note, now, now, approverRole, approverId, ...ids).run();
      if (!result.success || Number(result.meta?.changes ?? 0) !== ids.length) return json({ error: 'Sebagian pengajuan dalam sesi ini sudah diputuskan oleh request lain.' }, 409);
      return json({ ok: true, sessionId, requests: await Promise.all(ids.map(id => getRequest(env.DB, id))), posted: false });
    }

    const outcome = await applyGroupAccDecision(env, currents, { approverRole, approverId, now, note });
    if (!outcome.ok) return json({ ...outcome, sessionId }, outcome.status);

    return json({
      ok: true,
      sessionId,
      requests: outcome.requests,
      posted: true,
      message: `ACC berhasil, ${outcome.requests.length} barang ter-posting sekaligus.`
    });
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
