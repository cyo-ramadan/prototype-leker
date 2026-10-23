import { json, readJson } from './http.js';
import { setBerhenti } from './dana-apresiasi.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { requireManagement } from './owner-auth.js';
import { listLedgerForEmployee } from './payroll-ledger.js';
import { AKUN_HUTANG_GAJI, operasionalPerGerai, riwayatDariBuku } from './riwayat-dari-buku.js';

// Master Karyawan (migration 0072). Pemisahan "orang" dari "akun login":
// employees menyimpan manusianya (milik Entity), employee_account_links
// menyimpan siapa memegang username apa dari kapan sampai kapan.
//
// Aturan wewenang di modul ini:
// - Gerai (Admin Gerai) boleh MELIHAT semua karyawan di bawah entity-nya --
//   itu yang bikin gerai lain bisa menautkan CS backup ke username-nya
//   sendiri tanpa harus mendaftarkan ulang orang yang sama.
// - Tapi gerai hanya boleh MENGUBAH/menonaktifkan karyawan yang gerainya
//   sendiri yang merekrut (home_store_id). Karyawan gerai tetangga atau
//   karyawan tingkat Entity (mis. OB kantor, home_store_id NULL) cuma bisa
//   diubah Entity Admin/Owner.
// - Menautkan/melepas username selalu dibatasi ke username milik gerai yang
//   sedang dibuka -- gerai tidak bisa mengutak-atik username gerai lain.

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

// Detail shift (gaji per jam, jam kerja, jenis pekerjaan) TIDAK lagi di sini.
// Koreksi Bos Cyo, 2026-09-18: "harus nya detil itu tadi kamu taruh di user
// kasir/staf. bukan malah di nama orangnya ... tombol karyawan itu yang aku
// maksudkan nama orang, sedangkan yang ada di master kasir itu adalah
// employed atau pekerjaannya." Modul ini (employees + employee_account_links)
// murni identitas orang + siapa memegang akun apa -- detail pekerjaan pindah
// ke src/cashier-auth.js (account_job_details, migration 0104), menempel ke
// AKUN, bukan ke tautan atau ke orangnya.
const ACCOUNT_SOURCES = {
  CASHIER: { table: 'cashiers', nameColumn: 'employee_name', scope: 'STORE' },
  STORE_ADMIN: { table: 'store_admins', nameColumn: 'display_name', scope: 'STORE' },
  ENTITY_ADMIN: { table: 'entity_admins', nameColumn: 'display_name', scope: 'ENTITY' }
};

function mapEmployee(row, storeId) {
  return {
    id: row.id,
    entityId: row.entity_id,
    fullName: row.full_name,
    phone: row.phone || '',
    address: row.address || '',
    idNumber: row.id_number || '',
    note: row.note || '',
    status: row.status,
    berhentiTanggal: row.berhenti_tanggal || null,
    berhentiAlasan: row.berhenti_alasan || '',
    homeStoreId: row.home_store_id || null,
    homeStoreCode: row.home_store_code || '',
    homeStoreName: row.home_store_name || '',
    // Penanda yang diminta Bos Cyo: dari gerai mana pun, kelihatan ini
    // karyawan rekrutan gerai siapa.
    ownedByThisStore: Boolean(row.home_store_id && row.home_store_id === storeId),
    entityLevel: !row.home_store_id,
    createdAt: row.created_at,
    birthYear: row.birth_year == null ? null : Number(row.birth_year),
    hasPhoto: Boolean(row.has_photo),
    photoUpdatedAt: row.photo_updated_at || null,
    // Domisili terbaru + riwayatnya (diisi loadEmployees dari employee_domicile_history).
    domicile: null,
    domicileHistory: [],
    links: []
  };
}

// Bos Cyo, 2026-10-16: tahun kelahiran, foto, dan alamat domisili "saat itu" (ada keterangan waktu
// entry). Domisili tidak ditimpa: tiap perubahan jadi baris baru di employee_domicile_history.
const MAX_EMPLOYEE_PHOTO_LENGTH = 400_000;

// undefined = tidak diubah; null = dikosongkan; NaN = tidak valid.
function parseBirthYear(value) {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;
  const year = Number(value);
  const now = new Date().getUTCFullYear();
  return Number.isInteger(year) && year >= 1930 && year <= now ? year : NaN;
}

// undefined = tidak diubah; '' = foto dihapus; null = tidak valid.
function parsePhoto(value) {
  if (value === undefined) return undefined;
  const dataUrl = String(value ?? '');
  if (!dataUrl) return '';
  if (dataUrl.length > MAX_EMPLOYEE_PHOTO_LENGTH) return null;
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl) ? dataUrl : null;
}

function validateProfile(value) {
  const birthYear = parseBirthYear(value?.birthYear);
  if (Number.isNaN(birthYear)) return { error: 'Tahun kelahiran tidak valid (contoh: 1999).' };
  const photo = parsePhoto(value?.photoDataUrl);
  if (photo === null) return { error: 'Foto tidak valid atau terlalu besar.' };
  const domicile = value?.domicileAddress === undefined ? undefined : text(value.domicileAddress, 300);
  return { birthYear, photo, domicile };
}

async function recordDomicile(db, employeeId, entityId, address, actor) {
  if (!address) return;
  const latest = await db.prepare(`
    SELECT address FROM employee_domicile_history WHERE employee_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1
  `).bind(employeeId).first();
  if (latest && latest.address === address) return;
  await db.prepare(`
    INSERT INTO employee_domicile_history (id, employee_id, entity_id, address, recorded_at, recorded_by_role, recorded_by_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(`empdom_${crypto.randomUUID()}`, employeeId, entityId, address, new Date().toISOString(), actor.role, actor.id).run();
}

function mapLink(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    accountType: row.account_type,
    accountId: row.account_id,
    username: row.username || '',
    accountName: row.account_name || '',
    storeId: row.store_id || null,
    storeCode: row.store_code || '',
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || null,
    endedReason: row.ended_reason || ''
  };
}

// Bos Cyo, 2026-09-18: "kalo ada 1 nama coba login 2 akun, ini berlaku di
// entity ya. misal ninda cs dermo usa login, kok ada lagi akun ca pendem
// dengan nama ninda login, maka ini harus di tolak." Satu KARYAWAN (bukan
// satu akun) tidak boleh aktif di lebih dari satu akun bersamaan, lintas
// gerai dalam entity yang sama -- entity-wide otomatis di sini karena
// employee_id sudah menjangkarkan seluruh tautan seorang karyawan ke SATU
// entity (dijaga trg_employee_link_scope_insert, migration 0072), bukan
// dibatasi ke satu gerai.
//
// Dipanggil dari src/unified-login.js SEBELUM sesi baru dibuat -- bukan
// dengan mencabut sesi yang sudah aktif. Bos Cyo eksplisit: "yang paling
// dipertahankan untuk tidak logout adalah akun yang lagi buka laci" --
// jadi sesi yang sudah berjalan (mungkin lacinya sedang terbuka) TIDAK
// PERNAH disentuh sama sekali; yang ditolak selalu percobaan login BARU.
//
// Cuma berlaku untuk akun yang benar-benar tertaut ke Master Karyawan
// (employee_account_links) -- akun yang masih pakai "Nama karyawan" bebas
// (belum ditautkan) tidak kena pagar ini, karena sistem tidak punya cara
// yang bisa dipercaya untuk tahu itu orang yang sama atau cuma kebetulan
// nama sama.
export async function findEmployeeSessionConflict(db, accountType, accountId, nowIso) {
  if (!ACCOUNT_SOURCES[accountType]) return null;
  const row = await db.prepare(`
    SELECT e.full_name AS employee_name,
           l2.account_type AS conflict_account_type,
           l2.account_id AS conflict_account_id,
           s.code AS conflict_store_code,
           s.store_name AS conflict_store_name
    FROM employee_account_links l1
    JOIN employees e ON e.id = l1.employee_id
    JOIN employee_account_links l2 ON l2.employee_id = l1.employee_id AND l2.id <> l1.id AND l2.effective_to IS NULL
    LEFT JOIN stores s ON s.id = l2.store_id
    WHERE l1.account_type = ? AND l1.account_id = ? AND l1.effective_to IS NULL
      AND (
        (l2.account_type = 'CASHIER' AND EXISTS (SELECT 1 FROM cashier_sessions x WHERE x.cashier_id = l2.account_id AND x.expires_at > ?))
        OR (l2.account_type = 'STORE_ADMIN' AND EXISTS (SELECT 1 FROM store_admin_sessions x WHERE x.admin_id = l2.account_id AND x.expires_at > ?))
        OR (l2.account_type = 'ENTITY_ADMIN' AND EXISTS (SELECT 1 FROM entity_admin_sessions x WHERE x.entity_admin_id = l2.account_id AND x.expires_at > ?))
      )
    LIMIT 1
  `).bind(accountType, accountId, nowIso, nowIso, nowIso).first();
  return row || null;
}

async function selectedAdminStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

async function loadLinks(db, entityId, { activeOnly = true } = {}) {
  const rows = await db.prepare(`
    SELECT l.id, l.employee_id, l.account_type, l.account_id, l.store_id,
           l.effective_from, l.effective_to, l.ended_reason,
           s.code AS store_code,
           COALESCE(c.username, a.username, ea.username) AS username,
           COALESCE(c.employee_name, a.display_name, ea.display_name) AS account_name
    FROM employee_account_links l
    LEFT JOIN stores s ON s.id = l.store_id
    LEFT JOIN cashiers c ON l.account_type = 'CASHIER' AND c.id = l.account_id
    LEFT JOIN store_admins a ON l.account_type = 'STORE_ADMIN' AND a.id = l.account_id
    LEFT JOIN entity_admins ea ON l.account_type = 'ENTITY_ADMIN' AND ea.id = l.account_id
    WHERE l.entity_id = ? ${activeOnly ? 'AND l.effective_to IS NULL' : ''}
    ORDER BY l.effective_from DESC, l.id
  `).bind(entityId).all();
  return (rows.results ?? []).map(mapLink);
}

// Username di gerai ini yang belum dipegang siapa pun -- ini yang muncul di
// dropdown "tautkan ke username". Username yang sudah punya pemegang aktif
// sengaja tidak ditawarkan; harus dilepas dulu dari pemegang lama.
async function loadLinkableAccounts(db, storeId) {
  const rows = await db.prepare(`
    SELECT 'CASHIER' AS account_type, c.id AS account_id, c.username, c.employee_name AS account_name
    FROM cashiers c
    WHERE c.store_id = ? AND c.is_active = 1
      AND NOT EXISTS (
        SELECT 1 FROM employee_account_links l
        WHERE l.account_type = 'CASHIER' AND l.account_id = c.id AND l.effective_to IS NULL
      )
    UNION ALL
    SELECT 'STORE_ADMIN', a.id, a.username, a.display_name
    FROM store_admins a
    WHERE a.store_id = ? AND a.is_active = 1
      AND NOT EXISTS (
        SELECT 1 FROM employee_account_links l
        WHERE l.account_type = 'STORE_ADMIN' AND l.account_id = a.id AND l.effective_to IS NULL
      )
    ORDER BY account_type, username
  `).bind(storeId, storeId).all();
  return (rows.results ?? []).map(row => ({
    accountType: row.account_type,
    accountId: row.account_id,
    username: row.username,
    accountName: row.account_name
  }));
}

async function loadEmployees(db, entityId, storeId, { includeHistory = false } = {}) {
  const rows = await db.prepare(`
    SELECT e.id, e.entity_id, e.home_store_id, e.full_name, e.phone, e.address, e.id_number, e.note,
           e.status, e.berhenti_tanggal, e.berhenti_alasan, e.created_at, e.birth_year, e.photo_updated_at,
           (e.photo_data IS NOT NULL AND e.photo_data != '') AS has_photo,
           s.code AS home_store_code, s.store_name AS home_store_name
    FROM employees e
    LEFT JOIN stores s ON s.id = e.home_store_id
    WHERE e.entity_id = ?
    ORDER BY e.status, e.full_name COLLATE NOCASE
  `).bind(entityId).all();
  const employees = (rows.results ?? []).map(row => mapEmployee(row, storeId));
  const links = await loadLinks(db, entityId, { activeOnly: !includeHistory });
  const byEmployee = new Map();
  for (const link of links) {
    if (!byEmployee.has(link.employeeId)) byEmployee.set(link.employeeId, []);
    byEmployee.get(link.employeeId).push(link);
  }
  for (const employee of employees) employee.links = byEmployee.get(employee.id) ?? [];
  const domiciles = await db.prepare(`
    SELECT id, employee_id, address, recorded_at FROM employee_domicile_history
    WHERE entity_id = ? ORDER BY recorded_at DESC, id DESC
  `).bind(entityId).all();
  const byId = new Map(employees.map(employee => [employee.id, employee]));
  for (const row of domiciles.results ?? []) {
    byId.get(row.employee_id)?.domicileHistory.push({ id: row.id, address: row.address, recordedAt: row.recorded_at });
  }
  for (const employee of employees) employee.domicile = employee.domicileHistory[0] ?? null;
  return employees;
}

function actorFrom(auth) {
  if (auth.owner) return { role: 'OWNER', id: auth.owner.id, entityWide: true };
  if (auth.entityAdmin) return { role: 'ENTITY_ADMIN', id: auth.entityAdmin.id, entityWide: true };
  if (auth.admin) return { role: 'ADMIN', id: auth.admin.id, entityWide: false };
  return { role: 'LEGACY_PIN', id: '', entityWide: true };
}

export async function resignEmployee(db, { employee, tanggal, alasan = '', actor = {}, now = new Date() }) {
  const links = (await db.prepare(`
    SELECT l.id, l.account_type, l.account_id, c.username
    FROM employee_account_links l LEFT JOIN cashiers c ON c.id = l.account_id AND l.account_type = 'CASHIER'
    WHERE l.employee_id = ? AND l.effective_to IS NULL
  `).bind(employee.id).all()).results ?? [];
  const cashierIds = links.filter(link => link.account_type === 'CASHIER').map(link => link.account_id);
  for (const id of cashierIds) {
    const open = await db.prepare(`SELECT 1 FROM cash_drawer_sessions WHERE cashier_id = ? AND status = 'OPEN' LIMIT 1`).bind(id).first();
    if (open) return { ok: false, code: 'DRAWER_STILL_OPEN', error: 'Akun kasir karyawan ini masih memegang laci yang terbuka. Tutup lacinya dulu, lalu catat resign.' };
  }
  const nowIso = now.toISOString();
  let reevaluated = 0;
  for (const id of cashierIds) {
    const result = await setBerhenti(db, { accountId: id, tanggal, actor: { role: actor.role, id: actor.id }, now });
    if (result.ok) reevaluated += Number(result.reevaluated || 0);
  }
  const statements = [];
  for (const id of cashierIds) {
    statements.push(
      db.prepare('UPDATE cashiers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id),
      db.prepare('DELETE FROM cashier_sessions WHERE cashier_id = ?').bind(id)
    );
  }
  statements.push(
    db.prepare('UPDATE employee_account_links SET effective_to = ? WHERE employee_id = ? AND effective_to IS NULL').bind(nowIso, employee.id),
    db.prepare(`UPDATE employees SET status = 'INACTIVE', berhenti_tanggal = ?, berhenti_alasan = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(tanggal, alasan, employee.id)
  );
  await db.batch(statements);
  return { ok: true, accountsDeactivated: links.filter(link => link.account_type === 'CASHIER').map(link => link.username || link.account_id), reevaluated };
}

function canManageEmployee(actor, store, employee) {
  if (actor.entityWide) return true;
  return employee.home_store_id === store.id;
}

export async function handleEmployeeMasterApi(request, env, pathname) {
  const isEmployeeRoute = pathname === '/api/admin/employees' || pathname.startsWith('/api/admin/employees/');
  const isLinkRoute = pathname.startsWith('/api/admin/employee-links/');
  if (!isEmployeeRoute && !isLinkRoute) return null;

  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const store = await selectedAdminStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  if (!store.entityId) return json({ error: 'Gerai ini belum terhubung ke Entity mana pun.', code: 'STORE_WITHOUT_ENTITY' }, 409);
  const actor = actorFrom(auth);

  if (request.method === 'GET' && pathname === '/api/admin/employees') {
    const includeHistory = new URL(request.url).searchParams.get('history') === '1';
    return json({
      store,
      employees: await loadEmployees(db, store.entityId, store.id, { includeHistory }),
      linkableAccounts: await loadLinkableAccounts(db, store.id),
      canCreateEntityLevel: actor.entityWide
    });
  }

  if (request.method === 'POST' && pathname === '/api/admin/employees') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload karyawan tidak valid.' }, 400);
    const fullName = text(body.value?.fullName, 100);
    if (!fullName) return json({ error: 'Nama karyawan wajib diisi.' }, 400);

    // Karyawan tingkat Entity (tidak menempel gerai mana pun, mis. OB kantor)
    // hanya boleh dibuat Entity Admin/Owner -- Admin Gerai selalu merekrut
    // atas nama gerainya sendiri.
    const wantsEntityLevel = body.value?.scope === 'ENTITY';
    if (wantsEntityLevel && !actor.entityWide) {
      return json({ error: 'Karyawan tingkat Entity hanya bisa dibuat Entity Admin atau Owner.', code: 'ENTITY_LEVEL_FORBIDDEN' }, 403);
    }
    const homeStoreId = wantsEntityLevel ? null : store.id;
    const profile = validateProfile(body.value);
    if (profile.error) return json({ error: profile.error }, 400);

    const id = `emp_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO employees (
        id, entity_id, home_store_id, full_name, phone, address, id_number, note,
        status, created_by_role, created_by_id, created_at, updated_at,
        birth_year, photo_data, photo_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?)
    `).bind(
      id, store.entityId, homeStoreId, fullName,
      text(body.value?.phone, 40), text(body.value?.address, 200),
      text(body.value?.idNumber, 40), text(body.value?.note, 500),
      actor.role, actor.id,
      profile.birthYear ?? null, profile.photo || null, profile.photo ? new Date().toISOString() : null
    ).run();
    await recordDomicile(db, id, store.entityId, profile.domicile, actor);
    return json({ ok: true, id }, 201);
  }

  const linkCreateMatch = pathname.match(/^\/api\/admin\/employees\/([^/]+)\/links$/);
  if (request.method === 'POST' && linkCreateMatch) {
    const employeeId = decodeURIComponent(linkCreateMatch[1]);
    const employee = await db.prepare('SELECT * FROM employees WHERE id = ? AND entity_id = ?').bind(employeeId, store.entityId).first();
    if (!employee) return json({ error: 'Karyawan tidak ditemukan di entity gerai ini.' }, 404);
    if (employee.status !== 'ACTIVE') return json({ error: 'Karyawan nonaktif tidak bisa ditautkan ke username.', code: 'EMPLOYEE_INACTIVE' }, 409);

    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tautan tidak valid.' }, 400);
    const accountType = text(body.value?.accountType, 20).toUpperCase();
    const accountId = text(body.value?.accountId, 180);
    const source = ACCOUNT_SOURCES[accountType];
    if (!source || !accountId) return json({ error: 'Jenis akun atau username tidak valid.' }, 400);
    if (source.scope === 'ENTITY' && !actor.entityWide) {
      return json({ error: 'Username Entity Admin hanya bisa ditautkan oleh Entity Admin atau Owner.', code: 'ENTITY_ACCOUNT_FORBIDDEN' }, 403);
    }

    const account = source.scope === 'STORE'
      ? await db.prepare(`SELECT id FROM ${source.table} WHERE id = ? AND store_id = ? AND is_active = 1`).bind(accountId, store.id).first()
      : await db.prepare(`SELECT id FROM ${source.table} WHERE id = ? AND entity_id = ? AND is_active = 1`).bind(accountId, store.entityId).first();
    if (!account) return json({ error: 'Username tidak ditemukan atau bukan milik gerai ini.', code: 'ACCOUNT_OUT_OF_SCOPE' }, 404);

    const held = await db.prepare(`
      SELECT l.id, e.full_name FROM employee_account_links l
      JOIN employees e ON e.id = l.employee_id
      WHERE l.account_type = ? AND l.account_id = ? AND l.effective_to IS NULL
    `).bind(accountType, accountId).first();
    if (held) {
      return json({
        error: `Username ini masih dipegang ${held.full_name}. Lepas dulu tautannya sebelum dipasang ke karyawan lain.`,
        code: 'ACCOUNT_ALREADY_HELD'
      }, 409);
    }

    const id = `emplink_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO employee_account_links (
        id, employee_id, entity_id, account_type, account_id, store_id,
        effective_from, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, employeeId, store.entityId, accountType, accountId,
      source.scope === 'ENTITY' ? null : store.id,
      new Date().toISOString(), new Date().toISOString()
    ).run();
    return json({ ok: true, id }, 201);
  }

  const linkCloseMatch = pathname.match(/^\/api\/admin\/employee-links\/([^/]+)$/);
  if (request.method === 'DELETE' && linkCloseMatch) {
    const linkId = decodeURIComponent(linkCloseMatch[1]);
    const link = await db.prepare('SELECT * FROM employee_account_links WHERE id = ? AND entity_id = ?').bind(linkId, store.entityId).first();
    if (!link) return json({ error: 'Tautan tidak ditemukan di entity gerai ini.' }, 404);
    if (link.effective_to) return json({ error: 'Tautan ini sudah dilepas sebelumnya.', code: 'LINK_ALREADY_CLOSED' }, 409);
    if (link.store_id && link.store_id !== store.id && !actor.entityWide) {
      return json({ error: 'Tautan username gerai lain hanya bisa dilepas dari gerai itu sendiri.', code: 'LINK_OUT_OF_SCOPE' }, 403);
    }

    const body = await readJson(request);
    const reason = body.ok ? text(body.value?.reason, 200) : '';
    // Tidak pernah kurang dari effective_from: kalau dilepas di milidetik yang
    // sama dengan saat ditautkan (salah pilih lalu langsung dibetulkan),
    // periodenya jadi nol -- itu sah, yang dilarang cuma mundur.
    const closedAt = new Date().toISOString();
    const result = await db.prepare(`
      UPDATE employee_account_links
      SET effective_to = MAX(?, effective_from), ended_reason = ?
      WHERE id = ? AND effective_to IS NULL
    `).bind(closedAt, reason, linkId).run();
    if (!result.success || Number(result.meta?.changes ?? 0) !== 1) {
      return json({ error: 'Tautan sudah berubah di request lain.' }, 409);
    }
    return json({ ok: true });
  }

  // Riwayat Gaji per nama orang -- Bos Cyo, 2026-09-24: "riwayat gaji itu
  // mending acuannya per nama orang aja ... kalo kita klik nama orang
  // tersebut dari list maka keluar kartu2 gajinya pertanggal, dan dari mana
  // gajinya tersebut dan masuk melalui apa." Lintas SEMUA akun/gerai yang
  // pernah dipegang orang ini -- lihat listLedgerForEmployee, src/payroll-ledger.js.
  const ledgerMatch = pathname.match(/^\/api\/admin\/employees\/([^/]+)\/payroll-ledger$/);
  if (request.method === 'GET' && ledgerMatch) {
    const id = decodeURIComponent(ledgerMatch[1]);
    const employee = await db.prepare('SELECT id, full_name FROM employees WHERE id = ? AND entity_id = ?').bind(id, store.entityId).first();
    if (!employee) return json({ error: 'Karyawan tidak ditemukan di entity gerai ini.' }, 404);
    const { entries } = await listLedgerForEmployee(db, id);
    // ADR-054: saldo Hutang Gaji = buku Akuntansi; jurnal akuntan pada Hutang Gaji atas nama orang
    // ini ikut tampil sebagai kartu "Penyesuaian dari Akuntansi".
    const buku = await riwayatDariBuku(db, {
      entityId: store.entityId,
      accountCode: AKUN_HUTANG_GAJI,
      holderIds: [id],
      operationalByStore: operasionalPerGerai(entries.map(entry => ({ storeId: entry.storeId, amountScaled: entry.hutangGajiDeltaScaled, aktif: !entry.voided }))),
      syncStoreIds: entries.map(entry => entry.storeId)
    });
    const penyesuaian = buku.penyesuaian.map(entry => ({
      id: `jurnal:${entry.journalId}`,
      entryType: 'AKUNTANSI',
      storeId: entry.storeId,
      storeCode: entry.storeCode,
      businessDate: entry.businessDate,
      hutangGajiDeltaRupiah: entry.amountRupiah,
      hutangGajiDeltaScaled: entry.amountScaled,
      sourceType: 'AKUNTANSI',
      journalNumber: entry.journalNumber,
      description: entry.description || 'Penyesuaian dari Akuntansi',
      createdAt: entry.createdAt,
      voided: false
    }));
    return json({
      employee: { id: employee.id, fullName: employee.full_name },
      entries: [...entries, ...penyesuaian].sort((a, b) => String(b.businessDate).localeCompare(String(a.businessDate))),
      hutangGajiBalanceRupiah: buku.balanceRupiah,
      belumMasukBukuRupiah: buku.belumMasukBukuRupiah
    });
  }

  // Foto dikirim sebagai JSON (bukan gambar langsung) karena Entity Admin memakai header Bearer,
  // yang tidak bisa dibawa tag <img>.
  const photoMatch = pathname.match(/^\/api\/admin\/employees\/([^/]+)\/photo$/);
  if (request.method === 'GET' && photoMatch) {
    const row = await db.prepare('SELECT photo_data, photo_updated_at FROM employees WHERE id = ? AND entity_id = ?')
      .bind(decodeURIComponent(photoMatch[1]), store.entityId).first();
    if (!row?.photo_data) return json({ error: 'Foto karyawan tidak ditemukan.' }, 404);
    return json({ photoDataUrl: row.photo_data, photoUpdatedAt: row.photo_updated_at });
  }

  // Resign per tanggal (Bos Cyo, 2026-10-22): satu tombol (atau alat Fina karyawan_resign) yang mengurus
  // semuanya -- tanpa harus melepas tautan satu per satu dulu: akun kasir yang tertaut dinonaktifkan &
  // di-logout, tautannya ditutup, Dana Apresiasi berhenti dinilai sejak tanggal itu (yang terlanjur
  // tercatat dibatalkan + jurnal dibalik), lalu karyawan NONAKTIF dengan tanggal & alasannya.
  const resignMatch = pathname.match(/^\/api\/admin\/employees\/([^/]+)\/resign$/);
  if (request.method === 'POST' && resignMatch) {
    const employee = await db.prepare('SELECT * FROM employees WHERE id = ? AND entity_id = ?').bind(decodeURIComponent(resignMatch[1]), store.entityId).first();
    if (!employee) return json({ error: 'Karyawan tidak ditemukan di entity gerai ini.' }, 404);
    if (!canManageEmployee(actor, store, employee)) {
      return json({ error: 'Karyawan ini direkrut gerai lain. Resign hanya bisa dicatat gerai perekrut atau Entity Admin.', code: 'EMPLOYEE_NOT_OWNED_BY_STORE' }, 403);
    }
    const body = await readJson(request);
    const tanggal = text(body.ok ? body.value?.tanggal : '', 10);
    const alasan = text(body.ok ? body.value?.alasan : '', 300);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return json({ error: 'Tanggal berhenti wajib diisi (YYYY-MM-DD).' }, 400);
    const result = await resignEmployee(db, { employee, tanggal, alasan, actor });
    return result.ok ? json(result) : json({ error: result.error, code: result.code }, 409);
  }

  const employeeMatch = pathname.match(/^\/api\/admin\/employees\/([^/]+)$/);
  if (!employeeMatch) return json({ error: 'Route master karyawan tidak ditemukan.' }, 404);
  const employeeId = decodeURIComponent(employeeMatch[1]);
  const current = await db.prepare('SELECT * FROM employees WHERE id = ? AND entity_id = ?').bind(employeeId, store.entityId).first();
  if (!current) return json({ error: 'Karyawan tidak ditemukan di entity gerai ini.' }, 404);

  if (request.method === 'PATCH') {
    if (!canManageEmployee(actor, store, current)) {
      return json({
        error: 'Karyawan ini direkrut gerai lain. Perubahan data hanya bisa dilakukan gerai perekrut atau Entity Admin.',
        code: 'EMPLOYEE_NOT_OWNED_BY_STORE'
      }, 403);
    }
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload karyawan tidak valid.' }, 400);
    const fullName = text(body.value?.fullName ?? current.full_name, 100);
    if (!fullName) return json({ error: 'Nama karyawan wajib diisi.' }, 400);
    const status = body.value?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const profile = validateProfile(body.value);
    if (profile.error) return json({ error: profile.error }, 400);
    if (status === 'INACTIVE') {
      const active = await db.prepare('SELECT COUNT(*) AS n FROM employee_account_links WHERE employee_id = ? AND effective_to IS NULL').bind(employeeId).first();
      if (Number(active?.n ?? 0) > 0) {
        return json({ error: 'Lepas dulu semua tautan username karyawan ini sebelum dinonaktifkan.', code: 'EMPLOYEE_STILL_LINKED' }, 409);
      }
    }
    await db.prepare(`
      UPDATE employees
      SET full_name = ?, phone = ?, address = ?, id_number = ?, note = ?, status = ?,
          birth_year = ?, photo_data = ?, photo_updated_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND entity_id = ?
    `).bind(
      fullName,
      text(body.value?.phone ?? current.phone, 40),
      text(body.value?.address ?? current.address, 200),
      text(body.value?.idNumber ?? current.id_number, 40),
      text(body.value?.note ?? current.note, 500),
      status,
      profile.birthYear === undefined ? current.birth_year ?? null : profile.birthYear,
      profile.photo === undefined ? current.photo_data ?? null : (profile.photo || null),
      profile.photo === undefined ? current.photo_updated_at ?? null : (profile.photo ? new Date().toISOString() : null),
      employeeId, store.entityId
    ).run();
    await recordDomicile(db, employeeId, store.entityId, profile.domicile, actor);
    return json({ ok: true });
  }

  if (request.method === 'DELETE') {
    if (!canManageEmployee(actor, store, current)) {
      return json({
        error: 'Karyawan ini direkrut gerai lain. Nonaktifkan hanya bisa dilakukan gerai perekrut atau Entity Admin.',
        code: 'EMPLOYEE_NOT_OWNED_BY_STORE'
      }, 403);
    }
    const active = await db.prepare('SELECT COUNT(*) AS n FROM employee_account_links WHERE employee_id = ? AND effective_to IS NULL').bind(employeeId).first();
    if (Number(active?.n ?? 0) > 0) {
      return json({ error: 'Lepas dulu semua tautan username karyawan ini sebelum dinonaktifkan.', code: 'EMPLOYEE_STILL_LINKED' }, 409);
    }
    await db.prepare(`UPDATE employees SET status = 'INACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND entity_id = ?`).bind(employeeId, store.entityId).run();
    return json({ ok: true });
  }

  return json({ error: 'Method tidak didukung.' }, 405);
}
