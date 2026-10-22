import { getJakartaBusinessDate, jakartaWallClockToUtc, timeOfDayToMinutes } from './time.js';
import { resolveEmployeeForAccount } from './payroll-ledger.js';

// Dana Apresiasi Backup & Denda Ketidakhadiran CS (Bos Cyo, 2026-10-15, ADR-058, migration 0162).
//
// "CS normal Rp5.600/jam. Kalau CS asli berhalangan dan ada backup, backup dapat Rp8.000/jam =
// Rp5.600 beban perusahaan + Rp2.400 dana apresiasi yang DIBAYAR oleh CS asli yang berhalangan.
// Kalau tidak ada backup, CS asli tetap membayar apresiasi (gerai rugi: sewa lapak jalan, pentol
// basi, es batu cair) DITAMBAH denda."
//
// Aturan (keputusan Bos 2026-10-15):
//   - Saklar di Entity Admin -> Pengaturan, bawaan entity + override per gerai, default ON. OFF =
//     perilaku sebelum fitur ini (tidak ada potongan/denda baru).
//   - Hanya akun berstatus CS ASLI yang dinilai, per shift jadwalnya (account_shift_schedule).
//   - Tiap menit shift yang tidak dijaga CS asli (tidak masuk, telat, pulang awal) = apresiasi per jam:
//       dijaga backup -> ke backup lewat penampung 2105 (POTONG_BACKUP <-> FEE_BACKUP)
//       kosong        -> Pendapatan Lain-lain (POTONG_KOSONG)
//   - Denda: shift kosong penuh (tak ada yang jaga sama sekali) / kosong sebagian; dijaga penuh = 0.
//   - Hutang gaji tidak cukup -> tetap dipotong, saldo boleh minus (invariant #8).
//   - "Menggantikan siapa": otomatis dari jadwal CS asli yang bolong; backup mengonfirmasi saat
//     presensi masuk; Entity Admin bisa mengoreksi (dinilai ulang: revisi lama dibatalkan + dibalik).
//   - Alasan syar'i: Entity Admin membuat PENYESUAIAN pada baris potongan/denda (bawaan = membalik
//     penuh, nominal & keterangan bisa diubah).
// Penilaian lazy (tanpa cron, invariant #6): saat riwayat/rekap/portal dibaca, shift yang jam
// pulangnya sudah lewat 1 jam (jeda yang sama dengan tutup otomatis presensi) dinilai sekali.

// Bawaan "Mulai dihitung" bila Entity Admin belum memilih tanggal. Bos Cyo, 2026-10-17: dihitung mulai
// fitur aktif -> hari penuh pertama sesudah rilis (18 Okt). Tidak pernah sebelum fitur ada.
export const APRESIASI_BERLAKU_MULAI = '2026-10-18';
export const APRESIASI_PALING_AWAL = '2026-10-16';
// Denda kekosongan bertingkat (Bos Cyo, 2026-10-17, migration 0163): dari lamanya gerai KOSONG dalam satu
// shift. Kosong >= dendaRinganMenit (3 jam) s.d. dendaBeratMenit (4 jam) = denda ringan (dendaSebagianRupiah,
// Rp10.000); lebih dari dendaBeratMenit = denda berat (dendaPenuhRupiah, Rp20.000); di bawahnya tanpa denda.
export const APRESIASI_DEFAULTS = Object.freeze({
  ratePerHourRupiah: 2400, dendaPenuhRupiah: 20000, dendaSebagianRupiah: 10000,
  dendaEnabled: true, dendaRinganMenit: 180, dendaBeratMenit: 240
});

// '' = tanpa denda, 'SEBAGIAN' = denda ringan, 'PENUH' = denda berat (nilai kolom denda_kind).
export function dendaTier(kosongMinutes, settings) {
  if (!settings?.dendaEnabled || !(kosongMinutes > 0)) return '';
  if (kosongMinutes > settings.dendaBeratMenit) return 'PENUH';
  if (kosongMinutes >= settings.dendaRinganMenit) return 'SEBAGIAN';
  return '';
}
export const PENAMPUNG_CODE = '2105';
export const PENAMPUNG_NAME = 'Dana Apresiasi Backup';
const SCALE = 1_000_000;
const GRACE_MS = 60 * 60 * 1000;
const LOOKBACK_DAYS = 31;
const MAX_RUPIAH = 10_000_000;
const DAY_NAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const text = (value, max = 300) => String(value ?? '').trim().slice(0, max);
const rupiahLabel = value => `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(value) || 0)}`;

export function tanggalPendek(date) {
  const [, month, day] = String(date).split('-').map(Number);
  return `${day} ${MONTHS[month - 1] || ''}`.trim();
}

export function durasiLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!rest) return `${hours} jam`;
  return hours ? `${hours} jam ${rest} menit` : `${rest} menit`;
}

function dayOfWeekOf(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function amountForMinutes(minutes, ratePerHourRupiah) {
  return Math.round((minutes * ratePerHourRupiah * SCALE) / 60);
}

// ------------------------------------------------------------ hitungan ---

function mergeIntervals(list) {
  const sorted = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function subtract(base, cut) {
  let result = mergeIntervals(base);
  for (const [ca, cb] of mergeIntervals(cut)) {
    result = result.flatMap(([a, b]) => {
      if (cb <= a || ca >= b) return [[a, b]];
      return [[a, Math.min(b, ca)], [Math.max(a, cb), b]].filter(([x, y]) => y > x);
    });
  }
  return result;
}

const intersect = (list, [a, b]) => list.map(([x, y]) => [Math.max(x, a), Math.min(y, b)]).filter(([x, y]) => y > x);
const totalMs = list => list.reduce((sum, [a, b]) => sum + (b - a), 0);
const toMinutes = ms => Math.round(ms / 60000);

// Penilaian satu shift, murni (tanpa DB). Waktu dalam ms.
//   own   : sesi CS asli sendiri [[in, out], ...]
//   others: sesi akun lain di gerai itu [{ accountId, start, end, replaces }] -- replaces undefined =
//           otomatis; '' = tidak menggantikan; id = menggantikan akun itu saja.
export function nilaiShift({ accountId, shiftStart, shiftEnd, own = [], others = [] }) {
  const window = [shiftStart, shiftEnd];
  const ownCovered = mergeIntervals(own.flatMap(interval => intersect([interval], window)));
  let gaps = subtract([window], ownCovered);
  const backups = new Map();
  for (const session of [...others].sort((a, b) => a.start - b.start)) {
    if (session.replaces !== undefined && session.replaces !== accountId) continue;
    const covered = intersect(gaps, [session.start, session.end]);
    const ms = totalMs(covered);
    if (!ms) continue;
    backups.set(session.accountId, (backups.get(session.accountId) || 0) + ms);
    gaps = subtract(gaps, covered);
  }
  const shiftMinutes = toMinutes(shiftEnd - shiftStart);
  const ownMinutes = toMinutes(totalMs(ownCovered));
  const backupList = [...backups].map(([backupAccountId, ms]) => ({ accountId: backupAccountId, minutes: toMinutes(ms) })).filter(row => row.minutes > 0);
  const backupMinutes = backupList.reduce((sum, row) => sum + row.minutes, 0);
  const kosongMinutes = Math.max(0, toMinutes(totalMs(gaps)));
  return { shiftMinutes, ownMinutes, backups: backupList, backupMinutes, kosongMinutes };
}

// ------------------------------------------------------------ setelan ---

function mapSettingRow(row) {
  if (!row) return null;
  return {
    enabled: row.enabled == null ? null : Boolean(row.enabled),
    ratePerHourRupiah: row.rate_per_hour_rupiah ?? null,
    dendaPenuhRupiah: row.denda_penuh_rupiah ?? null,
    dendaSebagianRupiah: row.denda_sebagian_rupiah ?? null,
    dendaEnabled: row.denda_enabled == null ? null : Boolean(row.denda_enabled),
    dendaRinganMenit: row.denda_ringan_menit ?? null,
    dendaBeratMenit: row.denda_berat_menit ?? null,
    jamBuka: row.jam_buka || '',
    jamTutup: row.jam_tutup || '',
    enabledSince: row.enabled_since || null,
    mulaiTanggal: row.mulai_tanggal || null,
    updatedAt: row.updated_at || null
  };
}

function resolveSettings(entityRow, storeRow) {
  const pick = key => storeRow?.[key] ?? entityRow?.[key] ?? APRESIASI_DEFAULTS[key];
  const decider = storeRow?.enabled != null ? storeRow : (entityRow?.enabled != null ? entityRow : null);
  const enabled = decider ? decider.enabled : true;
  const mulaiTanggal = storeRow?.mulaiTanggal || entityRow?.mulaiTanggal || APRESIASI_BERLAKU_MULAI;
  const since = [APRESIASI_PALING_AWAL, mulaiTanggal, decider?.enabledSince].filter(Boolean).sort().pop();
  return {
    enabled,
    ratePerHourRupiah: pick('ratePerHourRupiah'),
    dendaPenuhRupiah: pick('dendaPenuhRupiah'),
    dendaSebagianRupiah: pick('dendaSebagianRupiah'),
    dendaEnabled: pick('dendaEnabled'),
    dendaRinganMenit: pick('dendaRinganMenit'),
    dendaBeratMenit: pick('dendaBeratMenit'),
    jamBuka: storeRow?.jamBuka || '',
    jamTutup: storeRow?.jamTutup || '',
    mulaiTanggal,
    since
  };
}

async function settingRows(db, entityId) {
  const rows = (await db.prepare('SELECT * FROM apresiasi_settings WHERE entity_id = ?').bind(entityId).all()).results ?? [];
  return new Map(rows.map(row => [row.store_id, mapSettingRow(row)]));
}

export async function storeSettings(db, entityId, storeId) {
  const rows = await settingRows(db, entityId);
  return resolveSettings(rows.get(''), rows.get(storeId));
}

function cleanRupiah(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > MAX_RUPIAH) return undefined;
  return number;
}

// Batas denda diisi dalam jam (boleh pecahan, koma atau titik), disimpan dalam menit.
function cleanHours(value) {
  if (value === null || value === undefined || value === '') return null;
  const hours = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) return undefined;
  return Math.round(hours * 60);
}

function cleanClock(value) {
  const raw = text(value, 5);
  if (!raw) return '';
  return timeOfDayToMinutes(raw) === null ? undefined : raw;
}

export async function saveSettings(db, { entityId, storeId = '', input = {}, actor = {} }) {
  const rows = await settingRows(db, entityId);
  const current = rows.get(storeId) || {};
  const enabled = input.enabled === null || input.enabled === undefined || input.enabled === ''
    ? (storeId ? null : true)
    : Boolean(input.enabled === true || input.enabled === 1 || input.enabled === '1' || input.enabled === 'true');
  const values = {
    rate: cleanRupiah(input.ratePerHourRupiah),
    penuh: cleanRupiah(input.dendaPenuhRupiah),
    sebagian: cleanRupiah(input.dendaSebagianRupiah),
    ringan: cleanHours(input.dendaRinganJam),
    berat: cleanHours(input.dendaBeratJam),
    buka: cleanClock(input.jamBuka),
    tutup: cleanClock(input.jamTutup),
    mulai: input.mulaiTanggal ? (/^\d{4}-\d{2}-\d{2}$/.test(String(input.mulaiTanggal)) ? String(input.mulaiTanggal) : undefined) : null
  };
  if (Object.values(values).includes(undefined)) return { ok: false, error: 'Nominal wajib rupiah bulat 0-10.000.000, batas denda dalam jam (mis. 3 atau 3,5), jam format HH:MM, tanggal YYYY-MM-DD.' };
  const dendaEnabled = input.dendaEnabled === null || input.dendaEnabled === undefined || input.dendaEnabled === ''
    ? (storeId ? null : true)
    : Boolean(input.dendaEnabled === true || input.dendaEnabled === 1 || input.dendaEnabled === '1' || input.dendaEnabled === 'true');
  if (!storeId) {
    values.ringan ??= APRESIASI_DEFAULTS.dendaRinganMenit;
    values.berat ??= APRESIASI_DEFAULTS.dendaBeratMenit;
  }
  const effRingan = values.ringan ?? rows.get('')?.dendaRinganMenit ?? APRESIASI_DEFAULTS.dendaRinganMenit;
  const effBerat = values.berat ?? rows.get('')?.dendaBeratMenit ?? APRESIASI_DEFAULTS.dendaBeratMenit;
  if (effBerat < effRingan) return { ok: false, error: 'Batas denda berat tidak boleh lebih kecil dari batas denda ringan.' };
  if (values.mulai && values.mulai < APRESIASI_PALING_AWAL) return { ok: false, error: `Mulai dihitung paling awal ${APRESIASI_PALING_AWAL}.` };
  if ((values.buka && !values.tutup) || (!values.buka && values.tutup)) return { ok: false, error: 'Jam buka dan jam tutup diisi berdua.' };
  if (values.buka && timeOfDayToMinutes(values.buka) >= timeOfDayToMinutes(values.tutup)) return { ok: false, error: 'Jam tutup harus setelah jam buka.' };
  if (!storeId && (values.rate === null || values.penuh === null || values.sebagian === null)) {
    values.rate ??= APRESIASI_DEFAULTS.ratePerHourRupiah;
    values.penuh ??= APRESIASI_DEFAULTS.dendaPenuhRupiah;
    values.sebagian ??= APRESIASI_DEFAULTS.dendaSebagianRupiah;
  }
  // Dinyalakan dari mati = mulai dihitung hari ini; shift selama mati tidak dihitung belakangan.
  const before = storeId ? resolveSettings(rows.get(''), rows.get(storeId)) : resolveSettings(rows.get(''), null);
  const newRow = { ...current, enabled };
  const after = storeId ? resolveSettings(rows.get(''), newRow) : resolveSettings(newRow, null);
  const enabledSince = enabled === null ? null : (!before.enabled && after.enabled ? getJakartaBusinessDate() : (current.enabledSince || null));
  await db.prepare(`
    INSERT INTO apresiasi_settings (entity_id, store_id, enabled, rate_per_hour_rupiah, denda_penuh_rupiah, denda_sebagian_rupiah,
      jam_buka, jam_tutup, enabled_since, mulai_tanggal, denda_enabled, denda_ringan_menit, denda_berat_menit,
      updated_at, updated_by_role, updated_by_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
    ON CONFLICT (entity_id, store_id) DO UPDATE SET
      enabled = excluded.enabled, rate_per_hour_rupiah = excluded.rate_per_hour_rupiah,
      denda_penuh_rupiah = excluded.denda_penuh_rupiah, denda_sebagian_rupiah = excluded.denda_sebagian_rupiah,
      jam_buka = excluded.jam_buka, jam_tutup = excluded.jam_tutup, enabled_since = excluded.enabled_since,
      mulai_tanggal = excluded.mulai_tanggal, denda_enabled = excluded.denda_enabled,
      denda_ringan_menit = excluded.denda_ringan_menit, denda_berat_menit = excluded.denda_berat_menit,
      updated_at = CURRENT_TIMESTAMP, updated_by_role = excluded.updated_by_role, updated_by_id = excluded.updated_by_id
  `).bind(
    entityId, storeId, enabled === null ? null : (enabled ? 1 : 0), values.rate, values.penuh, values.sebagian,
    values.buka, values.tutup, enabledSince, values.mulai, dendaEnabled === null ? null : (dendaEnabled ? 1 : 0), values.ringan, values.berat,
    text(actor.role, 40), text(actor.id, 120)
  ).run();
  return { ok: true };
}

// ------------------------------------------------------------ status ---

export function defaultCsStatus(isEntityBackup) {
  return Number(isEntityBackup) === 1 ? 'FREELANCE' : 'ASLI';
}

export async function csStatusOf(db, accountId) {
  const row = await db.prepare(`
    SELECT c.is_entity_backup, s.status FROM cashiers c LEFT JOIN cashier_cs_status s ON s.account_id = c.id WHERE c.id = ?
  `).bind(accountId).first();
  if (!row) return null;
  return row.status || defaultCsStatus(row.is_entity_backup);
}

export async function setCsStatus(db, { accountId, status, actor = {} }) {
  const value = text(status, 20).toUpperCase();
  if (!['ASLI', 'FREELANCE'].includes(value)) return { ok: false, error: 'Status wajib ASLI atau FREELANCE.' };
  await db.prepare(`
    INSERT INTO cashier_cs_status (account_id, status, updated_at, updated_by_role, updated_by_id) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?)
    ON CONFLICT (account_id) DO UPDATE SET status = excluded.status, updated_at = CURRENT_TIMESTAMP,
      updated_by_role = excluded.updated_by_role, updated_by_id = excluded.updated_by_id
  `).bind(accountId, value, text(actor.role, 40), text(actor.id, 120)).run();
  return { ok: true };
}

// CS berhenti/resign per tanggal (Bos Cyo, 2026-10-22, kasus Indah Beji): shift pada/sesudah tanggal itu
// tidak dinilai lagi, dan yang terlanjur dinilai dibatalkan (nilai ulang dengan tanggal berhenti, jurnal
// dibalik). tanggal null = batal berhenti (shift sesudahnya dinilai lagi bila jadwalnya ada).
export async function setBerhenti(db, { accountId, tanggal, actor = {}, now = new Date() }) {
  const value = tanggal ? text(tanggal, 10) : null;
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, error: 'Tanggal berhenti wajib YYYY-MM-DD.' };
  const account = await db.prepare('SELECT is_entity_backup FROM cashiers WHERE id = ?').bind(accountId).first();
  if (!account) return { ok: false, error: 'Akun kasir tidak ditemukan.' };
  await db.prepare(`
    INSERT INTO cashier_cs_status (account_id, status, berhenti_tanggal, updated_at, updated_by_role, updated_by_id)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
    ON CONFLICT (account_id) DO UPDATE SET berhenti_tanggal = excluded.berhenti_tanggal, updated_at = CURRENT_TIMESTAMP,
      updated_by_role = excluded.updated_by_role, updated_by_id = excluded.updated_by_id
  `).bind(accountId, defaultCsStatus(account.is_entity_backup), value, text(actor.role, 40), text(actor.id, 120)).run();
  if (!value) return { ok: true, reevaluated: 0 };
  const rows = (await db.prepare('SELECT id FROM apresiasi_evaluations WHERE account_id = ? AND business_date >= ?').bind(accountId, value).all()).results ?? [];
  let changed = 0;
  for (const row of rows) {
    const result = await reevaluate(db, row.id, { actor, reason: `CS berhenti per ${value}`, now, jadwalSekarang: true });
    if (result.changed) changed += 1;
  }
  return { ok: true, reevaluated: changed };
}

// ------------------------------------------------------------ data ---

async function storeAccounts(db, storeId) {
  const rows = await db.prepare(`
    SELECT c.id, c.username, c.employee_name, c.is_entity_backup, c.is_active, c.created_at, s.status, s.berhenti_tanggal,
           j.hourly_wage_scaled, j.payment_type
    FROM cashiers c
    LEFT JOIN cashier_cs_status s ON s.account_id = c.id
    LEFT JOIN account_job_details j ON j.account_type = 'CASHIER' AND j.account_id = c.id
    WHERE c.store_id = ? AND c.is_active = 1
    ORDER BY c.username
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    username: row.username,
    name: text(row.employee_name || row.username, 120),
    status: row.status || defaultCsStatus(row.is_entity_backup),
    statusIsDefault: !row.status,
    isEntityBackup: Number(row.is_entity_backup) === 1,
    createdAt: row.created_at || null,
    hourlyWageRupiah: row.hourly_wage_scaled == null ? null : Number(row.hourly_wage_scaled) / SCALE,
    hasJobDetail: row.hourly_wage_scaled != null,
    berhentiTanggal: row.berhenti_tanggal || null
  }));
}

async function schedulesFor(db, accountIds) {
  if (!accountIds.length) return new Map();
  const rows = await db.prepare(`
    SELECT account_id, day_of_week, is_day_off, shift_start, shift_end FROM account_shift_schedule
    WHERE account_type = 'CASHIER' AND account_id IN (${accountIds.map(() => '?').join(',')})
  `).bind(...accountIds).all();
  const map = new Map();
  for (const row of rows.results ?? []) {
    if (!map.has(row.account_id)) map.set(row.account_id, new Map());
    map.get(row.account_id).set(Number(row.day_of_week), row);
  }
  return map;
}

function shiftOf(schedule, date) {
  const day = schedule?.get(dayOfWeekOf(date));
  if (!day || day.is_day_off || !day.shift_start || !day.shift_end) return null;
  const start = jakartaWallClockToUtc(date, day.shift_start);
  const end = jakartaWallClockToUtc(date, day.shift_end);
  if (!start || !end || end <= start) return null;
  return { start: start.getTime(), end: end.getTime(), startText: day.shift_start, endText: day.shift_end };
}

async function accountName(db, accountId) {
  const row = await db.prepare('SELECT employee_name, username FROM cashiers WHERE id = ?').bind(accountId).first();
  return text(row?.employee_name || row?.username || accountId, 120);
}

// Bos Cyo, 2026-10-22 (laporan admin: Ade/Dermo, Adenia/Mandala): presensi yang lupa ditutup dulu dianggap
// berjaga "sampai sekarang", jadi akun uji yang OPEN sejak September (zahra tes, bilget) "menggantikan"
// setiap jam bolong berminggu-minggu. Sesi OPEN kini hanya dihitung sampai akhir hari masuknya (WIB).
function openSessionLimit(createdAt) {
  const date = getJakartaBusinessDate(new Date(createdAt));
  const nextMidnight = jakartaWallClockToUtc(addDays(date, 1), '00:00');
  return nextMidnight ? nextMidnight.getTime() : new Date(createdAt).getTime();
}

async function sessionsInWindow(db, storeId, fromIso, toIso, nowMs) {
  const rows = await db.prepare(`
    SELECT a.id, a.user_id, a.created_at, a.check_out_at, a.status, p.replaces_account_id, p.attendance_id AS has_choice
    FROM staff_attendance a
    LEFT JOIN apresiasi_pengganti p ON p.attendance_id = a.id
    WHERE a.store_id = ? AND a.created_at < ? AND (a.check_out_at IS NULL OR a.check_out_at > ?)
      AND (a.status = 'OPEN' OR a.check_out_at IS NOT NULL)
  `).bind(storeId, toIso, fromIso).all();
  return (rows.results ?? []).map(row => ({
    attendanceId: row.id,
    accountId: row.user_id,
    start: new Date(row.created_at).getTime(),
    end: row.check_out_at ? new Date(row.check_out_at).getTime() : Math.min(nowMs, openSessionLimit(row.created_at)),
    replaces: row.has_choice ? (row.replaces_account_id || '') : undefined
  })).filter(row => Number.isFinite(row.start) && Number.isFinite(row.end) && row.end > row.start);
}

// ------------------------------------------------------------ menilai ---

function parseDbTime(value) {
  const raw = String(value);
  const date = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isFinite(date.getTime()) ? date : new Date(0);
}

function refCode() {
  return `APR-${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

async function buildEntries(db, { evaluation, result, settings, names }) {
  const date = evaluation.business_date;
  const tgl = tanggalPendek(date);
  const rate = settings.ratePerHourRupiah;
  const rateText = `x ${rupiahLabel(rate)}`;
  const ref = `ref ${evaluation.ref_code}`;
  const list = [];
  const push = (accountId, kind, counter, minutes, amountScaled, description) => {
    if (!amountScaled) return;
    list.push({ accountId, kind, counter, minutes, amountScaled, description: `${description} · ${ref}` });
  };
  for (const backup of result.backups) {
    const amount = amountForMinutes(backup.minutes, rate);
    push(evaluation.account_id, 'POTONG_BACKUP', backup.accountId, backup.minutes, -amount,
      `Potongan apresiasi · digantikan ${names.get(backup.accountId)} ${tgl} · ${durasiLabel(backup.minutes)} ${rateText}`);
    push(backup.accountId, 'FEE_BACKUP', evaluation.account_id, backup.minutes, amount,
      `Apresiasi backup · gantikan ${names.get(evaluation.account_id)} ${tgl} · ${durasiLabel(backup.minutes)} ${rateText}`);
  }
  if (result.kosongMinutes > 0) {
    push(evaluation.account_id, 'POTONG_KOSONG', '', result.kosongMinutes, -amountForMinutes(result.kosongMinutes, rate),
      `Potongan apresiasi · gerai kosong ${tgl} · ${durasiLabel(result.kosongMinutes)} ${rateText}`);
  }
  if (result.dendaKind) {
    const denda = result.dendaKind === 'PENUH' ? settings.dendaPenuhRupiah : settings.dendaSebagianRupiah;
    push(evaluation.account_id, 'DENDA', '', result.kosongMinutes, -denda * SCALE,
      `Denda gerai kosong · shift ${tgl} · kosong ${durasiLabel(result.kosongMinutes)}`);
  }
  for (const row of list) row.employeeId = await resolveEmployeeForAccount(db, 'CASHIER', row.accountId, new Date(jakartaWallClockToUtc(date, evaluation.shift_start) || Date.now()).toISOString());
  return list.map(row => ({ ...row, rateRupiah: rate }));
}

async function insertEntries(db, evaluation, entries) {
  const ids = [];
  for (const entry of entries) {
    const id = `apre_${crypto.randomUUID()}`;
    const result = await db.prepare(`
      INSERT OR IGNORE INTO apresiasi_entries (id, evaluation_id, revision, entity_id, store_id, business_date, account_id, employee_id,
        kind, counter_account_id, minutes, rate_rupiah, amount_scaled, description, created_by_role, created_by_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYSTEM', '', CURRENT_TIMESTAMP)
    `).bind(
      id, evaluation.id, evaluation.revision, evaluation.entity_id, evaluation.store_id, evaluation.business_date,
      entry.accountId, entry.employeeId, entry.kind, entry.counter || '', entry.minutes, entry.rateRupiah, entry.amountScaled, entry.description
    ).run();
    if (Number(result?.meta?.changes ?? 0) === 1) ids.push(id);
  }
  return ids;
}

async function computeFor(db, { storeId, accountId, shift, nowMs }) {
  const sessions = await sessionsInWindow(db, storeId, new Date(shift.start).toISOString(), new Date(shift.end).toISOString(), nowMs);
  // Sesi akun pengganti bisa tercatat di gerai lain kalau akun backup berpindah; yang dinilai hanya
  // sesi di gerai CS asli ini.
  const own = sessions.filter(row => row.accountId === accountId).map(row => [row.start, row.end]);
  // CS asli lain yang sedang menjalani shift-nya sendiri bukan pengganti (kecuali dipilih eksplisit):
  // bagian sesinya di dalam jadwalnya sendiri tidak dihitung sebagai jaga untuk shift ini.
  const otherIds = [...new Set(sessions.filter(row => row.accountId !== accountId).map(row => row.accountId))];
  const statuses = new Map();
  for (const id of otherIds) statuses.set(id, await csStatusOf(db, id));
  const otherSchedules = await schedulesFor(db, otherIds.filter(id => statuses.get(id) === 'ASLI'));
  const others = sessions.filter(row => row.accountId !== accountId).flatMap(row => {
    if (row.replaces !== undefined || statuses.get(row.accountId) !== 'ASLI') return [row];
    const date = getJakartaBusinessDate(new Date(row.start));
    const ownShift = shiftOf(otherSchedules.get(row.accountId), date);
    if (!ownShift) return [row];
    return subtract([[row.start, row.end]], [[ownShift.start, ownShift.end]]).map(([start, end]) => ({ ...row, start, end }));
  });
  return nilaiShift({ accountId, shiftStart: shift.start, shiftEnd: shift.end, own, others });
}

async function namesFor(db, ids) {
  const names = new Map();
  for (const id of new Set(ids)) names.set(id, await accountName(db, id));
  return names;
}

async function dispatchEntries(db, ids) {
  if (!ids.length) return;
  const { dispatchAdminAccountingFact } = await import('./accounting-admin-bridge.js');
  for (const id of ids) {
    try { await dispatchAdminAccountingFact(db, 'APRESIASI', id); } catch (error) { console.warn('jurnal apresiasi gagal', id, error?.message); }
  }
}

async function reverseEntries(db, ids, reason) {
  if (!ids.length) return;
  const { reverseAdminAccountingFact } = await import('./accounting-admin-bridge.js');
  for (const id of ids) {
    try { await reverseAdminAccountingFact(db, 'APRESIASI', id, reason); } catch (error) { console.warn('pembalik apresiasi gagal', id, error?.message); }
  }
}

// Nilai semua shift CS asli di satu gerai yang sudah lewat jam pulang + 1 jam dan belum dinilai.
export async function evaluateDueApresiasi(db, storeId, { now = new Date() } = {}) {
  const store = await db.prepare('SELECT id, entity_id FROM stores WHERE id = ?').bind(storeId).first();
  if (!store?.entity_id) return { evaluated: 0 };
  const settings = await storeSettings(db, store.entity_id, storeId);
  if (!settings.enabled) return { evaluated: 0, disabled: true };
  const nowMs = now.getTime();
  const today = getJakartaBusinessDate(now);
  const from = [settings.since, addDays(today, -LOOKBACK_DAYS)].sort().pop();
  if (from > today) return { evaluated: 0 };
  const accounts = (await storeAccounts(db, storeId)).filter(account => account.status === 'ASLI' && account.hasJobDetail);
  if (!accounts.length) return { evaluated: 0 };
  const schedules = await schedulesFor(db, accounts.map(account => account.id));
  const done = new Set(((await db.prepare(`
    SELECT account_id, business_date FROM apresiasi_evaluations WHERE store_id = ? AND business_date >= ?
  `).bind(storeId, from).all()).results ?? []).map(row => `${row.account_id}|${row.business_date}`));
  let evaluated = 0;
  for (const account of accounts) {
    const accountStart = account.createdAt ? getJakartaBusinessDate(parseDbTime(account.createdAt)) : from;
    for (let date = from; date <= today; date = addDays(date, 1)) {
      if (date < accountStart || done.has(`${account.id}|${date}`)) continue;
      if (account.berhentiTanggal && date >= account.berhentiTanggal) continue;
      const shift = shiftOf(schedules.get(account.id), date);
      if (!shift || nowMs <= shift.end + GRACE_MS) continue;
      const result = await computeFor(db, { storeId, accountId: account.id, shift, nowMs });
      result.dendaKind = dendaTier(result.kosongMinutes, settings);
      const evaluation = {
        id: `apreval_${crypto.randomUUID()}`, ref_code: refCode(), entity_id: store.entity_id, store_id: storeId,
        account_id: account.id, business_date: date, shift_start: shift.startText, shift_end: shift.endText, revision: 1
      };
      const inserted = await db.prepare(`
        INSERT OR IGNORE INTO apresiasi_evaluations (id, ref_code, entity_id, store_id, account_id, business_date, shift_start, shift_end,
          revision, shift_minutes, own_minutes, backup_minutes, kosong_minutes, denda_kind, evaluated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
      `).bind(
        evaluation.id, evaluation.ref_code, evaluation.entity_id, storeId, account.id, date, shift.startText, shift.endText,
        result.shiftMinutes, result.ownMinutes, result.backupMinutes, result.kosongMinutes, result.dendaKind, now.toISOString()
      ).run();
      if (Number(inserted?.meta?.changes ?? 0) !== 1) continue;
      evaluated += 1;
      const names = await namesFor(db, [account.id, ...result.backups.map(row => row.accountId)]);
      const entries = await buildEntries(db, { evaluation, result, settings, names });
      await dispatchEntries(db, await insertEntries(db, evaluation, entries));
    }
  }
  return { evaluated };
}

// Penilaian ulang satu shift (koreksi "menggantikan siapa"): baris revisi lama dibatalkan (jurnalnya
// dibalik di tanggal shift), baris baru dihitung dari data sekarang. Penyesuaian admin tetap.
// jadwalSekarang (Bos Cyo, 2026-10-22: "penyelesaiannya harus menyertakan tombol"): shift diambil dari jadwal
// mingguan SEKARANG dan tanggal berhenti CS, bukan dari jadwal saat pertama dinilai -- untuk jadwal yang
// ternyata salah atau CS yang sudah resign. Tidak ada shift = semua potongan/denda/fee shift itu dibatalkan.
// dryRun = pratinjau: tidak menulis apa pun, mengembalikan baris lama dan baris baru.
export async function reevaluate(db, evaluationId, { actor = {}, reason = 'Koreksi pengganti', now = new Date(), jadwalSekarang = false, dryRun = false } = {}) {
  const evaluation = await db.prepare('SELECT * FROM apresiasi_evaluations WHERE id = ?').bind(evaluationId).first();
  if (!evaluation) return { ok: false, error: 'Penilaian shift tidak ditemukan.' };
  let shift;
  let berhenti = null;
  if (jadwalSekarang) {
    const status = await db.prepare('SELECT berhenti_tanggal FROM cashier_cs_status WHERE account_id = ?').bind(evaluation.account_id).first();
    berhenti = status?.berhenti_tanggal || null;
    shift = berhenti && evaluation.business_date >= berhenti
      ? null
      : shiftOf((await schedulesFor(db, [evaluation.account_id])).get(evaluation.account_id), evaluation.business_date);
  } else {
    const schedule = new Map([[dayOfWeekOf(evaluation.business_date), { shift_start: evaluation.shift_start, shift_end: evaluation.shift_end, is_day_off: 0 }]]);
    shift = shiftOf(schedule, evaluation.business_date);
  }
  const result = shift
    ? await computeFor(db, { storeId: evaluation.store_id, accountId: evaluation.account_id, shift, nowMs: now.getTime() })
    : { shiftMinutes: 0, ownMinutes: 0, backups: [], backupMinutes: 0, kosongMinutes: 0 };
  const settings = await storeSettings(db, evaluation.entity_id, evaluation.store_id);
  result.dendaKind = dendaTier(result.kosongMinutes, settings);
  const old = (await db.prepare(`
    SELECT id, kind, counter_account_id, amount_scaled FROM apresiasi_entries
    WHERE evaluation_id = ? AND revision = ? AND kind <> 'PENYESUAIAN' AND voided_at IS NULL
  `).bind(evaluationId, evaluation.revision).all()).results ?? [];
  const next = { ...evaluation, revision: Number(evaluation.revision) + 1 };
  const names = await namesFor(db, [evaluation.account_id, ...result.backups.map(row => row.accountId)]);
  // Tarif tetap tarif saat pertama dinilai (dari baris lama bila ada), supaya koreksi pengganti tidak ikut mengubah angka.
  const firstRate = await db.prepare('SELECT rate_rupiah FROM apresiasi_entries WHERE evaluation_id = ? AND kind <> \'PENYESUAIAN\' AND rate_rupiah > 0 ORDER BY created_at LIMIT 1').bind(evaluationId).first();
  const entries = await buildEntries(db, { evaluation: next, result, settings: { ...settings, ratePerHourRupiah: firstRate?.rate_rupiah ?? settings.ratePerHourRupiah }, names });
  const same = old.length === entries.length && entries.every(entry => old.some(row => row.kind === entry.kind && row.counter_account_id === (entry.counter || '') && Number(row.amount_scaled) === entry.amountScaled));
  if (dryRun) {
    return {
      ok: true, dryRun: true, changed: !same,
      shift: shift ? `${shift.startText}-${shift.endText}` : (berhenti && evaluation.business_date >= berhenti ? `berhenti ${berhenti}` : 'libur'),
      lama: old.map(row => ({ kind: row.kind, amountRupiah: Number(row.amount_scaled) / SCALE })),
      baru: entries.map(entry => ({ kind: entry.kind, amountRupiah: entry.amountScaled / SCALE, description: entry.description }))
    };
  }
  if (same) return { ok: true, changed: false };
  const ids = old.map(row => row.id);
  for (const id of ids) {
    await db.prepare(`
      UPDATE apresiasi_entries SET voided_at = ?, voided_by_role = ?, voided_by_id = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL
    `).bind(now.toISOString(), text(actor.role, 40), text(actor.id, 120), text(reason, 200), id).run();
  }
  await reverseEntries(db, ids, reason);
  await db.prepare(`
    UPDATE apresiasi_evaluations SET revision = ?, own_minutes = ?, backup_minutes = ?, kosong_minutes = ?, denda_kind = ?, evaluated_at = ?,
      shift_start = ?, shift_end = ?, shift_minutes = ? WHERE id = ?
  `).bind(next.revision, result.ownMinutes, result.backupMinutes, result.kosongMinutes, result.dendaKind, now.toISOString(),
    shift ? shift.startText : evaluation.shift_start, shift ? shift.endText : evaluation.shift_end, result.shiftMinutes, evaluationId).run();
  await dispatchEntries(db, await insertEntries(db, next, entries));
  return { ok: true, changed: true };
}

// Pilihan "menggantikan siapa" untuk satu sesi. replacesAccountId: id CS asli, '' = tidak menggantikan,
// null = kembali otomatis. Shift yang sudah dinilai di gerai & tanggal sesi itu dinilai ulang.
export async function setPengganti(db, { attendanceId, replacesAccountId, actor = {}, now = new Date() }) {
  const session = await db.prepare('SELECT id, user_id, store_id, created_at FROM staff_attendance WHERE id = ?').bind(attendanceId).first();
  if (!session) return { ok: false, error: 'Sesi presensi tidak ditemukan.' };
  if (replacesAccountId === null || replacesAccountId === undefined || replacesAccountId === 'AUTO') {
    await db.prepare('DELETE FROM apresiasi_pengganti WHERE attendance_id = ?').bind(attendanceId).run();
  } else {
    const target = text(replacesAccountId, 120);
    if (target === session.user_id) return { ok: false, error: 'Tidak bisa menggantikan diri sendiri.' };
    if (target) {
      const ok = await db.prepare('SELECT 1 FROM cashiers WHERE id = ? AND store_id = ?').bind(target, session.store_id).first();
      if (!ok) return { ok: false, error: 'CS yang digantikan harus akun gerai yang sama.' };
    }
    await db.prepare(`
      INSERT INTO apresiasi_pengganti (attendance_id, replaces_account_id, set_by_role, set_by_id, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (attendance_id) DO UPDATE SET replaces_account_id = excluded.replaces_account_id, set_by_role = excluded.set_by_role,
        set_by_id = excluded.set_by_id, updated_at = excluded.updated_at
    `).bind(attendanceId, target, text(actor.role, 40), text(actor.id, 120), now.toISOString()).run();
  }
  const date = getJakartaBusinessDate(new Date(session.created_at));
  const affected = (await db.prepare('SELECT id FROM apresiasi_evaluations WHERE store_id = ? AND business_date IN (?, ?)')
    .bind(session.store_id, date, addDays(date, -1)).all()).results ?? [];
  let changed = 0;
  for (const row of affected) {
    const result = await reevaluate(db, row.id, { actor, reason: 'Koreksi pengganti', now });
    if (result.changed) changed += 1;
  }
  return { ok: true, reevaluated: changed };
}

// Pilihan untuk akun yang baru presensi masuk: CS asli gerai ini yang shift hari ini belum lewat dan
// belum presensi. Yang shift-nya sedang berjalan sekarang jadi saran pertama.
export async function penggantiOptions(db, { accountId, storeId, now = new Date() }) {
  const status = await csStatusOf(db, accountId);
  const store = await db.prepare('SELECT entity_id FROM stores WHERE id = ?').bind(storeId).first();
  if (!store?.entity_id || !(await storeSettings(db, store.entity_id, storeId)).enabled) return { status, enabled: false, options: [] };
  const date = getJakartaBusinessDate(now);
  const accounts = (await storeAccounts(db, storeId)).filter(account => account.status === 'ASLI' && account.id !== accountId);
  const schedules = await schedulesFor(db, accounts.map(account => account.id));
  const nowMs = now.getTime();
  const options = [];
  for (const account of accounts) {
    const shift = shiftOf(schedules.get(account.id), date);
    if (!shift || shift.end <= nowMs) continue;
    const open = await db.prepare(`SELECT 1 FROM staff_attendance WHERE user_id = ? AND status = 'OPEN' LIMIT 1`).bind(account.id).first();
    if (open) continue;
    options.push({ accountId: account.id, name: account.name, shift: `${shift.startText}-${shift.endText}`, running: shift.start <= nowMs });
  }
  options.sort((a, b) => Number(b.running) - Number(a.running));
  return { status, enabled: true, options };
}

// ------------------------------------------------------------ penyesuaian ---

export async function createPenyesuaian(db, { entityId, entryId, amountRupiah, note, actor = {} }) {
  const entry = await db.prepare('SELECT * FROM apresiasi_entries WHERE id = ? AND entity_id = ?').bind(entryId, entityId).first();
  if (!entry || entry.kind === 'PENYESUAIAN') return { ok: false, error: 'Baris potongan/denda tidak ditemukan.' };
  if (entry.voided_at) return { ok: false, error: 'Baris ini sudah dibatalkan (dinilai ulang); sesuaikan baris yang berlaku.' };
  const amount = amountRupiah === undefined || amountRupiah === null || amountRupiah === '' ? -Number(entry.amount_scaled) / SCALE : Number(amountRupiah);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > MAX_RUPIAH) return { ok: false, error: 'Nominal penyesuaian wajib rupiah bulat, tidak nol.' };
  const noteText = text(note, 300) || 'Alasan syar\'i';
  const evaluation = await db.prepare('SELECT ref_code FROM apresiasi_evaluations WHERE id = ?').bind(entry.evaluation_id).first();
  const what = { POTONG_BACKUP: 'potongan apresiasi', POTONG_KOSONG: 'potongan apresiasi', DENDA: 'denda', FEE_BACKUP: 'apresiasi backup' }[entry.kind];
  const id = `apre_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO apresiasi_entries (id, evaluation_id, revision, entity_id, store_id, business_date, account_id, employee_id, kind,
      counter_account_id, minutes, rate_rupiah, amount_scaled, adjusts_entry_id, description, note, created_by_role, created_by_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENYESUAIAN', ?, 0, 0, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    id, entry.evaluation_id, entry.revision, entry.entity_id, entry.store_id, entry.business_date, entry.account_id, entry.employee_id,
    entry.counter_account_id, amount * SCALE, entry.id,
    `Penyesuaian ${what} ${tanggalPendek(entry.business_date)} · ${noteText} · ref ${evaluation?.ref_code || ''}`.slice(0, 300),
    noteText, text(actor.role, 40), text(actor.id, 120)
  ).run();
  await dispatchEntries(db, [id]);
  return { ok: true, id };
}

export async function voidPenyesuaian(db, { entityId, id, reason, actor = {}, now = new Date() }) {
  const row = await db.prepare(`SELECT id, voided_at FROM apresiasi_entries WHERE id = ? AND entity_id = ? AND kind = 'PENYESUAIAN'`).bind(id, entityId).first();
  if (!row) return { ok: false, error: 'Penyesuaian tidak ditemukan.' };
  if (row.voided_at) return { ok: true, already: true };
  const reasonText = text(reason, 200);
  if (reasonText.length < 3) return { ok: false, error: 'Alasan pembatalan wajib diisi.' };
  await db.prepare(`UPDATE apresiasi_entries SET voided_at = ?, voided_by_role = ?, voided_by_id = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL`)
    .bind(now.toISOString(), text(actor.role, 40), text(actor.id, 120), reasonText, id).run();
  await reverseEntries(db, [id], reasonText);
  return { ok: true };
}

// ------------------------------------------------------------ baca ---

export function mapEntry(row) {
  return {
    id: row.id,
    evaluationId: row.evaluation_id,
    storeId: row.store_id,
    storeCode: row.store_code || '',
    businessDate: row.business_date,
    accountId: row.account_id,
    employeeId: row.employee_id || null,
    kind: row.kind,
    counterAccountId: row.counter_account_id || '',
    minutes: Number(row.minutes || 0),
    amountScaled: Number(row.amount_scaled),
    amountRupiah: Number(row.amount_scaled) / SCALE,
    adjustsEntryId: row.adjusts_entry_id || null,
    description: row.description || '',
    note: row.note || '',
    createdAt: row.created_at,
    voided: Boolean(row.voided_at),
    voidReason: row.void_reason || ''
  };
}

// Baris milik satu akun kasir (Portal Staf). Termasuk yang dibatalkan, ditandai.
export async function entriesForAccount(db, accountId) {
  const rows = await db.prepare(`
    SELECT e.*, s.code AS store_code FROM apresiasi_entries e JOIN stores s ON s.id = e.store_id
    WHERE e.account_id = ? ORDER BY e.business_date DESC, e.created_at DESC LIMIT 200
  `).bind(accountId).all();
  return (rows.results ?? []).map(mapEntry);
}

function scheduleGaps(buka, tutup, schedulesByAccount, accounts) {
  const open = timeOfDayToMinutes(buka);
  const close = timeOfDayToMinutes(tutup);
  if (open === null || close === null) return [];
  const gaps = [];
  for (let day = 0; day < 7; day += 1) {
    const covered = [];
    for (const account of accounts) {
      const row = schedulesByAccount.get(account.id)?.get(day);
      if (!row || row.is_day_off || !row.shift_start || !row.shift_end) continue;
      covered.push([timeOfDayToMinutes(row.shift_start), timeOfDayToMinutes(row.shift_end)]);
    }
    for (const [a, b] of subtract([[open, close]], covered.filter(([a, b]) => a !== null && b !== null))) {
      const hhmm = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      gaps.push({ day, dayName: DAY_NAMES[day], from: hhmm(a), to: hhmm(b) });
    }
  }
  return gaps;
}

export async function settingsOverview(db, { entityId, stores }) {
  const rows = await settingRows(db, entityId);
  const entityRow = rows.get('') || null;
  const entityEffective = resolveSettings(entityRow, null);
  const list = [];
  for (const store of stores) {
    const storeRow = rows.get(store.id) || null;
    const effective = resolveSettings(entityRow, storeRow);
    const accounts = await storeAccounts(db, store.id);
    const schedules = await schedulesFor(db, accounts.map(account => account.id));
    const asli = accounts.filter(account => account.status === 'ASLI');
    const warnings = [];
    if (effective.jamBuka && effective.jamTutup) {
      for (const gap of scheduleGaps(effective.jamBuka, effective.jamTutup, schedules, asli)) {
        warnings.push(`${gap.dayName} ${gap.from}-${gap.to} tidak tertutup jadwal CS asli`);
      }
    }
    const minAsliRate = Math.min(...asli.filter(account => account.hourlyWageRupiah).map(account => account.hourlyWageRupiah));
    for (const account of accounts.filter(item => item.status === 'FREELANCE' && item.hourlyWageRupiah)) {
      if (Number.isFinite(minAsliRate) && account.hourlyWageRupiah >= minAsliRate + effective.ratePerHourRupiah) {
        warnings.push(`Tarif freelance ${account.username} ${rupiahLabel(account.hourlyWageRupiah)}/jam: dengan mekanisme ON tarif dasarnya cukup ${rupiahLabel(minAsliRate)} (apresiasi ${rupiahLabel(effective.ratePerHourRupiah)}/jam dibayar dari CS yang digantikan)`);
      }
    }
    for (const account of asli.filter(item => !schedules.get(item.id)?.size && item.hasJobDetail)) {
      warnings.push(`CS asli ${account.username} belum punya jadwal shift: tidak pernah dinilai`);
    }
    list.push({
      storeId: store.id,
      storeCode: store.code,
      storeName: store.storeName || store.name || store.code,
      override: storeRow,
      effective,
      accounts: accounts.map(account => ({
        id: account.id, username: account.username, name: account.name, status: account.status, statusIsDefault: account.statusIsDefault,
        berhentiTanggal: account.berhentiTanggal,
        hourlyWageRupiah: account.hourlyWageRupiah,
        schedule: [...(schedules.get(account.id)?.values() ?? [])].sort((a, b) => a.day_of_week - b.day_of_week)
          .map(row => `${DAY_NAMES[row.day_of_week]} ${row.is_day_off ? 'libur' : (row.shift_start && row.shift_end ? `${row.shift_start}-${row.shift_end}` : '-')}`).join(' · ')
      })),
      warnings
    });
  }
  return { entity: { ...entityEffective, saved: Boolean(entityRow), savedMulai: entityRow?.mulaiTanggal || null }, berlakuMulai: APRESIASI_BERLAKU_MULAI, palingAwal: APRESIASI_PALING_AWAL, defaults: APRESIASI_DEFAULTS, stores: list };
}

// Rekap harian: apresiasi masuk (potongan jam backup) vs keluar (fee ke backup) -- selisih harus 0 --
// ditambah jam kosong, denda, penyesuaian. Plus daftar baris (untuk tombol penyesuaian) dan sesi
// backup (untuk koreksi "menggantikan siapa").
export async function rekap(db, { entityId, stores, from, to, now = new Date() }) {
  for (const store of stores) {
    try { await evaluateDueApresiasi(db, store.id, { now }); } catch (error) { console.warn('nilai apresiasi gagal', store.code, error?.message); }
  }
  const storeIds = stores.map(store => store.id);
  if (!storeIds.length) return { days: [], entries: [], evaluations: [], totals: {} };
  const marks = storeIds.map(() => '?').join(',');
  const entryRows = ((await db.prepare(`
    SELECT e.*, s.code AS store_code, c.username, c.employee_name, cc.username AS counter_username, cc.employee_name AS counter_name
    FROM apresiasi_entries e
    JOIN stores s ON s.id = e.store_id
    LEFT JOIN cashiers c ON c.id = e.account_id
    LEFT JOIN cashiers cc ON cc.id = e.counter_account_id
    WHERE e.entity_id = ? AND e.store_id IN (${marks}) AND e.business_date BETWEEN ? AND ?
    ORDER BY e.business_date DESC, s.code, e.created_at
  `).bind(entityId, ...storeIds, from, to).all()).results ?? []);
  const entries = entryRows.map(row => ({ ...mapEntry(row), accountName: text(row.employee_name || row.username, 120), counterName: text(row.counter_name || row.counter_username || '', 120) }));
  const adjustedBy = new Map();
  for (const entry of entries) if (entry.kind === 'PENYESUAIAN' && !entry.voided) adjustedBy.set(entry.adjustsEntryId, (adjustedBy.get(entry.adjustsEntryId) || 0) + entry.amountRupiah);
  const byDay = new Map();
  const zero = () => ({ masukRupiah: 0, keluarRupiah: 0, kosongRupiah: 0, dendaRupiah: 0, penyesuaianRupiah: 0 });
  for (const entry of entries) {
    if (entry.voided) continue;
    const key = `${entry.businessDate}|${entry.storeCode}`;
    if (!byDay.has(key)) byDay.set(key, { businessDate: entry.businessDate, storeCode: entry.storeCode, ...zero() });
    const day = byDay.get(key);
    if (entry.kind === 'POTONG_BACKUP') day.masukRupiah += -entry.amountRupiah;
    if (entry.kind === 'FEE_BACKUP') day.keluarRupiah += entry.amountRupiah;
    if (entry.kind === 'POTONG_KOSONG') day.kosongRupiah += -entry.amountRupiah;
    if (entry.kind === 'DENDA') day.dendaRupiah += -entry.amountRupiah;
    if (entry.kind === 'PENYESUAIAN') day.penyesuaianRupiah += entry.amountRupiah;
  }
  const days = [...byDay.values()].map(day => ({ ...day, selisihRupiah: Math.round((day.masukRupiah - day.keluarRupiah) * 100) / 100 }))
    .sort((a, b) => (a.businessDate === b.businessDate ? a.storeCode.localeCompare(b.storeCode) : (a.businessDate < b.businessDate ? 1 : -1)));
  const totals = days.reduce((sum, day) => {
    for (const key of Object.keys(zero())) sum[key] += day[key];
    sum.selisihRupiah += day.selisihRupiah;
    return sum;
  }, { ...zero(), selisihRupiah: 0 });
  const evalRows = ((await db.prepare(`
    SELECT v.*, s.code AS store_code, c.username, c.employee_name FROM apresiasi_evaluations v
    JOIN stores s ON s.id = v.store_id LEFT JOIN cashiers c ON c.id = v.account_id
    WHERE v.entity_id = ? AND v.store_id IN (${marks}) AND v.business_date BETWEEN ? AND ?
      AND (v.backup_minutes > 0 OR v.kosong_minutes > 0)
    ORDER BY v.business_date DESC, s.code
  `).bind(entityId, ...storeIds, from, to).all()).results ?? []);
  const evaluations = [];
  for (const row of evalRows) {
    const shiftStart = jakartaWallClockToUtc(row.business_date, row.shift_start);
    const shiftEnd = jakartaWallClockToUtc(row.business_date, row.shift_end);
    const sessions = shiftStart && shiftEnd
      ? (await sessionsInWindow(db, row.store_id, shiftStart.toISOString(), shiftEnd.toISOString(), now.getTime())).filter(item => item.accountId !== row.account_id)
      : [];
    const names = await namesFor(db, sessions.map(item => item.accountId));
    evaluations.push({
      id: row.id, refCode: row.ref_code, storeCode: row.store_code, businessDate: row.business_date,
      accountId: row.account_id, accountName: text(row.employee_name || row.username, 120),
      shift: `${row.shift_start}-${row.shift_end}`, ownMinutes: row.own_minutes, backupMinutes: row.backup_minutes,
      kosongMinutes: row.kosong_minutes, dendaKind: row.denda_kind, revision: row.revision,
      sessions: sessions.map(item => ({
        attendanceId: item.attendanceId, accountId: item.accountId, name: names.get(item.accountId),
        start: new Date(item.start).toISOString(), end: new Date(item.end).toISOString(),
        replaces: item.replaces === undefined ? 'AUTO' : item.replaces
      }))
    });
  }
  return {
    from, to, days, totals, evaluations,
    entries: entries.map(entry => ({ ...entry, adjustedRupiah: adjustedBy.get(entry.id) || 0 }))
  };
}
