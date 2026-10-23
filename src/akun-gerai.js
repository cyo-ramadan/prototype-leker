import { json, readJson } from './http.js';
import { ownerEntityContext } from './owner-entity-context.js';
import { storeSettings } from './dana-apresiasi.js';
import { timeOfDayToMinutes } from './time.js';

// Entity Admin -> Karyawan -> Kelola akun (Bos Cyo, 2026-10-23): "muncul akun2 setiap gerai sama seperti
// karyawan, dan tambahin peta akun di setiap gerai ... biar kita bisa cek apakah masih ada akun aktif yang
// ada pada suatu gerai, ini nanti akan ngefek di dana apresiasi".
//
// Satu bacaan untuk seluruh entity: akun kasir per gerai (aktif & nonaktif), jadwal 7 hari, status CS
// asli/freelance, karyawan tertaut, presensi yang masih terbuka, dan presensi terakhir. Peta jam (baris
// jam x kolom hari x akun) digambar di klien dari jadwal ini. Peringatan di sini adalah hal-hal yang
// diam-diam membuat Dana Apresiasi salah hitung (kejadian 22 Okt: zahra_tes & bilget presensi OPEN
// berminggu-minggu jadi "backup", Indah resign tapi akunnya masih aktif & berjadwal).
// Satu-satunya tulisan: aktifkan / nonaktifkan akun (sama dengan Admin Gerai -> Akun Kasir).

const BASE = '/api/entity-admin/akun-gerai';
const DAY = 24 * 60 * 60 * 1000;
export const PRESENSI_BASI_JAM = 16;
export const TANPA_PRESENSI_HARI = 30;
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

function parseDbTime(value) {
  if (!value) return null;
  const raw = String(value);
  const date = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

async function inBatches(db, ids, sql, before = []) {
  const out = [];
  for (let i = 0; i < ids.length; i += 80) {
    const batch = ids.slice(i, i + 80);
    const rows = await db.prepare(sql.replace('(?)', `(${batch.map(() => '?').join(',')})`)).bind(...before, ...batch).all();
    out.push(...(rows.results ?? []));
  }
  return out;
}

// Jadwal lewat tengah malam (pulang <= masuk) tidak dinilai Dana Apresiasi (shiftOf menolaknya);
// di peta tetap digambar membungkus ke pagi supaya terlihat ada yang jaga.
export function jamJadwal(row) {
  if (!row || row.isDayOff || !row.shiftStart || !row.shiftEnd) return [];
  const start = timeOfDayToMinutes(row.shiftStart);
  const end = timeOfDayToMinutes(row.shiftEnd);
  if (start === null || end === null || start === end) return [];
  const slots = new Set();
  const mark = (from, to) => { for (let hour = Math.floor(from / 60); hour * 60 < to; hour += 1) slots.add(hour); };
  if (end > start) mark(start, end);
  else { mark(start, 24 * 60); mark(0, end); }
  return [...slots].sort((a, b) => a - b);
}

export function peringatanAkun(account, { nowMs }) {
  const list = [];
  if (account.openSince) {
    const since = parseDbTime(account.openSince);
    if (since && nowMs - since.getTime() > PRESENSI_BASI_JAM * 60 * 60 * 1000) {
      list.push({ kode: 'PRESENSI_BASI', teks: `Presensi masih terbuka sejak ${account.openSince.slice(0, 10)}${account.openStoreCode ? ` di ${account.openStoreCode}` : ''} -- bisa terbaca "sedang jaga" di Dana Apresiasi. Tutup lewat Admin Gerai -> Presensi.` });
    }
  }
  if (!account.isActive) return list;
  if (account.employee && account.employee.status !== 'ACTIVE') {
    list.push({ kode: 'KARYAWAN_NONAKTIF', teks: `Karyawan tertaut (${account.employee.name}) sudah nonaktif/resign, akunnya masih aktif.` });
  }
  if (!account.employee) list.push({ kode: 'TANPA_KARYAWAN', teks: 'Belum tertaut ke karyawan mana pun.' });
  const days = account.schedule.filter(row => !row.isDayOff && row.shiftStart && row.shiftEnd);
  if (account.status === 'ASLI' && !days.length) {
    list.push({ kode: 'TANPA_JADWAL', teks: 'CS asli tanpa jadwal shift: tidak pernah dinilai Dana Apresiasi.' });
  }
  if (days.some(row => (timeOfDayToMinutes(row.shiftEnd) ?? 0) <= (timeOfDayToMinutes(row.shiftStart) ?? 0))) {
    list.push({ kode: 'LEWAT_MALAM', teks: 'Ada jadwal sampai/lewat tengah malam (pulang 00:00 atau lebih pagi dari masuk): shift itu tidak dinilai Dana Apresiasi.' });
  }
  const last = parseDbTime(account.lastAttendanceAt) || parseDbTime(account.createdAt);
  if (!last || nowMs - last.getTime() > TANPA_PRESENSI_HARI * DAY) {
    list.push({ kode: 'TIDAK_DIPAKAI', teks: `Tidak ada presensi ${TANPA_PRESENSI_HARI} hari terakhir -- masih dipakai?` });
  }
  return list;
}

export async function akunGerai(db, { entityId, stores, now = new Date() }) {
  const storeIds = stores.map(store => store.id);
  if (!storeIds.length) return { stores: [] };
  const storeById = new Map(stores.map(store => [store.id, store]));
  const cashiers = await inBatches(db, storeIds, `
    SELECT c.id, c.username, c.employee_name, c.store_id, c.is_active, c.is_entity_backup, c.created_at,
      COALESCE(cs.status, CASE WHEN c.is_entity_backup = 1 THEN 'FREELANCE' ELSE 'ASLI' END) AS cs_status,
      j.job_type, e.id AS employee_id, e.full_name AS employee_name_master, e.status AS employee_status
    FROM cashiers c
    LEFT JOIN cashier_cs_status cs ON cs.account_id = c.id
    LEFT JOIN account_job_details j ON j.account_type = 'CASHIER' AND j.account_id = c.id
    LEFT JOIN employee_account_links l ON l.account_type = 'CASHIER' AND l.account_id = c.id AND l.effective_to IS NULL
    LEFT JOIN employees e ON e.id = l.employee_id AND e.entity_id = ?
    WHERE c.store_id IN (?)
    ORDER BY c.is_active DESC, c.username COLLATE NOCASE
  `, [entityId]);
  const ids = cashiers.map(row => row.id);
  const schedules = new Map();
  for (const row of await inBatches(db, ids, `
    SELECT account_id, day_of_week, is_day_off, shift_start, shift_end FROM account_shift_schedule
    WHERE account_type = 'CASHIER' AND account_id IN (?)
  `)) {
    if (!schedules.has(row.account_id)) schedules.set(row.account_id, []);
    schedules.get(row.account_id).push({ dayOfWeek: Number(row.day_of_week), isDayOff: Boolean(row.is_day_off), shiftStart: row.shift_start || '', shiftEnd: row.shift_end || '' });
  }
  const open = new Map();
  for (const row of await inBatches(db, ids, `
    SELECT a.user_id, a.created_at, s.code AS store_code FROM staff_attendance a LEFT JOIN stores s ON s.id = a.store_id
    WHERE a.status = 'OPEN' AND a.user_id IN (?) ORDER BY a.created_at
  `)) if (!open.has(row.user_id)) open.set(row.user_id, row);
  const last = new Map();
  for (const row of await inBatches(db, ids, `
    SELECT user_id, MAX(created_at) AS last_at FROM staff_attendance WHERE user_id IN (?) GROUP BY user_id
  `)) last.set(row.user_id, row.last_at);

  const nowMs = now.getTime();
  const grouped = new Map(storeIds.map(id => [id, []]));
  for (const row of cashiers) {
    const account = {
      id: row.id,
      username: row.username,
      name: text(row.employee_name || row.username, 120),
      isActive: Number(row.is_active) === 1,
      isEntityBackup: Number(row.is_entity_backup) === 1,
      status: row.cs_status,
      jobType: row.job_type || '',
      createdAt: row.created_at || null,
      employee: row.employee_id ? { id: row.employee_id, name: text(row.employee_name_master, 120), status: row.employee_status || 'ACTIVE' } : null,
      schedule: (schedules.get(row.id) || []).sort((a, b) => a.dayOfWeek - b.dayOfWeek),
      openSince: open.get(row.id)?.created_at || null,
      openStoreCode: open.get(row.id)?.store_code || '',
      lastAttendanceAt: last.get(row.id) || null
    };
    account.peringatan = peringatanAkun(account, { nowMs });
    grouped.get(row.store_id)?.push(account);
  }
  const out = [];
  for (const storeId of storeIds) {
    const store = storeById.get(storeId);
    const settings = await storeSettings(db, entityId, storeId);
    out.push({
      storeId,
      storeCode: store.code,
      storeName: store.storeName || store.name || store.code,
      jamBuka: settings.jamBuka || '',
      jamTutup: settings.jamTutup || '',
      apresiasiOn: Boolean(settings.enabled),
      accounts: grouped.get(storeId)
    });
  }
  return { stores: out, generatedAt: now.toISOString(), presensiBasiJam: PRESENSI_BASI_JAM };
}

export async function handleAkunGeraiApi(request, env, pathname) {
  if (pathname !== BASE && !pathname.startsWith(`${BASE}/`)) return null;
  const context = await ownerEntityContext(request, env, { allowEntityAdminOutsideSkin: true });
  if (context.response) return context.response;
  const db = env.DB;
  if (request.method === 'GET' && pathname === BASE) {
    return json(await akunGerai(db, { entityId: context.entityId, stores: context.stores }));
  }
  if (request.method === 'POST' && pathname === `${BASE}/aktif`) {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
    const accountId = text(body.value?.accountId, 120);
    const isActive = body.value?.isActive === true ? 1 : 0;
    const account = await db.prepare('SELECT id, store_id FROM cashiers WHERE id = ?').bind(accountId).first();
    if (!account || !context.stores.some(store => store.id === account.store_id)) return json({ error: 'Akun kasir di luar entity ini.' }, 403);
    // Sama dengan Admin Gerai -> Akun Kasir (PATCH/DELETE /api/admin/cashiers/:id): sesi login dicabut.
    await db.batch([
      db.prepare('UPDATE cashiers SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(isActive, accountId),
      db.prepare('DELETE FROM cashier_sessions WHERE cashier_id = ?').bind(accountId)
    ]);
    return json({ ok: true, isActive: Boolean(isActive) });
  }
  return json({ error: 'Route Kelola akun tidak ditemukan.' }, 404);
}
