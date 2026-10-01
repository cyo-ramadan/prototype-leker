import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getJakartaBusinessDate, jakartaWallClockToUtc } from './time.js';
import { mapAttendance, scheduleMap } from './staff-attendance.js';

// Bos Cyo, 2026-10-01: "dalam penilaian kpi manual oleh admin nanti jangan
// sampe menyusahkannya ... memanjakan owner yang berlaku sebagai admin."
// Laporan Presensi mengumpulkan di satu layar, per karyawan: jumlah sesi,
// telat, tidak tutup presensi, koreksi jam, dan semua catatan GPS (tanpa GPS,
// di luar radius, sudah di-ACC, masih merah). Baca-saja, tanpa skor otomatis --
// kebijakan bobot KPI tetap di tangan Admin.
//
// Bacaan D1 dibatasi gerai + rentang tanggal (default 30 hari) lewat indeks
// idx_staff_attendance_store_created dan dipotong MAX_SESSIONS baris.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS = 30;
const MAX_SESSIONS = 1500;
const MAX_DETAIL = 200;
const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);

function addDays(date, days) {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function resolveRange(url) {
  const to = DATE.test(url.searchParams.get('to') || '') ? url.searchParams.get('to') : getJakartaBusinessDate(new Date());
  const from = DATE.test(url.searchParams.get('from') || '') ? url.searchParams.get('from') : addDays(to, -(DEFAULT_DAYS - 1));
  if (from > to) return null;
  return {
    from, to,
    fromUtc: jakartaWallClockToUtc(from, '00:00').toISOString(),
    toExclusiveUtc: jakartaWallClockToUtc(addDays(to, 1), '00:00').toISOString()
  };
}

const emptyTotals = () => ({
  sessions: 0, lateCount: 0, lateMinutes: 0, autoClosed: 0, timeCorrections: 0,
  gpsNoGps: 0, gpsOutOfRadius: 0, gpsResolved: 0, gpsStillRed: 0, gpsPending: 0
});

// Satu titik GPS (masuk/pulang) -> ringkasan untuk laporan; null kalau tidak
// bermasalah. Admin melihat jarak asli (includeDistance).
function gpsPoint(which, fact, permit) {
  if (!fact || (fact.status !== 'NO_GPS' && fact.status !== 'OUT_OF_RADIUS')) return null;
  return {
    which,
    status: fact.status,
    distanceMeters: fact.distanceMeters ?? null,
    overRadiusMeters: fact.overRadiusMeters,
    resolved: Boolean(fact.resolved),
    resolutionNote: fact.resolved?.note || '',
    needsAttention: fact.needsAttention,
    permit: permit ? { id: permit.id, status: permit.status, reason: permit.reason || '', decisionNote: permit.decision_note || '' } : null
  };
}

export async function buildAttendanceReport(db, storeId, { requesterId = null, range }) {
  const conditions = ['a.store_id = ?', 'a.created_at >= ?', 'a.created_at < ?'];
  const values = [storeId, range.fromUtc, range.toExclusiveUtc];
  if (requesterId) { conditions.push('a.user_id = ?'); values.push(requesterId); }
  const rows = await db.prepare(`
    SELECT a.id, a.user_id, a.store_id, a.attendance_type, a.photo_type, a.created_at, a.latitude, a.longitude, a.location_accuracy_meters,
           a.status, a.check_out_at, a.check_out_photo_type, a.check_out_latitude, a.check_out_longitude, a.check_out_location_accuracy_meters,
           a.auto_closed, a.original_created_at, a.correction_reason, a.correction_decision_note,
           a.gps_in_status, a.gps_in_distance_m, a.gps_in_resolved_permit_id, a.gps_in_resolution_note,
           a.gps_out_status, a.gps_out_distance_m, a.gps_out_resolved_permit_id, a.gps_out_resolution_note,
           c.employee_name,
           pi.id AS in_permit_id, pi.status AS in_permit_status, pi.reason AS in_permit_reason, pi.decision_note AS in_permit_decision,
           po.id AS out_permit_id, po.status AS out_permit_status, po.reason AS out_permit_reason, po.decision_note AS out_permit_decision
    FROM staff_attendance a
    JOIN cashiers c ON c.id = a.user_id
    LEFT JOIN attendance_gps_permits pi ON pi.attendance_id = a.id AND pi.which = 'IN'
    LEFT JOIN attendance_gps_permits po ON po.attendance_id = a.id AND po.which = 'OUT'
    WHERE ${conditions.join(' AND ')}
    ORDER BY a.created_at DESC LIMIT ${MAX_SESSIONS + 1}
  `).bind(...values).all();
  const all = rows.results ?? [];
  const truncated = all.length > MAX_SESSIONS;
  const sessions = truncated ? all.slice(0, MAX_SESSIONS) : all;

  const userIds = [...new Set(sessions.map(row => row.user_id))];
  const schedules = new Map();
  for (let index = 0; index < userIds.length; index += 90) {
    const chunk = userIds.slice(index, index + 90);
    const scheduleRows = await db.prepare(`
      SELECT account_id, day_of_week, is_day_off, shift_start, shift_end
      FROM account_shift_schedule
      WHERE account_type = 'CASHIER' AND account_id IN (${chunk.map(() => '?').join(',')})
    `).bind(...chunk).all();
    for (const row of scheduleRows.results ?? []) {
      if (!schedules.has(row.account_id)) schedules.set(row.account_id, []);
      schedules.get(row.account_id).push(row);
    }
  }

  const perEmployee = new Map();
  const totals = emptyTotals();
  const detail = [];
  for (const row of sessions) {
    const mapped = mapAttendance(row, scheduleMap(schedules.get(row.user_id) || []), { includeDistance: true });
    const entry = perEmployee.get(row.user_id) || { cashierId: row.user_id, employeeName: row.employee_name || '', ...emptyTotals() };
    perEmployee.set(row.user_id, entry);
    const lateMinutes = mapped.checkIn?.lateMinutes || 0;
    const points = [
      gpsPoint('IN', mapped.checkIn?.gps, row.in_permit_id ? { id: row.in_permit_id, status: row.in_permit_status, reason: row.in_permit_reason, decision_note: row.in_permit_decision } : null),
      gpsPoint('OUT', mapped.checkOut?.gps, row.out_permit_id ? { id: row.out_permit_id, status: row.out_permit_status, reason: row.out_permit_reason, decision_note: row.out_permit_decision } : null)
    ].filter(Boolean);

    const bump = (key, n = 1) => { entry[key] += n; totals[key] += n; };
    bump('sessions');
    if (lateMinutes > 0) { bump('lateCount'); bump('lateMinutes', lateMinutes); }
    if (mapped.autoClosed) bump('autoClosed');
    if (mapped.correction) bump('timeCorrections');
    for (const point of points) {
      if (point.status === 'NO_GPS') bump('gpsNoGps'); else bump('gpsOutOfRadius');
      if (point.resolved) bump('gpsResolved');
      if (point.needsAttention) bump('gpsStillRed');
      if (point.permit?.status === 'PENDING') bump('gpsPending');
    }

    const flagged = lateMinutes > 0 || mapped.autoClosed || mapped.correction || points.length;
    if (flagged && detail.length < MAX_DETAIL) {
      detail.push({
        attendanceId: row.id,
        cashierId: row.user_id,
        employeeName: row.employee_name || '',
        checkInAt: mapped.checkIn?.at || null,
        checkOutAt: mapped.checkOut?.at || null,
        lateMinutes: lateMinutes > 0 ? lateMinutes : 0,
        autoClosed: mapped.autoClosed,
        correction: mapped.correction,
        gps: points
      });
    }
  }

  return {
    totals,
    employees: [...perEmployee.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'id')),
    detail,
    detailTruncated: detail.length >= MAX_DETAIL,
    truncated
  };
}

export async function handleAttendanceReportApi(request, env, pathname) {
  if (pathname !== '/api/admin/attendance-report' || request.method !== 'GET') return null;
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  const store = await resolveStore(db, token, { includeInactive: true });
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const url = new URL(request.url);
  const range = resolveRange(url);
  if (!range) return json({ error: 'Tanggal "dari" tidak boleh setelah tanggal "sampai".' }, 400);
  const requesterId = text(url.searchParams.get('requester'), 160) || null;

  const report = await buildAttendanceReport(db, store.id, { requesterId, range });
  const cashiers = await db.prepare(`SELECT id, employee_name FROM cashiers WHERE store_id = ? ORDER BY employee_name COLLATE NOCASE`).bind(store.id).all();
  return json({
    store,
    filters: { requester: requesterId, from: range.from, to: range.to },
    requesters: (cashiers.results ?? []).map(row => ({ id: row.id, name: row.employee_name })),
    ...report
  });
}
