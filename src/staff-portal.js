import { json } from './http.js';
import { requireCashier, latestAttendanceStatus } from './cashier-auth.js';
import { isMultipartRequest, readLivePhoto } from './live-photo.js';
import { getCashierRaportFacts } from './staff-raport.js';

const coord = value => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function mapAttendance(row) {
  return {
    id: row.id,
    userId: row.user_id,
    storeId: row.store_id,
    type: row.attendance_type,
    photoType: row.photo_type,
    createdAt: row.created_at,
    latitude: row.latitude,
    longitude: row.longitude,
    locationAccuracyMeters: row.location_accuracy_meters
  };
}

async function listAttendance(db, userId, limit = 60) {
  const rows = await db.prepare(`
    SELECT id, user_id, store_id, attendance_type, photo_type, created_at, latitude, longitude, location_accuracy_meters
    FROM staff_attendance WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `).bind(userId, limit).all();
  return (rows.results || []).map(mapAttendance);
}

export async function handleStaffPortalApi(request, env, pathname) {
  if (!pathname.startsWith('/api/staff/')) return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;

  if (request.method === 'GET' && pathname === '/api/staff/portal') {
    return json({
      staff: { userId: auth.cashier.id, username: auth.cashier.username, employeeName: auth.cashier.employeeName, store: auth.cashier.store },
      attendance: await listAttendance(env.DB, auth.cashier.id),
      attendanceStatus: await latestAttendanceStatus(env.DB, auth.cashier.id),
      kpi: await getCashierRaportFacts(env.DB, auth.cashier.store.id, auth.cashier.id),
      deposits: [], payroll: []
    });
  }

  if (request.method === 'POST' && pathname === '/api/staff/attendance') {
    if (!isMultipartRequest(request)) return json({ error: 'Presensi wajib dikirim sebagai multipart/form-data.' }, 415);
    const form = await request.formData();
    const attendanceType = String(form.get('type') || '').toLowerCase();
    if (!['in', 'out'].includes(attendanceType)) return json({ error: 'Tipe presensi wajib in atau out.' }, 400);

    // 2026-09-04, Bos Cyo: presensi masuk/keluar adalah toggle state -- tidak
    // boleh presensi masuk dua kali berturut-turut tanpa presensi keluar
    // di antaranya, dan tidak bisa presensi keluar kalau belum presensi masuk.
    const currentStatus = await latestAttendanceStatus(env.DB, auth.cashier.id);
    if (attendanceType === 'in' && currentStatus === 'in') {
      return json({ error: 'Sudah presensi masuk. Presensi keluar dulu sebelum presensi masuk lagi.', code: 'ALREADY_CHECKED_IN' }, 409);
    }
    if (attendanceType === 'out' && currentStatus !== 'in') {
      return json({ error: 'Belum presensi masuk.', code: 'NOT_CHECKED_IN' }, 409);
    }

    const photo = await readLivePhoto(form, 'photo');
    if (!photo.ok) return json({ error: photo.error }, photo.status);
    const latitude = coord(form.get('latitude'));
    const longitude = coord(form.get('longitude'));
    const accuracy = coord(form.get('accuracy'));
    const id = `attendance_${crypto.randomUUID()}`; const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, latitude, longitude, location_accuracy_meters)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, auth.cashier.id, auth.cashier.store.id, attendanceType, photo.bytes, photo.type, now, latitude, longitude, accuracy).run();
    return json({ ok: true, attendance: { id, userId: auth.cashier.id, storeId: auth.cashier.store.id, type: attendanceType, photoType: photo.type, createdAt: now, latitude, longitude, locationAccuracyMeters: accuracy } }, 201);
  }

  return json({ error: 'Route Portal Staf tidak ditemukan.' }, 404);
}
