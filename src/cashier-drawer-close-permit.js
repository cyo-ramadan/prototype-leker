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
//
// Koreksi UX Bos Cyo, 2026-09-19 (sesudah PR pertama live): TIDAK ADA lagi
// jalur Admin tutup paksa langsung tanpa pengajuan -- "tombol admint untuk
// force close, jadi langsung itu di del aja. jadi admin hanya bisa close
// kalo ada request." Satu-satunya pemicu penutupan paksa selalu pengajuan
// dari kasir (lewat tombol Buka Laci yang sama, lihat public/cashier.js),
// dan Admin cuma memutuskan (ACC/Tolak) pengajuan yang sudah ada -- atau
// kalau gerai itu sudah mengaktifkan Auto Permit (toggle yang sama dipakai
// approval_requests, tabel store_approval_settings), pengajuan langsung
// ter-ACC otomatis saat itu juga tanpa menunggu Admin.

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

// Bos Cyo, 2026-09-19: "itu data permit acc admin kok ga ada tanggal dan
// jam pengajuannya, jadi biar ga kadarluasa untuk acc nya. dibikin aja
// kalo engga di acc 24 jam, dan ga aktifin auto permit maka jadi
// kenreject." Tanggal/jam pengajuan sudah tersimpan (created_at) dan sudah
// ditampilkan (admin-drawers.js), tapi belum ada batas waktu -- pengajuan
// pending bisa nggantung tanpa batas kalau Admin lupa. Auto Permit tidak
// relevan di sini (permit dari gerai yang mengaktifkannya sudah APPROVED
// sedetik itu juga, tidak pernah sempat nyangkut PENDING), jadi expiry ini
// cukup berlaku ke SEMUA pengajuan PENDING yang lebih tua dari 24 jam.
//
// Lazy-expiry (dicek ulang setiap GET/POST/PATCH menyentuh tabel ini),
// BUKAN cron/polling periodik -- invariant #6 CLAUDE.md.
const EXPIRED_NOTE = 'Kadaluarsa otomatis -- tidak ada keputusan Admin dalam 24 jam.';

async function expireStalePermits(db, storeId) {
  // Threshold dihitung pakai datetime('now', ...) SQLite sendiri (bukan
  // new Date().toISOString() dari JS) supaya dibandingkan dalam format yang
  // sama persis dengan created_at (default CURRENT_TIMESTAMP, migration
  // 0110) -- keduanya 'YYYY-MM-DD HH:MM:SS' UTC, tidak ada risiko mismatch
  // format 'T'/'Z' yang bisa menggeser hasil perbandingan string.
  await db.prepare(`
    UPDATE drawer_close_permits
    SET status = 'REJECTED', decision_note = ?, decided_by_role = 'SYSTEM', decided_by_id = '', decided_at = ?
    WHERE store_id = ? AND status = 'PENDING' AND created_at <= datetime('now', '-24 hours')
  `).bind(EXPIRED_NOTE, new Date().toISOString(), storeId).run();
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

// Sama persis toggle "Auto Permit" yang sudah dipakai approval_requests
// (src/approval-queue.js, tabel store_approval_settings) -- dibaca ulang
// langsung di sini (bukan diimpor) karena getApprovalSettings di sana tidak
// diekspor dan query-nya sesederhana ini, tidak perlu bikin dependency baru
// antar modul buat satu SELECT.
async function isAutoPermitEnabled(db, storeId) {
  const row = await db.prepare(`SELECT auto_permit_enabled FROM store_approval_settings WHERE store_id = ?`).bind(storeId).first();
  return Boolean(row?.auto_permit_enabled);
}

// Dipakai bersama oleh keputusan ACC manual Admin (PATCH) dan jalur Auto
// Permit (langsung dieksekusi begitu kasir submit, kalau gerainya sudah
// mengaktifkan toggle itu) -- supaya dua-duanya lewat kontrak penutupan yang
// persis sama, tidak ada dua implementasi yang bisa mencong (pola sama
// seperti applyAccDecision di approval-queue.js).
async function applyClosePermitApproval(db, store, current, { approverRole, approverId, note }) {
  const now = new Date().toISOString();

  // Laci sasaran wajib masih persis OPEN milik target_cashier_id -- kalau
  // sudah berubah (mis. pemegang laci ternyata sempat login sendiri dan
  // nutup di antara pengajuan dan keputusan ini), tolak dengan jelas alih-
  // alih diam-diam menutup laci yang salah.
  const drawer = await db.prepare(`
    SELECT id FROM cash_drawer_sessions WHERE id = ? AND cashier_id = ? AND status = 'OPEN'
  `).bind(current.drawerSessionId, current.targetCashierId).first();
  if (!drawer) {
    await db.prepare(`
      UPDATE drawer_close_permits
      SET status = 'REJECTED', decision_note = ?, decided_by_role = ?, decided_by_id = ?, decided_at = ?
      WHERE id = ? AND status = 'PENDING'
    `).bind('Laci sudah tidak OPEN lagi (mungkin sudah ditutup sendiri) -- pengajuan otomatis ditolak.', approverRole, approverId, now, current.id).run();
    return {
      ok: false, status: 409, error: 'Laci sasaran sudah tidak OPEN lagi, pengajuan ini otomatis ditolak.',
      code: 'DRAWER_ALREADY_CLOSED', permit: await getPermit(db, current.id)
    };
  }

  const result = await db.prepare(`
    UPDATE cash_drawer_sessions
    SET closing_amount = ?, deposit_amount = ?, status = 'CLOSED', closed_at = ?, closing_note = ?
    WHERE id = ? AND cashier_id = ? AND status = 'OPEN'
  `).bind(current.closingAmount, current.depositAmount, now, current.closingNote, current.drawerSessionId, current.targetCashierId).run();
  if (!result.success || Number(result.meta?.changes ?? 0) !== 1) {
    return { ok: false, status: 409, error: 'Laci sudah berubah status di request lain.' };
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
      `).bind(note, approverRole, approverId, now, current.id).run();
      return {
        ok: false,
        status: employeeDeposit.accounting.status || 503,
        error: employeeDeposit.accounting.error,
        code: employeeDeposit.accounting.code || 'EMPLOYEE_DEPOSIT_RECOGNITION_POST_FAILED',
        drawerCommitted: true,
        permit: await getPermit(db, current.id),
        employeeDeposit
      };
    }
  }

  const permitResult = await db.prepare(`
    UPDATE drawer_close_permits
    SET status = 'APPROVED', decision_note = ?, decided_by_role = ?, decided_by_id = ?, decided_at = ?
    WHERE id = ? AND status = 'PENDING'
  `).bind(note, approverRole, approverId, now, current.id).run();
  if (!permitResult.success || Number(permitResult.meta?.changes ?? 0) !== 1) {
    return { ok: false, status: 409, error: 'Pengajuan sudah diputuskan oleh request lain (laci sudah terlanjur ditutup).', drawerCommitted: true };
  }

  return { ok: true, permit: await getPermit(db, current.id), employeeDeposit };
}

async function handleCashierClosePermit(request, env, pathname) {
  if (!pathname.startsWith('/api/cashier/drawer/close-permits')) return null;
  const db = env.DB;
  const auth = await requireCashier(request, db);
  if (!auth.ok) return auth.response;
  const cashier = auth.cashier;

  if (request.method === 'GET' && pathname === '/api/cashier/drawer/close-permits') {
    await expireStalePermits(db, cashier.store.id);
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
    // Pengajuan lama yang sudah lebih dari 24 jam kadaluarsa dulu di sini --
    // supaya pengajuan pending yang sebenarnya sudah basi tidak menghalangi
    // pengajuan baru selamanya (PERMIT_ALREADY_PENDING).
    await expireStalePermits(db, cashier.store.id);
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
    const created = await getPermit(db, id);

    // Bos Cyo, 2026-09-19: "kalo admin aktifkan auto permit juga akan
    // langsung." Toggle store yang sama dipakai approval_requests -- gerai
    // yang sudah mengaktifkannya tidak perlu menunggu Admin klik ACC sama
    // sekali, laci langsung tertutup saat itu juga.
    if (await isAutoPermitEnabled(db, cashier.store.id)) {
      const outcome = await applyClosePermitApproval(db, cashier.store, created, {
        approverRole: 'AUTO_PERMIT', approverId: '', note: 'Auto Permit'
      });
      if (!outcome.ok) return json(outcome, outcome.status);
      return json({ ok: true, permit: outcome.permit, employeeDeposit: outcome.employeeDeposit, autoPermit: true }, 201);
    }

    return json({ ok: true, permit: created }, 201);
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
    await expireStalePermits(db, store.id);
    const rawStatus = text(new URL(request.url).searchParams.get('status'), 20) || 'PENDING';
    const status = rawStatus.toUpperCase() === 'ALL' ? null : rawStatus.toUpperCase();
    return json({ store, permits: await listPermits(db, { storeId: store.id, status }) });
  }

  const decisionMatch = pathname.match(/^\/api\/admin\/drawer\/close-permits\/([^/]+)$/);
  if (request.method === 'PATCH' && decisionMatch) {
    const permitId = decodeURIComponent(decisionMatch[1]);
    await expireStalePermits(db, store.id);
    const current = await getPermit(db, permitId);
    if (!current) return json({ error: 'Pengajuan tidak ditemukan.' }, 404);
    if (current.storeId !== store.id) return json({ error: 'Pengajuan berada di gerai lain.', code: 'PERMIT_STORE_SCOPE_MISMATCH' }, 403);
    if (current.status !== 'PENDING') {
      return json({
        error: current.decidedByRole === 'SYSTEM'
          ? 'Pengajuan ini sudah kadaluarsa otomatis (lebih dari 24 jam tidak diputuskan Admin).'
          : 'Pengajuan ini sudah diputuskan sebelumnya.',
        code: current.decidedByRole === 'SYSTEM' ? 'PERMIT_EXPIRED' : undefined,
        permit: current
      }, 409);
    }

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

    const outcome = await applyClosePermitApproval(db, store, current, { approverRole, approverId, note });
    if (!outcome.ok) return json(outcome, outcome.status);
    return json({ ok: true, permit: outcome.permit, employeeDeposit: outcome.employeeDeposit });
  }

  return json({ error: 'Route permit tutup laci Admin tidak ditemukan.' }, 404);
}

export async function handleDrawerClosePermitApi(request, env, pathname) {
  const cashierResponse = await handleCashierClosePermit(request, env, pathname);
  if (cashierResponse) return cashierResponse;
  return handleManagementClosePermit(request, env, pathname);
}
