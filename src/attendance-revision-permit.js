import { json, readJson } from './http.js';
import { requireCashier, loadSchedule } from './cashier-auth.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getJakartaBusinessDate, getJakartaTimeOfDay, jakartaWallClockToUtc } from './time.js';
import { scheduleMap, recordSessionAccrual } from './staff-attendance.js';

// Revisi jam presensi oleh CS (Bos Cyo, 2026-10-17, migration 0162):
// "di portal cs kasih aja tombol cs untuk komplain masalah pencatatan, terus buat mekanisme dia bisa
// merevisi jam masuk yang dihitungnya, dan terbitkan ke permit draft revisi ... kalo nanti di acc maka
// perhitungannya mengikuti revisi itu, kalo tidak, owner/admin yang baca draft permit itu bisa mengedit
// draft nya sesuai kebijakannya lalu acc. atau juga bisa di tolak ... secara otomatis perubahan ini
// apabila ngelink ke akuntansi akan bikin jurnal pembalik sekaligus menambah baru jurnal revisi nya.
// jadi sifatnya itu semua nya karyawan yang mengkoreksi dan minta ijin, owner tinggal acc atau engga."
//
// Keputusan Bos: yang bisa direvisi jam masuk, jam pulang, dan lupa presensi (sesi baru); tanpa batas
// waktu; menggantikan permit koreksi jam masuk lama (src/attendance-correction-permit.js, hanya saat
// sesi berjalan) untuk pengajuan baru.
//
// ACC pada sesi yang sudah selesai: jam presensi diganti (jam asli disimpan), baris gaji sesi itu di
// Akun Gaji dibatalkan dan jurnalnya dibalik di tanggal sesi, gaji baru dicatat dari jam revisi
// (source_id `<attendance>#rev-<permit>`) dan dijurnal, lalu dana apresiasi shift di gerai & tanggal
// itu dinilai ulang. Sesi yang masih berjalan: hanya jam masuk yang diganti (gaji dicatat saat pulang).

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const REASON_MIN = 5;

function mapPermit(row) {
  return row ? {
    id: row.id,
    storeId: row.store_id,
    storeCode: row.store_code || '',
    accountId: row.account_id,
    requestedByName: row.employee_name || row.username || '',
    attendanceId: row.attendance_id || null,
    businessDate: row.business_date,
    originalCheckInAt: row.original_check_in_at || null,
    originalCheckOutAt: row.original_check_out_at || null,
    requestedCheckInAt: row.requested_check_in_at,
    requestedCheckOutAt: row.requested_check_out_at || null,
    approvedCheckInAt: row.approved_check_in_at || null,
    approvedCheckOutAt: row.approved_check_out_at || null,
    editedByApprover: Boolean(row.edited_by_approver),
    reason: row.reason,
    status: row.status,
    decisionNote: row.decision_note || '',
    decidedByRole: row.decided_by_role || null,
    decidedAt: row.decided_at || null,
    createdAt: row.created_at
  } : null;
}

const SELECT = `
  SELECT p.*, c.employee_name, c.username, s.code AS store_code
  FROM attendance_revision_permits p
  JOIN cashiers c ON c.id = p.account_id
  JOIN stores s ON s.id = p.store_id
`;

async function getPermit(db, id) {
  return mapPermit(await db.prepare(`${SELECT} WHERE p.id = ?`).bind(id).first());
}

export async function listRevisionPermits(db, { storeId = null, accountId = null, status = null } = {}) {
  const where = [];
  const values = [];
  if (storeId) { where.push('p.store_id = ?'); values.push(storeId); }
  if (accountId) { where.push('p.account_id = ?'); values.push(accountId); }
  if (status) { where.push('p.status = ?'); values.push(status); }
  const rows = await db.prepare(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.created_at DESC LIMIT 100`).bind(...values).all();
  return (rows.results ?? []).map(mapPermit);
}

// Jam JJ:MM pada tanggal bisnis -> ISO. Jam pulang wajib setelah jam masuk, tidak di masa depan.
export function validateTimes({ businessDate, checkIn, checkOut, requireCheckOut, now = new Date() }) {
  const inAt = jakartaWallClockToUtc(businessDate, text(checkIn, 5));
  if (!inAt) return { ok: false, error: 'Jam masuk tidak valid. Gunakan format JJ:MM, mis. 08:59.' };
  let outAt = null;
  if (text(checkOut, 5)) {
    outAt = jakartaWallClockToUtc(businessDate, text(checkOut, 5));
    if (!outAt) return { ok: false, error: 'Jam pulang tidak valid. Gunakan format JJ:MM, mis. 18:00.' };
    if (outAt <= inAt) return { ok: false, error: 'Jam pulang harus setelah jam masuk.' };
    if (outAt > now) return { ok: false, error: 'Jam pulang tidak boleh di masa depan.' };
  } else if (requireCheckOut) {
    return { ok: false, error: 'Jam pulang wajib diisi.' };
  }
  if (inAt > now) return { ok: false, error: 'Jam masuk tidak boleh di masa depan.' };
  return { ok: true, checkInIso: inAt.toISOString(), checkOutIso: outAt ? outAt.toISOString() : null };
}

async function loadAttendance(db, id) {
  return db.prepare(`
    SELECT id, user_id, store_id, attendance_type, created_at, status, check_out_at, original_created_at, original_check_out_at
    FROM staff_attendance WHERE id = ?
  `).bind(id).first();
}

async function overlapsOtherSession(db, accountId, fromIso, toIso, exceptId = '') {
  const row = await db.prepare(`
    SELECT 1 FROM staff_attendance
    WHERE user_id = ? AND id <> ? AND created_at < ? AND COALESCE(check_out_at, '9999') > ? LIMIT 1
  `).bind(accountId, exceptId, toIso || fromIso, fromIso).first();
  return Boolean(row);
}

// Draft pengajuan: dari sesi yang ada (attendanceId) atau sesi baru (businessDate) bila lupa presensi.
export async function createRevisionPermit(db, { cashier, attendanceId, businessDate, checkIn, checkOut, reason, now = new Date() }) {
  const reasonText = text(reason, 500);
  if (reasonText.length < REASON_MIN) return { ok: false, status: 400, error: `Alasan wajib diisi (minimal ${REASON_MIN} karakter), mis. "lupa absen, datang 08:59".` };
  let attendance = null;
  let date = text(businessDate, 10);
  if (attendanceId) {
    attendance = await loadAttendance(db, text(attendanceId, 120));
    if (!attendance || attendance.user_id !== cashier.id) return { ok: false, status: 404, error: 'Presensi tidak ditemukan.' };
    if (attendance.attendance_type === 'out' && !attendance.check_out_at) return { ok: false, status: 409, error: 'Sesi lama ini tidak punya jam masuk yang bisa direvisi.' };
    date = getJakartaBusinessDate(new Date(attendance.created_at));
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, status: 400, error: 'Pilih tanggal sesi yang lupa dipresensi.' };
  }
  const open = attendance?.status === 'OPEN';
  if (open && text(checkOut, 5)) return { ok: false, status: 400, error: 'Sesi ini belum presensi pulang; yang bisa direvisi sekarang hanya jam masuk.' };
  const checked = validateTimes({ businessDate: date, checkIn, checkOut, requireCheckOut: !open, now });
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  if (attendance && checked.checkInIso === attendance.created_at && (checked.checkOutIso || null) === (attendance.check_out_at || null)) {
    return { ok: false, status: 400, error: 'Jam yang diajukan sama dengan yang tercatat.' };
  }
  if (await overlapsOtherSession(db, cashier.id, checked.checkInIso, checked.checkOutIso, attendance?.id || '')) {
    return { ok: false, status: 409, error: 'Jam yang diajukan bertabrakan dengan sesi presensi lain milikmu.' };
  }
  const store = await db.prepare('SELECT entity_id FROM stores WHERE id = ?').bind(attendance?.store_id || cashier.store.id).first();
  const id = `attrev_${crypto.randomUUID()}`;
  try {
    await db.prepare(`
      INSERT INTO attendance_revision_permits (id, entity_id, store_id, account_id, attendance_id, business_date,
        original_check_in_at, original_check_out_at, requested_check_in_at, requested_check_out_at, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, store?.entity_id || '', attendance?.store_id || cashier.store.id, cashier.id, attendance?.id || null, date,
      attendance?.created_at || null, attendance?.check_out_at || null, checked.checkInIso, checked.checkOutIso, reasonText
    ).run();
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) return { ok: false, status: 409, error: 'Sudah ada pengajuan revisi untuk sesi/tanggal ini yang menunggu keputusan.' };
    throw error;
  }
  return { ok: true, permit: await getPermit(db, id) };
}

async function dispatch(db, action, factType, factId, reason) {
  try {
    const bridge = await import('./accounting-admin-bridge.js');
    return action === 'reverse'
      ? await bridge.reverseAdminAccountingFact(db, factType, factId, reason)
      : await bridge.dispatchAdminAccountingFact(db, factType, factId);
  } catch (error) {
    console.warn('jurnal revisi presensi gagal', factType, factId, error?.message);
    return null;
  }
}

// Gaji sesi dibatalkan + dibalik, lalu dicatat ulang dari jam revisi.
async function rebookSessionPay(db, { attendance, permitId, approver, checkInIso, checkOutIso }) {
  const old = (await db.prepare(`
    SELECT id FROM payroll_ledger_entries
    WHERE source_type = 'ATTENDANCE' AND entry_type = 'ACCRUAL' AND voided_at IS NULL
      AND (source_id = ? OR source_id LIKE ?)
  `).bind(attendance.id, `${attendance.id}#%`).all()).results ?? [];
  for (const row of old) {
    await db.prepare(`
      UPDATE payroll_ledger_entries SET voided_at = CURRENT_TIMESTAMP, voided_by_role = ?, voided_by_id = ?, void_reason = ?
      WHERE id = ? AND voided_at IS NULL
    `).bind(approver.role, approver.id, `Revisi jam presensi ${permitId}`, row.id).run();
    await dispatch(db, 'reverse', 'GAJI_PRESENSI', row.id, 'Revisi jam presensi');
  }
  const sourceId = `${attendance.id}#rev-${permitId}`;
  const result = await recordSessionAccrual(db, {
    accountId: attendance.user_id, storeId: attendance.store_id, checkInAt: checkInIso, checkOutAt: checkOutIso,
    attendanceId: sourceId, scheduleByDay: scheduleMap(await loadSchedule(db, attendance.user_id)),
    scheduleGateEnabled: await scheduleGateFor(db, attendance.store_id)
  });
  if (!result.skipped) {
    const entry = await db.prepare(`SELECT id FROM payroll_ledger_entries WHERE source_type = 'ATTENDANCE' AND source_id = ?`).bind(sourceId).first();
    if (entry) await dispatch(db, 'dispatch', 'GAJI_PRESENSI', entry.id);
  }
}

async function scheduleGateFor(db, storeId) {
  try {
    const { resolveTenantId, getTenantPolicySetting, ATTENDANCE_SCHEDULE_GATE_KEY } = await import('./tenant-policy.js');
    const store = await db.prepare('SELECT entity_id FROM stores WHERE id = ?').bind(storeId).first();
    return await getTenantPolicySetting(db, await resolveTenantId(db, store?.entity_id), ATTENDANCE_SCHEDULE_GATE_KEY);
  } catch {
    return true;
  }
}

async function reevaluateApresiasi(db, storeId, businessDate, approver) {
  try {
    const { reevaluate } = await import('./dana-apresiasi.js');
    const rows = (await db.prepare('SELECT id FROM apresiasi_evaluations WHERE store_id = ? AND business_date = ?').bind(storeId, businessDate).all()).results ?? [];
    for (const row of rows) await reevaluate(db, row.id, { actor: approver, reason: 'Revisi jam presensi' });
  } catch (error) {
    console.warn('nilai ulang apresiasi gagal', error?.message);
  }
}

// ACC (dengan jam hasil edit owner/admin bila ada).
export async function approveRevision(db, { permitId, approver, note = '', checkIn, checkOut, now = new Date() }) {
  const permit = await getPermit(db, permitId);
  if (!permit) return { ok: false, status: 404, error: 'Pengajuan tidak ditemukan.' };
  if (permit.status !== 'PENDING') return { ok: false, status: 409, error: 'Pengajuan ini sudah diputuskan.', permit };
  let attendance = permit.attendanceId ? await loadAttendance(db, permit.attendanceId) : null;
  if (permit.attendanceId && !attendance) return { ok: false, status: 409, error: 'Sesi presensi asal tidak ditemukan.' };
  // Sesi yang diajukan saat masih berjalan lalu keburu presensi pulang tetap bisa di-ACC (jam pulang asli dipakai).
  if (attendance && (attendance.created_at !== permit.originalCheckInAt || (permit.originalCheckOutAt && attendance.check_out_at !== permit.originalCheckOutAt))) {
    return { ok: false, status: 409, error: 'Jam presensi sesi ini sudah berubah sejak diajukan. Tolak dan minta CS mengajukan ulang.' };
  }
  const open = attendance?.status === 'OPEN';
  const edited = Boolean(text(checkIn, 5) || text(checkOut, 5));
  const inText = text(checkIn, 5) || getJakartaTimeOfDay(new Date(permit.requestedCheckInAt));
  const fallbackOut = permit.requestedCheckOutAt || attendance?.check_out_at || null;
  const outText = open ? '' : (text(checkOut, 5) || (fallbackOut ? getJakartaTimeOfDay(new Date(fallbackOut)) : ''));
  const checked = validateTimes({ businessDate: permit.businessDate, checkIn: inText, checkOut: outText, requireCheckOut: !open, now });
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  if (await overlapsOtherSession(db, permit.accountId, checked.checkInIso, checked.checkOutIso, attendance?.id || '')) {
    return { ok: false, status: 409, error: 'Jam ini bertabrakan dengan sesi presensi lain milik CS ini.' };
  }
  const decidedAt = now.toISOString();
  const claim = await db.prepare(`
    UPDATE attendance_revision_permits
    SET status = 'APPROVED', approved_check_in_at = ?, approved_check_out_at = ?, edited_by_approver = ?,
        decision_note = ?, decided_by_role = ?, decided_by_id = ?, decided_at = ?
    WHERE id = ? AND status = 'PENDING'
  `).bind(checked.checkInIso, checked.checkOutIso, edited ? 1 : 0, text(note, 500), approver.role, approver.id, decidedAt, permit.id).run();
  if (Number(claim.meta?.changes ?? 0) !== 1) return { ok: false, status: 409, error: 'Pengajuan sudah diputuskan oleh request lain.' };

  const correctionNote = `${permit.reason}${edited ? ' (jam diedit saat ACC)' : ''}`;
  if (!attendance) {
    const id = `attendance_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status, check_out_at,
        revision_permit_id, correction_reason, correction_decision_note)
      VALUES (?, ?, ?, 'in', x'', 'none', ?, 'CLOSED', ?, ?, ?, ?)
    `).bind(id, permit.accountId, permit.storeId, checked.checkInIso, checked.checkOutIso, permit.id, correctionNote, text(note, 500)).run();
    attendance = await loadAttendance(db, id);
  } else {
    await db.prepare(`
      UPDATE staff_attendance
      SET original_created_at = COALESCE(original_created_at, created_at),
          original_check_out_at = CASE WHEN check_out_at IS NOT NULL THEN COALESCE(original_check_out_at, check_out_at) ELSE original_check_out_at END,
          created_at = ?, check_out_at = COALESCE(?, check_out_at), revision_permit_id = ?,
          correction_reason = ?, correction_decision_note = ?
      WHERE id = ?
    `).bind(checked.checkInIso, checked.checkOutIso, permit.id, correctionNote, text(note, 500), attendance.id).run();
  }
  if (!open) {
    await rebookSessionPay(db, { attendance, permitId: permit.id, approver, checkInIso: checked.checkInIso, checkOutIso: checked.checkOutIso });
    await reevaluateApresiasi(db, permit.storeId, permit.businessDate, approver);
  }
  return { ok: true, permit: await getPermit(db, permit.id) };
}

export async function rejectRevision(db, { permitId, approver, note }) {
  const noteText = text(note, 500);
  if (noteText.length < 3) return { ok: false, status: 400, error: 'Alasan penolakan wajib diisi supaya CS tahu kenapa.' };
  const result = await db.prepare(`
    UPDATE attendance_revision_permits SET status = 'REJECTED', decision_note = ?, decided_by_role = ?, decided_by_id = ?, decided_at = ?
    WHERE id = ? AND status = 'PENDING'
  `).bind(noteText, approver.role, approver.id, new Date().toISOString(), permitId).run();
  if (Number(result.meta?.changes ?? 0) !== 1) return { ok: false, status: 409, error: 'Pengajuan sudah diputuskan sebelumnya.' };
  return { ok: true, permit: await getPermit(db, permitId) };
}

export async function handleAttendanceRevisionApi(request, env, pathname) {
  const db = env.DB;
  if (pathname === '/api/staff/attendance-revisions') {
    const auth = await requireCashier(request, db);
    if (!auth.ok) return auth.response;
    if (request.method === 'GET') return json({ permits: await listRevisionPermits(db, { accountId: auth.cashier.id }) });
    if (request.method !== 'POST') return json({ error: 'Method tidak didukung.' }, 405);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload pengajuan tidak valid.' }, 400);
    const result = await createRevisionPermit(db, { cashier: auth.cashier, ...body.value });
    return result.ok ? json({ ok: true, permit: result.permit }, 201) : json({ error: result.error }, result.status);
  }
  if (!pathname.startsWith('/api/admin/attendance-revisions')) return null;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const store = await resolveStore(db, new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE, { includeInactive: true });
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const approver = {
    role: auth.owner ? 'OWNER' : auth.entityAdmin ? 'ENTITY_ADMIN' : auth.admin ? 'ADMIN' : 'LEGACY_PIN',
    id: auth.owner?.id || auth.entityAdmin?.id || auth.admin?.id || ''
  };
  if (request.method === 'GET' && pathname === '/api/admin/attendance-revisions') {
    const raw = text(new URL(request.url).searchParams.get('status'), 20).toUpperCase() || 'PENDING';
    return json({ store, permits: await listRevisionPermits(db, { storeId: store.id, status: raw === 'ALL' ? null : raw }) });
  }
  const match = pathname.match(/^\/api\/admin\/attendance-revisions\/([^/]+)$/);
  if (request.method === 'PATCH' && match) {
    const permit = await getPermit(db, decodeURIComponent(match[1]));
    if (!permit) return json({ error: 'Pengajuan tidak ditemukan.' }, 404);
    if (permit.storeId !== store.id) return json({ error: 'Pengajuan berada di gerai lain.' }, 403);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload keputusan tidak valid.' }, 400);
    const decision = text(body.value?.decision, 10).toUpperCase();
    const result = decision === 'ACC'
      ? await approveRevision(db, { permitId: permit.id, approver, note: body.value?.note, checkIn: body.value?.checkIn, checkOut: body.value?.checkOut })
      : decision === 'REJECT'
        ? await rejectRevision(db, { permitId: permit.id, approver, note: body.value?.note })
        : { ok: false, status: 400, error: 'Decision wajib ACC atau REJECT.' };
    return result.ok ? json({ ok: true, permit: result.permit }) : json({ error: result.error, permit: result.permit }, result.status);
  }
  return json({ error: 'Route revisi presensi tidak ditemukan.' }, 404);
}
