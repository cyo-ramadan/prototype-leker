import { json, readJson } from './http.js';
import { requireCashier, latestAttendanceStatus } from './cashier-auth.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getOpenDrawer } from './cashier-drawer.js';
import { createEmployeeDepositReceivable } from './employee-deposit-settlement.js';

// Bos Cyo, 2026-09-19: "kasih tombol kasir bisa permit tutup laci kasir
// sebelumnya karna sudah waktu dia untuk jaga. nanti admin acc kan akhirnya
// di force close." Lihat migration 0110 untuk alasan tabel terpisah dari
// approval_requests. target_cashier_id (pemilik laci yang ditutup paksa)
// disimpan permanen di baris ini untuk jadi jejak penilaian kasir ke depan
// -- Bos Cyo eksplisit bilang model "diijinkan admin" begini akan
// mempengaruhi penilaian kasir bersangkutan.

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const money = value => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
};

function mapPermit(row) {
  return row ? {
    id: row.id,
    storeId: row.store_id,
    drawerSessionId: row.drawer_session_id,
    targetCashierId: row.target_cashier_id,
    targetCashierName: row.target_cashier_name || '',
    requestedByCashierId: row.requested_by_cashier_id,
    requestedByCashierName: row.requested_by_cashier_name || '',
    closingAmount: Number(row.closing_amount || 0),
    depositAmount: Number(row.deposit_amount || 0),
    closingNote: row.closing_note || '',
    reason: row.reason || '',
    status: row.status,
    decisionNote: row.decision_note || '',
    decidedByRole: row.decided_by_role || null,
    decidedById: row.decided_by_id || null,
    decidedAt: row.decided_at || null,
    createdAt: row.created_at
  } : null;
}

async function getPermit(db, id) {
  const row = await db.prepare(`
    SELECT p.*, t.employee_name AS target_cashier_name, r.employee_name AS requested_by_cashier_name
    FROM drawer_close_permits p
    JOIN cashiers t ON t.id = p.target_cashier_id
    JOIN cashiers r ON r.id = p.requested_by_cashier_id
    WHERE p.id = ?
  `).bind(id).first();
  return mapPermit(row);
}

async function listPermits(db, { storeId, status = null, cashierId = null } = {}) {
  const conditions = ['p.store_id = ?'];
  const values = [storeId];
  if (status) { conditions.push('p.status = ?'); values.push(status); }
  if (cashierId) { conditions.push('p.requested_by_cashier_id = ?'); values.push(cashierId); }
  const rows = await db.prepare(`
    SELECT p.*, t.employee_name AS target_cashier_name, r.employee_name AS requested_by_cashier_name
    FROM drawer_close_permits p
    JOIN cashiers t ON t.id = p.target_cashier_id
    JOIN cashiers r ON r.id = p.requested_by_cashier_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.created_at DESC
    LIMIT 200
  `).bind(...values).all();
  return (rows.results ?? []).map(mapPermit);
}

async function handleCashierClosePermit(request, env, pathname) {
  if (!pathname.startsWith('/api/cashier/drawer/close-permits')) return null;
  const db = env.DB;
  const auth = await requireCashier(request, db);
  if (!auth.ok) return auth.response;
  const cashier = auth.cashier;

  if (request.method === 'GET' && pathname === '/api/cashier/drawer/close-permits') {
    return json({ permits: await listPermits(db, { storeId: cashier.store.id, cashierId: cashier.id }) });
  }

  if (request.method === 'POST' && pathname === '/api/cashier/drawer/close-permits') {
    const drawer = await getOpenDrawer(db, cashier.store.id);
    if (!drawer) return json({ error: 'Tidak ada laci yang sedang terbuka di gerai ini.', code: 'DRAWER_NOT_OPEN' }, 409);
    if (drawer.cashierId === cashier.id) {
      return json({ error: 'Laci ini milik akun sendiri -- tutup langsung lewat Tutup Laci, tidak perlu permit.', code: 'DRAWER_OWNED_BY_SELF' }, 400);
    }
    // Sama seperti buka laci normal -- yang mengajukan wajib sudah presensi
    // masuk, supaya jelas dia memang datang buat gantian jaga, bukan asal klik.
    if (await latestAttendanceStatus(db, cashier.id) !== 'in') {
      return json({ error: 'Presensi masuk dulu sebelum mengajukan tutup laci sebelumnya.', code: 'PRESENSI_REQUIRED' }, 403);
    }
    const pending = await db.prepare(`SELECT id FROM drawer_close_permits WHERE drawer_session_id = ? AND status = 'PENDING'`).bind(drawer.id).first();
    if (pending) return json({ error: 'Sudah ada pengajuan tutup laci ini yang masih menunggu ACC Admin.', code: 'PERMIT_ALREADY_PENDING' }, 409);

    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload pengajuan tidak valid.' }, 400);
    const closingAmount = money(body.value?.closingAmount);
    const depositAmount = money(body.value?.depositAmount ?? 0);
    if (closingAmount === null) return json({ error: 'Saldo akhir laci wajib berupa angka valid.' }, 400);
    if (depositAmount === null) return json({ error: 'Setoran wajib berupa angka valid.' }, 400);
    if (depositAmount > closingAmount) return json({ error: 'Setoran tidak boleh lebih besar dari saldo akhir laci.' }, 400);
    if (depositAmount > 0 && !Number.isSafeInteger(depositAmount * 1_000_000)) {
      return json({ error: 'Nominal setoran terlalu besar untuk precision Accounting.' }, 400);
    }

    const id = `drawerpermit_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO drawer_close_permits (
        id, store_id, drawer_session_id, target_cashier_id, requested_by_cashier_id,
        closing_amount, deposit_amount, closing_note, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, cashier.store.id, drawer.id, drawer.cashierId, cashier.id,
      closingAmount, depositAmount, text(body.value?.closingNote, 500), text(body.value?.reason, 500)
    ).run();
    return json({ ok: true, permit: await getPermit(db, id) }, 201);
  }

  return json({ error: 'Route permit tutup laci kasir tidak ditemukan.' }, 404);
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

async function handleManagementClosePermit(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/drawer/close-permits')) return null;
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const approverRole = auth.owner ? 'OWNER' : auth.entityAdmin ? 'ENTITY_ADMIN' : auth.admin ? 'ADMIN' : 'LEGACY_PIN';
  const approverId = auth.owner?.id || auth.entityAdmin?.id || auth.admin?.id || '';

  if (request.method === 'GET' && pathname === '/api/admin/drawer/close-permits') {
    const rawStatus = text(new URL(request.url).searchParams.get('status'), 20) || 'PENDING';
    const status = rawStatus.toUpperCase() === 'ALL' ? null : rawStatus.toUpperCase();
    return json({ store, permits: await listPermits(db, { storeId: store.id, status }) });
  }

  const decisionMatch = pathname.match(/^\/api\/admin\/drawer\/close-permits\/([^/]+)$/);
  if (request.method === 'PATCH' && decisionMatch) {
    const permitId = decodeURIComponent(decisionMatch[1]);
    const current = await getPermit(db, permitId);
    if (!current) return json({ error: 'Pengajuan tidak ditemukan.' }, 404);
    if (current.storeId !== store.id) return json({ error: 'Pengajuan berada di gerai lain.', code: 'PERMIT_STORE_SCOPE_MISMATCH' }, 403);
    if (current.status !== 'PENDING') return json({ error: 'Pengajuan ini sudah diputuskan sebelumnya.' }, 409);

    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload keputusan tidak valid.' }, 400);
    const decision = String(body.value?.decision || '').trim().toUpperCase();
    if (!['ACC', 'REJECT'].includes(decision)) return json({ error: 'Decision wajib ACC atau REJECT.' }, 400);
    const note = text(body.value?.note, 500);
    const now = new Date().toISOString();

    if (decision === 'REJECT') {
      const result = await db.prepare(`
        UPDATE drawer_close_permits
        SET status = 'REJECTED', decision_note = ?, decided_by_role = ?, decided_by_id = ?, decided_at = ?
        WHERE id = ? AND status = 'PENDING'
      `).bind(note, approverRole, approverId, now, permitId).run();
      if (!result.success || Number(result.meta?.changes ?? 0) !== 1) return json({ error: 'Pengajuan sudah diputuskan oleh request lain.' }, 409);
      return json({ ok: true, permit: await getPermit(db, permitId) });
    }

    // ACC: laci sasaran wajib masih persis OPEN milik target_cashier_id --
    // kalau sudah berubah (mis. A ternyata sempat login sendiri dan nutup),
    // tolak dengan jelas alih-alih diam-diam menutup laci yang salah.
    const drawer = await db.prepare(`
      SELECT id FROM cash_drawer_sessions WHERE id = ? AND cashier_id = ? AND status = 'OPEN'
    `).bind(current.drawerSessionId, current.targetCashierId).first();
    if (!drawer) {
      await db.prepare(`
        UPDATE drawer_close_permits
        SET status = 'REJECTED', decision_note = ?, decided_by_role = ?, decided_by_id = ?, decided_at = ?
        WHERE id = ? AND status = 'PENDING'
      `).bind('Laci sudah tidak OPEN lagi (mungkin sudah ditutup sendiri) -- pengajuan otomatis ditolak.', approverRole, approverId, now, permitId).run();
      return json({ error: 'Laci sasaran sudah tidak OPEN lagi, pengajuan ini otomatis ditolak.', code: 'DRAWER_ALREADY_CLOSED' }, 409);
    }

    const result = await db.prepare(`
      UPDATE cash_drawer_sessions
      SET closing_amount = ?, deposit_amount = ?, status = 'CLOSED', closed_at = ?, closing_note = ?
      WHERE id = ? AND cashier_id = ? AND status = 'OPEN'
    `).bind(current.closingAmount, current.depositAmount, now, current.closingNote, current.drawerSessionId, current.targetCashierId).run();
    if (!result.success || Number(result.meta?.changes ?? 0) !== 1) {
      return json({ error: 'Laci sudah berubah status di request lain.' }, 409);
    }

    let employeeDeposit = null;
    if (current.depositAmount > 0) {
      employeeDeposit = await createEmployeeDepositReceivable(db, {
        storeId: store.id,
        cashierId: current.targetCashierId,
        drawerSessionId: current.drawerSessionId,
        amountRupiah: current.depositAmount,
        transactionDate: now.slice(0, 10)
      });
      if (employeeDeposit?.accounting && !employeeDeposit.accounting.ok) {
        await db.prepare(`
          UPDATE drawer_close_permits
          SET status = 'APPROVED', decision_note = ?, decided_by_role = ?, decided_by_id = ?, decided_at = ?
          WHERE id = ? AND status = 'PENDING'
        `).bind(note, approverRole, approverId, now, permitId).run();
        return json({
          error: employeeDeposit.accounting.error,
          code: employeeDeposit.accounting.code || 'EMPLOYEE_DEPOSIT_RECOGNITION_POST_FAILED',
          drawerCommitted: true,
          permit: await getPermit(db, permitId),
          employeeDeposit
        }, employeeDeposit.accounting.status || 503);
      }
    }

    const permitResult = await db.prepare(`
      UPDATE drawer_close_permits
      SET status = 'APPROVED', decision_note = ?, decided_by_role = ?, decided_by_id = ?, decided_at = ?
      WHERE id = ? AND status = 'PENDING'
    `).bind(note, approverRole, approverId, now, permitId).run();
    if (!permitResult.success || Number(permitResult.meta?.changes ?? 0) !== 1) {
      return json({ error: 'Pengajuan sudah diputuskan oleh request lain (laci sudah terlanjur ditutup).', drawerCommitted: true }, 409);
    }

    return json({ ok: true, permit: await getPermit(db, permitId), employeeDeposit });
  }

  return json({ error: 'Route permit tutup laci Admin tidak ditemukan.' }, 404);
}

export async function handleDrawerClosePermitApi(request, env, pathname) {
  const cashierResponse = await handleCashierClosePermit(request, env, pathname);
  if (cashierResponse) return cashierResponse;
  return handleManagementClosePermit(request, env, pathname);
}
