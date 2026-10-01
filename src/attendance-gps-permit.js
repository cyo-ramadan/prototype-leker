import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { overRadiusMeters } from './attendance-gps.js';

// Bos Cyo, 2026-10-01: "mungkin cs bisa request untuk perbaikan salah gps/
// tanpa gps ini dengan mengirimkan permit dan alasannya. kalo di acc maka
// tandanya ilang dengan keterangan, kalo ga di acc ya tetap merah. pokok
// intinya dalam penilaian kpi manual oleh admin nanti jangan sampe
// menyusahkannya."
//
// Tidak menyentuh uang, jadi boleh diajukan kapan pun (sesi berjalan atau
// selesai) dan tidak kadaluarsa. Satu pengajuan per titik presensi seumur
// hidup (UNIQUE attendance_id + which): ditolak berarti final, supaya Admin
// tidak dibanjiri pengajuan ulang. ACC tidak menghapus status asli; ia mengisi
// gps_*_resolved_permit_id + keterangan sehingga tanda merahnya padam dan
// jejaknya tetap ada untuk laporan.

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const REASON_MIN_LENGTH = 5;
const REJECT_NOTE_MIN_LENGTH = 3;
const WHICH = new Set(['IN', 'OUT']);

function mapPermit(row, { includeDistance = false } = {}) {
  return row ? {
    id: row.id,
    storeId: row.store_id,
    attendanceId: row.attendance_id,
    which: row.which,
    requestedByCashierId: row.requested_by_cashier_id,
    requestedByName: row.requested_by_name || '',
    originalStatus: row.original_status,
    overRadiusMeters: row.original_status === 'OUT_OF_RADIUS' ? overRadiusMeters(row.original_distance_m) : null,
    ...(includeDistance ? { originalDistanceMeters: row.original_distance_m == null ? null : Number(row.original_distance_m) } : {}),
    attendanceAt: row.attendance_at || null,
    reason: row.reason || '',
    status: row.status,
    decisionNote: row.decision_note || '',
    decidedByRole: row.decided_by_role || null,
    decidedAt: row.decided_at || null,
    createdAt: row.created_at
  } : null;
}

const PERMIT_SELECT = `
  SELECT p.*, c.employee_name AS requested_by_name, a.created_at AS attendance_at
  FROM attendance_gps_permits p
  JOIN cashiers c ON c.id = p.requested_by_cashier_id
  JOIN staff_attendance a ON a.id = p.attendance_id
`;

async function getPermit(db, id, options) {
  return mapPermit(await db.prepare(`${PERMIT_SELECT} WHERE p.id = ?`).bind(id).first(), options);
}

async function listPermits(db, { storeId = null, cashierId = null, status = null } = {}, options) {
  const conditions = [];
  const values = [];
  if (storeId) { conditions.push('p.store_id = ?'); values.push(storeId); }
  if (cashierId) { conditions.push('p.requested_by_cashier_id = ?'); values.push(cashierId); }
  if (status) { conditions.push('p.status = ?'); values.push(status); }
  const rows = await db.prepare(`
    ${PERMIT_SELECT}
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY p.created_at DESC LIMIT 200
  `).bind(...values).all();
  return (rows.results ?? []).map(row => mapPermit(row, options));
}

export const listOwnGpsPermits = (db, cashierId) => listPermits(db, { cashierId });

const column = (which, name) => `gps_${which.toLowerCase()}_${name}`;

async function loadAttendance(db, id) {
  return db.prepare(`
    SELECT id, user_id, store_id, check_out_at,
           gps_in_status, gps_in_distance_m, gps_in_resolved_permit_id,
           gps_out_status, gps_out_distance_m, gps_out_resolved_permit_id
    FROM staff_attendance WHERE id = ?
  `).bind(id).first();
}

async function handleStaffSide(request, env, pathname) {
  const isPostRoute = /^\/api\/staff\/attendance\/[^/]+\/gps-permits$/.test(pathname);
  if (!isPostRoute && pathname !== '/api/staff/attendance-gps-permits') return null;
  const db = env.DB;
  const auth = await requireCashier(request, db);
  if (!auth.ok) return auth.response;
  const cashier = auth.cashier;

  if (request.method === 'GET' && pathname === '/api/staff/attendance-gps-permits') {
    return json({ permits: await listOwnGpsPermits(db, cashier.id) });
  }

  const match = pathname.match(/^\/api\/staff\/attendance\/([^/]+)\/gps-permits$/);
  if (request.method === 'POST' && match) {
    const attendance = await loadAttendance(db, decodeURIComponent(match[1]));
    if (!attendance || attendance.user_id !== cashier.id) return json({ error: 'Presensi tidak ditemukan.' }, 404);

    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload pengajuan tidak valid.' }, 400);
    const which = text(body.value?.which, 3).toUpperCase();
    if (!WHICH.has(which)) return json({ error: 'Pilih presensi masuk atau pulang yang GPS-nya mau diperbaiki.' }, 400);
    if (which === 'OUT' && !attendance.check_out_at) return json({ error: 'Sesi ini belum presensi pulang.' }, 409);

    const status = attendance[column(which, 'status')];
    if (!['NO_GPS', 'OUT_OF_RADIUS'].includes(status)) return json({ error: 'Presensi ini tidak punya tanda GPS yang perlu diperbaiki.', code: 'NOTHING_TO_FIX' }, 409);
    if (attendance[column(which, 'resolved_permit_id')]) return json({ error: 'Tanda GPS ini sudah diperbaiki Admin.', code: 'ALREADY_RESOLVED' }, 409);

    const existing = await db.prepare(`SELECT status FROM attendance_gps_permits WHERE attendance_id = ? AND which = ?`).bind(attendance.id, which).first();
    if (existing) {
      return json({
        error: existing.status === 'REJECTED'
          ? 'Pengajuan perbaikan GPS ini sudah ditolak Admin dan tidak bisa diajukan lagi.'
          : 'Pengajuan perbaikan GPS untuk presensi ini sudah pernah dibuat.',
        code: 'GPS_PERMIT_EXISTS'
      }, 409);
    }

    const reason = text(body.value?.reason, 500);
    if (reason.length < REASON_MIN_LENGTH) return json({ error: `Alasan wajib diisi (minimal ${REASON_MIN_LENGTH} karakter), mis. "GPS HP error, saya sudah di gerai".` }, 400);

    const id = `gpspermit_${crypto.randomUUID()}`;
    try {
      await db.prepare(`
        INSERT INTO attendance_gps_permits (
          id, store_id, attendance_id, which, requested_by_cashier_id, original_status, original_distance_m, reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, attendance.store_id, attendance.id, which, cashier.id, status, attendance[column(which, 'distance_m')] ?? null, reason).run();
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Pengajuan perbaikan GPS untuk presensi ini sudah pernah dibuat.', code: 'GPS_PERMIT_EXISTS' }, 409);
      throw error;
    }
    return json({ ok: true, permit: await getPermit(db, id) }, 201);
  }

  return json({ error: 'Route permit GPS presensi tidak ditemukan.' }, 404);
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

async function handleManagementSide(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/attendance-gps-permits')) return null;
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const approver = {
    role: auth.owner ? 'OWNER' : auth.entityAdmin ? 'ENTITY_ADMIN' : auth.admin ? 'ADMIN' : 'LEGACY_PIN',
    id: auth.owner?.id || auth.entityAdmin?.id || auth.admin?.id || ''
  };
  const options = { includeDistance: true };

  if (request.method === 'GET' && pathname === '/api/admin/attendance-gps-permits') {
    const rawStatus = text(new URL(request.url).searchParams.get('status'), 20).toUpperCase() || 'PENDING';
    return json({ store, permits: await listPermits(db, { storeId: store.id, status: rawStatus === 'ALL' ? null : rawStatus }, options) });
  }

  const match = pathname.match(/^\/api\/admin\/attendance-gps-permits\/([^/]+)$/);
  if (request.method === 'PATCH' && match) {
    const permit = await getPermit(db, decodeURIComponent(match[1]), options);
    if (!permit) return json({ error: 'Pengajuan tidak ditemukan.' }, 404);
    if (permit.storeId !== store.id) return json({ error: 'Pengajuan berada di gerai lain.', code: 'PERMIT_STORE_SCOPE_MISMATCH' }, 403);
    if (permit.status !== 'PENDING') return json({ error: 'Pengajuan ini sudah diputuskan sebelumnya.', permit }, 409);

    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload keputusan tidak valid.' }, 400);
    const decision = String(body.value?.decision || '').trim().toUpperCase();
    if (!['ACC', 'REJECT'].includes(decision)) return json({ error: 'Decision wajib ACC atau REJECT.' }, 400);
    const note = text(body.value?.note, 500);
    const decidedAt = new Date().toISOString();

    if (decision === 'REJECT') {
      if (note.length < REJECT_NOTE_MIN_LENGTH) return json({ error: 'Alasan penolakan wajib diisi supaya karyawan tahu kenapa.' }, 400);
      const result = await db.prepare(`
        UPDATE attendance_gps_permits
        SET status = 'REJECTED', decision_note = ?, decided_by_role = ?, decided_by_id = ?, decided_at = ?
        WHERE id = ? AND status = 'PENDING'
      `).bind(note, approver.role, approver.id, decidedAt, permit.id).run();
      if (Number(result.meta?.changes ?? 0) !== 1) return json({ error: 'Pengajuan sudah diputuskan oleh request lain.' }, 409);
      return json({ ok: true, permit: await getPermit(db, permit.id, options) });
    }

    // ACC: klaim permit dan padamkan tanda merah dalam satu batch; tanda hanya
    // padam bila titik itu memang masih bermasalah dan belum diperbaiki.
    const which = permit.which.toLowerCase();
    const resolution = `Alasan: ${permit.reason}${note ? ` · Catatan Admin: ${note}` : ''}`;
    const [claim, update] = await db.batch([
      db.prepare(`
        UPDATE attendance_gps_permits
        SET status = 'APPROVED', decision_note = ?, decided_by_role = ?, decided_by_id = ?, decided_at = ?
        WHERE id = ? AND status = 'PENDING'
      `).bind(note, approver.role, approver.id, decidedAt, permit.id),
      db.prepare(`
        UPDATE staff_attendance
        SET gps_${which}_resolved_permit_id = ?, gps_${which}_resolution_note = ?
        WHERE id = ? AND gps_${which}_status IN ('NO_GPS', 'OUT_OF_RADIUS') AND gps_${which}_resolved_permit_id IS NULL
          AND EXISTS (SELECT 1 FROM attendance_gps_permits WHERE id = ? AND status = 'APPROVED' AND decided_at = ?)
      `).bind(permit.id, resolution, permit.attendanceId, permit.id, decidedAt)
    ]);
    if (Number(claim.meta?.changes ?? 0) !== 1) return json({ error: 'Pengajuan sudah diputuskan oleh request lain.' }, 409);
    if (Number(update.meta?.changes ?? 0) !== 1) {
      await db.prepare(`
        UPDATE attendance_gps_permits
        SET status = 'REJECTED', decision_note = 'Otomatis ditolak: tanda GPS pada presensi ini sudah tidak ada.', decided_by_role = 'SYSTEM', decided_by_id = ''
        WHERE id = ? AND status = 'APPROVED' AND decided_at = ?
      `).bind(permit.id, decidedAt).run();
      return json({ error: 'Tanda GPS pada presensi ini sudah tidak ada, pengajuan otomatis ditolak.', code: 'NOTHING_TO_FIX', permit: await getPermit(db, permit.id, options) }, 409);
    }
    return json({ ok: true, permit: await getPermit(db, permit.id, options) });
  }

  return json({ error: 'Route permit GPS presensi Admin tidak ditemukan.' }, 404);
}

export async function handleAttendanceGpsPermitApi(request, env, pathname) {
  const staffResponse = await handleStaffSide(request, env, pathname);
  if (staffResponse) return staffResponse;
  return handleManagementSide(request, env, pathname);
}
