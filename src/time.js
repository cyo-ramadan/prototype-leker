const BUSINESS_TIME_ZONE = 'Asia/Jakarta';

export function isoNow(date = new Date()) {
  return date.toISOString();
}

export function getJakartaBusinessDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

// "HH:MM" jam dinding Jakarta -- dipakai membandingkan jam presensi ke
// shift_start/shift_end (account_job_details), yang juga diisi Admin sebagai
// jam dinding lokal, bukan UTC.
export function getJakartaTimeOfDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.hour}:${values.minute}`;
}

// Menit sejak tengah malam, dari string "HH:MM". Dipakai untuk selisih
// keterlambatan -- integer, tidak ada isu float sama sekali (bukan uang,
// tapi tetap dihindari desimal supaya perbandingannya presisi).
export function timeOfDayToMinutes(hhmm) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ''));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// 0=Minggu .. 6=Sabtu, hari kalender Jakarta (bukan UTC) -- dipakai
// account_shift_schedule (migration 0106) supaya jam kerja bisa beda per
// hari (mis. Senin-Jumat 09:00-18:00, Sabtu libur, Minggu 09:00-22:00).
// Dihitung dari tanggal Jakarta (Y-M-D) yang dikonstruksi ulang jadi UTC
// tengah hari, supaya aman dari isu DST/timezone -- cuma kalender yang
// dipakai, bukan jam.
export function getJakartaDayOfWeek(date = new Date()) {
  const [year, month, day] = getJakartaBusinessDate(date).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
