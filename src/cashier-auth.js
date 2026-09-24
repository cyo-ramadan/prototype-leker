import { json, readJson } from './http.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { bearerToken, hashCredential, requireManagement } from './owner-auth.js';
import { WAGE_SCALE, scheduleMap, listAttendance, buildPayroll } from './staff-attendance.js';
import { listPayrollAdjustments, createPayrollAdjustment, voidPayrollAdjustment } from './payroll-adjustments.js';
import { activateEntityBackupCashier } from './entity-backup-cashiers.js';
import { getJakartaBusinessDate } from './time.js';
import { resolveTenantId, getTenantPolicySetting, ATTENDANCE_SCHEDULE_GATE_KEY } from './tenant-policy.js';

// Identitas pemanggil requireManagement (Owner/Admin Gerai/Entity Admin/Agent
// token) diringkas ke {role, id} generik -- dipakai sebagai jejak audit
// created_by_role/created_by_id di payroll_adjustments, bukan buat otorisasi
// (otorisasinya sudah selesai lewat requireManagement + scope store di atas).
function managementActor(auth) {
  const identity = auth.owner || auth.admin || auth.entityAdmin || auth.agent;
  return { role: auth.authType, id: identity?.id || auth.authType };
}

const SESSION_HOURS = 12;
const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const usernameText = value => text(value, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '');

// Detail shift (gaji per jam, jam kerja, jenis pekerjaan) menempel ke AKUN
// kasir, bukan ke orang yang memegangnya -- koreksi Bos Cyo, 2026-09-18:
// "harus nya detil itu tadi kamu taruh di user kasir/staf. bukan malah di
// nama orangnya ... tombol karyawan itu yang aku maksudkan nama orang,
// sedangkan yang ada di master kasir itu adalah employed atau pekerjaannya."
// Sengaja BERTAHAN walau akun dioper ke karyawan lain (sifat jabatan, bukan
// sifat orang) -- lihat migration 0104. WAGE_SCALE sendiri didefinisikan di
// staff-attendance.js supaya cashier-auth.js dan staff-portal.js sama-sama
// bisa impor tanpa impor melingkar -- lihat komentar di sana.
const MAX_HOURLY_WAGE_RUPIAH = 1_000_000; // pagar salah ketik, bukan aturan bisnis
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

// undefined = format tidak valid, DITOLAK. Kosong ('' / 0) itu sah -- berarti
// detail sengaja belum diisi, bukan kesalahan.
function hourlyWageInput(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > MAX_HOURLY_WAGE_RUPIAH) return undefined;
  return Math.round(number * WAGE_SCALE);
}

function shiftTimeInput(value) {
  const trimmed = text(value, 5);
  if (trimmed === '') return '';
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed) ? trimmed : undefined;
}

function jobTypeInput(value) {
  return text(value, 100);
}

// Bos Cyo, 2026-09-19: "untuk ganti konsep ga jadi deh, bener yang udah
// jalan sekarang, tapi akunnya dibikin lebih detil aja misal jam kerja dan
// hari kerja. jadi misal hari senin jam 9-18 sampai hari jumat sama, terus
// sabtu libur, minggu jam 9-22." -- account_job_details.shift_start/shift_end
// (migration 0104, satu jam untuk semua hari) digantikan account_shift_schedule
// (migration 0106, 7 baris per akun). Kolom lama SENGAJA dibiarkan menganggur,
// tidak dibaca/ditulis lagi mulai dari sini.
function mapScheduleRow(row) {
  return { dayOfWeek: row.day_of_week, isDayOff: Boolean(row.is_day_off), shiftStart: row.shift_start || '', shiftEnd: row.shift_end || '' };
}

// raw = satu entry body.schedule (bisa undefined kalau hari itu tidak
// dikirim sama sekali). undefined/hari hilang = "belum diatur" (bukan
// libur, bukan error) -- sengaja beda dari isDayOff supaya lateness tidak
// diam-diam menganggap hari yang lupa diisi sebagai hari libur.
function scheduleDayInput(raw) {
  if (raw?.isDayOff) return { ok: true, value: { isDayOff: true, shiftStart: '', shiftEnd: '' } };
  const shiftStart = shiftTimeInput(raw?.shiftStart ?? '');
  if (shiftStart === undefined) return { ok: false, error: 'jam mulai kerja harus format HH:MM, mis. 08:00' };
  const shiftEnd = shiftTimeInput(raw?.shiftEnd ?? '');
  if (shiftEnd === undefined) return { ok: false, error: 'jam selesai kerja harus format HH:MM, mis. 16:00' };
  return { ok: true, value: { isDayOff: false, shiftStart, shiftEnd } };
}

// body.schedule tidak dikirim sama sekali (mis. PATCH yang cuma ganti
// password) -- jadwal lama (currentRows) dipertahankan utuh. body.schedule
// DIKIRIM -- ganti ke-7 hari SEKALIGUS (bukan per-hari, beda dari field
// lain di jobDetailInput yang bisa parsial), supaya tidak ada hari yang
// nyangkut kombinasi lama+baru yang tidak pernah dimaksud Admin.
function scheduleInput(body, currentRows) {
  if (!owns(body, 'schedule')) return { ok: true, value: (currentRows ?? []).map(mapScheduleRow) };
  const raw = Array.isArray(body.schedule) ? body.schedule : [];
  const byDay = new Map(raw.map(item => [Number(item?.dayOfWeek), item]));
  const value = [];
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
    const dayResult = scheduleDayInput(byDay.get(dayOfWeek));
    if (!dayResult.ok) return { ok: false, error: `Jadwal hari ke-${dayOfWeek}: ${dayResult.error}` };
    value.push({ dayOfWeek, ...dayResult.value });
  }
  return { ok: true, value };
}

export async function loadSchedule(db, accountId, accountType = 'CASHIER') {
  const rows = await db.prepare(`
    SELECT day_of_week, is_day_off, shift_start, shift_end
    FROM account_shift_schedule WHERE account_type = ? AND account_id = ?
    ORDER BY day_of_week
  `).bind(accountType, accountId).all();
  return rows.results ?? [];
}

async function upsertSchedule(db, accountId, days) {
  await db.batch(days.map(day => db.prepare(`
    INSERT INTO account_shift_schedule (account_type, account_id, day_of_week, is_day_off, shift_start, shift_end)
    VALUES ('CASHIER', ?, ?, ?, ?, ?)
    ON CONFLICT (account_type, account_id, day_of_week) DO UPDATE SET
      is_day_off = excluded.is_day_off, shift_start = excluded.shift_start, shift_end = excluded.shift_end
  `).bind(accountId, day.dayOfWeek, day.isDayOff ? 1 : 0, day.shiftStart, day.shiftEnd)));
}

// Bos Cyo, 2026-09-19: "settingan gaji itu ditambahin juga ya jenis
// pembayarannya bisa per sesi bisa per jam jadi nanti dibuat model
// dropdown" -- lihat migration 0105. 'JAM' = hourlyWage tarif per jam
// (dikali durasi kerja). 'SESI' = hourlyWage dipakai flat per sesi presensi
// yang selesai, berapa pun lama kerjanya.
export const PAYMENT_TYPES = ['JAM', 'SESI'];
function paymentTypeInput(value) {
  const trimmed = text(value, 10).toUpperCase();
  return PAYMENT_TYPES.includes(trimmed) ? trimmed : undefined;
}

// Merangkai detail jabatan dari body request -- dipakai POST (bikin akun
// baru, detail opsional) dan PATCH (ubah detail, tiap field opsional, field
// yang tidak dikirim tidak disentuh). `current` adalah baris account_job_details
// yang sudah ada (null saat POST) supaya PATCH sebagian bisa mewarisi nilai lama.
// shiftStart/shiftEnd TIDAK lagi di sini sejak migration 0106 -- jam kerja
// pindah ke account_shift_schedule (7 hari, lihat scheduleInput di atas).
function jobDetailInput(body, current) {
  const hourlyWageRaw = owns(body, 'hourlyWage') ? body.hourlyWage : (current ? current.hourly_wage_scaled / WAGE_SCALE : 0);
  const jobTypeRaw = owns(body, 'jobType') ? body.jobType : (current?.job_type ?? '');
  const paymentTypeRaw = owns(body, 'paymentType') ? body.paymentType : (current?.payment_type ?? 'JAM');

  const hourlyWageScaled = hourlyWageInput(hourlyWageRaw);
  if (hourlyWageScaled === undefined) return { ok: false, error: 'Gaji harus angka rupiah yang wajar.' };
  const paymentType = paymentTypeInput(paymentTypeRaw);
  if (paymentType === undefined) return { ok: false, error: 'Jenis pembayaran harus JAM atau SESI.' };

  return { ok: true, value: { hourlyWageScaled, jobType: jobTypeInput(jobTypeRaw), paymentType } };
}

export async function loadJobDetail(db, accountId, accountType = 'CASHIER') {
  return db.prepare(`
    SELECT hourly_wage_scaled, job_type, payment_type
    FROM account_job_details WHERE account_type = ? AND account_id = ?
  `).bind(accountType, accountId).first();
}

// shift_start/shift_end TIDAK disentuh sama sekali di sini -- dibiarkan
// menganggur di nilai lama (atau default '' kolom untuk baris baru),
// menang tidak dibaca lagi mulai migration 0106.
async function upsertJobDetail(db, accountId, detail) {
  await db.prepare(`
    INSERT INTO account_job_details (account_type, account_id, hourly_wage_scaled, job_type, payment_type, updated_at)
    VALUES ('CASHIER', ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (account_type, account_id) DO UPDATE SET
      hourly_wage_scaled = excluded.hourly_wage_scaled,
      job_type = excluded.job_type,
      payment_type = excluded.payment_type,
      updated_at = CURRENT_TIMESTAMP
  `).bind(accountId, detail.hourlyWageScaled, detail.jobType, detail.paymentType).run();
}

// Presensi masuk/keluar dianggap toggle state, bukan penanda per-hari-kalender
// (menghindari ambiguitas timezone gerai): status "in" berlaku sampai kasir
// eksplisit presensi keluar lagi lewat Portal Staf. Satu baris staff_attendance
// menjelaskan satu sesi kerja penuh (migration 0068) -- "in" berarti ada baris
// dengan status='OPEN' (sudah presensi masuk, belum presensi pulang).
export async function latestAttendanceStatus(db, cashierId) {
  const row = await db.prepare(`
    SELECT 1 FROM staff_attendance WHERE user_id = ? AND status = 'OPEN' LIMIT 1
  `).bind(cashierId).first();
  return row ? 'in' : 'out';
}

function mapCashier(row, schedule = []) {
  return row ? {
    id: row.id,
    username: row.username,
    employeeName: row.employee_name,
    isActive: Boolean(row.is_active),
    store: {
      id: row.store_id,
      code: row.store_code,
      storeName: row.store_name
    },
    hourlyWage: Number(row.hourly_wage_scaled || 0) / WAGE_SCALE,
    jobType: row.job_type || '',
    paymentType: row.payment_type || 'JAM',
    isEntityBackup: Boolean(row.is_entity_backup),
    schedule
  } : null;
}

// Bos Cyo, 2026-09-24: "opsi on/off nya itu adalah kebijakan suatu tenant"
// -- diresolusi tiap request lewat entity_id gerai -> tenant_id (ADR-030),
// bukan dibaca dari kolom `stores` (koreksi atas migration 0118). Lihat
// src/tenant-policy.js untuk alasan lengkap kenapa levelnya tenant.
async function attachAttendanceScheduleGate(db, cashier, entityId) {
  const tenantId = await resolveTenantId(db, entityId);
  cashier.store.attendanceScheduleGateEnabled = await getTenantPolicySetting(db, tenantId, ATTENDANCE_SCHEDULE_GATE_KEY);
  return cashier;
}

export async function requireCashier(request, db) {
  const token = bearerToken(request);
  if (!token) return { ok: false, response: json({ error: 'Login kasir diperlukan.', code: 'CASHIER_LOGIN_REQUIRED' }, 401) };
  const tokenHash = await hashCredential(token);
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT c.id, c.username, c.employee_name, c.is_active, c.is_entity_backup,
           s.id AS store_id, s.code AS store_code, s.store_name, s.entity_id
    FROM cashier_sessions cs
    JOIN cashiers c ON c.id = cs.cashier_id
    JOIN stores s ON s.id = c.store_id
    WHERE cs.token_hash = ? AND cs.expires_at > ?
      AND c.is_active = 1 AND s.is_active = 1
    LIMIT 1
  `).bind(tokenHash, now).first();
  if (!row) return { ok: false, response: json({ error: 'Session kasir tidak valid atau sudah habis.', code: 'CASHIER_SESSION_EXPIRED' }, 401) };
  const cashier = await attachAttendanceScheduleGate(db, mapCashier(row), row.entity_id);
  return { ok: true, cashier, tokenHash };
}

// Bos Cyo, 2026-09-17: "harusnya liat persis banget halaman kasir, tapi
// dia ga bisa write, bukan bikin ui sendiri" -- Owner/Admin Gerai/Entity
// Admin membuka halaman Kasir ASLI ini (public/cashier.html) tanpa akun
// kasir sungguhan, murni untuk BACA (menu + status laci). Dipakai HANYA
// oleh /api/cashier/me dan /api/cashier/workspace (dua endpoint baca) --
// TIDAK PERNAH dipakai endpoint tulis (sales/purchases/expenses/drawer/
// production), yang tetap wajib requireCashier eksklusif seperti
// sebelumnya. requireCashier dicoba dulu supaya kasir sungguhan yang
// kebetulan juga punya token Owner/Admin di browser yang sama tetap
// diprioritaskan sebagai dirinya sendiri, bukan dianggap "cuma lihat".
export async function requireCashierOrReadOnlyManagement(request, env) {
  const db = env.DB;
  const cashierAuth = await requireCashier(request, db);
  if (cashierAuth.ok) return { ok: true, cashier: cashierAuth.cashier, readOnly: false };

  const management = await requireManagement(request, db, env);
  // A specific management failure (mis. Entity Admin di luar entity-nya)
  // lebih informatif daripada "login kasir diperlukan" generik dari
  // requireCashier di atas -- tunjukkan alasan yang sebenarnya.
  if (!management.ok) return { ok: false, response: management.response };

  const url = new URL(request.url);
  const store = await resolveStore(db, url.searchParams.get('store') || DEFAULT_STORE_CODE, { includeInactive: true });
  if (!store) return { ok: false, response: json({ error: 'Gerai tidak ditemukan.' }, 404) };

  const viewerName = management.owner?.displayName || management.entityAdmin?.displayName || management.admin?.displayName || 'Manajemen';
  return {
    ok: true,
    readOnly: true,
    cashier: {
      id: `readonly:${management.authType}`,
      username: '',
      employeeName: `${viewerName} (Mode Lihat)`,
      isActive: true,
      store: { id: store.id, code: store.code, storeName: store.storeName }
    }
  };
}

export async function handleCashierAuthApi(request, env, pathname) {
  const db = env.DB;

  if (request.method === 'POST' && pathname === '/api/cashier/login') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload login tidak valid.' }, 400);
    const username = usernameText(body.value?.username);
    const password = String(body.value?.password ?? '');
    if (!username || !password) return json({ error: 'Username dan password wajib diisi.' }, 400);

    const row = await db.prepare(`
      SELECT c.id, c.username, c.password_hash, c.employee_name, c.is_active, c.is_entity_backup,
             s.id AS store_id, s.code AS store_code, s.store_name, s.is_active AS store_active, s.entity_id
      FROM cashiers c
      JOIN stores s ON s.id = c.store_id
      WHERE c.username = ? COLLATE NOCASE
      LIMIT 1
    `).bind(username).first();

    if (!row || !row.is_active || !row.store_active || await hashCredential(password) !== row.password_hash) {
      return json({ error: 'Username atau password salah.' }, 401);
    }

    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
    const tokenHash = await hashCredential(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
    await db.batch([
      db.prepare('DELETE FROM cashier_sessions WHERE expires_at <= ?').bind(now.toISOString()),
      db.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
        .bind(tokenHash, row.id, now.toISOString(), expiresAt)
    ]);

    const cashier = await attachAttendanceScheduleGate(db, mapCashier(row), row.entity_id);
    return json({ token, expiresAt, cashier, attendanceStatus: await latestAttendanceStatus(db, row.id) });
  }

  if (request.method === 'GET' && pathname === '/api/cashier/me') {
    const auth = await requireCashierOrReadOnlyManagement(request, env);
    if (!auth.ok) return auth.response;
    // Presensi tidak berlaku untuk pengunjung read-only -- 'in' di sini
    // cuma sinyal buat cashier-presensi-gate.js supaya tidak menahan
    // mereka di gerbang foto datang, bukan klaim presensi sungguhan.
    const attendanceStatus = auth.readOnly ? 'in' : await latestAttendanceStatus(db, auth.cashier.id);
    return json({ cashier: auth.cashier, attendanceStatus, readOnly: Boolean(auth.readOnly) });
  }

  if (request.method === 'POST' && pathname === '/api/cashier/logout') {
    const token = bearerToken(request);
    if (token) await db.prepare('DELETE FROM cashier_sessions WHERE token_hash = ?').bind(await hashCredential(token)).run();
    return json({ ok: true });
  }

  return null;
}

async function selectedAdminStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function handleAdminCashierApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/cashiers')) return null;
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const store = await selectedAdminStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  // Bos Cyo, 2026-09-24: "opsi on/off nya itu adalah kebijakan suatu
  // tenant" -- lihat src/tenant-policy.js. Diresolusi sekali di sini,
  // dipakai kedua route presensi/gaji di bawah.
  const attendanceScheduleGateEnabled = await getTenantPolicySetting(
    db, await resolveTenantId(db, store.entityId), ATTENDANCE_SCHEDULE_GATE_KEY
  );

  if (request.method === 'GET' && pathname === '/api/admin/cashiers') {
    // Bos Cyo, 2026-09-24: "untuk akun backup mending ikut entity aja, jadi
    // bikin akunnya cuma 1 aja." Sebelumnya WHERE c.store_id = ? doang --
    // akun backup yang store_id-nya SEDANG menunjuk ke gerai lain (belum/
    // sudah tidak diaktifkan di gerai ini) jadi tidak kelihatan sama sekali
    // di Master Kasir gerai ini, padahal Admin gerai ini seharusnya tetap
    // bisa melihat dan mengaktifkannya. Akun backup (is_entity_backup=1)
    // ditambahkan kalau se-entity, terlepas store_id-nya lagi di gerai mana.
    const rows = await db.prepare(`
      SELECT c.id, c.username, c.employee_name, c.is_active, c.is_entity_backup,
             s.id AS store_id, s.code AS store_code, s.store_name,
             j.hourly_wage_scaled, j.job_type, j.payment_type
      FROM cashiers c
      JOIN stores s ON s.id = c.store_id
      LEFT JOIN account_job_details j ON j.account_type = 'CASHIER' AND j.account_id = c.id
      WHERE c.store_id = ? OR (c.is_entity_backup = 1 AND s.entity_id = ?)
      ORDER BY c.employee_name COLLATE NOCASE
    `).bind(store.id, store.entityId).all();
    const cashiers = rows.results ?? [];
    const scheduleByAccount = new Map();
    const activationByAccount = new Map();
    if (cashiers.length) {
      const scheduleRows = await db.prepare(`
        SELECT account_id, day_of_week, is_day_off, shift_start, shift_end
        FROM account_shift_schedule
        WHERE account_type = 'CASHIER' AND account_id IN (${cashiers.map(() => '?').join(',')})
      `).bind(...cashiers.map(cashier => cashier.id)).all();
      for (const row of scheduleRows.results ?? []) {
        if (!scheduleByAccount.has(row.account_id)) scheduleByAccount.set(row.account_id, []);
        scheduleByAccount.get(row.account_id).push(mapScheduleRow(row));
      }
      const backupIds = cashiers.filter(cashier => cashier.is_entity_backup).map(cashier => cashier.id);
      if (backupIds.length) {
        const todayDate = getJakartaBusinessDate();
        const activationRows = await db.prepare(`
          SELECT account_id, store_id, activated_by_role, activated_at
          FROM account_daily_activations
          WHERE account_type = 'CASHIER' AND business_date = ? AND account_id IN (${backupIds.map(() => '?').join(',')})
        `).bind(todayDate, ...backupIds).all();
        for (const row of activationRows.results ?? []) {
          activationByAccount.set(row.account_id, { storeId: row.store_id, activatedByRole: row.activated_by_role, activatedAt: row.activated_at });
        }
      }
    }
    return json({
      cashiers: cashiers.map(row => ({
        ...mapCashier(row, scheduleByAccount.get(row.id) ?? []),
        todayActivation: row.is_entity_backup ? (activationByAccount.get(row.id) || null) : null
      })),
      store
    });
  }

  if (request.method === 'POST' && pathname === '/api/admin/cashiers') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload kasir tidak valid.' }, 400);
    const username = usernameText(body.value?.username);
    const password = String(body.value?.password ?? '');
    const employeeName = text(body.value?.employeeName, 100);
    if (username.length < 3 || password.length < 6 || !employeeName) {
      return json({ error: 'Username min. 3 karakter, password min. 6 karakter, dan nama karyawan wajib diisi.' }, 400);
    }
    const detail = jobDetailInput(body.value ?? {}, null);
    if (!detail.ok) return json({ error: detail.error }, 400);
    const schedule = scheduleInput(body.value ?? {}, null);
    if (!schedule.ok) return json({ error: schedule.error }, 400);
    // Bos Cyo, 2026-09-24: akun backup lintas gerai -- lihat migration 0115.
    const isEntityBackup = body.value?.isEntityBackup === true ? 1 : 0;
    const duplicate = await db.prepare('SELECT id FROM cashiers WHERE username = ? COLLATE NOCASE').bind(username).first();
    if (duplicate) return json({ error: 'Username kasir sudah dipakai.' }, 409);
    const id = `cashier_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, is_entity_backup, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(id, username, await hashCredential(password), employeeName, store.id, isEntityBackup).run();
    await upsertJobDetail(db, id, detail.value);
    await upsertSchedule(db, id, schedule.value);
    return json({ ok: true, id }, 201);
  }

  // Bos Cyo, 2026-09-24: "presensi cs kok ngga muncul di web baru... yang
  // ngga ada di webnya admin, jadi ini saya sama mba rika juga bingung mau
  // cek presensi dan hitung honornya, harus buka web lama." Riwayat Presensi
  // (Portal Staf, /api/staff/portal) cuma pernah dibangun untuk karyawan
  // melihat DIRINYA SENDIRI -- tidak pernah ada jalur Admin melihat riwayat
  // karyawan LAIN.
  //
  // Payroll SENGAJA tidak lagi dibawa di sini (dulu ada) -- "untuk detil
  // gaji dikasi tombol dan kolom sendiri saja. karna selain dari presensi,
  // gaji nanti juga bisa dibuat oleh akuntan sendiri" (Bos Cyo, 2026-09-24).
  // Lihat GET .../payroll di bawah.
  const attendanceMatch = pathname.match(/^\/api\/admin\/cashiers\/([^/]+)\/attendance$/);
  if (attendanceMatch) {
    if (request.method !== 'GET') return json({ error: 'Method tidak didukung.' }, 405);
    const id = decodeURIComponent(attendanceMatch[1]);
    const cashier = await db.prepare('SELECT id, employee_name, username FROM cashiers WHERE id = ? AND store_id = ?').bind(id, store.id).first();
    if (!cashier) return json({ error: 'Kasir tidak ditemukan di gerai ini.' }, 404);
    const scheduleByDay = scheduleMap(await loadSchedule(db, id));
    const attendance = await listAttendance(db, id, scheduleByDay, attendanceScheduleGateEnabled);
    return json({
      cashier: { id: cashier.id, employeeName: cashier.employee_name, username: cashier.username },
      attendance
    });
  }

  // Bos Cyo, 2026-09-24: "untuk detil gaji dikasi tombol dan kolom sendiri
  // saja. karna selain dari presensi, gaji nanti juga bisa dibuat oleh
  // akuntan sendiri, misal tanggal 26 akuntan entry tambahan 30rb karena
  // lembur ... jadi di tanggal 26 nanti akan terlihat 2 kartu, 1 dari
  // presensi normal, 2 tambah entryan akuntan." payroll (dihitung ulang
  // dari presensi + tarif) dan adjustments (entry manual, baris permanen di
  // payroll_adjustments) dua sumber terpisah -- caller (UI) yang
  // menggabungkan per tanggal untuk ditampilkan sebagai kartu-kartu.
  const payrollMatch = pathname.match(/^\/api\/admin\/cashiers\/([^/]+)\/payroll$/);
  if (payrollMatch) {
    const id = decodeURIComponent(payrollMatch[1]);
    const cashier = await db.prepare('SELECT id, employee_name, username FROM cashiers WHERE id = ? AND store_id = ?').bind(id, store.id).first();
    if (!cashier) return json({ error: 'Kasir tidak ditemukan di gerai ini.' }, 404);

    if (request.method === 'GET') {
      const jobDetail = await loadJobDetail(db, id);
      const scheduleByDay = scheduleMap(await loadSchedule(db, id));
      const attendance = await listAttendance(db, id, scheduleByDay, attendanceScheduleGateEnabled);
      const adjustments = await listPayrollAdjustments(db, { accountId: id, storeId: store.id });
      return json({
        cashier: { id: cashier.id, employeeName: cashier.employee_name, username: cashier.username },
        payroll: buildPayroll(attendance, jobDetail, scheduleByDay, attendanceScheduleGateEnabled),
        adjustments
      });
    }

    if (request.method === 'POST') {
      const body = await readJson(request);
      if (!body.ok) return json({ error: 'Payload penyesuaian gaji tidak valid.' }, 400);
      const actor = managementActor(auth);
      const result = await createPayrollAdjustment(db, {
        accountId: id,
        storeId: store.id,
        businessDate: body.value?.businessDate,
        amountRupiah: body.value?.amountRupiah,
        reason: body.value?.reason,
        createdByRole: actor.role,
        createdById: actor.id
      });
      if (!result.ok) return json({ error: result.error }, 400);
      return json({ ok: true, id: result.id }, 201);
    }

    return json({ error: 'Method tidak didukung.' }, 405);
  }

  const voidAdjustmentMatch = pathname.match(/^\/api\/admin\/cashiers\/([^/]+)\/payroll-adjustments\/([^/]+)\/void$/);
  if (voidAdjustmentMatch) {
    if (request.method !== 'POST') return json({ error: 'Method tidak didukung.' }, 405);
    const id = decodeURIComponent(voidAdjustmentMatch[1]);
    const adjustmentId = decodeURIComponent(voidAdjustmentMatch[2]);
    const cashier = await db.prepare('SELECT id FROM cashiers WHERE id = ? AND store_id = ?').bind(id, store.id).first();
    if (!cashier) return json({ error: 'Kasir tidak ditemukan di gerai ini.' }, 404);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload pembatalan tidak valid.' }, 400);
    const actor = managementActor(auth);
    const result = await voidPayrollAdjustment(db, {
      id: adjustmentId,
      storeId: store.id,
      reason: body.value?.reason,
      voidedByRole: actor.role,
      voidedById: actor.id
    });
    if (!result.ok) return json({ error: result.error }, 404);
    return json({ ok: true });
  }

  // Bos Cyo, 2026-09-24: aktivasi akun backup lintas gerai -- lihat migration
  // 0115 dan src/entity-backup-cashiers.js. Sengaja DICEK LEWAT entity_id gerai
  // TEMPAT AKUN ITU SEDANG BERADA (bukan store.id pemanggil), supaya Admin gerai
  // manapun dalam entity yang sama bisa "menarik" akun backup ke gerainya --
  // itu justru intinya fitur ini (satu akun, dipindah antar-gerai sesama entity).
  const activateMatch = pathname.match(/^\/api\/admin\/cashiers\/([^/]+)\/activate-today$/);
  if (activateMatch) {
    if (request.method !== 'POST') return json({ error: 'Method tidak didukung.' }, 405);
    const id = decodeURIComponent(activateMatch[1]);
    const backup = await db.prepare(`
      SELECT c.id, c.is_entity_backup, s.entity_id AS entity_id
      FROM cashiers c JOIN stores s ON s.id = c.store_id
      WHERE c.id = ?
    `).bind(id).first();
    if (!backup || !backup.is_entity_backup) return json({ error: 'Akun backup tidak ditemukan.' }, 404);
    if (backup.entity_id !== store.entityId) return json({ error: 'Akun backup ini bukan milik entity gerai Anda.' }, 403);
    const actor = managementActor(auth);
    const result = await activateEntityBackupCashier(db, {
      accountId: id,
      storeId: store.id,
      activatedByRole: actor.role,
      activatedById: actor.id
    });
    if (!result.ok) return json({ error: result.error }, 400);
    return json({ ok: true, alreadyActive: Boolean(result.alreadyActive) });
  }

  // Foto presensi versi Admin -- simetris dengan /api/staff/attendance/:id/photo
  // (src/staff-portal.js), tapi discoped ke GERAI (lewat kepemilikan akun
  // kasirnya), bukan ke diri sendiri. <img src="..."> browser tidak pernah
  // membawa header Authorization custom (sama seperti versi staff), jadi
  // caller wajib fetch() sebagai blob dulu -- lihat loadAttendancePhotoThumbs
  // di public/staff.js untuk pola yang sama, ditiru di admin-cashiers.js.
  const attendancePhotoMatch = pathname.match(/^\/api\/admin\/cashiers\/([^/]+)\/attendance\/([^/]+)\/photo$/);
  if (attendancePhotoMatch) {
    if (request.method !== 'GET') return json({ error: 'Method tidak didukung.' }, 405);
    const cashierId = decodeURIComponent(attendancePhotoMatch[1]);
    const attendanceId = decodeURIComponent(attendancePhotoMatch[2]);
    const cashier = await db.prepare('SELECT id FROM cashiers WHERE id = ? AND store_id = ?').bind(cashierId, store.id).first();
    if (!cashier) return json({ error: 'Kasir tidak ditemukan di gerai ini.' }, 404);
    const which = new URL(request.url).searchParams.get('which') === 'out' ? 'out' : 'in';
    const blobColumn = which === 'out' ? 'check_out_photo_blob' : 'photo_blob';
    const typeColumn = which === 'out' ? 'check_out_photo_type' : 'photo_type';
    const row = await db.prepare(`
      SELECT ${blobColumn} AS photo_blob, ${typeColumn} AS photo_type
      FROM staff_attendance WHERE id = ? AND user_id = ?
    `).bind(attendanceId, cashier.id).first();
    if (!row || !row.photo_blob) return json({ error: 'Foto presensi tidak ditemukan.' }, 404);
    return new Response(row.photo_blob, {
      headers: { 'Content-Type': row.photo_type || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }
    });
  }

  const match = pathname.match(/^\/api\/admin\/cashiers\/([^/]+)$/);
  if (!match) return json({ error: 'Route master kasir tidak ditemukan.' }, 404);
  const id = decodeURIComponent(match[1]);
  const current = await db.prepare('SELECT id, username, employee_name, store_id, is_active, is_entity_backup FROM cashiers WHERE id = ? AND store_id = ?').bind(id, store.id).first();
  if (!current) return json({ error: 'Kasir tidak ditemukan di gerai ini.' }, 404);

  if (request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload kasir tidak valid.' }, 400);
    const username = usernameText(body.value?.username ?? current.username);
    const employeeName = text(body.value?.employeeName ?? current.employee_name, 100);
    const password = String(body.value?.password ?? '');
    const isActive = body.value?.isActive === false ? 0 : 1;
    // Bos Cyo, 2026-09-24: toggle akun backup lintas gerai lewat form edit yang
    // sama -- undefined artinya field tidak dikirim (biarkan nilai lama).
    const isEntityBackup = owns(body.value, 'isEntityBackup')
      ? (body.value.isEntityBackup === true ? 1 : 0)
      : current.is_entity_backup;
    if (username.length < 3 || !employeeName || (password && password.length < 6)) {
      return json({ error: 'Data kasir tidak valid.' }, 400);
    }
    const currentDetail = await loadJobDetail(db, id);
    const detail = jobDetailInput(body.value ?? {}, currentDetail);
    if (!detail.ok) return json({ error: detail.error }, 400);
    const currentSchedule = await loadSchedule(db, id);
    const schedule = scheduleInput(body.value ?? {}, currentSchedule);
    if (!schedule.ok) return json({ error: schedule.error }, 400);
    const duplicate = await db.prepare('SELECT id FROM cashiers WHERE username = ? COLLATE NOCASE AND id <> ?').bind(username, id).first();
    if (duplicate) return json({ error: 'Username kasir sudah dipakai.' }, 409);

    if (password) {
      await db.prepare(`UPDATE cashiers SET username = ?, password_hash = ?, employee_name = ?, is_active = ?, is_entity_backup = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?`)
        .bind(username, await hashCredential(password), employeeName, isActive, isEntityBackup, id, store.id).run();
    } else {
      await db.prepare(`UPDATE cashiers SET username = ?, employee_name = ?, is_active = ?, is_entity_backup = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?`)
        .bind(username, employeeName, isActive, isEntityBackup, id, store.id).run();
    }
    await upsertJobDetail(db, id, detail.value);
    await upsertSchedule(db, id, schedule.value);
    await db.prepare('DELETE FROM cashier_sessions WHERE cashier_id = ?').bind(id).run();
    return json({ ok: true });
  }

  if (request.method === 'DELETE') {
    await db.batch([
      db.prepare('UPDATE cashiers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?').bind(id, store.id),
      db.prepare('DELETE FROM cashier_sessions WHERE cashier_id = ?').bind(id)
    ]);
    return json({ ok: true });
  }

  return json({ error: 'Method tidak didukung.' }, 405);
}
