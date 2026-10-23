import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { getTenantPolicySetting, TUGAS_BUKA_LACI_KEY, usesTugasBukaLaciSkin } from './tenant-policy.js';
import { getJakartaBusinessDate } from './time.js';
import { listStockAdjustmentOptions } from './operational-posting.js';
import { listNotificationActors, emitNotification } from './management-notifications.js';
import { getOpenDrawer, requireDrawerOwner } from './cashier-drawer.js';
import { submitStockAdjustmentBatch } from './approval-queue.js';

// Bos Cyo, 2026-10-23: "setiap cs mau buka laci maka dia wajib stok opname
// atau penyesuaian stok, di daily task itu ada pekerjaan stok opname, ketika
// dibuka dia langsung masuk ke form penyesuaian stok dimana semua bahan2
// sudah masuk di list disana, dia tinggal ngisi qty nya saja. ditambah lagi
// cek uang laci saat itu juga sama aset, untuk saat ini asetnya cuma appron."
//
// Keputusan Bos hari yang sama: laci dibuka dulu (penyesuaian stok memang
// selalu menempel ke laci), lalu Tugas Buka Laci wajib -- semua transaksi
// laci ditahan requireDrawerOwner (423 OPENING_CHECK_REQUIRED) sampai tiga
// bagian selesai:
//   1. Stok opname: semua Bahan + Bahan Setengah Jadi gerai sudah terdaftar,
//      CS mengisi qty nyata. Barang yang berselisih langsung diposting lewat
//      jalur Penyesuaian Stok yang sama (submitStockAdjustmentBatch).
//   2. Uang laci: CS menghitung uang fisik. Selisih dengan saldo awal laci
//      hanya dicatat + admin dikabari -- saldo awal tetap dari server dan
//      tidak ada jurnal otomatis (keputusan 2026-09-04: dibahas dengan akuntan).
//   3. Aset: daftar diatur Admin Gerai di tab Daily Task (jenis ASSET), isi
//      awal Apron. Aset yang tidak ada tetap boleh lanjut, tercatat, admin
//      dikabari.
// Saklar tenant 'tugas_buka_laci' (bawaan aktif); mati = laci langsung dipakai.

const STOCK_TYPE_CODES = ['RAW_MATERIAL', 'SEMI_FINISHED'];
const BATCH_LIMIT = 50;
const DEFAULT_ASSETS = Object.freeze([{ id: 'bawaan_apron', name: 'Apron', description: 'Apron ada dan dipakai saat jaga' }]);
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const rupiah = value => `Rp${Math.abs(Number(value) || 0).toLocaleString('id-ID')}`;
const parseList = value => { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };

export async function tugasBukaLaciWajib(db, cashier) {
  if (cashier.officeActor || cashier.readOnly) return false;
  if (!usesTugasBukaLaciSkin(cashier.store.skinChoice)) return false;
  return getTenantPolicySetting(db, cashier.store.tenantId ?? null, TUGAS_BUKA_LACI_KEY);
}

export function tugasBukaLaciInsert(db, { drawerId, cashier, now }) {
  return db.prepare(`
    INSERT INTO drawer_opening_checks (drawer_session_id, store_id, cashier_id, business_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(drawerId, cashier.store.id, cashier.id, getJakartaBusinessDate(new Date(now)), now, now);
}

function mapCheck(row) {
  if (!row) return null;
  return {
    drawerId: row.drawer_session_id,
    businessDate: row.business_date,
    completedAt: row.completed_at || null,
    stock: {
      doneAt: row.stock_done_at || null,
      itemCount: Number(row.stock_item_count || 0),
      diffCount: Number(row.stock_diff_count || 0),
      lines: parseList(row.stock_lines_json)
    },
    cash: {
      doneAt: row.cash_done_at || null,
      systemAmount: row.cash_system_amount == null ? null : Number(row.cash_system_amount),
      countedAmount: row.cash_counted_amount == null ? null : Number(row.cash_counted_amount),
      difference: row.cash_difference == null ? null : Number(row.cash_difference)
    },
    assets: {
      doneAt: row.asset_done_at || null,
      items: parseList(row.assets_json),
      missingCount: Number(row.missing_asset_count || 0)
    }
  };
}

export async function getDrawerOpeningCheck(db, drawerId) {
  const row = await db.prepare('SELECT * FROM drawer_opening_checks WHERE drawer_session_id = ?').bind(drawerId).first();
  return mapCheck(row);
}

// Daftar opname: Bahan + Bahan Setengah Jadi (Barang Jadi menu dadakan tidak
// punya stok fisik sendiri). Gerai tanpa bahan sama sekali (mis. toko retail
// yang hanya Barang Jadi) memakai seluruh daftar Penyesuaian Stok.
export async function listOpnameItems(db, storeId) {
  const options = await listStockAdjustmentOptions(db, storeId);
  const rows = await db.prepare(`
    SELECT p.id FROM products p
    JOIN item_types t ON t.id = p.item_type_id
    WHERE p.store_id = ? AND p.is_active = 1 AND t.code IN (${STOCK_TYPE_CODES.map(() => '?').join(', ')})
  `).bind(storeId, ...STOCK_TYPE_CODES).all();
  const materialIds = new Set((rows.results ?? []).map(row => Number(row.id)));
  const materials = options.filter(item => materialIds.has(item.productId));
  return materials.length ? materials : options;
}

export async function listOpeningAssets(db, storeId) {
  const rows = await db.prepare(`
    SELECT id, title, description, is_active FROM daily_task_templates
    WHERE store_id = ? AND kind = 'ASSET'
    ORDER BY sort_order, title COLLATE NOCASE
  `).bind(storeId).all();
  const all = rows.results ?? [];
  if (!all.length) return DEFAULT_ASSETS.map(item => ({ ...item }));
  return all.filter(row => row.is_active).map(row => ({ id: row.id, name: row.title, description: row.description || '' }));
}

async function notifyAdmins(env, cashier, { dedupKey, title, body, kind }) {
  try {
    const store = await env.DB.prepare('SELECT entity_id FROM stores WHERE id = ?').bind(cashier.store.id).first();
    const entityId = store?.entity_id;
    if (!entityId) return;
    const actors = await listNotificationActors(env, { entityId, storeId: cashier.store.id });
    for (const recipient of actors.filter(item => item.role !== 'CASHIER')) {
      await emitNotification(env, {
        recipientKey: recipient.key,
        entityId,
        storeId: cashier.store.id,
        dedupKey,
        title,
        body,
        url: recipient.role === 'ADMIN' ? `/s/${encodeURIComponent(cashier.store.code)}/admin` : recipient.role === 'OWNER' ? '/admin' : '/entity-admin',
        kind
      });
    }
  } catch (error) {
    // Gagal kirim notifikasi tidak membatalkan hasil tugas yang sudah tersimpan.
    console.error('Tugas Buka Laci: notifikasi admin gagal', { name: error?.name });
  }
}

// Selesai = tiga bagian sudah tercatat. Laci baru dilepas (DONE) di sini.
async function finishIfComplete(db, drawerId, now) {
  await db.batch([
    db.prepare(`
      UPDATE drawer_opening_checks SET completed_at = ?, updated_at = ?
      WHERE drawer_session_id = ? AND completed_at IS NULL
        AND stock_done_at IS NOT NULL AND cash_done_at IS NOT NULL AND asset_done_at IS NOT NULL
    `).bind(now, now, drawerId),
    db.prepare(`
      UPDATE cash_drawer_sessions SET opening_check_status = 'DONE'
      WHERE id = ? AND opening_check_status = 'PENDING'
        AND EXISTS (SELECT 1 FROM drawer_opening_checks WHERE drawer_session_id = ? AND completed_at IS NOT NULL)
    `).bind(drawerId, drawerId)
  ]);
}

async function payload(db, cashier, drawer) {
  const check = drawer ? await getDrawerOpeningCheck(db, drawer.id) : null;
  if (!drawer || !check) return { required: false, status: drawer?.openingCheckStatus || '' };
  const mine = drawer.cashierId === cashier.id;
  return {
    required: true,
    status: drawer.openingCheckStatus,
    drawerId: drawer.id,
    canWork: mine,
    check,
    openingAmount: drawer.openingAmount,
    ...(mine && !check.completedAt ? {
      stockItems: check.stock.doneAt ? [] : await listOpnameItems(db, cashier.store.id),
      assets: check.assets.doneAt ? [] : await listOpeningAssets(db, cashier.store.id)
    } : {})
  };
}

async function submitStock(env, cashier, drawer, check, body) {
  if (check.stock.doneAt) return json({ error: 'Stok opname laci ini sudah dicatat.', code: 'OPENING_STOCK_DONE' }, 409);
  const items = await listOpnameItems(env.DB, cashier.store.id);
  const counted = new Map();
  for (const item of Array.isArray(body?.items) ? body.items : []) {
    const quantity = Number(item?.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 0) return json({ error: 'Qty nyata harus angka bulat 0 atau lebih.' }, 400);
    counted.set(Number(item?.productId), quantity);
  }
  const missing = items.filter(item => !counted.has(item.productId));
  if (missing.length) {
    return json({ error: `Qty nyata belum diisi: ${missing.slice(0, 5).map(item => item.productName).join(', ')}${missing.length > 5 ? ` dan ${missing.length - 5} lainnya` : ''}.`, code: 'OPENING_STOCK_INCOMPLETE' }, 400);
  }
  const note = text(body?.note, 400);
  const lines = items.map(item => ({
    productId: item.productId,
    productName: item.productName,
    unitSymbol: item.unitSymbol,
    recorded: item.currentQuantity,
    actual: counted.get(item.productId),
    difference: counted.get(item.productId) - item.currentQuantity
  }));
  const changed = lines.filter(line => line.difference !== 0);
  const sessionIds = [];
  for (let index = 0; index < changed.length; index += BATCH_LIMIT) {
    const chunk = changed.slice(index, index + BATCH_LIMIT);
    const result = await submitStockAdjustmentBatch(env, cashier, drawer.id, chunk.map(line => ({
      productId: line.productId,
      targetQuantity: line.actual,
      reason: 'Stok opname buka laci',
      note
    })));
    if (!result.ok) return json({ error: result.error }, result.status || 400);
    if (result.posted?.posted === false) {
      return json({ error: `Penyesuaian Stok ditolak: ${result.posted.reason || 'stok berubah, ulangi stok opname.'}`, code: 'OPENING_STOCK_NOT_POSTED' }, 409);
    }
    sessionIds.push(result.sessionId);
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE drawer_opening_checks
    SET stock_done_at = ?, stock_item_count = ?, stock_diff_count = ?, stock_session_ids = ?, stock_lines_json = ?, note = ?, updated_at = ?
    WHERE drawer_session_id = ? AND stock_done_at IS NULL
  `).bind(now, lines.length, changed.length, JSON.stringify(sessionIds), JSON.stringify(changed), note, now, drawer.id).run();
  await finishIfComplete(env.DB, drawer.id, now);
  return json({ ok: true, itemCount: lines.length, diffCount: changed.length, changed });
}

async function submitCash(env, cashier, drawer, check, body) {
  if (check.cash.doneAt) return json({ error: 'Uang laci sudah dihitung untuk laci ini.', code: 'OPENING_CASH_DONE' }, 409);
  const countedAmount = Number(body?.countedAmount);
  if (body?.countedAmount === '' || body?.countedAmount == null || !Number.isSafeInteger(countedAmount) || countedAmount < 0) {
    return json({ error: 'Isi jumlah uang di laci (angka bulat, 0 atau lebih).' }, 400);
  }
  const systemAmount = Number(drawer.openingAmount || 0);
  const difference = countedAmount - systemAmount;
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE drawer_opening_checks
    SET cash_done_at = ?, cash_system_amount = ?, cash_counted_amount = ?, cash_difference = ?, updated_at = ?
    WHERE drawer_session_id = ? AND cash_done_at IS NULL
  `).bind(now, systemAmount, countedAmount, difference, now, drawer.id).run();
  if (difference !== 0) {
    await notifyAdmins(env, cashier, {
      dedupKey: `tugas-buka-laci:uang:${drawer.id}`,
      title: `💰 Uang laci ${difference > 0 ? 'lebih' : 'kurang'} ${rupiah(difference)} di ${cashier.store.storeName || cashier.store.code}`,
      body: `${cashier.employeeName || cashier.username} buka laci: hitung fisik ${rupiah(countedAmount)}, saldo awal sistem ${rupiah(systemAmount)}. Tidak ada jurnal otomatis -- bahas dengan akuntan.`,
      kind: 'TUGAS_BUKA_LACI_UANG'
    });
  }
  await finishIfComplete(env.DB, drawer.id, now);
  return json({ ok: true, systemAmount, countedAmount, difference });
}

async function submitAssets(env, cashier, drawer, check, body) {
  if (check.assets.doneAt) return json({ error: 'Aset laci ini sudah dicek.', code: 'OPENING_ASSETS_DONE' }, 409);
  const assets = await listOpeningAssets(env.DB, cashier.store.id);
  const answers = new Map((Array.isArray(body?.items) ? body.items : []).map(item => [String(item?.id || ''), item]));
  const unanswered = assets.filter(asset => typeof answers.get(asset.id)?.present !== 'boolean');
  if (unanswered.length) return json({ error: `Pilih Ada / Tidak ada untuk: ${unanswered.map(asset => asset.name).join(', ')}.`, code: 'OPENING_ASSETS_INCOMPLETE' }, 400);
  const items = assets.map(asset => ({
    id: asset.id,
    name: asset.name,
    present: answers.get(asset.id).present,
    note: text(answers.get(asset.id).note, 200)
  }));
  const missing = items.filter(item => !item.present);
  const now = new Date().toISOString();
  await env.DB.prepare(`
    UPDATE drawer_opening_checks
    SET asset_done_at = ?, assets_json = ?, missing_asset_count = ?, updated_at = ?
    WHERE drawer_session_id = ? AND asset_done_at IS NULL
  `).bind(now, JSON.stringify(items), missing.length, now, drawer.id).run();
  if (missing.length) {
    await notifyAdmins(env, cashier, {
      dedupKey: `tugas-buka-laci:aset:${drawer.id}`,
      title: `🧺 Aset tidak ada di ${cashier.store.storeName || cashier.store.code}`,
      body: `${cashier.employeeName || cashier.username} buka laci: ${missing.map(item => `${item.name}${item.note ? ` (${item.note})` : ''}`).join(', ')} tidak ada.`,
      kind: 'TUGAS_BUKA_LACI_ASET'
    });
  }
  await finishIfComplete(env.DB, drawer.id, now);
  return json({ ok: true, missing: missing.map(item => item.name) });
}

const PARTS = { stock: submitStock, cash: submitCash, assets: submitAssets };

export async function handleTugasBukaLaciApi(request, env, pathname) {
  if (!pathname.startsWith('/api/cashier/drawer/opening-check')) return null;
  const db = env.DB;
  const auth = await requireCashier(request, db);
  if (!auth.ok) return auth.response;
  const cashier = auth.cashier;

  if (request.method === 'GET' && pathname === '/api/cashier/drawer/opening-check') {
    return json(await payload(db, cashier, await getOpenDrawer(db, cashier.store.id)));
  }

  const match = pathname.match(/^\/api\/cashier\/drawer\/opening-check\/(stock|cash|assets)$/);
  if (request.method !== 'POST' || !match) return json({ error: 'Route Tugas Buka Laci tidak ditemukan.' }, 404);
  const ownership = await requireDrawerOwner(db, cashier, { allowPendingOpeningCheck: true });
  if (!ownership.ok) return ownership.response;
  const check = await getDrawerOpeningCheck(db, ownership.drawer.id);
  if (!check || ownership.drawer.openingCheckStatus !== 'PENDING') {
    return json({ error: 'Laci ini tidak punya Tugas Buka Laci yang perlu diselesaikan.', code: 'OPENING_CHECK_NOT_PENDING' }, 409);
  }
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload Tugas Buka Laci tidak valid.' }, 400);
  return PARTS[match[1]](env, cashier, ownership.drawer, check, body.value);
}

// Portal Staf (Daily Task): ringkasan Tugas Buka Laci milik kasir ini hari ini.
export async function openingCheckForDailyTask(db, cashier, businessDate) {
  const row = await db.prepare(`
    SELECT oc.*, d.status AS drawer_status FROM drawer_opening_checks oc
    JOIN cash_drawer_sessions d ON d.id = oc.drawer_session_id
    WHERE oc.cashier_id = ? AND oc.business_date = ?
    ORDER BY oc.created_at DESC LIMIT 1
  `).bind(cashier.id, businessDate).first();
  if (!row) return null;
  return { ...mapCheck(row), drawerOpen: row.drawer_status === 'OPEN' };
}
