import { getJakartaBusinessDate, getJakartaTimeOfDay, getJakartaDayOfWeek, timeOfDayToMinutes, jakartaWallClockToUtc } from './time.js';

// Bos Cyo, 2026-09-24: "presensi cs kok ngga muncul di web baru... yang ngga
// ada di webnya admin, jadi ini saya sama mba rika juga bingung mau cek
// presensi dan hitung honornya, harus buka web lama." Logika presensi +
// payroll ini dipakai DUA sisi -- Portal Staf (karyawan lihat riwayatnya
// sendiri, src/staff-portal.js) dan Admin Gerai (Bos Cyo/Admin lihat riwayat
// karyawan tertentu buat hitung honor, src/cashier-auth.js). Sengaja
// dipisah ke modul netral ini (bukan didefinisikan di salah satu lalu
// diimpor yang lain) supaya tidak ada arah impor melingkar antara
// cashier-auth.js <-> staff-portal.js, dan supaya rumus lateness/payroll-nya
// SATU sumber -- diubah di satu tempat, otomatis konsisten di kedua sisi.
export const WAGE_SCALE = 1_000_000;

export function scheduleMap(scheduleRows) {
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
export function mapAttendance(row, scheduleByDay = new Map()) {
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
    autoClosed: Boolean(row.auto_closed),
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

// Bos Cyo, 2026-09-24: "ketika satu jam setelah waktu presensi pulang dia
// belum absen maka langsung force close tanpa foto dan gps ... kartu
// presensi hari itu juga jadi warna kuning." Dibedakan eksplisit dari alur
// permit laci: "kalo laci gpp permit, karna memang akan dipakai cs lain.
// kalo presensi langsung force close karna urusannya cuma dengan cs
// bersangkutan" -- jadi LANGSUNG, tanpa pengajuan/ACC apa pun.
//
// check_out_at diisi jam PULANG JADWAL (shift_end), BUKAN shift_end+1jam --
// jam ekstra itu cuma jeda deteksi sebelum sistem menyimpulkan "memang lupa
// tutup", bukan jam lembur yang ikut dibayar. Bos Cyo eksplisit: lembur
// sungguhan jalurnya lain -- "secara lapangan itu nanti bisa pake id user
// backup atau lembur" (akun backup lintas gerai, atau entry Bea Gaji manual
// "lembur") -- bukan dari jam tambahan di force-close ini.
//
// Lazy-expiry (dicek ulang tiap listAttendance() dipanggil, plus eksplisit
// di awal POST /api/staff/attendance sebelum gerbang toggle presensi supaya
// sesi kelupaan kemarin tidak memblokir presensi masuk hari ini), BUKAN
// cron/polling periodik -- invariant CLAUDE.md #6, pola yang sama dengan
// expireStalePermits (src/cashier-drawer-close-permit.js).
//
// Hari yang jadwalnya belum diatur Admin sama sekali (bukan ditandai libur,
// cuma kosong) TIDAK di-force-close -- tidak ada "jam pulang" buat dijadikan
// acuan, konsisten dengan computeLateMinutes/isWithinScheduledWindow.
//
// `enabled` -- Bos Cyo, 2026-09-24: "perkara ga ada bayaran gaji ketika
// diluar jam kerja dan force close ini msukin ke settingan aja, bisa on,
// bisa off. defaultnya on aja." Saklar per-gerai (stores.
// attendance_schedule_gate_enabled, migration 0118) -- caller meneruskan
// nilainya dari store yang sedang dibuka. Off = fungsi ini no-op sama sekali.
export async function forceCloseOverdueSessions(db, userId, scheduleByDay, enabled = true) {
  if (!enabled) return;
  const openRows = await db.prepare(`SELECT id, created_at FROM staff_attendance WHERE user_id = ? AND status = 'OPEN'`).bind(userId).all();
  const rows = openRows.results ?? [];
  if (!rows.length) return;
  const nowMs = Date.now();
  for (const row of rows) {
    const day = scheduleByDay.get(getJakartaDayOfWeek(new Date(row.created_at)));
    if (!day || day.is_day_off || !day.shift_end) continue;
    const shiftEndUtc = jakartaWallClockToUtc(getJakartaBusinessDate(new Date(row.created_at)), day.shift_end);
    if (!shiftEndUtc) continue;
    const deadline = new Date(shiftEndUtc.getTime() + 60 * 60 * 1000);
    if (nowMs <= deadline.getTime()) continue;
    await db.prepare(`
      UPDATE staff_attendance SET status = 'CLOSED', check_out_at = ?, auto_closed = 1
      WHERE id = ? AND status = 'OPEN'
    `).bind(shiftEndUtc.toISOString(), row.id).run();
  }
}

export async function listAttendance(db, userId, scheduleByDay, enabled = true, limit = 60) {
  await forceCloseOverdueSessions(db, userId, scheduleByDay, enabled);
  const rows = await db.prepare(`
    SELECT id, user_id, store_id, attendance_type, photo_type, created_at, latitude, longitude, location_accuracy_meters,
           status, check_out_at, check_out_photo_type, check_out_latitude, check_out_longitude, check_out_location_accuracy_meters,
           auto_closed
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
export function computeEarningScaled(paymentType, hourlyWageScaled, checkInAt, checkOutAt) {
  if (paymentType === 'SESI') return hourlyWageScaled;
  const minutes = Math.round((new Date(checkOutAt).getTime() - new Date(checkInAt).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.round((minutes * hourlyWageScaled) / 60);
}

// Bos Cyo, 2026-09-24: "kalo cs masuk diluar jam kerja seharusnya kan engga
// masuk itungan gaji?" -- sebelum ini jadwal cuma dipakai buat label telat
// (computeLateMinutes), tidak pernah membatasi apakah sesinya dibayar.
// Sekarang jadi pagar gaji juga: presensi masuk di HARI yang ditandai Libur,
// atau di LUAR rentang shift_start..shift_end hari itu, gajinya 0 --
// presensinya sendiri TETAP tersimpan dan kelihatan di riwayat, cuma tidak
// ikut dihitung/dicatat sebagai gaji (Bos Cyo eksplisit pilih ini, bukan
// dipotong ke jam jadwal atau ditandai buat ditinjau manual).
//
// Jadwal yang belum diisi SAMA SEKALI untuk hari itu (bukan ditandai libur,
// cuma kosong/belum diatur Admin) TIDAK membatasi apa pun -- konsisten
// dengan computeLateMinutes: kosong berarti "belum ada aturan untuk
// dinilai", bukan otomatis dianggap "di luar jadwal". Shift lintas tengah
// malam sengaja tidak ditangani di sini juga (sama seperti
// computeLateMinutes), cuma dibandingkan jam-menit di hari presensi masuk.
export function isWithinScheduledWindow(checkInAt, scheduleByDay) {
  const day = scheduleByDay.get(getJakartaDayOfWeek(new Date(checkInAt)));
  if (!day) return true;
  if (day.is_day_off) return false;
  if (!day.shift_start || !day.shift_end) return true;
  const startMinutes = timeOfDayToMinutes(day.shift_start);
  const endMinutes = timeOfDayToMinutes(day.shift_end);
  const checkInMinutes = timeOfDayToMinutes(getJakartaTimeOfDay(new Date(checkInAt)));
  if (startMinutes === null || endMinutes === null || checkInMinutes === null) return true;
  return checkInMinutes >= startMinutes && checkInMinutes <= endMinutes;
}

// `scheduleGateEnabled` -- saklar Bos Cyo (lihat forceCloseOverdueSessions
// di atas untuk kutipan lengkap): off berarti SEMUA sesi dianggap dalam
// jadwal (withinSchedule selalu true), persis perilaku sebelum fitur ini ada.
export function buildPayroll(attendanceRows, jobDetail, scheduleByDay = new Map(), scheduleGateEnabled = true) {
  if (!jobDetail) return [];
  const hourlyWageScaled = Number(jobDetail.hourly_wage_scaled || 0);
  const paymentType = jobDetail.payment_type || 'JAM';
  return attendanceRows
    .filter(row => row.status === 'CLOSED' && row.checkIn && row.checkOut)
    .map(row => {
      const withinSchedule = !scheduleGateEnabled || isWithinScheduledWindow(row.checkIn.at, scheduleByDay);
      const earningScaled = withinSchedule ? computeEarningScaled(paymentType, hourlyWageScaled, row.checkIn.at, row.checkOut.at) : 0;
      return {
        attendanceId: row.id,
        date: getJakartaBusinessDate(new Date(row.checkIn.at)),
        paymentType,
        hoursWorked: paymentType === 'JAM'
          ? Math.round(((new Date(row.checkOut.at).getTime() - new Date(row.checkIn.at).getTime()) / 3600000) * 100) / 100
          : null,
        earningRupiah: earningScaled / WAGE_SCALE,
        withinSchedule
      };
    });
}
