import { json } from './http.js';
import { requireCashier, latestAttendanceStatus, loadJobDetail, loadSchedule } from './cashier-auth.js';
import { isMultipartRequest, readLivePhoto } from './live-photo.js';
import { getCashierRaportFacts } from './staff-raport.js';
// Bos Cyo, 2026-09-24: logika presensi+payroll dipindah ke modul bersama
// karena dipakai dua sisi sekarang -- Portal Staf (di sini) dan Admin Gerai
// (src/cashier-auth.js) -- lihat komentar di staff-attendance.js untuk
// alasan kenapa dipisah ke modul netral, bukan diimpor silang.
import { scheduleMap, mapAttendance, listAttendance, buildPayroll, computeEarningScaled, isWithinScheduledWindow } from './staff-attendance.js';
import { listPayrollAdjustments } from './payroll-adjustments.js';
import { isActivatedToday } from './entity-backup-cashiers.js';
import { recordAttendanceAccrual } from './payroll-ledger.js';
import { invalidateDailyProfitSnapshot } from './net-profit-report.js';
import { getJakartaBusinessDate } from './time.js';

const coord = value => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

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
      deposits: [],
      payroll: buildPayroll(attendance, jobDetail, scheduleByDay),
      // Bos Cyo, 2026-09-24: "gaji nanti juga bisa dibuat oleh akuntan
      // sendiri ... jadi di tanggal 26 nanti akan terlihat 2 kartu." Ini
      // gaji karyawan sendiri -- entry Admin (Penyesuaian Gaji) wajib ikut
      // kelihatan di sini juga, bukan cuma di panel Admin.
      payrollAdjustments: await listPayrollAdjustments(env.DB, { accountId: auth.cashier.id, storeId: auth.cashier.store.id })
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

    // Bos Cyo, 2026-09-24: "intinya hal ini untuk menghindari di hari dan
    // jam normal cs ini presensi memakai user backup, karna user backup itu
    // gaji per jam nya lebih gede." Gerbangnya di presensi MASUK -- begitu
    // sudah presensi masuk (sesi sedang berjalan), presensi keluar dibiarkan
    // lewat tanpa cek ulang supaya orang yang sudah aktif tidak terjebak
    // kalau aktivasinya kebetulan berakhir tengah hari.
    if (attendanceType === 'in' && auth.cashier.isEntityBackup) {
      const activated = await isActivatedToday(env.DB, auth.cashier.id, auth.cashier.store.id);
      if (!activated) {
        return json({ error: 'Akun backup ini belum diaktifkan Admin untuk gerai ini hari ini. Minta Admin aktifkan dulu sebelum presensi masuk.', code: 'BACKUP_NOT_ACTIVATED' }, 403);
      }
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

    // Bos Cyo, 2026-09-24: "kalo dalam akuntansi ketika ada gaji harian itu
    // jurnalnya debet beban gaji kredit hutang gaji ... jadi harusnya nominal
    // di sesi jam harian itu uda mencetak beban dan hutang gaji." Begitu sesi
    // presensi SELESAI, langsung dicatat sebagai fakta ke Akun Gaji (ledger)
    // -- bukan cuma dihitung ulang tiap kali dilihat seperti sebelumnya.
    // Kalau belum ada detail gaji diisi (jobDetail null/tarif 0), tidak ada
    // apa pun yang dicatat -- bukan error, cuma memang belum ada nilainya.
    //
    // Lalu koreksi Bos Cyo di hari yang sama: "kalo cs masuk diluar jam
    // kerja seharusnya kan engga masuk itungan gaji?" -- sesi yang presensi
    // masuknya di hari Libur atau di luar shift_start..shift_end hari itu
    // TIDAK dicatat ke Akun Gaji sama sekali (bukan dicatat lalu dibatalkan)
    // -- presensinya sendiri tetap tersimpan seperti biasa di staff_attendance.
    const jobDetail = await loadJobDetail(env.DB, auth.cashier.id);
    if (jobDetail && isWithinScheduledWindow(updated.created_at, scheduleMap(await loadSchedule(env.DB, auth.cashier.id)))) {
      const earningScaled = computeEarningScaled(jobDetail.payment_type, jobDetail.hourly_wage_scaled, updated.created_at, updated.check_out_at);
      const businessDate = getJakartaBusinessDate(new Date(updated.created_at));
      await recordAttendanceAccrual(env.DB, {
        accountType: 'CASHIER',
        accountId: auth.cashier.id,
        storeId: auth.cashier.store.id,
        businessDate,
        checkInAtIso: updated.created_at,
        amountScaled: earningScaled,
        attendanceId: updated.id,
        description: `Gaji presensi ${businessDate}`
      });
      await invalidateDailyProfitSnapshot(env.DB, auth.cashier.store.id, businessDate);
    }

    return json({ ok: true, attendance: mapAttendance(updated) }, 201);
  }

  return json({ error: 'Route Portal Staf tidak ditemukan.' }, 404);
}
