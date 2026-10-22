// Hapus Arus Kas (Bos Cyo, 2026-10-22: "buat di data (panel kasir) dan transaksi (panel admin) jenis arus
// kas itu bisa dihapus, kalo dihapus kan bikin jurnal pembaliknya"). Kasus pemicu: Tlekung 22 Okt, CS
// mencoba memperbaiki pembelian salah cara bayar dengan Arus Kas masuk Rp305.500 ke Pendapatan Lainnya.
//
// Soft delete, bukan hapus baris (invariant riwayat): approval_requests + cash_ledger_entries diberi
// voided_at (migration 0181), uang laci tidak lagi menghitungnya (drawer-report.js), jurnal aslinya dibalik
// lewat jalur pembalik POS yang sama dengan hapus transaksi (reversePostedPosAccountingFact), dan cache
// laba hari itu dibuang.
//
// Dua pintu:
//   - CS di Data kasir: mengajukan (cash_flow_void_permits), Admin/Entity Admin ACC atau Tolak di Izin CS.
//   - Admin di Transaksi: langsung menghapus (wewenangnya sendiri), wajib alasan.
// Tabel izin hapus transaksi (approval_permits) tidak dipakai karena CHECK subject_type-nya tidak bisa
// diperluas tanpa membangun ulang tabel yang dirujuk sales/purchases/expenses.

import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { requireDrawerOwner } from './cashier-drawer.js';
import { managementScope } from './transaction-void-permits.js';
import { reversePostedPosAccountingFact } from './accounting-pos-reversal.js';
import { invalidateDailyProfitSnapshot } from './net-profit-report.js';

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };

async function cashFlowRow(db, storeId, requestId) {
  return db.prepare(`
    SELECT r.id, r.store_id, r.drawer_session_id, r.cashier_id, r.request_type, r.approval_status, r.posting_status,
           r.payload_json, r.posted_at, r.created_at, r.voided_at, c.direction, c.amount, c.description
    FROM approval_requests r
    LEFT JOIN cash_ledger_entries c ON c.approval_request_id = r.id AND c.store_id = r.store_id
    WHERE r.id = ? AND r.store_id = ? AND r.request_type = 'CASH_FLOW'
    LIMIT 1
  `).bind(requestId, storeId).first();
}

function snapshotOf(row) {
  const payload = parse(row.payload_json);
  return {
    requestId: row.id,
    direction: row.direction || payload.direction || '',
    amount: Number(row.amount ?? payload.amount ?? 0),
    description: row.description || payload.description || 'Arus Kas',
    counterpart: payload.accountingCounterpartLabel || '',
    postedAt: row.posted_at || null
  };
}

function permitDto(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    drawerSessionId: row.drawer_session_id,
    cashierId: row.cashier_id,
    cashierName: row.cashier_name || '',
    requestId: row.request_id,
    subject: parse(row.snapshot_json),
    reason: row.reason,
    approvalStatus: row.approval_status,
    executionStatus: row.execution_status,
    executionDetail: row.execution_detail || '',
    decisionNote: row.decision_note || '',
    requestedAt: row.requested_at,
    decidedAt: row.decided_at || null,
    executedAt: row.executed_at || null
  };
}

async function getPermit(db, id) {
  const row = await db.prepare(`
    SELECT p.*, c.employee_name AS cashier_name FROM cash_flow_void_permits p
    LEFT JOIN cashiers c ON c.id = p.cashier_id WHERE p.id = ? LIMIT 1
  `).bind(id).first();
  return row ? permitDto(row) : null;
}

async function listPermits(db, { storeId = null, cashierId = null, status = null } = {}) {
  const conditions = ['1 = 1'];
  const values = [];
  if (storeId) { conditions.push('p.store_id = ?'); values.push(storeId); }
  if (cashierId) { conditions.push('p.cashier_id = ?'); values.push(cashierId); }
  if (status) { conditions.push('p.approval_status = ?'); values.push(status); }
  const rows = await db.prepare(`
    SELECT p.*, c.employee_name AS cashier_name FROM cash_flow_void_permits p
    LEFT JOIN cashiers c ON c.id = p.cashier_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.requested_at DESC LIMIT 200
  `).bind(...values).all();
  return (rows.results || []).map(permitDto);
}

/**
 * Soft delete satu Arus Kas yang sudah ACC + posted, lalu balik jurnalnya. Idempoten: Arus Kas yang sudah
 * dihapus tidak dihapus dua kali (voided_at guard), jurnal pembalik memakai idempotency key referensinya.
 */
export async function voidCashFlow(db, store, { requestId, actor, reason, reference, now = new Date().toISOString() }) {
  const row = await cashFlowRow(db, store.id, requestId);
  if (!row) return { ok: false, status: 404, error: 'Arus Kas tidak ditemukan di gerai ini.' };
  if (row.voided_at) return { ok: true, duplicate: true };
  if (row.approval_status !== 'approved' || row.posting_status !== 'posted') {
    return { ok: false, status: 409, error: 'Arus Kas ini belum ACC/posted; tolak pengajuannya saja di Persetujuan.' };
  }
  const results = await db.batch([
    db.prepare(`
      UPDATE approval_requests SET voided_at = ?, voided_by_role = ?, voided_by_id = ?, void_reason = ?, updated_at = ?
      WHERE id = ? AND store_id = ? AND request_type = 'CASH_FLOW' AND voided_at IS NULL
    `).bind(now, actor.role, actor.id || '', text(reason), now, requestId, store.id),
    db.prepare('UPDATE cash_ledger_entries SET voided_at = ? WHERE approval_request_id = ? AND store_id = ? AND voided_at IS NULL')
      .bind(now, requestId, store.id)
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) return { ok: true, duplicate: true };
  const date = await db.prepare(`SELECT date(COALESCE(posted_at, created_at), '+7 hours') AS d FROM approval_requests WHERE id = ?`).bind(requestId).first();
  if (date?.d) await invalidateDailyProfitSnapshot(db, store.id, date.d);
  const accounting = await reversePostedPosAccountingFact(db, store, {
    factType: 'CASH_FLOW', factId: requestId, permitId: reference, occurredAt: now, reason: text(reason, 300)
  });
  return { ok: true, duplicate: false, accounting };
}

function accountingText(accounting) {
  if (!accounting) return '';
  if (accounting.ok === false) return `Jurnal pembalik belum berhasil: ${accounting.error || accounting.code}`;
  return accounting.accountingStatus === 'REVERSED' ? `Jurnal pembalik ${accounting.reversalJournalNumber || accounting.reversalJournalId}` : 'Belum pernah dijurnal; tidak perlu pembalik.';
}

async function executePermit(env, store, permit, actor, now) {
  const result = await voidCashFlow(env.DB, store, { requestId: permit.requestId, actor, reason: permit.reason, reference: permit.id, now });
  const executed = result.ok;
  await env.DB.prepare(`
    UPDATE cash_flow_void_permits SET execution_status = ?, execution_detail = ?, executed_at = ? WHERE id = ?
  `).bind(executed ? 'EXECUTED' : 'FAILED', executed ? (accountingText(result.accounting) || 'Sudah dihapus.') : result.error, executed ? now : null, permit.id).run();
  return { ok: true, executed, message: executed ? null : result.error, permit: await getPermit(env.DB, permit.id) };
}

async function handleCashier(request, env, pathname) {
  if (!pathname.startsWith('/api/cashier/cash-flow-void')) return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  if (request.method === 'GET' && pathname === '/api/cashier/cash-flow-void/permits') {
    return json({ permits: await listPermits(env.DB, { storeId: auth.cashier.store.id, cashierId: auth.cashier.id }) });
  }
  const drawer = await requireDrawerOwner(env.DB, auth.cashier);
  if (!drawer.ok) return drawer.response;
  if (request.method === 'POST' && pathname === '/api/cashier/cash-flow-void/permits') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
    const requestId = text(body.value?.requestId, 180);
    const reason = text(body.value?.reason, 500);
    if (!requestId || !reason) return json({ error: 'Arus Kas dan alasan wajib diisi.' }, 400);
    const row = await cashFlowRow(env.DB, auth.cashier.store.id, requestId);
    if (!row || row.drawer_session_id !== drawer.drawer.id || row.cashier_id !== auth.cashier.id) {
      return json({ error: 'Arus Kas ini tidak ada di laci kasir yang sedang dibuka.' }, 404);
    }
    if (row.voided_at) return json({ error: 'Arus Kas ini sudah dihapus.' }, 409);
    if (row.approval_status !== 'approved' || row.posting_status !== 'posted') return json({ error: 'Arus Kas ini belum ACC/posted.' }, 409);
    const open = await env.DB.prepare(`SELECT id FROM cash_flow_void_permits WHERE request_id = ? AND approval_status = 'pending_approval' LIMIT 1`).bind(requestId).first();
    if (open) return json({ error: 'Pengajuan hapus Arus Kas ini masih menunggu Admin.' }, 409);
    const id = `cfvoid_${crypto.randomUUID()}`;
    await env.DB.prepare(`
      INSERT INTO cash_flow_void_permits (id, store_id, drawer_session_id, cashier_id, request_id, snapshot_json, reason, requested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, auth.cashier.store.id, drawer.drawer.id, auth.cashier.id, requestId, JSON.stringify(snapshotOf(row)), reason, new Date().toISOString()).run();
    return json({ ok: true, permit: await getPermit(env.DB, id) }, 201);
  }
  const cancel = pathname.match(/^\/api\/cashier\/cash-flow-void\/permits\/([^/]+)$/);
  if (request.method === 'DELETE' && cancel) {
    const result = await env.DB.prepare(`
      UPDATE cash_flow_void_permits SET approval_status = 'rejected', decision_note = 'Dibatalkan sendiri oleh kasir/CS',
        decided_by_role = 'CASHIER_SELF', decided_by_id = ?, decided_at = ?
      WHERE id = ? AND cashier_id = ? AND approval_status = 'pending_approval'
    `).bind(auth.cashier.id, new Date().toISOString(), decodeURIComponent(cancel[1]), auth.cashier.id).run();
    if (Number(result.meta?.changes ?? 0) !== 1) return json({ error: 'Pengajuan tidak ditemukan atau sudah diputuskan Admin.' }, 409);
    return json({ ok: true });
  }
  return json({ error: 'Route hapus Arus Kas kasir tidak ditemukan.' }, 404);
}

async function handleManagement(request, env, pathname) {
  const permitRoute = pathname.startsWith('/api/management/cash-flow-void-permits');
  const directRoute = pathname.match(/^\/api\/admin\/cash-flows\/([^/]+)\/void$/);
  if (!permitRoute && !directRoute) return null;
  const scope = await managementScope(request, env);
  if (!scope.ok) return scope.response;
  const actor = {
    role: scope.owner ? 'OWNER' : scope.entityAdmin ? 'ENTITY_ADMIN' : 'ADMIN',
    id: scope.owner?.id || scope.entityAdmin?.id || scope.admin?.id || ''
  };
  const now = new Date().toISOString();

  if (directRoute && request.method === 'POST') {
    if (!scope.store) return json({ error: 'Gerai belum dipilih.' }, 400);
    const body = await readJson(request);
    const reason = text(body.ok ? body.value?.reason : '', 500);
    if (reason.length < 3) return json({ error: 'Alasan hapus wajib diisi.' }, 400);
    const result = await voidCashFlow(env.DB, scope.store, {
      requestId: decodeURIComponent(directRoute[1]), actor, reason, reference: `direct_${crypto.randomUUID()}`, now
    });
    if (!result.ok) return json({ error: result.error }, result.status || 400);
    return json({ ok: true, duplicate: result.duplicate, accounting: result.accounting, message: accountingText(result.accounting) });
  }

  if (request.method === 'GET' && pathname === '/api/management/cash-flow-void-permits') {
    const status = text(new URL(request.url).searchParams.get('status'), 40) || 'pending_approval';
    return json({ permits: await listPermits(env.DB, { storeId: scope.storeId, status: status === 'all' ? null : status }) });
  }
  const match = pathname.match(/^\/api\/management\/cash-flow-void-permits\/([^/]+)$/);
  if (request.method === 'PATCH' && match) {
    const permit = await getPermit(env.DB, decodeURIComponent(match[1]));
    if (!permit) return json({ error: 'Pengajuan tidak ditemukan.' }, 404);
    if (!scope.store || permit.storeId !== scope.store.id) return json({ error: 'Pengajuan di luar gerai ini.' }, 403);
    const body = await readJson(request);
    const decision = text(body.ok ? body.value?.decision : '', 20).toUpperCase();
    const note = text(body.ok ? body.value?.note : '', 500);
    if (decision === 'RETRY_EXECUTION') {
      if (permit.approvalStatus !== 'approved' || permit.executionStatus === 'EXECUTED') return json({ error: 'Hanya untuk yang sudah ACC tapi belum terhapus.' }, 409);
      return json(await executePermit(env, scope.store, permit, actor, now));
    }
    if (!['ACC', 'REJECT'].includes(decision)) return json({ error: 'Keputusan wajib ACC atau REJECT.' }, 400);
    const claimed = await env.DB.prepare(`
      UPDATE cash_flow_void_permits SET approval_status = ?, decision_note = ?, decided_by_role = ?, decided_by_id = ?, decided_at = ?
      WHERE id = ? AND approval_status = 'pending_approval'
    `).bind(decision === 'ACC' ? 'approved' : 'rejected', note, actor.role, actor.id, now, permit.id).run();
    if (Number(claimed.meta?.changes ?? 0) !== 1) return json({ error: 'Pengajuan sudah diputuskan.' }, 409);
    if (decision === 'REJECT') return json({ ok: true, permit: await getPermit(env.DB, permit.id), executed: false });
    return json(await executePermit(env, scope.store, permit, actor, now));
  }
  return json({ error: 'Route hapus Arus Kas tidak ditemukan.' }, 404);
}

export async function handleCashFlowVoidApi(request, env, pathname) {
  return (await handleCashier(request, env, pathname)) ?? handleManagement(request, env, pathname);
}
