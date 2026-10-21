// H2: hitungan HR murni. Tidak menilai uang, tidak menulis fakta atau keputusan HR.
import { getJakartaBusinessDate, jakartaWallClockToUtc, timeOfDayToMinutes } from './time.js';

const DAY = 86400000;
const MINUTE = 60000;
const idOf = row => row.account_id ?? row.user_id ?? row.accountId ?? row.id;
const storeOf = row => row.store_id ?? row.storeId;
const dateOf = row => row.business_date ?? row.tanggal;
const ms = value => value == null ? NaN : new Date(value).getTime();
export const geserTanggalFina = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);

export function rentangShiftFina(tanggal, dari, sampai) {
  const a = timeOfDayToMinutes(dari), b = timeOfDayToMinutes(sampai);
  if (a === null || b === null || a === b) return null;
  const start = jakartaWallClockToUtc(tanggal, dari)?.getTime();
  const end = jakartaWallClockToUtc(geserTanggalFina(tanggal, b < a ? 1 : 0), sampai)?.getTime();
  return Number.isFinite(start) && end > start ? { start, end } : null;
}

function shifts(jadwal, dates) {
  return jadwal.flatMap(row => {
    if (Number(row.is_day_off) === 1) return [];
    return (dateOf(row) ? [dateOf(row)] : dates).flatMap(date => {
      if (row.day_of_week != null && Number(row.day_of_week) !== new Date(date + 'T00:00:00Z').getUTCDay()) return [];
      const range = rentangShiftFina(date, row.shift_start, row.shift_end);
      return range ? [{ ...row, ...range, accountId: idOf(row), storeId: storeOf(row), businessDate: date }] : [];
    });
  });
}

function attendance(row) {
  return { ...row, accountId: idOf(row), storeId: storeOf(row),
    start: ms(row.created_at), end: row.check_out_at ? ms(row.check_out_at) : (row.status === 'OPEN' ? Infinity : NaN) };
}
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const sameStore = (a, b) => Boolean(storeOf(a)) && storeOf(a) === storeOf(b);
const active = (row, at) => row.start <= at && row.end > at;

/** Shift yang SEDANG berjalan dan belum dijaga akun itu / pengganti tercatat.
 * Aktivasi harian menentukan gerai akun backup, bukan bukti kehadiran.
 */
export function cariShiftKosong({ jadwal = [], presensi = [], aktivasi = [], sekarang, deteksiMenit }) {
  const now = ms(sekarang);
  if (!Number.isFinite(now) || !Number.isInteger(deteksiMenit) || deteksiMenit < 0) throw new TypeError('Waktu dan deteksiMenit wajib valid dari pengaturan HR.');
  const today = getJakartaBusinessDate(new Date(now));
  const sessions = presensi.map(attendance);
  return shifts(jadwal, [geserTanggalFina(today, -1), today]).filter(shift => {
    if (shift.start + deteksiMenit * MINUTE > now || now >= shift.end) return false;
    return !sessions.some(session => {
      if (!sameStore(session, shift) || !active(session, now)) return false;
      if (session.accountId === shift.accountId) return true;
      // Hanya pilihan eksplisit; kehadiran CS lain tidak otomatis menutup shift ini.
      if (session.replaces_account_id !== shift.accountId) return false;
      return !aktivasi.some(a => idOf(a) === session.accountId && dateOf(a) === today && storeOf(a) !== shift.storeId);
    });
  }).map(shift => ({
    accountId: shift.accountId, name: shift.employee_name || shift.name || '',
    storeId: shift.storeId, businessDate: shift.businessDate,
    shiftStart: shift.shift_start, shiftEnd: shift.shift_end,
    mulai: new Date(shift.start).toISOString(), selesai: new Date(shift.end).toISOString(),
    lewatMenit: Math.floor((now - shift.start) / MINUTE)
  })).sort((a, b) => a.mulai.localeCompare(b.mulai) || String(a.accountId).localeCompare(String(b.accountId)));
}

/** Ketersediaan adalah saran; aktivasi/presensi tetap keputusan admin. */
export function pilihFreelance({ kandidat = [], jadwal = [], presensi = [], aktivasi = [], tanggal, dari, sampai, lintasGerai, storeId }) {
  const window = rentangShiftFina(tanggal, dari, sampai);
  if (!window) throw new TypeError('Jam backup wajib HH:MM dan berbeda.');
  const dates = [geserTanggalFina(tanggal, -1), tanggal, geserTanggalFina(tanggal, 1)];
  const busy = [...shifts(jadwal, dates), ...presensi.map(attendance)];
  const hariTugas = [tanggal, ...(getJakartaBusinessDate(new Date(window.end - 1)) !== tanggal ? [geserTanggalFina(tanggal, 1)] : [])];
  const seen = new Set();
  return [...kandidat].sort((a, b) => Number(storeOf(b) === storeId) - Number(storeOf(a) === storeId)).filter(row => {
    const id = idOf(row);
    const identity = row.employee_id || id;
    if (seen.has(identity) || row.status !== 'FREELANCE' || Number(row.is_active ?? 1) !== 1) return false;
    if (!lintasGerai && storeOf(row) !== storeId) return false;
    if (aktivasi.some(a => idOf(a) === id && hariTugas.includes(dateOf(a)) && storeOf(a) !== storeId)) return false;
    if (busy.some(b => (b.accountId === id || (row.employee_id && b.employee_id === row.employee_id)) && overlaps(b, window))) return false;
    seen.add(identity);
    return true;
  }).map(row => ({
    accountId: idOf(row), employeeId: row.employee_id || null, name: row.employee_name || row.name || '',
    storeId: storeOf(row), storeCode: row.store_code || '', isEntityBackup: Number(row.is_entity_backup) === 1,
    perluAktivasi: Number(row.is_entity_backup) === 1 && !aktivasi.some(a => idOf(a) === idOf(row) && dateOf(a) === tanggal && storeOf(a) === storeId)
  })).sort((a, b) => Number(b.storeId === storeId) - Number(a.storeId === storeId)
    || a.name.localeCompare(b.name, 'id') || String(a.accountId).localeCompare(String(b.accountId)));
}

/** Kosong/denda berasal dari evaluasi tersimpan, bukan kebijakan model.
 * Jumlah kejadian = shift bermasalah unik; satu shift bisa punya beberapa jenis masalah.
 * Nominal memakai scaled INTEGER string (signed), tidak pernah Number.
 */
export function rekapMasalah({ evaluasi = [], presensi = [], dari, sampai }) {
  const result = new Map();
  const sessions = presensi.map(attendance);
  const entry = row => {
    const id = idOf(row);
    if (!result.has(id)) result.set(id, { accountId: id, name: row.employee_name || row.name || '', telatMenit: 0,
      pulangAwalMenit: 0, kosongMenit: 0, denda: 0, dendaSkala: '0', lupaPulang: 0, kejadian: 0, bukti: [], events: new Set() });
    return result.get(id);
  };
  const used = new Set();
  const resolved = shifts(evaluasi, []);
  const groupKey = row => [row.accountId, storeOf(row)].join('|');
  const byAccount = new Map(), shiftsByAccount = new Map();
  for (const row of sessions) {
    const key = groupKey(row);
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key).push(row);
  }
  for (const row of resolved) {
    const key = groupKey(row);
    if (!shiftsByAccount.has(key)) shiftsByAccount.set(key, []);
    shiftsByAccount.get(key).push(row);
  }
  for (const shift of resolved) {
    if (shift.businessDate < dari || shift.businessDate > sampai) continue;
    const key = [shift.storeId, shift.accountId, shift.businessDate, shift.shift_start, shift.shift_end].join('|');
    if (used.has(key)) continue;
    used.add(key);
    const e = entry(shift);
    const own = (byAccount.get(groupKey(shift)) || []).filter(s => overlaps(s, shift));
    const late = own.length ? Math.max(0, Math.floor((Math.min(...own.map(s => s.start)) - shift.start) / MINUTE)) : 0;
    const last = own.length ? own.reduce((a, b) => a.end > b.end ? a : b) : null;
    const early = last && Number(last.auto_closed) !== 1 && Number.isFinite(last.end) ? Math.max(0, Math.floor((shift.end - last.end) / MINUTE)) : 0;
    const empty = Math.max(0, Number(shift.kosong_minutes || 0));
    const fine = Boolean(shift.denda_kind);
    e.telatMenit += late; e.pulangAwalMenit += early; e.kosongMenit += empty; e.denda += Number(fine);
    e.dendaSkala = (BigInt(e.dendaSkala) + BigInt(shift.denda_amount_scaled || '0')).toString();
    if (late || early || empty || fine) {
      e.events.add(key);
      e.bukti.push({ evaluationId: shift.id || null, businessDate: shift.businessDate, telatMenit: late,
        pulangAwalMenit: early, kosongMenit: empty, dendaKind: shift.denda_kind || '' });
    }
  }
  const closed = new Set();
  for (const session of sessions) {
    const shift = (shiftsByAccount.get(groupKey(session)) || []).find(s => overlaps(s, session) && s.businessDate >= dari && s.businessDate <= sampai);
    const date = shift?.businessDate || (Number.isFinite(session.start) ? getJakartaBusinessDate(new Date(session.start)) : '');
    if (!date || date < dari || date > sampai || Number(session.auto_closed) !== 1 || closed.has(session.id)) continue;
    closed.add(session.id);
    const e = entry(session);
    e.lupaPulang += 1;
    e.events.add(shift ? [shift.storeId, shift.accountId, shift.businessDate, shift.shift_start, shift.shift_end].join('|') : 'presensi:' + session.id);
    e.bukti.push({ attendanceId: session.id, businessDate: date, autoClosed: true });
  }
  return [...result.values()].filter(e => e.events.size).map(({ events, ...e }) => ({ ...e, kejadian: events.size }))
    .sort((a, b) => b.kejadian - a.kejadian || a.name.localeCompare(b.name, 'id'));
}
