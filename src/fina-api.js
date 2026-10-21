import { json } from './http.js';
import { requireManagement, storeAdminFromRequest } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getJakartaBusinessDate } from './time.js';
import { pengaturanFina } from './fina-pengaturan.js';
import { cariShiftKosong, pilihFreelance, rekapMasalah, rentangShiftFina, geserTanggalFina } from './fina-hitung.js';

const PREFIX = '/api/admin/fina/';
const ROUTES = Object.freeze({
  '/api/admin/fina/kosong': 'kosong',
  '/api/admin/fina/freelance': 'freelance',
  '/api/admin/fina/masalah': 'masalah'
});
const MAX_ROWS = 5000; // batas pembacaan, bukan aturan HR tenant
const MAX_DAYS = 31;
const tanggalValid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
  && !Number.isNaN(Date.parse(value + 'T00:00:00Z'))
  && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const gagal = (message, status = 400) => Object.assign(new Error(message), { status });

async function rows(db, sql, params = []) {
  const result = (await db.prepare(sql + ' LIMIT ' + (MAX_ROWS + 1)).bind(...params).all()).results || [];
  if (result.length > MAX_ROWS) throw gagal('Data terlalu banyak untuk dibaca lengkap. Pilih rentang lebih pendek; Fina belum menyimpulkan.', 422);
  return result;
}

// Aturan HR dari pengaturan Fina (H1): gerai -> entity -> FINA_BAWAAN. Tidak ada angka HR di sini.
async function accounts(db, store, lintas, includeInactive = false) {
  return rows(db, `
    SELECT c.id AS account_id, c.employee_name, c.store_id, s.code AS store_code, c.is_active, c.is_entity_backup,
      COALESCE(cs.status, CASE WHEN c.is_entity_backup = 1 THEN 'FREELANCE' ELSE 'ASLI' END) AS status,
      l.employee_id
    FROM cashiers c JOIN stores s ON s.id = c.store_id
    LEFT JOIN cashier_cs_status cs ON cs.account_id = c.id
    LEFT JOIN employee_account_links l ON l.account_type = 'CASHIER' AND l.account_id = c.id AND l.effective_to IS NULL
    WHERE s.entity_id = ? AND (? = 1 OR c.store_id = ?) AND (? = 1 OR c.is_active = 1)
    ORDER BY c.id
  `, [store.entityId, Number(lintas), store.id, Number(includeInactive)]);
}

async function schedules(db, people) {
  const out = [];
  const map = new Map(people.map(p => [p.account_id, p]));
  const ids = [...map.keys()];
  for (let i = 0; i < ids.length; i += 80) {
    const batch = ids.slice(i, i + 80);
    const list = await rows(db, `SELECT account_id, day_of_week, is_day_off, shift_start, shift_end FROM account_shift_schedule
      WHERE account_type = 'CASHIER' AND account_id IN (${batch.map(() => '?').join(',')})`, batch);
    out.push(...list.map(r => ({ ...map.get(r.account_id), ...r })));
  }
  return out;
}

async function sessions(db, store, from, to, people = null) {
  const out = [];
  const ids = people ? [...new Set(people.map(p => p.account_id))] : null;
  const batches = ids ? Array.from({ length: Math.ceil(ids.length / 80) }, (_, i) => ids.slice(i * 80, i * 80 + 80)) : [null];
  for (const batch of batches) {
    const list = await rows(db, `
      SELECT a.id, a.user_id AS account_id, a.store_id, a.created_at, a.check_out_at, a.status, a.auto_closed,
        c.employee_name, p.replaces_account_id, l.employee_id
      FROM staff_attendance a JOIN stores s ON s.id = a.store_id JOIN cashiers c ON c.id = a.user_id
      LEFT JOIN apresiasi_pengganti p ON p.attendance_id = a.id
      LEFT JOIN employee_account_links l ON l.account_type = 'CASHIER' AND l.account_id = a.user_id AND l.effective_to IS NULL
      WHERE s.entity_id = ? AND ${batch ? 'a.user_id IN (' + batch.map(() => '?').join(',') + ')' : 'a.store_id = ?'}
        AND a.created_at < ? AND (a.check_out_at > ? OR (a.check_out_at IS NULL AND a.status = 'OPEN'))
      ORDER BY a.created_at
    `, [store.entityId, ...(batch || [store.id]), to, from]);
    out.push(...list);
    if (out.length > MAX_ROWS) throw gagal('Presensi terlalu banyak untuk dibaca lengkap; Fina belum menyimpulkan.', 422);
  }
  return out;
}

async function activations(db, people, from, to) {
  const ids = [...new Set(people.map(p => p.account_id))];
  const out = [];
  for (let i = 0; i < ids.length; i += 80) {
    const batch = ids.slice(i, i + 80);
    out.push(...await rows(db, `SELECT account_id, business_date, store_id FROM account_daily_activations
      WHERE account_type = 'CASHIER' AND account_id IN (${batch.map(() => '?').join(',')}) AND business_date BETWEEN ? AND ?`, [...batch, from, to]));
  }
  return out;
}

export async function handleFinaApi(request, env, pathname, { now = new Date() } = {}) {
  if (!pathname.startsWith(PREFIX)) return null;
  const jenis = ROUTES[pathname];
  if (!['kosong', 'freelance', 'masalah'].includes(jenis)) return json({ error: 'Rute Fina tidak ditemukan.' }, 404);
  const url = new URL(request.url);
  // Tanpa parameter, Admin mengikuti gerai sesi, bukan gerai terakhir di browser.
  if (!url.searchParams.has('store')) {
    const admin = await storeAdminFromRequest(request, env.DB);
    if (admin) url.searchParams.set('store', admin.store.id);
  }
  const scoped = new Request(url, request);
  const auth = await requireManagement(scoped, env.DB, env);
  if (!auth.ok) return auth.response;
  if (request.method !== 'GET') return json({ error: 'Alat Fina H2 hanya membaca.' }, 405);
  const store = await resolveStore(env.DB, url.searchParams.get('store') || DEFAULT_STORE_CODE);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  if (auth.authType === 'LEGACY_PIN' && store.code !== DEFAULT_STORE_CODE) return json({ error: 'PIN lama hanya untuk gerai bawaan.' }, 403);
  if (!store.entityId) return json({ error: 'Gerai belum terhubung ke entity.' }, 409);
  try {
    const today = getJakartaBusinessDate(now);
    const date = url.searchParams.get('date') || today;
    const from = url.searchParams.get('from') || geserTanggalFina(today, -6);
    const to = url.searchParams.get('to') || today;
    if (jenis !== 'masalah' && !tanggalValid(date)) throw gagal('Tanggal wajib YYYY-MM-DD yang benar.');
    if (jenis === 'masalah' && (!tanggalValid(from) || !tanggalValid(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 >= MAX_DAYS)) throw gagal('Rentang rekap wajib tanggal benar, berurutan, maksimal 31 hari.');
    const safeStore = { id: store.id, code: store.code, storeName: store.storeName };
    const db = env.DB;
    if (jenis === 'kosong') {
      const { deteksiKosongMenit: deteksi } = await pengaturanFina(db, store.entityId, store.id);
      const people = await accounts(db, store, false);
      const jadwal = await schedules(db, people);
      const dates = [geserTanggalFina(date, -1), date];
      const expanded = jadwal.flatMap(r => dates.map(business_date => ({ ...r, business_date })));
      const start = new Date(geserTanggalFina(date, -1) + 'T00:00:00+07:00').toISOString();
      const end = new Date(geserTanggalFina(date, 2) + 'T00:00:00+07:00').toISOString();
      const presensi = await sessions(db, store, start, end);
      const aktivasi = await activations(db, presensi, dates[0], geserTanggalFina(date, 1));
      return json({ store: safeStore, date, diperiksaPada: now.toISOString(), deteksiMenit: deteksi,
        shifts: cariShiftKosong({ jadwal: expanded, presensi, aktivasi, sekarang: now, deteksiMenit: deteksi }) });
    }
    if (jenis === 'freelance') {
      const dari = url.searchParams.get('from'), sampai = url.searchParams.get('to');
      const range = rentangShiftFina(date, dari, sampai);
      if (!range) throw gagal('Jam dari dan sampai wajib HH:MM dan berbeda.');
      const { backupLintasGerai: configured } = await pengaturanFina(db, store.entityId, store.id);
      // Admin/PIN hanya melihat kandidat gerainya, Owner/EA boleh lintas gerai dalam entity.
      const lintas = configured === true && Boolean(auth.owner || auth.entityAdmin || auth.agent);
      const people = await accounts(db, store, lintas);
      const jadwal = await schedules(db, people);
      const presensi = await sessions(db, store, new Date(range.start).toISOString(), new Date(range.end).toISOString(), people);
      const aktivasi = await activations(db, people, date, geserTanggalFina(date, 1));
      return json({ store: safeStore, date, from: dari, to: sampai, lintasGerai: lintas,
        candidates: pilihFreelance({ kandidat: people, jadwal, presensi, aktivasi, tanggal: date, dari, sampai, lintasGerai: lintas, storeId: store.id }) });
    }
    const evaluasi = await rows(db, `
      SELECT v.id, v.account_id, v.store_id, v.business_date, v.shift_start, v.shift_end,
        v.kosong_minutes, v.denda_kind, c.employee_name
      FROM apresiasi_evaluations v LEFT JOIN cashiers c ON c.id = v.account_id
      WHERE v.entity_id = ? AND v.store_id = ? AND v.business_date BETWEEN ? AND ?
      ORDER BY v.business_date, v.account_id
    `, [store.entityId, store.id, from, to]);
    const fines = await rows(db, `SELECT evaluation_id, CAST(SUM(amount_scaled) AS TEXT) AS amount_scaled
      FROM apresiasi_entries WHERE entity_id = ? AND store_id = ? AND business_date BETWEEN ? AND ?
      AND kind = 'DENDA' AND voided_at IS NULL GROUP BY evaluation_id`, [store.entityId, store.id, from, to]);
    const fineMap = new Map(fines.map(r => [r.evaluation_id, r.amount_scaled]));
    const presensi = await sessions(db, store, new Date(from + 'T00:00:00+07:00').toISOString(), new Date(geserTanggalFina(to, 2) + 'T00:00:00+07:00').toISOString());
    // Snapshot evaluasi menang atas jadwal yang sudah diedit. Sesi tanpa evaluasi
    // diberi jadwal saat ini untuk indikasi telat/pulang, tanpa mengarang denda/kosong.
    const jadwal = await schedules(db, await accounts(db, store, false, true));
    const snapshots = evaluasi.map(e => ({ ...e, denda_amount_scaled: fineMap.get(e.id) || '0' }));
    const keys = new Set(snapshots.map(r => [r.account_id, r.business_date].join('|')));
    const byAccountDay = new Map(jadwal.map(r => [[r.account_id, r.day_of_week].join('|'), r]));
    for (const session of presensi) {
      const date = getJakartaBusinessDate(new Date(session.created_at));
      for (const d of [geserTanggalFina(date, -1), date]) {
        if (d < from || d > to || keys.has([session.account_id, d].join('|'))) continue;
        const r = byAccountDay.get([session.account_id, new Date(d + 'T00:00:00Z').getUTCDay()].join('|'));
        if (!r || Number(r.is_day_off) === 1) continue;
        const window = rentangShiftFina(d, r.shift_start, r.shift_end);
        if (!window || Date.parse(session.created_at) >= window.end || (session.check_out_at && Date.parse(session.check_out_at) <= window.start)) continue;
        keys.add([session.account_id, d].join('|'));
        snapshots.push({ ...r, id: null, business_date: d });
      }
    }
    return json({ store: safeStore, from, to,
      catatan: 'Kosong dan denda hanya dari evaluasi tersimpan. Tanpa evaluasi, indikasi jam memakai jadwal saat ini. Pembacaan ini tidak menilai ulang atau memotong gaji.',
      employees: rekapMasalah({ evaluasi: snapshots, presensi, dari: from, sampai: to }) });
  } catch (error) {
    if (error.status) return json({ error: error.message }, error.status);
    throw error;
  }
}
