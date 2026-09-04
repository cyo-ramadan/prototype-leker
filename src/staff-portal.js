import { json } from './http.js';
import { requireCashier, latestAttendanceStatus } from './cashier-auth.js';
import { isMultipartRequest, readLivePhoto } from './live-photo.js';
import { getCashierRaportFacts } from './staff-raport.js';

const coord = value => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// Satu baris staff_attendance sekarang menjelaskan satu sesi kerja penuh
// (migration 0068): kolom lama (created_at/photo_type/latitude/longitude/
// location_accuracy_meters) adalah fakta presensi MASUK; check_out_* adalah
// fakta presensi PULANG pada baris yang sama. Baris lama dari sebelum
// migration ini (attendance_type='out' tanpa presensi masuk yang tercatat di
// baris yang sama) ditampilkan sebagai checkOut saja, checkIn null.
function mapAttendance(row) {
  const singlePhotoFact = {
    at: row.created_at,
    photoType: row.photo_type,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.location_accuracy_meters
  };
  const hasCheckOut = row.check_out_at != null;
  return {
    id: row.id,
    userId: row.user_id,
    storeId: row.store_id,
    status: row.status,
    checkIn: hasCheckOut || row.attendance_type !== 'out' ? singlePhotoFact : null,
    checkOut: hasCheckOut ? {
      at: row.check_out_at,
      photoType: row.check_out_photo_type,
      latitude: row.check_out_latitude,
      longitude: row.check_out_longitude,
      accuracyMeters: row.check_out_location_accuracy_meters
    } : (row.attendance_type === 'out' ? singlePhotoFact : null)
  };
}

async function listAttendance(db, userId, limit = 60) {
  const rows = await db.prepare(`
    SELECT id, user_id, store_id, attendance_type, photo_type, created_at, latitude, longitude, location_accuracy_meters,
           status, check_out_at, check_out_photo_type, check_out_latitude, check_out_longitude, check_out_location_accuracy_meters
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
    const now = new Date().toISOString();

    if (attendanceType === 'in') {
      const id = `attendance_${crypto.randomUUID()}`;
      await env.DB.prepare(`
        INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, latitude, longitude, location_accuracy_meters, status)
        VALUES (?, ?, ?, 'in', ?, ?, ?, ?, ?, ?, 'OPEN')
      `).bind(id, auth.cashier.id, auth.cashier.store.id, photo.bytes, photo.type, now, latitude, longitude, accuracy).run();
      const created = await env.DB.prepare(`
        SELECT id, user_id, store_id, attendance_type, photo_type, created_at, latitude, longitude, location_accuracy_meters,
               status, check_out_at, check_out_photo_type, check_out_latitude, check_out_longitude, check_out_location_accuracy_meters
        FROM staff_attendance WHERE id = ?
      `).bind(id).first();
      return json({ ok: true, attendance: mapAttendance(created) }, 201);
    }

    const open = await env.DB.prepare(`SELECT id FROM staff_attendance WHERE user_id = ? AND status = 'OPEN' ORDER BY created_at DESC LIMIT 1`).bind(auth.cashier.id).first();
    if (!open) return json({ error: 'Belum presensi masuk.', code: 'NOT_CHECKED_IN' }, 409);
    const result = await env.DB.prepare(`
      UPDATE staff_attendance
      SET status = 'CLOSED', check_out_at = ?, check_out_photo_blob = ?, check_out_photo_type = ?,
          check_out_latitude = ?, check_out_longitude = ?, check_out_location_accuracy_meters = ?
      WHERE id = ? AND status = 'OPEN'
    `).bind(now, photo.bytes, photo.type, latitude, longitude, accuracy, open.id).run();
    if (!result.success || Number(result.meta?.changes ?? 0) !== 1) {
      return json({ error: 'Presensi sudah berubah status di request lain.' }, 409);
    }
    const updated = await env.DB.prepare(`
      SELECT id, user_id, store_id, attendance_type, photo_type, created_at, latitude, longitude, location_accuracy_meters,
             status, check_out_at, check_out_photo_type, check_out_latitude, check_out_longitude, check_out_location_accuracy_meters
      FROM staff_attendance WHERE id = ?
    `).bind(open.id).first();
    return json({ ok: true, attendance: mapAttendance(updated) }, 201);
  }

  return json({ error: 'Route Portal Staf tidak ditemukan.' }, 404);
}
