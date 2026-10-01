import { json, readJson } from './http.js';
import { requireCashier, loadSchedule } from './cashier-auth.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getJakartaBusinessDate, getJakartaDayOfWeek, jakartaWallClockToUtc, timeOfDayToMinutes, getJakartaTimeOfDay } from './time.js';
import { scheduleMap } from './staff-attendance.js';

// Bos Cyo, 2026-10-01: "bikinin permit untuk absen telat. misal aslinya
// masuk jam 9 tapi dia baru absen jam 13. tapi alasannya syari, misalnya
// karna web nya error. mekanisme dia ngajuin permit untuk ngubah jam absen
// dia jadi jam 9, lalu masuk ke acc admin dan ketika di acc jam nya
// diperbaiki, dan ada catatan alasan waktu absennya dia diubah."
//
// Bos Cyo, 2026-10-01 (lanjutan): "dia permit nya waktu dia belum tutup laci
// ya, jadi masih belum di posted di akutansi. kalo misal dia tutup laci dan
// permit engga di acc berarti ya kadaluarsa permitnya. jalurnya nanti di
// penyesuaian." Jadi permit HANYA boleh diajukan selagi sesi presensi masih
// berjalan (OPEN) -- gaji baru masuk buku gaji dan jurnal Akuntansi saat
// presensi pulang, sehingga koreksi di tahap ini tidak menyentuh data yang
// sudah posted. Begitu sesinya selesai (presensi pulang atau ditutup sistem)
// dan permit belum diputuskan, permit EXPIRED (lazy, bukan cron -- invariant
// #6) dan koreksinya lewat Penyesuaian Gaji oleh Admin. Tidak ada Auto Permit:
// ini menyentuh gaji, selalu butuh keputusan Admin. Gaji sesi dihitung dari
// created_at saat presensi pulang, jadi jam hasil koreksi otomatis terpakai.
// Lihat contracts/attendance-correction-permit-v1.md.

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const REASON_MIN_LENGTH = 5;
const REJECT_NOTE_MIN_LENGTH = 3;

function mapPermit(row) {
  return row ? {
    id: row.id,
    storeId: row.store_id,
    attendanceId: row.attendance_id,
    requestedByCashierId: row.requested_by_cashier_id,
    requestedByName: row.requested_by_name || '',
    originalCheckInAt: row.original_check_in_at,
    requestedCheckInAt: row.requested_check_in_at,
    reason: row.reason || '',
    status: row.status,
    decisionNote: row.decision_note || '',
    decidedByRole: row.decided_by_role || null,
    decidedAt: row.decided_at || null,
    createdAt: row.created_at,
    attendanceStatus: row.attendance_status || null
  } : null;
}

const EXPIRED_NOTE = 'Kadaluarsa otomatis -- sesi presensi sudah selesai sebelum ada keputusan Admin. Koreksi lewat Penyesuaian Gaji.';
const SESSION_CLOSED_ERROR = 'Sesi presensi ini sudah selesai, jadi jam masuknya tidak bisa dikoreksi lewat permit. Minta Admin mengoreksinya lewat Penyesuaian Gaji.';

// Lazy-expiry: pengajuan PENDING yang sesinya sudah tidak OPEN jadi EXPIRED.
// Dipanggil saat presensi pulang (attendanceId) dan tiap permit dibaca/
// diputuskan (storeId/cashierId) -- sesi yang ditutup sistem (lupa pulang)
// juga tertangkap di sana.
export async function expirePermitsForClosedSessions(db, { attendanceId = null, storeId = null, cashierId = null } = {}) {
  const conditions = ["p.status = 'PENDING'"];
  const values = [];
  if (attendanceId) { conditions.push('p.attendance_id = ?'); values.push(attendanceId); }
  if (storeId) { conditions.push('p.store_id = ?'); values.push(storeId); }
  if (cashierId) { conditions.push('p.requested_by_cashier_id = ?'); values.push(cashierId); }
  await db.prepare(`
    UPDATE attendance_correction_permits
    SET status = 'EXPIRED', decision_note = ?, decided_by_role = 'SYSTEM', decided_by_id = '', decided_at = ?
    WHERE id IN (
      SELECT p.id FROM attendance_correction_permits p
      JOIN staff_attendance a ON a.id = p.attendance_id
      WHERE ${conditions.join(' AND ')} AND a.status <> 'OPEN'
    )
  `).bind(EXPIRED_NOTE, new Date().toISOString(), ...values).run();
}

export async function listOwnCorrectionPermits(db, cashierId) {
  await expirePermitsForClosedSessions(db, { cashierId });
  return listPermits(db, { cashierId });
}

const PERMIT_SELECT = `
  SELECT p.*, c.employee_name AS requested_by_name, a.status AS attendance_status
  FROM attendance_correction_permits p
  JOIN cashiers c ON c.id = p.requested_by_cashier_id
  JOIN staff_attendance a ON a.id = p.attendance_id
`;

async function getPermit(db, id) {
  return mapPermit(await db.prepare(`${PERMIT_SELECT} WHERE p.id = ?`).bind(id).first());
}

async function listPermits(db, { storeId = null, cashierId = null, status = null } = {}) {
  const conditions = [];
  const values = [];
  if (storeId) { conditions.push('p.store_id = ?'); values.push(storeId); }
  if (cashierId) { conditions.push('p.requested_by_cashier_id = ?'); values.push(cashierId); }
  if (status) { conditions.push('p.status = ?'); values.push(status); }
  const rows = await db.prepare(`
    ${PERMIT_SELECT}
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY p.created_at DESC LIMIT 100
  `).bind(...values).all();
  return (rows.results ?? []).map(mapPermit);
}

async function loadAttendance(db, id) {
  return db.prepare(`
    SELECT id, user_id, store_id, attendance_type, created_at, status, check_out_at, original_created_at
    FROM staff_attendance WHERE id = ?
  `).bind(id).first();
}

const hasCheckIn = row => row.check_out_at != null || row.attendance_type !== 'out';

// Aturan jam yang boleh diminta: hari bisnis Jakarta yang sama dengan presensi
// masuk, harus LEBIH AWAL dari jam yang tercatat (ini koreksi untuk telat),
// sebelum jam pulang bila sesi sudah selesai, dan tidak boleh lebih awal dari
// jam mulai shift hari itu (jadwal dipakai pagar gaji, jadi koreksi tidak boleh
// dipakai untuk mengklaim jam sebelum shift). Hari libur ditolak.
export function validateRequestedCheckIn(attendance, hhmm, scheduleByDay) {
  const original = new Date(attendance.created_at);
  const businessDate = getJakartaBusinessDate(original);
  const requested = jakartaWallClockToUtc(businessDate, text(hhmm, 5));
  if (!requested) return { ok: false, error: 'Jam koreksi tidak valid. Gunakan format JJ:MM, mis. 09:00.' };
  if (requested.getTime() >= original.getTime()) {
    return { ok: false, error: `Jam koreksi harus lebih awal dari jam presensi masuk yang tercatat (${getJakartaTimeOfDay(original)}).` };
  }
  if (attendance.check_out_at && requested.getTime() >= new Date(attendance.check_out_at).getTime()) {
    return { ok: false, error: 'Jam koreksi harus sebelum jam presensi pulang.' };
  }
  const day = scheduleByDay.get(getJakartaDayOfWeek(original));
  if (day?.is_day_off) return { ok: false, error: 'Hari itu ditandai libur di jadwal akun ini, jadi jam masuk tidak bisa dikoreksi.' };
  if (day?.shift_start) {
    const shiftStart = timeOfDayToMinutes(day.shift_start);
    if (shiftStart !== null && timeOfDayToMinutes(text(hhmm, 5)) < shiftStart) {
      return { ok: false, error: `Jam koreksi tidak boleh lebih awal dari jam mulai shift (${day.shift_start}).` };
    }
  }
  return { ok: true, requestedIso: requested.toISOString(), businessDate };
}

async function handleStaffSide(request, env, pathname) {
  const isPostRoute = /^\/api\/staff\/attendance\/[^/]+\/correction-permits$/.test(pathname);
  if (!isPostRoute && pathname !== '/api/staff/attendance-correction-permits') return null;
  const db = env.DB;
  const auth = await requireCashier(request, db);
  if (!auth.ok) return auth.response;
  const cashier = auth.cashier;

  if (request.method === 'GET' && pathname === '/api/staff/attendance-correction-permits') {
    return json({ permits: await listOwnCorrectionPermits(db, cashier.id) });
  }

  const match = pathname.match(/^\/api\/staff\/attendance\/([^/]+)\/correction-permits$/);
  if (request.method === 'POST' && match) {
    const attendance = await loadAttendance(db, decodeURIComponent(match[1]));
    if (!attendance || attendance.user_id !== cashier.id) return json({ error: 'Presensi tidak ditemukan.' }, 404);
    if (!hasCheckIn(attendance)) return json({ error: 'Sesi ini tidak punya presensi masuk yang bisa dikoreksi.' }, 409);
    if (attendance.status !== 'OPEN') return json({ error: SESSION_CLOSED_ERROR, code: 'SESSION_ALREADY_CLOSED' }, 409);
    if (attendance.original_created_at) {
      return json({ error: 'Jam masuk sesi ini sudah pernah dikoreksi, tidak bisa diajukan lagi.', code: 'ALREADY_CORRECTED' }, 409);
    }
    const pending = await db.prepare(`SELECT id FROM attendance_correction_permits WHERE attendance_id = ? AND status = 'PENDING'`).bind(attendance.id).first();
    if (pending) return json({ error: 'Sudah ada pengajuan koreksi untuk sesi ini yang menunggu ACC Admin.', code: 'PERMIT_ALREADY_PENDING' }, 409);

    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload pengajuan tidak valid.' }, 400);
    const reason = text(body.value?.reason, 500);
    if (reason.length < REASON_MIN_LENGTH) return json({ error: `Alasan wajib diisi (minimal ${REASON_MIN_LENGTH} karakter), mis. "web error saat presensi".` }, 400);

    const checked = validateRequestedCheckIn(attendance, body.value?.requestedTime, scheduleMap(await loadSchedule(db, cashier.id)));
    if (!checked.ok) return json({ error: checked.error }, 400);

    const id = `attcorr_${crypto.randomUUID()}`;
    try {
      await db.prepare(`
        INSERT INTO attendance_correction_permits (
          id, store_id, attendance_id, requested_by_cashier_id, original_check_in_at, requested_check_in_at, reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, cashier.store.id, attendance.id, cashier.id, attendance.created_at, checked.requestedIso, reason).run();
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) {
        return json({ error: 'Sudah ada pengajuan koreksi untuk sesi ini yang menunggu ACC Admin.', code: 'PERMIT_ALREADY_PENDING' }, 409);
      }
      throw error;
    }
    return json({ ok: true, permit: await getPermit(db, id) }, 201);
  }

  return json({ error: 'Route permit koreksi presensi tidak ditemukan.' }, 404);
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

async function markRejected(db, permitId, { role, id, note }) {
  return db.prepare(`
    UPDATE attendance_correction_permits
    SET status = 'REJECTED', decision_note = ?, decided_by_role = ?, decided_by_id = ?, decided_at = ?
    WHERE id = ? AND status = 'PENDING'
  `).bind(note, role, id, new Date().toISOString(), permitId).run();
}

// ACC: klaim permit dan penggantian jam masuk dijalankan SEKALIGUS dalam satu
// batch, dan penggantian jam hanya berlaku bila sesi masih OPEN, jamnya masih
// sama dengan saat diajukan, dan permit memang baru saja berhasil diklaim.
// Jadi tidak ada keadaan setengah jadi: sesi yang keburu ditutup di antara
// pengecekan dan penerapan membuat permit EXPIRED, bukan jam yang berubah.
async function approve(db, permit, approver, note) {
  const attendance = await loadAttendance(db, permit.attendanceId);
  if (!attendance || attendance.status !== 'OPEN') {
    await expirePermitsForClosedSessions(db, { attendanceId: permit.attendanceId });
    return { ok: false, status: 409, error: `Pengajuan kadaluarsa. ${SESSION_CLOSED_ERROR}`, code: 'PERMIT_EXPIRED', permit: await getPermit(db, permit.id) };
  }

  const scheduleByDay = scheduleMap(await loadSchedule(db, permit.requestedByCashierId));
  const stale = attendance.created_at !== permit.originalCheckInAt || attendance.original_created_at;
  const rechecked = stale ? null : validateRequestedCheckIn(attendance, getJakartaTimeOfDay(new Date(permit.requestedCheckInAt)), scheduleByDay);
  if (stale || !rechecked.ok) {
    const reason = stale ? 'Data presensi sudah berubah sejak diajukan.' : rechecked.error;
    await markRejected(db, permit.id, { role: 'SYSTEM', id: '', note: `Otomatis ditolak: ${reason}` });
    return { ok: false, status: 409, error: `Pengajuan tidak bisa di-ACC dan otomatis ditolak: ${reason}`, code: 'ATTENDANCE_CHANGED', permit: await getPermit(db, permit.id) };
  }

  const decidedAt = new Date().toISOString();
  const [claim, update] = await db.batch([
    db.prepare(`
      UPDATE attendance_correction_permits
      SET status = 'APPROVED', decision_note = ?, decided_by_role = ?, decided_by_id = ?, decided_at = ?
      WHERE id = ? AND status = 'PENDING'
    `).bind(note, approver.role, approver.id, decidedAt, permit.id),
    db.prepare(`
      UPDATE staff_attendance
      SET original_created_at = created_at, created_at = ?, correction_permit_id = ?,
          correction_reason = ?, correction_decision_note = ?
      WHERE id = ? AND status = 'OPEN' AND created_at = ? AND original_created_at IS NULL
        AND EXISTS (
          SELECT 1 FROM attendance_correction_permits
          WHERE id = ? AND status = 'APPROVED' AND decided_at = ?
        )
    `).bind(
      permit.requestedCheckInAt, permit.id, permit.reason, note,
      permit.attendanceId, permit.originalCheckInAt, permit.id, decidedAt
    )
  ]);
  if (Number(claim.meta?.changes ?? 0) !== 1) {
    return { ok: false, status: 409, error: 'Pengajuan sudah diputuskan oleh request lain.' };
  }
  if (Number(update.meta?.changes ?? 0) !== 1) {
    await db.prepare(`
      UPDATE attendance_correction_permits
      SET status = 'EXPIRED', decision_note = ?, decided_by_role = 'SYSTEM', decided_by_id = ''
      WHERE id = ? AND status = 'APPROVED' AND decided_at = ?
    `).bind(EXPIRED_NOTE, permit.id, decidedAt).run();
    return { ok: false, status: 409, error: `Pengajuan kadaluarsa. ${SESSION_CLOSED_ERROR}`, code: 'PERMIT_EXPIRED', permit: await getPermit(db, permit.id) };
  }
  return { ok: true, permit: await getPermit(db, permit.id) };
}

async function handleManagementSide(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/attendance-correction-permits')) return null;
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const approver = {
    role: auth.owner ? 'OWNER' : auth.entityAdmin ? 'ENTITY_ADMIN' : auth.admin ? 'ADMIN' : 'LEGACY_PIN',
    id: auth.owner?.id || auth.entityAdmin?.id || auth.admin?.id || ''
  };

  if (request.method === 'GET' && pathname === '/api/admin/attendance-correction-permits') {
    const rawStatus = text(new URL(request.url).searchParams.get('status'), 20).toUpperCase() || 'PENDING';
    const status = rawStatus === 'ALL' ? null : rawStatus;
    await expirePermitsForClosedSessions(db, { storeId: store.id });
    return json({ store, permits: await listPermits(db, { storeId: store.id, status }) });
  }

  const match = pathname.match(/^\/api\/admin\/attendance-correction-permits\/([^/]+)$/);
  if (request.method === 'PATCH' && match) {
    await expirePermitsForClosedSessions(db, { storeId: store.id });
    const permit = await getPermit(db, decodeURIComponent(match[1]));
    if (!permit) return json({ error: 'Pengajuan tidak ditemukan.' }, 404);
    if (permit.storeId !== store.id) return json({ error: 'Pengajuan berada di gerai lain.', code: 'PERMIT_STORE_SCOPE_MISMATCH' }, 403);
    if (permit.status === 'EXPIRED') return json({ error: `Pengajuan sudah kadaluarsa. ${SESSION_CLOSED_ERROR}`, code: 'PERMIT_EXPIRED', permit }, 409);
    if (permit.status !== 'PENDING') return json({ error: 'Pengajuan ini sudah diputuskan sebelumnya.', permit }, 409);

    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload keputusan tidak valid.' }, 400);
    const decision = String(body.value?.decision || '').trim().toUpperCase();
    if (!['ACC', 'REJECT'].includes(decision)) return json({ error: 'Decision wajib ACC atau REJECT.' }, 400);
    const note = text(body.value?.note, 500);

    if (decision === 'REJECT') {
      if (note.length < REJECT_NOTE_MIN_LENGTH) return json({ error: 'Alasan penolakan wajib diisi supaya karyawan tahu kenapa.' }, 400);
      const result = await markRejected(db, permit.id, { role: approver.role, id: approver.id, note });
      if (!result.success || Number(result.meta?.changes ?? 0) !== 1) return json({ error: 'Pengajuan sudah diputuskan oleh request lain.' }, 409);
      return json({ ok: true, permit: await getPermit(db, permit.id) });
    }

    const outcome = await approve(db, permit, approver, note);
    return json(outcome, outcome.ok ? 200 : outcome.status);
  }

  return json({ error: 'Route permit koreksi presensi Admin tidak ditemukan.' }, 404);
}

export async function handleAttendanceCorrectionPermitApi(request, env, pathname) {
  const staffResponse = await handleStaffSide(request, env, pathname);
  if (staffResponse) return staffResponse;
  return handleManagementSide(request, env, pathname);
}
