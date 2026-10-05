import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getAccountingJournal, parseRupiahAmountToScaled, postAccountingJournal } from './accounting-ledger.js';
import { getJakartaBusinessDate } from './time.js';
import { invalidateDailyProfitSnapshot } from './net-profit-report.js';
import { SO_JURNAL_MULAI } from './accounting-admin-bridge.js';

// Koreksi Nilai Penyesuaian Stok (Bos Cyo, 2026-10-05): "cara perbaikan kita disini tidak ikut
// aturan akuntansi ... kalo kita jual program kita apa akan laku" -- koreksi nilai SO harus lewat
// jalur resmi program, dengan jurnal pembalik, bukan jurnal manual yang diketik orang.
//
// Kejadian yang memicunya: Mandala 5 Okt, SO+ Gula 1.998 g dinilai dengan HPP yang sedang rusak
// (Rp18.000/g dari pembelian salah ketik) -> Rp35.964.000 masuk Pendapatan Koreksi Stok.
//
// Aturan:
//   - Penyesuaian stok aslinya dan jurnalnya TIDAK diubah (invariant #2). Koreksi = baris baru di
//     stock_adjustment_value_corrections + (gerai Akuntansi) satu jurnal penyesuaian sebesar
//     selisih nilai, bertanggal SAMA dengan SO aslinya, memakai akun yang SAMA dengan jurnal SO
//     aslinya: nilai terlalu besar -> baris jurnal asli dibalik; terlalu kecil -> ditambah searah.
//   - Nilai benar = qty x harga per satuan yang benar (integer skala 1.000.000, tanpa float).
//   - Satu koreksi per SO. Hanya qty dan arah SO aslinya yang dipakai; qty stok tidak berubah.
//   - Laporan Untung Rugi gerai non-Akuntansi membaca nilai terkoreksi (net-profit-report.js);
//     gerai Akuntansi membaca jurnal, jadi jurnal penyesuaian di atas yang membetulkannya.
//
//   GET  /api/admin/stock-adjustments/value-corrections?store=<gerai>
//   POST /api/admin/stock-adjustments/<approvalId>/value-correction/preview?store=<gerai>  { unitCost }
//   POST /api/admin/stock-adjustments/<approvalId>/value-correction?store=<gerai>          { unitCost, reason }

const SCALE = 1_000_000n;
const SOURCE_SYSTEM = 'LEKER_SO_KOREKSI';
const FACT_TYPE = 'SO_KOREKSI';
const ROUTE = /^\/api\/admin\/stock-adjustments\/([^/]+)\/value-correction(\/preview)?$/;
const text = (value, max = 300) => String(value ?? '').trim().slice(0, max);

function rupiah(scaled) {
  const n = BigInt(scaled);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = (abs / SCALE).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = (abs % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}Rp${whole}${fraction ? `,${fraction}` : ''}`;
}

function actorFrom(auth) {
  if (auth.owner) return { role: 'OWNER', id: auth.owner.id || '' };
  if (auth.entityAdmin) return { role: 'ENTITY_ADMIN', id: auth.entityAdmin.id || '' };
  if (auth.admin) return { role: 'ADMIN', id: auth.admin.id || '' };
  if (auth.agent) return { role: 'AGENT', id: '' };
  return { role: 'LEGACY_PIN', id: '' };
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

function parseUnitCost(value) {
  const raw = text(value, 40);
  if (raw === '0') return 0n;
  const scaled = parseRupiahAmountToScaled(raw);
  return Number.isSafeInteger(scaled) && scaled >= 0 ? BigInt(scaled) : null;
}

/** Hitung koreksi tanpa menulis apa pun. */
export async function computeStockAdjustmentCorrection(db, storeId, approvalId, unitCostScaled) {
  const row = await db.prepare(`
    SELECT id, store_id, request_type, posting_status, posted_at, payload_json
    FROM approval_requests WHERE id = ? AND store_id = ? LIMIT 1
  `).bind(approvalId, storeId).first();
  if (!row) return { ok: false, status: 404, error: 'Penyesuaian stok tidak ditemukan di gerai ini.' };
  let payload;
  try { payload = JSON.parse(row.payload_json || '{}'); } catch { payload = {}; }
  if (row.request_type !== 'GOODS_FLOW' || payload.purpose !== 'STOCK_ADJUSTMENT') {
    return { ok: false, status: 400, error: 'Transaksi ini bukan penyesuaian stok.' };
  }
  if (row.posting_status !== 'posted' || !row.posted_at) {
    return { ok: false, status: 409, error: 'Penyesuaian stok ini belum diposting, jadi belum punya nilai untuk dikoreksi.' };
  }
  const direction = payload.direction;
  const quantity = Number(payload.quantity);
  if (!['IN', 'OUT'].includes(direction) || !Number.isSafeInteger(quantity) || quantity <= 0) {
    return { ok: false, status: 400, error: 'Data penyesuaian stok tidak lengkap (arah/qty).' };
  }
  const existing = await db.prepare('SELECT id FROM stock_adjustment_value_corrections WHERE approval_request_id = ? LIMIT 1').bind(approvalId).first();
  if (existing) return { ok: false, status: 409, code: 'ALREADY_CORRECTED', error: 'Nilai penyesuaian stok ini sudah pernah dikoreksi.' };

  const originalValue = BigInt(Math.max(0, Math.trunc(Number(payload.totalCostSnapshotScaled) || 0)));
  const originalUnit = BigInt(Math.max(0, Math.trunc(Number(payload.unitCostSnapshotScaled) || 0)));
  const correctedValue = BigInt(quantity) * unitCostScaled;
  const delta = correctedValue - originalValue;
  return {
    ok: true,
    approval: row,
    payload,
    direction,
    quantity,
    businessDate: getJakartaBusinessDate(new Date(row.posted_at)),
    originalUnit,
    originalValue,
    correctedUnit: unitCostScaled,
    correctedValue,
    delta
  };
}

function summary(c) {
  return {
    approvalRequestId: c.approval.id,
    productName: c.payload.productName || '',
    unitSymbol: c.payload.unitSymbol || '',
    direction: c.direction,
    label: c.direction === 'IN' ? 'SO+ (stok lebih)' : 'SO- (stok kurang)',
    quantity: c.quantity,
    businessDate: c.businessDate,
    originalUnitCost: rupiah(c.originalUnit),
    originalValue: rupiah(c.originalValue),
    correctedUnitCost: rupiah(c.correctedUnit),
    correctedValue: rupiah(c.correctedValue),
    delta: rupiah(c.delta),
    originalValueScaled: String(c.originalValue),
    correctedValueScaled: String(c.correctedValue),
    deltaScaled: String(c.delta)
  };
}

async function saveDelivery(db, storeId, factId, status, journalId, code, detail) {
  await db.prepare(`
    INSERT INTO accounting_bridge_deliveries (
      id, store_id, producer_module, fact_type, fact_id, transaction_category_code,
      status, journal_id, failure_code, failure_detail, attempts, last_attempt_at, created_at, updated_at
    ) VALUES (?, ?, 'ADMIN', ?, ?, 'so_koreksi', ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(store_id, producer_module, fact_type, fact_id) DO UPDATE SET
      status = excluded.status, journal_id = excluded.journal_id, failure_code = excluded.failure_code,
      failure_detail = excluded.failure_detail, attempts = accounting_bridge_deliveries.attempts + 1,
      last_attempt_at = excluded.last_attempt_at, updated_at = CURRENT_TIMESTAMP
  `).bind(`accounting_so_koreksi_${crypto.randomUUID()}`, storeId, FACT_TYPE, factId, status, journalId, code, detail, new Date().toISOString()).run();
}

// Jurnal SO aslinya (dibuat jembatan Admin, fakta STOCK_ADJUSTMENT). null = SO ini memang tidak
// pernah dijurnal (sebelum SO_JURNAL_MULAI atau gerai non-Akuntansi).
async function originalSoJournal(db, storeId, approvalId) {
  const delivery = await db.prepare(`
    SELECT status, journal_id FROM accounting_bridge_deliveries
    WHERE store_id = ? AND producer_module = 'ADMIN' AND fact_type = 'STOCK_ADJUSTMENT' AND fact_id = ? LIMIT 1
  `).bind(storeId, approvalId).first();
  if (!delivery) return { delivery: null, journal: null };
  const journal = delivery.journal_id ? await getAccountingJournal(db, storeId, delivery.journal_id) : null;
  return { delivery, journal };
}

/** Terapkan koreksi: catatan baru + jurnal penyesuaian (gerai Akuntansi). */
export async function applyStockAdjustmentCorrection(db, store, auth, approvalId, unitCostScaled, reason) {
  const c = await computeStockAdjustmentCorrection(db, store.id, approvalId, unitCostScaled);
  if (!c.ok) return c;
  if (c.delta === 0n) return { ok: false, status: 409, error: 'Nilai yang benar sama dengan nilai tercatat; tidak ada yang perlu dikoreksi.' };

  const accounting = store.edition === 'ACCOUNTING' && c.approval.posted_at >= SO_JURNAL_MULAI;
  let original = { delivery: null, journal: null };
  if (accounting) {
    original = await originalSoJournal(db, store.id, approvalId);
    // Jurnal SO aslinya harus sudah masuk dulu: kalau belum, sinkron Akuntansi nanti akan
    // memposting nilai lama dan koreksinya jadi tidak berpasangan.
    if (original.delivery?.status !== 'POSTED' || !original.journal?.lines?.length) {
      return { ok: false, status: 409, code: 'ORIGINAL_SO_NOT_POSTED', error: 'Jurnal penyesuaian stok aslinya belum masuk Akuntansi. Jalankan sinkron Akuntansi dulu, lalu ulangi koreksi.' };
    }
  }

  const id = `socorr_${crypto.randomUUID()}`;
  const actor = actorFrom(auth);
  const now = new Date().toISOString();
  const entity = await db.prepare('SELECT entity_id FROM stores WHERE id = ?').bind(store.id).first();
  await db.prepare(`
    INSERT INTO stock_adjustment_value_corrections (
      id, store_id, entity_id, approval_request_id, product_id, product_name, unit_symbol, direction, quantity,
      business_date, original_unit_cost_scaled, original_value_scaled, corrected_unit_cost_scaled,
      corrected_value_scaled, delta_scaled, reason, created_by_role, created_by_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, store.id, entity?.entity_id || null, approvalId, Number(c.payload.productId), text(c.payload.productName, 120),
    text(c.payload.unitSymbol, 20), c.direction, c.quantity, c.businessDate,
    String(c.originalUnit), String(c.originalValue), String(c.correctedUnit), String(c.correctedValue), String(c.delta),
    reason, actor.role, actor.id, now
  ).run();
  await invalidateDailyProfitSnapshot(db, store.id, c.businessDate);

  let journal = { status: 'NOT_REQUIRED' };
  if (accounting) {
    // Nilai tercatat terlalu besar -> balik arah baris jurnal asli; terlalu kecil -> searah.
    const amount = c.delta < 0n ? -c.delta : c.delta;
    const flip = c.delta < 0n;
    const lines = original.journal.lines.filter(line => !line.isSystemGenerated).map(line => ({
      accountId: line.accountId,
      side: flip ? (line.side === 'DEBIT' ? 'CREDIT' : 'DEBIT') : line.side,
      amountScaled: Number(amount),
      description: `${flip ? 'Pembalik selisih' : 'Tambahan selisih'} nilai ${c.direction === 'IN' ? 'SO+' : 'SO-'} · ${text(c.payload.productName, 80)}`
    }));
    try {
      const posted = await postAccountingJournal(db, { id: store.id }, {
        businessDate: c.businessDate,
        occurredAt: now,
        sourceSystem: SOURCE_SYSTEM,
        sourceReferenceId: `${FACT_TYPE}:${id}`,
        correlationId: approvalId,
        idempotencyKey: `${SOURCE_SYSTEM}:${store.id}:${id}`,
        description: `Koreksi nilai ${c.direction === 'IN' ? 'SO+' : 'SO-'} · ${text(c.payload.productName, 80)} ${c.quantity} ${text(c.payload.unitSymbol, 10)} · ${rupiah(c.originalValue)} -> ${rupiah(c.correctedValue)} · ${text(reason, 120)}`,
        journalLines: lines
      });
      if (posted.ok) {
        await saveDelivery(db, store.id, id, 'POSTED', posted.journal.journalId, '', '');
        journal = { status: 'POSTED', journalId: posted.journal.journalId };
      } else {
        await saveDelivery(db, store.id, id, 'FAILED', null, posted.code || 'ACCOUNTING_POST_FAILED', text(posted.error, 500));
        journal = { status: 'FAILED', error: posted.error };
      }
    } catch (error) {
      await saveDelivery(db, store.id, id, 'FAILED', null, 'ACCOUNTING_POST_FAILED', text(error?.message || error, 500));
      journal = { status: 'FAILED', error: text(error?.message || error, 300) };
    }
  }
  return { ok: true, id, correction: summary(c), journal };
}

export async function listStockAdjustmentCorrections(db, storeId) {
  const rows = await db.prepare(`
    SELECT c.*, d.status AS journal_status, d.journal_id
    FROM stock_adjustment_value_corrections c
    LEFT JOIN accounting_bridge_deliveries d ON d.store_id = c.store_id AND d.producer_module = 'ADMIN' AND d.fact_type = 'SO_KOREKSI' AND d.fact_id = c.id
    WHERE c.store_id = ? ORDER BY c.created_at DESC LIMIT 100
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    approvalRequestId: row.approval_request_id,
    productName: row.product_name,
    unitSymbol: row.unit_symbol,
    direction: row.direction,
    quantity: Number(row.quantity),
    businessDate: row.business_date,
    originalValue: rupiah(row.original_value_scaled),
    correctedValue: rupiah(row.corrected_value_scaled),
    delta: rupiah(row.delta_scaled),
    reason: row.reason,
    createdByRole: row.created_by_role,
    createdAt: row.created_at,
    journalStatus: row.journal_status || 'NOT_REQUIRED',
    journalId: row.journal_id || null
  }));
}

export async function handleStockAdjustmentCorrectionApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/stock-adjustments/')) return null;
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const edition = await db.prepare('SELECT edition FROM stores WHERE id = ?').bind(store.id).first();
  const scopedStore = { ...store, edition: edition?.edition || '' };

  if (request.method === 'GET' && pathname === '/api/admin/stock-adjustments/value-corrections') {
    return json({ store: { code: store.code }, corrections: await listStockAdjustmentCorrections(db, store.id) });
  }
  const match = pathname.match(ROUTE);
  if (!match || request.method !== 'POST') return json({ error: 'Route koreksi penyesuaian stok tidak ditemukan.' }, 404);
  const approvalId = decodeURIComponent(match[1]);
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload koreksi tidak valid.' }, 400);
  const unitCost = parseUnitCost(body.value?.unitCost);
  if (unitCost === null) return json({ error: 'Harga per satuan yang benar wajib angka, boleh desimal (mis. 18 atau 0,4375).' }, 400);

  if (match[2]) {
    const computed = await computeStockAdjustmentCorrection(db, store.id, approvalId, unitCost);
    if (!computed.ok) return json({ error: computed.error, code: computed.code }, computed.status || 400);
    return json({ preview: summary(computed) });
  }
  const reason = text(body.value?.reason, 300);
  if (reason.length < 5) return json({ error: 'Alasan koreksi wajib diisi (minimal 5 karakter).' }, 400);
  const applied = await applyStockAdjustmentCorrection(db, scopedStore, auth, approvalId, unitCost, reason);
  if (!applied.ok) return json({ error: applied.error, code: applied.code }, applied.status || 400);
  return json(applied, 201);
}
