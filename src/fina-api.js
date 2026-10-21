import { json, readJson } from './http.js';
import { ownerEntityContext } from './owner-entity-context.js';
import { requireManagement, storeAdminFromRequest } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getJakartaBusinessDate } from './time.js';
import { pengaturanFina } from './fina-pengaturan.js';
import { cariShiftKosong, pilihFreelance, rekapMasalah, rentangShiftFina, geserTanggalFina } from './fina-hitung.js';

const PREFIX = '/api/admin/fina/';
const ROUTES = Object.freeze({
  '/api/admin/fina/kosong': 'kosong',
  '/api/admin/fina/freelance': 'freelance',
  '/api/admin/fina/masalah': 'masalah',
  // H3: sesi presensi satu hari di satu gerai, untuk alat catat_pengganti.
  '/api/admin/fina/sesi': 'sesi'
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
  if (!['kosong', 'freelance', 'masalah', 'sesi'].includes(jenis)) return json({ error: 'Rute Fina tidak ditemukan.' }, 404);
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
      const aturan = await pengaturanFina(db, store.entityId, store.id);
      const configured = aturan.backupLintasGerai;
      // Admin/PIN hanya melihat kandidat gerainya, Owner/EA boleh lintas gerai dalam entity.
      const lintas = configured === true && Boolean(auth.owner || auth.entityAdmin || auth.agent);
      const people = await accounts(db, store, lintas);
      const jadwal = await schedules(db, people);
      const presensi = await sessions(db, store, new Date(range.start).toISOString(), new Date(range.end).toISOString(), people);
      const aktivasi = await activations(db, people, date, geserTanggalFina(date, 1));
      return json({ store: safeStore, date, from: dari, to: sampai, lintasGerai: lintas,
        tawaranSerentak: aturan.tawaranSerentak, batasTungguMenit: aturan.batasTungguMenit,
        candidates: pilihFreelance({ kandidat: people, jadwal, presensi, aktivasi, tanggal: date, dari, sampai, lintasGerai: lintas, storeId: store.id }) });
    }
    if (jenis === 'sesi') {
      // Sesi yang MULAI pada hari WIB itu (atau sehari sebelumnya untuk shift malam) + CS asli yang
      // berjadwal hari itu: bahan "X menggantikan Y". Tanpa kontak; tidak menulis apa pun.
      const start = new Date(geserTanggalFina(date, -1) + 'T12:00:00+07:00').toISOString();
      const end = new Date(geserTanggalFina(date, 1) + 'T00:00:00+07:00').toISOString();
      const presensi = await sessions(db, store, start, end);
      const people = await accounts(db, store, false);
      const jadwal = await schedules(db, people);
      const hari = new Date(date + 'T00:00:00Z').getUTCDay();
      return json({ store: safeStore, date,
        sesi: presensi.filter(x => x.store_id === store.id).map(x => ({ attendanceId: x.id, accountId: x.account_id, name: x.employee_name || '',
          masuk: x.created_at, pulang: x.check_out_at || null, status: x.status, replacesAccountId: x.replaces_account_id ?? null })),
        terjadwal: jadwal.filter(x => Number(x.day_of_week) === hari && Number(x.is_day_off) !== 1 && x.shift_start && x.shift_end && x.status === 'ASLI')
          .map(x => ({ accountId: x.account_id, name: x.employee_name || '', shiftStart: x.shift_start, shiftEnd: x.shift_end })) });
    }
    const aturanSp = await pengaturanFina(db, store.entityId, store.id);
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
      aturan: { spTingkat: aturanSp.spTingkat, spBerlakuHari: aturanSp.spBerlakuHari, kopSurat: aturanSp.kopSurat },
      catatan: 'Kosong dan denda hanya dari evaluasi tersimpan. Tanpa evaluasi, indikasi jam memakai jadwal saat ini. Pembacaan ini tidak menilai ulang atau memotong gaji.',
      employees: rekapMasalah({ evaluasi: snapshots, presensi, dari: from, sampai: to }) });
  } catch (error) {
    if (error.status) return json({ error: error.message }, error.status);
    throw error;
  }
}

// --- Surat teguran / SP (H3, migration 0175) -----------------------------------------------
// Fina (lewat draft + "Ya") hanya bisa MEMBUAT surat berstatus DRAFT. Setujui / Batalkan hanya
// tombol manusia di Entity Admin: rutenya sengaja tidak masuk PINTU_AKSI agen (src/caca-chat.js).
const SURAT_BASE = '/api/entity-admin/fina/surat';
const MAKS_ISI_SURAT = 8000;
const MAKS_FAKTA_SURAT = 20000;

const suratKe = row => ({
  id: row.id, storeId: row.store_id, storeCode: row.store_code || '', accountId: row.account_id, name: row.employee_name || '',
  tingkat: row.tingkat, periodeDari: row.periode_dari, periodeSampai: row.periode_sampai,
  fakta: (() => { try { return JSON.parse(row.fakta); } catch { return null; } })(), isi: row.isi, status: row.status,
  berlakuSampai: row.berlaku_sampai || null, dibuatOleh: row.dibuat_oleh_role, disetujuiOleh: row.disetujui_oleh_role || null,
  disetujuiAt: row.disetujui_at || null, dibatalkanAlasan: row.dibatalkan_alasan || '', createdAt: row.created_at
});

export async function handleFinaSuratApi(request, env, pathname, { now = new Date() } = {}) {
  if (pathname !== SURAT_BASE && !pathname.startsWith(SURAT_BASE + '/')) return null;
  const context = await ownerEntityContext(request, env, { allowEntityAdminOutsideSkin: true });
  if (context.response) return context.response;
  const db = env.DB;
  const actor = context.entityAdmin ? { role: 'ENTITY_ADMIN', id: context.entityAdmin.id } : { role: 'OWNER', id: context.owner?.id || '' };
  const stores = new Map(context.stores.map(st => [st.id, st]));
  const byCode = new Map(context.stores.map(st => [String(st.code).toUpperCase(), st]));
  const pilih = `SELECT h.*, s.code AS store_code, c.employee_name FROM hr_surat h LEFT JOIN stores s ON s.id = h.store_id
    LEFT JOIN cashiers c ON c.id = h.account_id WHERE h.entity_id = ?`;

  if (pathname === SURAT_BASE && request.method === 'GET') {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const account = url.searchParams.get('account');
    const list = (await db.prepare(`${pilih} ${status ? 'AND h.status = ?' : ''} ${account ? 'AND h.account_id = ?' : ''} ORDER BY h.created_at DESC LIMIT 200`)
      .bind(context.entityId, ...(status ? [status] : []), ...(account ? [account] : [])).all()).results ?? [];
    return json({ surat: list.map(suratKe), hariIni: getJakartaBusinessDate(now) });
  }

  if (pathname === SURAT_BASE && request.method === 'POST') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
    const v = body.value || {};
    const store = stores.get(String(v.storeId || '')) || byCode.get(String(v.storeCode || '').toUpperCase());
    if (!store) return json({ error: 'Gerai di luar entity ini.' }, 403);
    const akun = await db.prepare('SELECT id, store_id FROM cashiers WHERE id = ?').bind(String(v.accountId || '')).first();
    if (!akun || akun.store_id !== store.id) return json({ error: 'Akun CS bukan milik gerai ini.' }, 403);
    const aturan = await pengaturanFina(db, context.entityId, store.id);
    const tingkat = String(v.tingkat || '').trim().toUpperCase();
    if (!aturan.spTingkat.includes(tingkat)) return json({ error: `Tingkat harus salah satu dari: ${aturan.spTingkat.join(', ')}.` }, 400);
    if (!tanggalValid(v.periodeDari) || !tanggalValid(v.periodeSampai) || v.periodeDari > v.periodeSampai) return json({ error: 'Periode surat wajib tanggal YYYY-MM-DD berurutan.' }, 400);
    const isi = String(v.isi || '').replace(/\r\n?/g, '\n').trim();
    if (!isi || isi.length > MAKS_ISI_SURAT) return json({ error: `Isi surat wajib, maks ${MAKS_ISI_SURAT} huruf.` }, 400);
    let fakta;
    try { fakta = JSON.stringify(v.fakta ?? null); } catch { fakta = ''; }
    if (!fakta || fakta === 'null' || fakta.length > MAKS_FAKTA_SURAT) return json({ error: 'Fakta rekap wajib dilampirkan.' }, 400);
    // Satu draft terbuka per CS + tingkat + periode: tombol "Ya" dua kali tidak membuat surat kembar.
    const kembar = await db.prepare(`SELECT id FROM hr_surat WHERE entity_id = ? AND account_id = ? AND tingkat = ? AND periode_dari = ? AND periode_sampai = ? AND status = 'DRAFT'`)
      .bind(context.entityId, akun.id, tingkat, v.periodeDari, v.periodeSampai).first();
    if (kembar) return json({ ok: true, id: kembar.id, duplicate: true });
    const link = await db.prepare(`SELECT employee_id FROM employee_account_links WHERE account_type = 'CASHIER' AND account_id = ? AND effective_to IS NULL LIMIT 1`).bind(akun.id).first();
    const id = `surat_${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO hr_surat (id, entity_id, store_id, account_id, employee_id, tingkat, periode_dari, periode_sampai, fakta, isi,
      status, dibuat_oleh_role, dibuat_oleh_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`)
      .bind(id, context.entityId, store.id, akun.id, link?.employee_id ?? null, tingkat, v.periodeDari, v.periodeSampai, fakta, isi, actor.role, String(actor.id).slice(0, 120)).run();
    return json({ ok: true, id }, 201);
  }

  const aksi = pathname.match(/^\/api\/entity-admin\/fina\/surat\/([^/]+)\/(setujui|batalkan)$/);
  if (aksi && request.method === 'POST') {
    const id = decodeURIComponent(aksi[1]);
    const row = await db.prepare(`${pilih} AND h.id = ?`).bind(context.entityId, id).first();
    if (!row) return json({ error: 'Surat tidak ditemukan.' }, 404);
    if (aksi[2] === 'setujui') {
      if (row.status !== 'DRAFT') return json({ error: 'Hanya draft yang bisa disetujui.' }, 409);
        const aturan = await pengaturanFina(db, context.entityId, row.store_id);
      const berlaku = geserTanggalFina(getJakartaBusinessDate(now), aturan.spBerlakuHari);
      await db.prepare(`UPDATE hr_surat SET status = 'DISETUJUI', berlaku_sampai = ?, disetujui_oleh_role = ?, disetujui_oleh_id = ?, disetujui_at = ?
        WHERE id = ? AND status = 'DRAFT'`).bind(berlaku, actor.role, String(actor.id).slice(0, 120), now.toISOString(), id).run();
      return json({ ok: true, berlakuSampai: berlaku });
    }
    if (row.status === 'DIBATALKAN') return json({ error: 'Surat sudah dibatalkan.' }, 409);
    const body = await readJson(request);
    const alasan = String(body.ok ? body.value?.alasan ?? '' : '').trim().slice(0, 300);
    if (alasan.length < 3) return json({ error: 'Alasan pembatalan wajib diisi.' }, 400);
    await db.prepare(`UPDATE hr_surat SET status = 'DIBATALKAN', dibatalkan_alasan = ? WHERE id = ? AND status <> 'DIBATALKAN'`).bind(alasan, id).run();
    return json({ ok: true });
  }
  return json({ error: 'Rute surat Fina tidak ditemukan.' }, 404);
}
