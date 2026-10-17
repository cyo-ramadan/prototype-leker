import { json, readJson } from './http.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { hashCredential, requireManagement } from './owner-auth.js';
import { requireCashier } from './cashier-auth.js';
import { getJakartaBusinessDate, jakartaWallClockToUtc } from './time.js';
import { QRIS_OTOMATIS_KEY, getTenantPolicySetting, resolveTenantId } from './tenant-policy.js';
import { emitNotification, listNotificationActors } from './management-notifications.js';
import { flushNotificationDeliveries } from './notification-delivery.js';

// QRIS Otomatis (Bos Cyo, 2026-10-16; migration 0164).
// Alur:
// 1. Pemilik memasang aplikasi merchant QRIS (GoBiz, bank, dll.) di SATU HP penerima miliknya --
//    CS tidak memegang aplikasi merchant. HP itu meneruskan notifikasi "uang masuk" ke
//    POST /api/qris/masuk memakai token penerima (MacroDroid gratis atau aplikasi penerus).
// 2. Leker mencatat uang masuk, menebak gerainya, lalu membunyikan notifikasi di kasir gerai itu.
// 3. Setiap penjualan QRIS harus menaut ke tepat satu uang masuk. Kalau nominal + waktunya cocok
//    tanpa keraguan, Leker menautkan sendiri; sisanya CS memilih dari daftar uang masuk.
//    CS tidak bisa membuat uang masuk -- hanya admin, dan wajib dengan catatan (mis. cek mutasi).
// Murni operasional: tidak menyentuh Accounting, stok, atau jurnal.

export const QRIS_JENDELA_OTOMATIS_MENIT = 30;
const JENDELA_MANUAL_JAM = 36;
const DUPLIKAT_DETIK = 10;
const MAX_NOMINAL = 100_000_000;

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const rows = async (stmt) => (await stmt.all()).results ?? [];
const rupiah = value => `Rp${Number(value || 0).toLocaleString('id-ID')}`;

// ---- Membaca notifikasi -------------------------------------------------------------------------

// Teks yang jelas BUKAN uang masuk ke merchant.
const BUKAN_UANG_MASUK = /(gagal|dibatalkan|refund|pengembalian dana|penarikan|tarik saldo|withdraw|pencairan|kedaluwarsa|expired)/i;
const TANDA_UANG_MASUK = /(terima|diterima|masuk|berhasil|sukses|received|lunas|qris|pembayaran)/i;

// "Rp15.000", "Rp 15.000,00", "IDR 15,000.00", "Rp15000" -> 15000. Ambil nominal pertama yang sah.
export function bacaNominal(value) {
  const source = String(value ?? '');
  const pattern = /(?:rp|idr)\s*\.?\s*(\d[\d.,\s]*)/gi;
  let match;
  while ((match = pattern.exec(source))) {
    let raw = match[1].replace(/\s+/g, '').replace(/[.,]+$/, '');
    raw = raw.replace(/[.,]\d{1,2}$/, '');
    const amount = Number(raw.replace(/\D/g, ''));
    if (Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_NOMINAL) return amount;
  }
  return null;
}

export function bacaNotifikasi({ title = '', text: body = '' } = {}) {
  const whole = `${title}\n${body}`;
  if (BUKAN_UANG_MASUK.test(whole)) return { ok: false, alasan: 'Bukan uang masuk (gagal/refund/penarikan).' };
  if (!TANDA_UANG_MASUK.test(whole)) return { ok: false, alasan: 'Teks tidak terlihat seperti uang masuk.' };
  const amount = bacaNominal(body) ?? bacaNominal(title);
  if (!amount) return { ok: false, alasan: 'Nominal Rp tidak ditemukan di teks notifikasi.' };
  return { ok: true, amount };
}

// ---- Siapa yang memanggil ---------------------------------------------------------------------

async function resolveActor(request, env) {
  const db = env.DB;
  const cashierAuth = await requireCashier(request, db);
  if (cashierAuth.ok && !cashierAuth.readOnly) {
    const cashier = cashierAuth.cashier;
    const store = await resolveStore(db, cashier.store.code, { includeInactive: true });
    if (!store?.entityId) return { error: json({ error: 'Gerai ini belum terhubung ke Entity.' }, 409) };
    return { role: 'CASHIER', id: cashier.id, name: cashier.employeeName || cashier.username || 'Kasir', store, canManage: false, entityWide: false };
  }
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return { error: auth.response };
  const store = await resolveStore(db, new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE, { includeInactive: true });
  if (!store) return { error: json({ error: 'Gerai tidak ditemukan.' }, 404) };
  if (!store.entityId) return { error: json({ error: 'Gerai ini belum terhubung ke Entity.' }, 409) };
  if (auth.authType === 'AGENT_TOKEN') return { role: 'AGENT', id: '', name: 'Agen', store, canManage: false, entityWide: false, readOnly: true };
  if (auth.owner) return { role: 'OWNER', id: auth.owner.id, name: auth.owner.displayName || 'Owner', store, canManage: true, entityWide: true };
  if (auth.entityAdmin) return { role: 'ENTITY_ADMIN', id: auth.entityAdmin.id, name: auth.entityAdmin.displayName || 'Entity Admin', store, canManage: true, entityWide: true };
  if (auth.admin) return { role: 'ADMIN', id: auth.admin.id, name: auth.admin.displayName || 'Admin Gerai', store, canManage: true, entityWide: false };
  return { error: json({ error: 'Login diperlukan.' }, 401) };
}

const forbidden = message => json({ error: message, code: 'QRIS_FORBIDDEN' }, 403);

async function qrisEnabled(db, entityId) {
  return getTenantPolicySetting(db, await resolveTenantId(db, entityId), QRIS_OTOMATIS_KEY);
}

// ---- Setelan gerai ----------------------------------------------------------------------------

async function paymentMethods(db, storeId) {
  return (await rows(db.prepare(`SELECT code, name FROM payment_methods WHERE store_id = ? AND is_active = 1 ORDER BY name COLLATE NOCASE`).bind(storeId)))
    .map(row => ({ code: row.code, name: row.name }));
}

// Cara bayar yang dihitung QRIS: pilihan admin; kalau belum dipilih, cara bayar yang kode/namanya
// memuat "QRIS". Tidak ada keduanya = gerai belum bisa dicek (UI meminta admin memilih).
export async function qrisMethodFor(db, storeId) {
  const setelan = await db.prepare(`SELECT payment_method_code, kata_kunci FROM qris_gerai_setelan WHERE store_id = ?`).bind(storeId).first();
  if (setelan?.payment_method_code) return { code: setelan.payment_method_code, chosen: true, kataKunci: setelan.kata_kunci || '' };
  const guess = await db.prepare(`
    SELECT code FROM payment_methods
    WHERE store_id = ? AND is_active = 1 AND (UPPER(code) LIKE '%QRIS%' OR UPPER(name) LIKE '%QRIS%')
    ORDER BY code LIMIT 1
  `).bind(storeId).first();
  return { code: guess?.code || '', chosen: false, kataKunci: setelan?.kata_kunci || '' };
}

// ---- Penautan -----------------------------------------------------------------------------------

const minutesBetween = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000;

async function unlinkedSales(db, storeId, methodCode, fromIso, toIso) {
  if (!methodCode) return [];
  return rows(db.prepare(`
    SELECT s.id, s.total_amount, s.created_at
    FROM sales s
    WHERE s.store_id = ? AND s.payment_method = ? AND s.voided_at IS NULL
      AND s.created_at >= ? AND s.created_at < ?
      AND NOT EXISTS (SELECT 1 FROM qris_masuk q WHERE q.sale_id = s.id)
  `).bind(storeId, methodCode, fromIso, toIso));
}

// Tautkan sendiri hanya bila tidak ada keraguan: uang masuk itu punya tepat satu penjualan QRIS
// dengan nominal sama dalam ±30 menit, dan penjualan itu juga hanya punya uang masuk tersebut.
// Dua pembeli Rp15.000 berdekatan = ragu -> dibiarkan untuk dipilih CS.
export async function tautkanOtomatis(db, storeId, { around = new Date() } = {}) {
  const method = await qrisMethodFor(db, storeId);
  if (!method.code) return 0;
  const from = new Date(new Date(around).getTime() - 36 * 3600_000).toISOString();
  const to = new Date(new Date(around).getTime() + 3600_000).toISOString();
  const masuk = await rows(db.prepare(`
    SELECT id, amount, received_at FROM qris_masuk
    WHERE store_id = ? AND status = 'BELUM' AND received_at >= ? AND received_at < ?
  `).bind(storeId, from, to));
  if (!masuk.length) return 0;
  const sales = await unlinkedSales(db, storeId, method.code, from, to);
  const near = (m, s) => Number(s.total_amount) === Number(m.amount) && minutesBetween(m.received_at, s.created_at) <= QRIS_JENDELA_OTOMATIS_MENIT;
  let linked = 0;
  const now = new Date().toISOString();
  for (const m of masuk) {
    const forMasuk = sales.filter(s => !s.used && near(m, s));
    if (forMasuk.length !== 1) continue;
    const sale = forMasuk[0];
    const rivals = masuk.filter(other => !other.used && near(other, sale));
    if (rivals.length !== 1) continue;
    const result = await db.prepare(`
      UPDATE qris_masuk SET status = 'TERTAUT', sale_id = ?, link_mode = 'OTOMATIS', linked_at = ?, linked_by_role = 'SYSTEM', linked_by_name = 'Otomatis'
      WHERE id = ? AND status = 'BELUM' AND NOT EXISTS (SELECT 1 FROM qris_masuk q2 WHERE q2.sale_id = ?)
    `).bind(sale.id, now, m.id, sale.id).run().catch(() => ({ meta: { changes: 0 } }));
    if (result.meta?.changes) { sale.used = true; m.used = true; linked += 1; }
  }
  return linked;
}

async function tautkan(db, actor, value) {
  if (actor.readOnly) return forbidden('Akses ini hanya untuk membaca.');
  const masukId = text(value?.masukId, 80);
  const saleId = text(value?.saleId, 120);
  const catatan = text(value?.catatan, 300);
  const masuk = await db.prepare(`SELECT * FROM qris_masuk WHERE id = ? AND entity_id = ?`).bind(masukId, actor.store.entityId).first();
  if (!masuk || masuk.store_id !== actor.store.id) return json({ error: 'Uang masuk tidak ditemukan di gerai ini.' }, 404);
  if (masuk.status !== 'BELUM') return json({ error: masuk.status === 'TERTAUT' ? 'Uang masuk ini sudah tertaut ke penjualan lain.' : 'Uang masuk ini sudah diabaikan admin.', code: 'QRIS_SUDAH_DIPAKAI' }, 409);
  const method = await qrisMethodFor(db, actor.store.id);
  const sale = await db.prepare(`SELECT id, store_id, total_amount, created_at, payment_method, voided_at FROM sales WHERE id = ?`).bind(saleId).first();
  if (!sale || sale.store_id !== actor.store.id) return json({ error: 'Penjualan tidak ditemukan di gerai ini.' }, 404);
  if (sale.voided_at) return json({ error: 'Penjualan ini sudah dibatalkan.' }, 409);
  if (!method.code || sale.payment_method !== method.code) return json({ error: 'Penjualan ini bukan pembayaran QRIS.' }, 409);
  if (await db.prepare(`SELECT 1 FROM qris_masuk WHERE sale_id = ?`).bind(sale.id).first()) return json({ error: 'Penjualan ini sudah tertaut.', code: 'QRIS_SUDAH_DIPAKAI' }, 409);
  const sameAmount = Number(sale.total_amount) === Number(masuk.amount);
  if (!sameAmount) {
    if (!actor.canManage) return json({ error: `Nominal tidak sama (penjualan ${rupiah(sale.total_amount)}, uang masuk ${rupiah(masuk.amount)}). Minta admin yang menautkan.`, code: 'QRIS_NOMINAL_BEDA' }, 409);
    if (!catatan) return json({ error: 'Nominal berbeda: tulis catatan alasannya.', code: 'QRIS_CATATAN_WAJIB' }, 400);
  }
  if (minutesBetween(sale.created_at, masuk.received_at) > JENDELA_MANUAL_JAM * 60) return json({ error: 'Jarak waktu penjualan dan uang masuk terlalu jauh (lebih dari 36 jam).' }, 409);
  const now = new Date().toISOString();
  const result = await db.prepare(`
    UPDATE qris_masuk SET status = 'TERTAUT', sale_id = ?, link_mode = ?, linked_at = ?, linked_by_role = ?, linked_by_name = ?,
      note = CASE WHEN ? = '' THEN note ELSE ? END
    WHERE id = ? AND status = 'BELUM'
  `).bind(sale.id, actor.canManage ? 'ADMIN' : 'CS', now, actor.role, actor.name, catatan, catatan, masuk.id).run()
    .catch(() => ({ meta: { changes: 0 } }));
  if (!result.meta?.changes) return json({ error: 'Gagal menautkan: data sudah berubah, muat ulang.', code: 'QRIS_SUDAH_DIPAKAI' }, 409);
  return json({ ok: true });
}

async function adminUbah(db, actor, value, aksi) {
  if (!actor.canManage) return forbidden('Hanya admin yang bisa melakukan ini.');
  const masuk = await db.prepare(`SELECT * FROM qris_masuk WHERE id = ? AND entity_id = ?`).bind(text(value?.masukId, 80), actor.store.entityId).first();
  if (!masuk) return json({ error: 'Uang masuk tidak ditemukan.' }, 404);
  if (!actor.entityWide && masuk.store_id !== actor.store.id) return forbidden('Uang masuk ini milik gerai lain.');
  const catatan = text(value?.catatan, 300);
  if (!catatan) return json({ error: 'Tulis catatan alasannya.', code: 'QRIS_CATATAN_WAJIB' }, 400);
  const now = new Date().toISOString();
  const by = `${actor.name} (${now.slice(0, 16).replace('T', ' ')} UTC)`;
  if (aksi === 'lepas') {
    if (masuk.status !== 'TERTAUT') return json({ error: 'Uang masuk ini belum tertaut.' }, 409);
    await db.prepare(`UPDATE qris_masuk SET status = 'BELUM', sale_id = NULL, link_mode = NULL, linked_at = NULL, linked_by_role = '', linked_by_name = '', note = ? WHERE id = ?`)
      .bind(`Dilepas ${by}: ${catatan}`, masuk.id).run();
  } else if (aksi === 'abaikan') {
    if (masuk.status !== 'BELUM') return json({ error: 'Hanya uang masuk yang belum tertaut yang bisa diabaikan.' }, 409);
    await db.prepare(`UPDATE qris_masuk SET status = 'DIABAIKAN', linked_at = ?, linked_by_role = ?, linked_by_name = ?, note = ? WHERE id = ?`)
      .bind(now, actor.role, actor.name, catatan, masuk.id).run();
  } else if (aksi === 'pulihkan') {
    if (masuk.status !== 'DIABAIKAN') return json({ error: 'Uang masuk ini tidak sedang diabaikan.' }, 409);
    await db.prepare(`UPDATE qris_masuk SET status = 'BELUM', linked_at = NULL, linked_by_role = '', linked_by_name = '', note = ? WHERE id = ?`)
      .bind(`Dipulihkan ${by}: ${catatan}`, masuk.id).run();
  } else if (aksi === 'pindah-gerai') {
    if (!actor.entityWide) return forbidden('Memindah gerai hanya untuk Entity Admin/Owner.');
    if (masuk.status === 'TERTAUT') return json({ error: 'Lepas tautannya dulu sebelum memindah gerai.' }, 409);
    const target = await resolveStore(db, text(value?.storeCode, 40), { includeInactive: true });
    if (!target || target.entityId !== actor.store.entityId) return json({ error: 'Gerai tujuan tidak ditemukan di entity ini.' }, 404);
    await db.prepare(`UPDATE qris_masuk SET store_id = ?, note = ? WHERE id = ?`).bind(target.id, `Dipindah ke ${target.code} oleh ${by}: ${catatan}`, masuk.id).run();
    await tautkanOtomatis(db, target.id, { around: masuk.received_at });
  }
  return json({ ok: true });
}

// Admin menambah uang masuk sendiri (HP penerima mati / notif terlewat) -- wajib catatan, mis.
// "dicek di mutasi BRI 14:05". CS tidak bisa: inilah yang mencegah orderan QRIS karangan.
async function tambahManual(db, actor, value) {
  if (!actor.canManage) return forbidden('Hanya admin yang bisa menambah uang masuk manual.');
  const amount = Number(value?.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_NOMINAL) return json({ error: 'Nominal tidak valid.' }, 400);
  const catatan = text(value?.catatan, 300);
  if (!catatan) return json({ error: 'Tulis catatan sumbernya (mis. dicek di mutasi rekening).', code: 'QRIS_CATATAN_WAJIB' }, 400);
  const waktu = value?.waktu ? new Date(value.waktu) : new Date();
  if (Number.isNaN(waktu.getTime())) return json({ error: 'Waktu tidak valid.' }, 400);
  const now = new Date().toISOString();
  const id = `qrism_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO qris_masuk (id, entity_id, store_id, amount, source, raw_text, received_at, business_date, note, created_by_role, created_by_name, created_at)
    VALUES (?, ?, ?, ?, 'MANUAL', '', ?, ?, ?, ?, ?, ?)
  `).bind(id, actor.store.entityId, actor.store.id, amount, waktu.toISOString(), getJakartaBusinessDate(waktu), catatan, actor.role, actor.name, now).run();
  await tautkanOtomatis(db, actor.store.id, { around: waktu });
  return json({ ok: true, id }, 201);
}

// ---- Daftar & ringkasan -----------------------------------------------------------------------

function dayRange(tanggal) {
  const start = jakartaWallClockToUtc(tanggal, '00:00');
  return { from: start.toISOString(), to: new Date(start.getTime() + 24 * 3600_000).toISOString() };
}

function mapMasuk(row) {
  return {
    id: row.id, storeId: row.store_id || null, amount: Number(row.amount), source: row.source, app: row.app,
    title: row.raw_title, text: row.raw_text, receivedAt: row.received_at, status: row.status, saleId: row.sale_id || null,
    linkMode: row.link_mode || null, linkedByName: row.linked_by_name, note: row.note, createdByName: row.created_by_name,
    saleVoided: Boolean(row.sale_voided_at)
  };
}

async function daftar(db, actor, tanggal) {
  const method = await qrisMethodFor(db, actor.store.id);
  await tautkanOtomatis(db, actor.store.id, { around: tanggal === getJakartaBusinessDate() ? new Date() : jakartaWallClockToUtc(tanggal, '12:00') });
  const { from, to } = dayRange(tanggal);
  const masuk = (await rows(db.prepare(`
    SELECT q.*, s.voided_at AS sale_voided_at FROM qris_masuk q LEFT JOIN sales s ON s.id = q.sale_id
    WHERE q.store_id = ? AND q.business_date = ? ORDER BY q.received_at DESC
  `).bind(actor.store.id, tanggal))).map(mapMasuk);
  const sales = method.code ? (await rows(db.prepare(`
    SELECT s.id, s.total_amount, s.created_at, s.customer_name, s.voided_at, c.employee_name AS cashier_name, q.id AS masuk_id, q.link_mode
    FROM sales s LEFT JOIN cashiers c ON c.id = s.cashier_id LEFT JOIN qris_masuk q ON q.sale_id = s.id
    WHERE s.store_id = ? AND s.payment_method = ? AND s.created_at >= ? AND s.created_at < ?
    ORDER BY s.created_at DESC
  `).bind(actor.store.id, method.code, from, to))).map(row => ({
    id: row.id, amount: Number(row.total_amount), createdAt: row.created_at, customerName: row.customer_name,
    cashierName: row.cashier_name || '', voided: Boolean(row.voided_at), masukId: row.masuk_id || null, linkMode: row.link_mode || null
  })) : [];
  // Uang masuk dari kemarin yang belum tertaut tetap bisa dipilih untuk penjualan hari ini (lewat tengah malam).
  const pilihan = (await rows(db.prepare(`
    SELECT q.*, NULL AS sale_voided_at FROM qris_masuk q
    WHERE q.store_id = ? AND q.status = 'BELUM' AND q.received_at >= ? AND q.received_at < ?
    ORDER BY q.received_at DESC
  `).bind(actor.store.id, new Date(new Date(from).getTime() - 12 * 3600_000).toISOString(), new Date(new Date(to).getTime() + 12 * 3600_000).toISOString()))).map(mapMasuk);
  const tanpaGerai = actor.entityWide ? (await rows(db.prepare(`
    SELECT q.*, NULL AS sale_voided_at FROM qris_masuk q
    WHERE q.entity_id = ? AND q.store_id IS NULL AND q.status = 'BELUM' ORDER BY q.received_at DESC LIMIT 50
  `).bind(actor.store.entityId))).map(mapMasuk) : [];
  const live = sales.filter(sale => !sale.voided);
  return {
    enabled: true,
    tanggal,
    store: { code: actor.store.code, name: actor.store.storeName },
    role: actor.role,
    canManage: actor.canManage,
    entityWide: actor.entityWide,
    metode: { code: method.code, chosen: method.chosen },
    masuk,
    pilihan,
    sales,
    tanpaGerai,
    ringkas: {
      penjualanBelum: live.filter(sale => !sale.masukId).length,
      penjualanTertaut: live.filter(sale => sale.masukId).length,
      masukBelum: masuk.filter(item => item.status === 'BELUM').length,
      totalMasuk: masuk.filter(item => item.status !== 'DIABAIKAN').reduce((sum, item) => sum + item.amount, 0),
      totalPenjualan: live.reduce((sum, sale) => sum + sale.amount, 0)
    }
  };
}

async function hitungGerai(db, store, tanggal) {
  const method = await qrisMethodFor(db, store.id);
  const { from, to } = dayRange(tanggal);
  const penjualanBelum = method.code ? Number((await db.prepare(`
    SELECT COUNT(*) AS n FROM sales s WHERE s.store_id = ? AND s.payment_method = ? AND s.voided_at IS NULL
      AND s.created_at >= ? AND s.created_at < ? AND NOT EXISTS (SELECT 1 FROM qris_masuk q WHERE q.sale_id = s.id)
  `).bind(store.id, method.code, from, to).first())?.n || 0) : 0;
  const masukBelum = Number((await db.prepare(`SELECT COUNT(*) AS n FROM qris_masuk WHERE store_id = ? AND business_date = ? AND status = 'BELUM'`).bind(store.id, tanggal).first())?.n || 0);
  return { storeCode: store.code, penjualanBelum, masukBelum, siap: Boolean(method.code) };
}

async function ringkasan(db, actor) {
  const tanggal = getJakartaBusinessDate();
  const stores = actor.entityWide
    ? await rows(db.prepare(`SELECT id, code FROM stores WHERE entity_id = ? AND is_active = 1 ORDER BY code`).bind(actor.store.entityId))
    : [{ id: actor.store.id, code: actor.store.code }];
  const result = [];
  for (const store of stores) {
    await tautkanOtomatis(db, store.id);
    result.push(await hitungGerai(db, store, tanggal));
  }
  const tanpaGerai = actor.entityWide ? Number((await db.prepare(`SELECT COUNT(*) AS n FROM qris_masuk WHERE entity_id = ? AND store_id IS NULL AND status = 'BELUM'`).bind(actor.store.entityId).first())?.n || 0) : 0;
  return { enabled: true, tanggal, stores: result, tanpaGerai };
}

// ---- Setelan & HP penerima --------------------------------------------------------------------

function ingestUrl(request) {
  return `${new URL(request.url).origin}/api/qris/masuk`;
}

async function setelan(db, actor, request) {
  const method = await qrisMethodFor(db, actor.store.id);
  const penerima = await rows(db.prepare(`
    SELECT p.id, p.label, p.store_id, s.code AS store_code, p.is_active, p.last_seen_at, p.last_result, p.created_by_name, p.created_at
    FROM qris_penerima p LEFT JOIN stores s ON s.id = p.store_id
    WHERE p.entity_id = ? AND p.is_active = 1 AND (p.store_id IS NULL OR p.store_id = ?)
    ORDER BY p.created_at DESC
  `).bind(actor.store.entityId, actor.store.id));
  return {
    store: { code: actor.store.code, name: actor.store.storeName },
    entityWide: actor.entityWide,
    metode: { code: method.code, chosen: method.chosen },
    kataKunci: method.kataKunci,
    paymentMethods: await paymentMethods(db, actor.store.id),
    penerima: penerima.map(row => ({
      id: row.id, label: row.label, semuaGerai: !row.store_id, storeCode: row.store_code || null,
      lastSeenAt: row.last_seen_at || null, lastResult: row.last_result, createdByName: row.created_by_name, createdAt: row.created_at,
      bisaCabut: actor.entityWide || row.store_id === actor.store.id
    })),
    ingestUrl: ingestUrl(request)
  };
}

async function simpanSetelan(db, actor, value) {
  if (!actor.canManage) return forbidden('Hanya admin yang bisa mengubah setelan QRIS.');
  const code = text(value?.paymentMethodCode, 32).toUpperCase();
  if (code && !(await db.prepare(`SELECT 1 FROM payment_methods WHERE store_id = ? AND code = ? AND is_active = 1`).bind(actor.store.id, code).first())) {
    return json({ error: 'Cara bayar tidak ditemukan di gerai ini.' }, 400);
  }
  const kataKunci = text(value?.kataKunci, 80);
  await db.prepare(`
    INSERT INTO qris_gerai_setelan (store_id, entity_id, payment_method_code, kata_kunci, updated_by_name, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(store_id) DO UPDATE SET payment_method_code = excluded.payment_method_code, kata_kunci = excluded.kata_kunci,
      updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at
  `).bind(actor.store.id, actor.store.entityId, code, kataKunci, actor.name, new Date().toISOString()).run();
  return json({ ok: true });
}

async function buatPenerima(db, actor, value, request) {
  if (!actor.canManage) return forbidden('Hanya admin yang bisa membuat HP penerima.');
  const semuaGerai = value?.semuaGerai === true;
  if (semuaGerai && !actor.entityWide) return forbidden('Penerima untuk semua gerai hanya bisa dibuat Entity Admin/Owner.');
  const label = text(value?.label, 80) || 'HP penerima QRIS';
  const token = `qr_${[...crypto.getRandomValues(new Uint8Array(24))].map(n => n.toString(16).padStart(2, '0')).join('')}`;
  const id = `qrisp_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO qris_penerima (id, entity_id, store_id, label, token_hash, created_by_role, created_by_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, actor.store.entityId, semuaGerai ? null : actor.store.id, label, await hashCredential(token), actor.role, actor.name, new Date().toISOString()).run();
  return json({ ok: true, id, token, ingestUrl: `${ingestUrl(request)}?token=${token}` }, 201);
}

async function cabutPenerima(db, actor, value) {
  if (!actor.canManage) return forbidden('Hanya admin yang bisa mencabut HP penerima.');
  const row = await db.prepare(`SELECT id, store_id FROM qris_penerima WHERE id = ? AND entity_id = ? AND is_active = 1`).bind(text(value?.id, 80), actor.store.entityId).first();
  if (!row) return json({ error: 'HP penerima tidak ditemukan.' }, 404);
  if (!actor.entityWide && row.store_id !== actor.store.id) return forbidden('HP penerima ini dikelola Entity Admin.');
  await db.prepare(`UPDATE qris_penerima SET is_active = 0, revoked_at = ? WHERE id = ?`).bind(new Date().toISOString(), row.id).run();
  return json({ ok: true });
}

// ---- Pintu masuk notifikasi dari HP penerima --------------------------------------------------

async function readIngestBody(request) {
  const type = (request.headers.get('content-type') || '').toLowerCase();
  const raw = (await request.text()).slice(0, 8000);
  // Teks notifikasi berisi tanda kutip bisa merusak JSON buatan aplikasi penerus -> pakai sebagai teks.
  if (type.includes('application/json')) { try { return JSON.parse(raw) || {}; } catch { return { text: raw }; } }
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try { const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object') return parsed; } catch {}
  return { text: raw };
}

async function tebakGerai(db, penerima, whole) {
  if (penerima.store_id) return penerima.store_id;
  const upper = whole.toUpperCase();
  const candidates = (await rows(db.prepare(`
    SELECT g.store_id, g.kata_kunci FROM qris_gerai_setelan g JOIN stores s ON s.id = g.store_id
    WHERE g.entity_id = ? AND s.is_active = 1 AND g.kata_kunci != ''
  `).bind(penerima.entity_id))).filter(row => upper.includes(String(row.kata_kunci).toUpperCase()));
  // Kata kunci terpanjang menang ("LEKER BEJI 2" mengalahkan "LEKER BEJI"); seri = tidak ditebak.
  candidates.sort((a, b) => b.kata_kunci.length - a.kata_kunci.length);
  if (!candidates.length) return null;
  if (candidates.length > 1 && candidates[0].kata_kunci.length === candidates[1].kata_kunci.length) return null;
  return candidates[0].store_id;
}

async function kabariKasir(env, masuk, store, linked) {
  try {
    const actors = await listNotificationActors(env, store ? { storeId: store.id } : { entityId: masuk.entity_id });
    const recipients = store ? actors.filter(a => a.role === 'CASHIER' && a.storeId === store.id) : actors.filter(a => a.role === 'ENTITY_ADMIN' && a.entityId === masuk.entity_id);
    const jam = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(masuk.received_at));
    for (const recipient of recipients) {
      await emitNotification(env, {
        recipientKey: recipient.key,
        entityId: masuk.entity_id,
        storeId: store?.id ?? null,
        dedupKey: `qris-masuk:${masuk.id}`,
        title: `💰 QRIS masuk ${rupiah(masuk.amount)}`,
        body: store
          ? `${store.store_name || store.code} · ${jam} WIB. ${linked ? 'Sudah otomatis tertaut ke penjualan.' : 'Tautkan di 📚 Detail Laci → Buka Cek QRIS.'}`
          : `${jam} WIB. Gerainya belum dikenali -- pilih gerainya di menu QRIS.`,
        url: store ? '/staff' : '/entity-admin',
        kind: 'QRIS_MASUK'
      });
    }
    if (recipients.length) await flushNotificationDeliveries(env);
  } catch (error) {
    console.error('QRIS: notifikasi kasir gagal', { name: error?.name });
  }
}

async function terimaNotifikasi(request, env) {
  const db = env.DB;
  if (request.method !== 'POST') return json({ error: 'Gunakan POST.' }, 405);
  const url = new URL(request.url);
  const body = await readIngestBody(request);
  if (!body) return json({ error: 'Isi permintaan tidak sah.' }, 400);
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const token = text(bearer || url.searchParams.get('token') || body.token, 100);
  if (!/^qr_[a-f0-9]{48}$/.test(token)) return json({ error: 'Token penerima tidak sah.' }, 401);
  const penerima = await db.prepare(`SELECT * FROM qris_penerima WHERE token_hash = ? AND is_active = 1`).bind(await hashCredential(token)).first();
  if (!penerima) return json({ error: 'Token penerima tidak dikenal atau sudah dicabut.' }, 401);
  const now = new Date();
  const catat = result => db.prepare(`UPDATE qris_penerima SET last_seen_at = ?, last_result = ? WHERE id = ?`).bind(now.toISOString(), text(result, 200), penerima.id).run();
  if (!await qrisEnabled(db, penerima.entity_id)) { await catat('Ditolak: QRIS Otomatis dimatikan untuk usaha ini.'); return json({ error: 'QRIS Otomatis tidak diaktifkan untuk usaha ini.', code: 'QRIS_DISABLED' }, 403); }

  const title = text(body.title, 200);
  const notifText = text(body.text ?? body.message ?? body.body, 1000);
  const app = text(body.app ?? body.package, 120);
  if (body.test === true || body.test === 'true' || /^tes(t)?$/i.test(notifText)) { await catat('Tes sambungan berhasil.'); return json({ ok: true, test: true }); }
  let amount = Number(body.amount);
  if (!(Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_NOMINAL)) {
    const parsed = bacaNotifikasi({ title, text: notifText });
    if (!parsed.ok) { await catat(`Diabaikan: ${parsed.alasan} "${notifText.slice(0, 80)}"`); return json({ ok: true, ignored: true, reason: parsed.alasan }); }
    amount = parsed.amount;
  }
  // Uang masuk dobel berbahaya: bisa dipakai menautkan orderan QRIS karangan. Pengenal terbaik =
  // nomor transaksi (ref); kalau tidak ada, waktu terbit notifikasi dari HP (postedAt) + teksnya.
  const postedAt = text(body.postedAt ?? body.posted_at ?? body.time, 40);
  let ref = text(body.ref ?? body.id, 120) || null;
  if (!ref && postedAt) ref = `notif:${(await hashCredential(`${penerima.id}|${postedAt}|${title}|${notifText}`)).slice(0, 40)}`;
  if (ref && await db.prepare(`SELECT 1 FROM qris_masuk WHERE entity_id = ? AND ref = ?`).bind(penerima.entity_id, ref).first()) {
    return json({ ok: true, duplicate: true });
  }
  // Tanpa keduanya: notifikasi berteks sama dalam beberapa detik dianggap kiriman ulang aplikasi
  // penerus. Pembayaran asli yang kebetulan kembar tetap bisa ditambah admin dari mutasi.
  const since = new Date(now.getTime() - DUPLIKAT_DETIK * 1000).toISOString();
  if (!ref && await db.prepare(`SELECT 1 FROM qris_masuk WHERE penerima_id = ? AND raw_title = ? AND raw_text = ? AND amount = ? AND received_at >= ?`).bind(penerima.id, title, notifText, amount, since).first()) {
    return json({ ok: true, duplicate: true });
  }
  const storeId = await tebakGerai(db, penerima, `${title}\n${notifText}`);
  const masuk = {
    id: `qrism_${crypto.randomUUID()}`, entity_id: penerima.entity_id, store_id: storeId, amount, received_at: now.toISOString()
  };
  await db.prepare(`
    INSERT INTO qris_masuk (id, entity_id, store_id, penerima_id, amount, source, app, raw_title, raw_text, ref, received_at, business_date, created_by_role, created_by_name, created_at)
    VALUES (?, ?, ?, ?, ?, 'NOTIF_HP', ?, ?, ?, ?, ?, ?, 'PENERIMA', ?, ?)
  `).bind(masuk.id, masuk.entity_id, storeId, penerima.id, amount, app, title, notifText, ref, masuk.received_at, getJakartaBusinessDate(now), penerima.label, masuk.received_at).run();
  const store = storeId ? await db.prepare(`SELECT id, code, store_name FROM stores WHERE id = ?`).bind(storeId).first() : null;
  const linked = storeId ? await tautkanOtomatis(db, storeId, { around: now }) : 0;
  const linkedThis = linked ? Boolean(await db.prepare(`SELECT 1 FROM qris_masuk WHERE id = ? AND status = 'TERTAUT'`).bind(masuk.id).first()) : false;
  await catat(`Uang masuk ${rupiah(amount)}${store ? ` -> ${store.code}` : ' (gerai belum dikenali)'}`);
  await kabariKasir(env, masuk, store, linkedThis);
  return json({ ok: true, id: masuk.id, amount, storeCode: store?.code || null, tertaut: linkedThis }, 201);
}

// ---- Router -------------------------------------------------------------------------------------

export async function handleQrisApi(request, env, pathname) {
  if (pathname !== '/api/qris' && !pathname.startsWith('/api/qris/')) return null;
  if (pathname === '/api/qris/masuk') return terimaNotifikasi(request, env);

  const actor = await resolveActor(request, env);
  if (actor.error) return actor.error;
  const db = env.DB;
  if (!await qrisEnabled(db, actor.store.entityId)) {
    if (pathname === '/api/qris/ringkasan') return json({ enabled: false, stores: [], tanpaGerai: 0 });
    return json({ error: 'QRIS Otomatis tidak diaktifkan untuk usaha ini.', code: 'QRIS_DISABLED' }, 403);
  }

  if (request.method === 'GET' && pathname === '/api/qris/ringkasan') return json(await ringkasan(db, actor));
  if (request.method === 'GET' && pathname === '/api/qris') {
    const asked = new URL(request.url).searchParams.get('tanggal') || '';
    const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : getJakartaBusinessDate();
    return json(await daftar(db, actor, tanggal));
  }
  if (request.method === 'GET' && pathname === '/api/qris/setelan') {
    if (!actor.canManage) return forbidden('Setelan QRIS hanya untuk admin.');
    return json(await setelan(db, actor, request));
  }
  if (request.method !== 'POST' && request.method !== 'PUT') return json({ error: 'Metode tidak didukung.' }, 405);
  const parsed = await readJson(request);
  if (!parsed.ok) return json({ error: 'Isi permintaan bukan JSON yang sah.' }, 400);
  const value = parsed.value || {};
  if (actor.readOnly) return forbidden('Akses ini hanya untuk membaca.');
  switch (pathname) {
    case '/api/qris/tautkan': return tautkan(db, actor, value);
    case '/api/qris/lepas': return adminUbah(db, actor, value, 'lepas');
    case '/api/qris/abaikan': return adminUbah(db, actor, value, 'abaikan');
    case '/api/qris/pulihkan': return adminUbah(db, actor, value, 'pulihkan');
    case '/api/qris/pindah-gerai': return adminUbah(db, actor, value, 'pindah-gerai');
    case '/api/qris/manual': return tambahManual(db, actor, value);
    case '/api/qris/setelan': return simpanSetelan(db, actor, value);
    case '/api/qris/penerima': return buatPenerima(db, actor, value, request);
    case '/api/qris/penerima/cabut': return cabutPenerima(db, actor, value);
    default: return json({ error: 'Rute QRIS tidak dikenal.' }, 404);
  }
}
