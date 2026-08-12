import { json } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { isMultipartRequest, readLivePhoto } from './live-photo.js';

function mapAttendance(row) {
  return {
    id: row.id,
    userId: row.user_id,
    storeId: row.store_id,
    type: row.attendance_type,
    photoType: row.photo_type,
    createdAt: row.created_at
  };
}

async function listAttendance(db, userId, limit = 60) {
  const rows = await db.prepare(`
    SELECT id, user_id, store_id, attendance_type, photo_type, created_at
    FROM staff_attendance
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(userId, limit).all();
  return (rows.results || []).map(mapAttendance);
}

export async function handleStaffPortalApi(request, env, pathname) {
  if (!pathname.startsWith('/api/staff/')) return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;

  if (request.method === 'GET' && pathname === '/api/staff/portal') {
    return json({
      staff: {
        userId: auth.cashier.id,
        username: auth.cashier.username,
        employeeName: auth.cashier.employeeName,
        store: auth.cashier.store
      },
      attendance: await listAttendance(env.DB, auth.cashier.id),
      kpi: [],
      deposits: [],
      payroll: []
    });
  }

  if (request.method === 'POST' && pathname === '/api/staff/attendance') {
    if (!isMultipartRequest(request)) return json({ error: 'Presensi wajib dikirim sebagai multipart/form-data.' }, 415);
    const form = await request.formData();
    const attendanceType = String(form.get('type') || '').toLowerCase();
    if (!['in', 'out'].includes(attendanceType)) return json({ error: 'Tipe presensi wajib in atau out.' }, 400);
    const photo = await readLivePhoto(form, 'photo');
    if (!photo.ok) return json({ error: photo.error }, photo.status);

    const id = `attendance_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, auth.cashier.id, auth.cashier.store.id, attendanceType, photo.bytes, photo.type, now).run();

    return json({ ok: true, attendance: { id, userId: auth.cashier.id, storeId: auth.cashier.store.id, type: attendanceType, photoType: photo.type, createdAt: now } }, 201);
  }

  return json({ error: 'Route Portal Staf tidak ditemukan.' }, 404);
}
