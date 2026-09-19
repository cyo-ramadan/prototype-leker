import { json } from './http.js';
import { requireCashier, latestAttendanceStatus, loadJobDetail, loadSchedule, WAGE_SCALE } from './cashier-auth.js';
import { isMultipartRequest, readLivePhoto } from './live-photo.js';
import { getCashierRaportFacts } from './staff-raport.js';
import { getJakartaBusinessDate, getJakartaTimeOfDay, getJakartaDayOfWeek, timeOfDayToMinutes } from './time.js';

const coord = value => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function scheduleMap(scheduleRows) {
  return new Map((scheduleRows || []).map(row => [row.day_of_week, row]));
}

// Bos Cyo, 2026-09-19: "itu uda ada setting masuk dan pulang jm brp kn. nah
// brarti ud bs tahu keterlambatannya" -- lalu diperluas: "akunnya dibikin
// lebih detil aja misal jam kerja dan hari kerja ... senin jam 9-18 sampai
// jumat sama, sabtu libur, minggu jam 9-22." Jadwal per hari (account_shift_
// schedule, migration 0106) dicocokkan ke HARI presensi MASUK (jam dinding
// Jakarta, bukan UTC hari kalender UTC yang bisa beda dekat tengah malam).
// null = hari itu libur ATAU belum diatur Admin sama sekali -- tidak bisa
// dinilai telat/tidak, BUKAN otomatis dianggap tepat waktu. 0/negatif =
// tepat waktu/lebih awal. Cuma dibandingkan jam-menit di hari yang sama --
// shift lintas tengah malam (mis. shift 3 mulai 23:00) sengaja tidak
// dihitung cross-day, kasus langka dan tidak diminta Bos Cyo.
function computeLateMinutes(checkInAt, scheduleByDay) {
  if (!checkInAt) return null;
  const day = scheduleByDay.get(getJakartaDayOfWeek(new Date(checkInAt)));
  if (!day || day.is_day_off || !day.shift_start) return null;
  const shiftMinutes = timeOfDayToMinutes(day.shift_start);
  if (shiftMinutes === null) return null;
  const checkInMinutes = timeOfDayToMinutes(getJakartaTimeOfDay(new Date(checkInAt)));
  return Math.max(0, checkInMinutes - shiftMinutes);
}

// Satu baris staff_attendance sekarang menjelaskan satu sesi kerja penuh
// (migration 0068): kolom lama (created_at/photo_type/latitude/longitude/
// location_accuracy_meters) adalah fakta presensi MASUK; check_out_* adalah
// fakta presensi PULANG pada baris yang sama. Baris lama dari sebelum
// migration ini (attendance_type='out' tanpa presensi masuk yang tercatat di
// baris yang sama) ditampilkan sebagai checkOut saja, checkIn null.
function mapAttendance(row, scheduleByDay = new Map()) {
  const singlePhotoFact = {
    at: row.created_at,
    photoType: row.photo_type,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.location_accuracy_meters
  };
  const hasCheckOut = row.check_out_at != null;
  const checkIn = hasCheckOut || row.attendance_type !== 'out' ? singlePhotoFact : null;
  return {
    id: row.id,
    userId: row.user_id,
    storeId: row.store_id,
    status: row.status,
    checkIn: checkIn ? { ...checkIn, lateMinutes: computeLateMinutes(checkIn.at, scheduleByDay) } : null,
    checkOut: hasCheckOut ? {
      at: row.check_out_at,
      photoType: row.check_out_photo_type,
      latitude: row.check_out_latitude,
      longitude: row.check_out_longitude,
      accuracyMeters: row.check_out_location_accuracy_meters
    } : (row.attendance_type === 'out' ? singlePhotoFact : null)
  };
}

async function listAttendance(db, userId, scheduleByDay, limit = 60) {
  const rows = await db.prepare(`
    SELECT id, user_id, store_id, attendance_type, photo_type, created_at, latitude, longitude, location_accuracy_meters,
           status, check_out_at, check_out_photo_type, check_out_latitude, check_out_longitude, check_out_location_accuracy_meters
    FROM staff_attendance WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `).bind(userId, limit).all();
  return (rows.results || []).map(row => mapAttendance(row, scheduleByDay));
}

// Bos Cyo, 2026-09-19: "pendapatan gaji perharinya harusnya juga masukin ke
// riwayat gaji ... untuk gaji kan uda diisi berapa per jam nya jadi uda bisa
// langsung diisi ya." Satu entry per sesi presensi SELESAI (CLOSED) --
// dihitung ulang tiap request dari fakta presensi + tarif akun saat ini,
// bukan snapshot beku (mengikuti pola Laporan Net Profit yang lain di repo
// ini). Sesi yang masih OPEN belum punya earning final ('sedang berjalan').
//
// Invariant CLAUDE.md #1 -- uang scaled integer, half-up: hourlyWageScaled
// sudah scaled (1 rupiah = 1_000_000 unit). Math.round() di sini membulatkan
// ke integer scaled terdekat, half-up untuk nilai non-negatif (yang selalu
// terjadi di sini karena gaji tidak pernah negatif) -- konsisten dengan
// invariant, tanpa perlu helper pembulatan terpisah.
function computeEarningScaled(paymentType, hourlyWageScaled, checkInAt, checkOutAt) {
  if (paymentType === 'SESI') return hourlyWageScaled;
  const minutes = Math.round((new Date(checkOutAt).getTime() - new Date(checkInAt).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.round((minutes * hourlyWageScaled) / 60);
}

function buildPayroll(attendanceRows, jobDetail) {
  if (!jobDetail) return [];
  const hourlyWageScaled = Number(jobDetail.hourly_wage_scaled || 0);
  const paymentType = jobDetail.payment_type || 'JAM';
  return attendanceRows
    .filter(row => row.status === 'CLOSED' && row.checkIn && row.checkOut)
    .map(row => {
      const earningScaled = computeEarningScaled(paymentType, hourlyWageScaled, row.checkIn.at, row.checkOut.at);
      return {
        attendanceId: row.id,
        date: getJakartaBusinessDate(new Date(row.checkIn.at)),
        paymentType,
        hoursWorked: paymentType === 'JAM'
          ? Math.round(((new Date(row.checkOut.at).getTime() - new Date(row.checkIn.at).getTime()) / 3600000) * 100) / 100
          : null,
        earningRupiah: earningScaled / WAGE_SCALE
      };
    });
}

export async function handleStaffPortalApi(request, env, pathname) {
  if (!pathname.startsWith('/api/staff/')) return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;

  if (request.method === 'GET' && pathname === '/api/staff/portal') {
    const jobDetail = await loadJobDetail(env.DB, auth.cashier.id);
    const scheduleByDay = scheduleMap(await loadSchedule(env.DB, auth.cashier.id));
    const attendance = await listAttendance(env.DB, auth.cashier.id, scheduleByDay);
    return json({
      staff: { userId: auth.cashier.id, username: auth.cashier.username, employeeName: auth.cashier.employeeName, store: auth.cashier.store },
      attendance,
      attendanceStatus: await latestAttendanceStatus(env.DB, auth.cashier.id),
      kpi: await getCashierRaportFacts(env.DB, auth.cashier.store.id, auth.cashier.id),
      deposits: [], payroll: buildPayroll(attendance, jobDetail)
    });
  }

  // Riwayat Presensi menampilkan thumbnail foto -- foto sudah ada watermark
  // jam+GPS terbakar di pixel-nya sejak diambil (lihat drawWatermark() di
  // camera-snapshot-modal.js), jadi endpoint ini cuma menyalurkan blob yang
  // sudah tersimpan, tidak menambah watermark apa pun. Discoped ketat ke milik
  // kasir yang login sendiri (user_id = auth.cashier.id) -- kasir tidak boleh
  // bisa intip foto presensi staf lain lewat tebak-tebak id.
  const photoMatch = pathname.match(/^\/api\/staff\/attendance\/([^/]+)\/photo$/);
  if (request.method === 'GET' && photoMatch) {
    const which = new URL(request.url).searchParams.get('which') === 'out' ? 'out' : 'in';
    const blobColumn = which === 'out' ? 'check_out_photo_blob' : 'photo_blob';
    const typeColumn = which === 'out' ? 'check_out_photo_type' : 'photo_type';
    const row = await env.DB.prepare(`
      SELECT ${blobColumn} AS photo_blob, ${typeColumn} AS photo_type
      FROM staff_attendance WHERE id = ? AND user_id = ?
    `).bind(decodeURIComponent(photoMatch[1]), auth.cashier.id).first();
    if (!row || !row.photo_blob) return json({ error: 'Foto presensi tidak ditemukan.' }, 404);
    return new Response(row.photo_blob, {
      headers: { 'Content-Type': row.photo_type || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }
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
