import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { parseRupiahAmountToScaled, postAccountingJournal } from './accounting-ledger.js';
import { invalidateDailyProfitSnapshot } from './net-profit-report.js';

// Hitung Ulang HPP (Bos Cyo, 2026-10-02): "kalo leker itu harganya 2000 maka
// bahannya 2000 adonan ... 1 adonan itu 1 rupiah ... bisa dibenerin pake
// hitung ulang? kalo bisa jadikan itu fitur ... hanya berlaku untuk hpp."
//
// Admin menetapkan harga per satuan yang BENAR untuk satu bahan sejak tanggal
// tertentu. Sistem menghitung ulang biaya bahan itu di setiap produksi
// DADAKAN yang menempel ke penjualan (penjualan yang tidak dibatalkan), lalu
// mencatat selisih HPP per baris penjualan.
//
// Hanya HPP. Jumlah stok, nominal pembelian, dan uang laci tidak disentuh.
// Snapshot lama (sale_items.line_cogs, production_run_components) tidak
// ditulis ulang: koreksi adalah catatan baru yang dijumlahkan laporan. Biaya
// rata-rata bahan diganti ke harga yang benar supaya penjualan berikutnya
// langsung benar.
//
// Akuntansi (gerai edisi ACCOUNTING): satu jurnal koreksi per penjualan,
// hanya untuk penjualan yang jurnal penjualannya sudah POSTED. Bentuknya:
// HPP terlalu besar -> Debit Persediaan bahan / Kredit HPP barang terjual
// (Persediaan barang jadi sudah netral karena produksi dan penjualannya
// sama-sama memakai angka lama). Penjualan yang jurnalnya belum masuk
// menunggu: koreksinya ikut diposting saat tombol sinkron Akuntansi ditekan.
// Pencatatan lewat accounting_bridge_deliveries (fakta HPP_KOREKSI), bukan
// foreign key dari tabel koreksi ke jurnal (invariant #4).
//
// Produksi MANUAL (stok) yang memakai bahan itu tidak ikut dihitung ulang --
// biayanya masuk ke stok barang setengah jadi lalu tersebar lewat biaya
// rata-rata; jumlahnya ditampilkan di pratinjau supaya tidak diam-diam.

const SCALE = 1_000_000;
const PRODUCER = 'ADMIN';
const FACT_TYPE = 'HPP_KOREKSI';
const SOURCE_SYSTEM = 'LEKER_HPP_KOREKSI';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINES = 5000;
const text = (value, max = 300) => String(value ?? '').trim().slice(0, max);
const rupiah = scaled => Math.round(Number(scaled || 0) / SCALE);
const JAKARTA_DATE = "date(s.created_at, '+7 hours')";

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

function actorFrom(auth) {
  if (auth.owner) return { role: 'OWNER', id: auth.owner.id || '' };
  if (auth.entityAdmin) return { role: 'ENTITY_ADMIN', id: auth.entityAdmin.id || '' };
  if (auth.admin) return { role: 'ADMIN', id: auth.admin.id || '' };
  if (auth.agent) return { role: 'AGENT', id: '' };
  return { role: 'LEGACY_PIN', id: '' };
}

// Bahan di gerai ini yang boleh dikoreksi harganya: (a) yang pernah dipakai
// produksi dadakan -- penjualannya ikut dihitung ulang, dan (b) bahan baku
// lain (mis. Air Mineral, Gula) yang harga rata-ratanya salah karena salah
// catat pembelian -- tanpa penjualan langsung, tapi harga rata-ratanya ikut
// meracuni produksi berikutnya, jadi harus bisa dibetulkan juga.
export async function listRecalculableComponents(db, storeId) {
  const rows = await db.prepare(`
    SELECT p.id, p.name, u.code AS unit_code, u.symbol AS unit_symbol, p.average_cost,
           CASE WHEN p.id IN (
             SELECT DISTINCT c.component_product_id
             FROM production_run_components c
             JOIN production_runs r ON r.id = c.production_run_id AND r.store_id = c.store_id
             WHERE c.store_id = ? AND r.mode = 'AUTO_DADAKAN'
           ) THEN 1 ELSE 0 END AS used_in_sales
    FROM products p
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    WHERE p.store_id = ? AND (
      p.id IN (
        SELECT DISTINCT c.component_product_id
        FROM production_run_components c
        JOIN production_runs r ON r.id = c.production_run_id AND r.store_id = c.store_id
        WHERE c.store_id = ? AND r.mode = 'AUTO_DADAKAN'
      )
      OR (p.is_active = 1 AND COALESCE(t.can_consume, 0) = 1 AND COALESCE(t.can_sell, 1) = 0)
    )
    ORDER BY p.name COLLATE NOCASE
  `).bind(storeId, storeId, storeId).all();
  return (rows.results ?? []).map(row => ({
    productId: Number(row.id),
    name: row.name,
    unitCode: row.unit_code || '',
    unitSymbol: row.unit_symbol || '',
    averageCostRupiah: Number(row.average_cost || 0) / SCALE,
    usedInSales: Boolean(row.used_in_sales)
  }));
}

function parseInput(body) {
  const componentProductId = Number(body?.componentProductId);
  const unitCostScaled = String(body?.unitCost ?? '').trim() === '0' ? 0 : parseRupiahAmountToScaled(body?.unitCost);
  const from = text(body?.from, 10);
  if (!Number.isInteger(componentProductId) || componentProductId <= 0) return { ok: false, error: 'Pilih bahan yang mau dihitung ulang.' };
  if (unitCostScaled === null) return { ok: false, error: 'Harga per satuan wajib angka, boleh desimal (mis. 1 atau 0,5).' };
  if (!DATE.test(from)) return { ok: false, error: 'Tanggal mulai wajib diisi.' };
  return { ok: true, componentProductId, unitCostScaled, from };
}

// Hitung selisih per baris penjualan. Biaya lama = snapshot produksi +
// koreksi sebelumnya untuk bahan yang sama di produksi yang sama, jadi
// hitung ulang kedua kali tidak menggandakan koreksi.
export async function computeHppRecalculation(db, storeId, { componentProductId, unitCostScaled, from }) {
  const component = await db.prepare(`SELECT id, name, average_cost, product_kind_id FROM products WHERE id = ? AND store_id = ?`).bind(componentProductId, storeId).first();
  if (!component) return { ok: false, status: 404, error: 'Bahan tidak ditemukan di gerai ini.' };

  const rows = await db.prepare(`
    SELECT si.id AS sale_item_id, si.sale_id, si.product_name AS sold_name, si.product_kind_id AS sold_kind_id,
           ${JAKARTA_DATE} AS business_date, r.id AS run_id,
           c.total_quantity, c.component_product_kind_id,
           COALESCE(c.total_cost_snapshot_scaled, CAST(ROUND(COALESCE(c.total_cost_snapshot, 0) * ${SCALE}) AS INTEGER)) AS snapshot_scaled,
           COALESCE((SELECT SUM(l.delta_scaled) FROM hpp_recalculation_lines l
                     WHERE l.production_run_id = r.id AND l.component_product_id = c.component_product_id), 0) AS prior_delta
    FROM production_runs r
    JOIN production_run_components c ON c.production_run_id = r.id AND c.store_id = r.store_id
    JOIN sales s ON s.id = r.sale_id AND s.store_id = r.store_id
    JOIN sale_items si ON si.sale_id = s.id AND si.store_id = s.store_id AND si.production_run_id = r.id
    WHERE r.store_id = ? AND r.mode = 'AUTO_DADAKAN' AND r.status = 'POSTED'
      AND c.component_product_id = ? AND s.voided_at IS NULL
      AND ${JAKARTA_DATE} >= ?
    ORDER BY s.created_at, si.id
    LIMIT ${MAX_LINES + 1}
  `).bind(storeId, componentProductId, from).all();
  const all = rows.results ?? [];
  if (all.length > MAX_LINES) return { ok: false, status: 400, error: `Terlalu banyak penjualan (lebih dari ${MAX_LINES}). Persempit dengan tanggal mulai yang lebih baru.` };

  const lines = all.map(row => {
    const quantity = Number(row.total_quantity);
    const oldCost = Number(row.snapshot_scaled || 0) + Number(row.prior_delta || 0);
    const newCost = quantity * unitCostScaled;
    return {
      saleItemId: row.sale_item_id,
      saleId: row.sale_id,
      soldName: row.sold_name,
      soldKindId: row.sold_kind_id || null,
      // Snapshot produksi lama kadang tidak mencatat Jenis Barang bahan: pakai Jenis Barang bahan sekarang.
      componentKindId: row.component_product_kind_id || component.product_kind_id || null,
      businessDate: row.business_date,
      runId: row.run_id,
      quantity,
      oldCost,
      newCost,
      delta: newCost - oldCost
    };
  }).filter(line => line.delta !== 0);
  if (lines.some(line => !Number.isSafeInteger(line.newCost))) return { ok: false, status: 400, error: 'Nominal terlalu besar.' };

  const byDate = new Map();
  for (const line of lines) {
    const day = byDate.get(line.businessDate) || { businessDate: line.businessDate, sales: new Set(), oldScaled: 0, newScaled: 0 };
    day.sales.add(line.saleId);
    day.oldScaled += line.oldCost;
    day.newScaled += line.newCost;
    byDate.set(line.businessDate, day);
  }
  const manual = await db.prepare(`
    SELECT COUNT(*) AS n FROM production_runs r
    JOIN production_run_components c ON c.production_run_id = r.id AND c.store_id = r.store_id
    WHERE r.store_id = ? AND r.mode = 'MANUAL' AND r.status = 'POSTED' AND c.component_product_id = ?
      AND date(r.created_at, '+7 hours') >= ?
  `).bind(storeId, componentProductId, from).first();

  const oldTotal = lines.reduce((sum, line) => sum + line.oldCost, 0);
  const newTotal = lines.reduce((sum, line) => sum + line.newCost, 0);
  const previousAverage = Number(component.average_cost || 0);
  return {
    ok: true,
    component: { productId: Number(component.id), name: component.name, averageCostScaled: Number(component.average_cost || 0) },
    lines,
    summary: {
      lineCount: lines.length,
      saleCount: new Set(lines.map(line => line.saleId)).size,
      oldHppRupiah: rupiah(oldTotal),
      newHppRupiah: rupiah(newTotal),
      deltaRupiah: rupiah(newTotal - oldTotal),
      oldTotalScaled: oldTotal,
      newTotalScaled: newTotal,
      manualProductionSkipped: Number(manual?.n || 0),
      // Tidak ada penjualan yang terdampak tapi harga rata-rata bahan memang beda:
      // Terapkan hanya membetulkan harga rata-rata (bahan baku yang salah catat).
      averageCostOnly: lines.length === 0 && previousAverage !== unitCostScaled,
      previousAverageCostRupiah: previousAverage / SCALE,
      newAverageCostRupiah: unitCostScaled / SCALE,
      byDate: [...byDate.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate)).map(day => ({
        businessDate: day.businessDate,
        saleCount: day.sales.size,
        oldHppRupiah: rupiah(day.oldScaled),
        newHppRupiah: rupiah(day.newScaled),
        deltaRupiah: rupiah(day.newScaled - day.oldScaled)
      }))
    }
  };
}

// --------------------------------------------------------- Akuntansi ---

async function isAccountingStore(db, storeId) {
  const row = await db.prepare('SELECT edition FROM stores WHERE id = ? LIMIT 1').bind(storeId).first();
  return row?.edition === 'ACCOUNTING';
}

async function kindAccounts(db, storeId, kindIds) {
  const unique = [...new Set(kindIds.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await db.prepare(`
    SELECT product_kind_id, inventory_account_id, cogs_account_id FROM item_categories
    WHERE store_id = ? AND is_active = 1 AND product_kind_id IN (${unique.map(() => '?').join(',')})
  `).bind(storeId, ...unique).all();
  return new Map((rows.results ?? []).map(row => [row.product_kind_id, row]));
}

async function saveDelivery(db, storeId, factId, status, journalId, code, detail) {
  await db.prepare(`
    INSERT INTO accounting_bridge_deliveries (
      id, store_id, producer_module, fact_type, fact_id, transaction_category_code,
      status, journal_id, failure_code, failure_detail, attempts, last_attempt_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'hpp_koreksi', ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(store_id, producer_module, fact_type, fact_id) DO UPDATE SET
      status = excluded.status, journal_id = excluded.journal_id, failure_code = excluded.failure_code,
      failure_detail = excluded.failure_detail, attempts = accounting_bridge_deliveries.attempts + 1,
      last_attempt_at = excluded.last_attempt_at, updated_at = CURRENT_TIMESTAMP
  `).bind(`accounting_hpp_${crypto.randomUUID()}`, storeId, PRODUCER, FACT_TYPE, factId, status, journalId, code, detail, new Date().toISOString()).run();
}

// Posting jurnal koreksi yang masih tertunda: per (hitung ulang, penjualan),
// hanya bila jurnal penjualannya sudah POSTED. Dipanggil sesudah Terapkan dan
// dari tombol sinkron Akuntansi.
// retryAfter (ISO): koreksi yang sudah dicoba sesudah waktu itu dilewati --
// dipakai sinkron otomatis supaya yang macet karena setelan tidak dicoba ulang
// di setiap pembukaan laporan.
export async function postPendingHppCorrections(db, storeId, limit = 100, { retryAfter = null } = {}) {
  if (!(await isAccountingStore(db, storeId))) return [];
  const groups = await db.prepare(`
    SELECT l.recalculation_id, l.sale_id, MIN(l.business_date) AS business_date, h.component_product_name
    FROM hpp_recalculation_lines l
    JOIN hpp_recalculations h ON h.id = l.recalculation_id
    WHERE l.store_id = ?
      AND EXISTS (SELECT 1 FROM accounting_bridge_deliveries d WHERE d.store_id = l.store_id AND d.producer_module = 'POS' AND d.fact_type = 'SALE' AND d.fact_id = l.sale_id AND d.status = 'POSTED')
      AND NOT EXISTS (SELECT 1 FROM accounting_bridge_deliveries d WHERE d.store_id = l.store_id AND d.producer_module = 'ADMIN' AND d.fact_type = 'HPP_KOREKSI' AND d.fact_id = l.recalculation_id || ':' || l.sale_id
                        AND (d.status = 'POSTED' OR (? IS NOT NULL AND d.last_attempt_at > ?)))
    GROUP BY l.recalculation_id, l.sale_id
    ORDER BY MIN(l.business_date)
    LIMIT ?
  `).bind(storeId, retryAfter, retryAfter, Math.max(1, Math.min(200, Number(limit) || 100))).all();

  const results = [];
  for (const group of groups.results ?? []) {
    const factId = `${group.recalculation_id}:${group.sale_id}`;
    const lineRows = await db.prepare(`
      SELECT COALESCE(l.component_kind_id, p.product_kind_id) AS component_kind_id, l.sold_kind_id, l.delta_scaled
      FROM hpp_recalculation_lines l
      LEFT JOIN products p ON p.id = l.component_product_id AND p.store_id = l.store_id
      WHERE l.recalculation_id = ? AND l.sale_id = ?
    `).bind(group.recalculation_id, group.sale_id).all();
    const lines = lineRows.results ?? [];
    const accounts = await kindAccounts(db, storeId, lines.flatMap(line => [line.component_kind_id, line.sold_kind_id]));
    const journalLines = new Map();
    let failure = null;
    const add = (accountId, side, amount) => {
      const key = `${accountId}:${side}`;
      journalLines.set(key, { accountId, side, amountScaled: (journalLines.get(key)?.amountScaled || 0) + amount });
    };
    for (const line of lines) {
      const inventory = accounts.get(line.component_kind_id)?.inventory_account_id;
      const cogs = accounts.get(line.sold_kind_id)?.cogs_account_id;
      if (!inventory || !cogs) { failure = 'Jenis Barang bahan atau barang terjual belum dilink ke akun Persediaan/HPP.'; break; }
      const delta = Number(line.delta_scaled);
      if (delta < 0) { add(inventory, 'DEBIT', -delta); add(cogs, 'CREDIT', -delta); }
      else if (delta > 0) { add(cogs, 'DEBIT', delta); add(inventory, 'CREDIT', delta); }
    }
    if (failure) {
      await saveDelivery(db, storeId, factId, 'NEEDS_CONFIGURATION', null, 'NEEDS_ITEM_CATEGORY_MAPPING', failure);
      results.push({ factId, status: 'NEEDS_CONFIGURATION' });
      continue;
    }
    if (!journalLines.size) continue;
    let posted;
    try {
      posted = await postAccountingJournal(db, { id: storeId }, {
        businessDate: group.business_date,
        occurredAt: new Date().toISOString(),
        sourceSystem: SOURCE_SYSTEM,
        sourceReferenceId: `${FACT_TYPE}:${factId}`,
        correlationId: group.sale_id,
        idempotencyKey: `${SOURCE_SYSTEM}:${factId}`,
        description: `Koreksi HPP · ${text(group.component_product_name, 120)}`,
        journalLines: [...journalLines.values()].map(line => ({ ...line, description: 'Koreksi HPP (hitung ulang)' }))
      });
    } catch (error) {
      await saveDelivery(db, storeId, factId, 'FAILED', null, 'ACCOUNTING_POST_FAILED', text(error?.message || error, 500));
      results.push({ factId, status: 'FAILED' });
      continue;
    }
    if (posted.ok) {
      await saveDelivery(db, storeId, factId, 'POSTED', posted.journal.journalId, '', '');
      results.push({ factId, status: 'POSTED' });
    } else {
      await saveDelivery(db, storeId, factId, 'FAILED', null, posted.code || 'ACCOUNTING_POST_FAILED', text(posted.error, 500));
      results.push({ factId, status: 'FAILED' });
    }
  }
  return results;
}

// ------------------------------------------------------------- Terapkan ---

async function applyHppRecalculation(db, store, auth, input, reason) {
  const computed = await computeHppRecalculation(db, store.id, input);
  if (!computed.ok) return computed;
  if (!computed.lines.length && !computed.summary.averageCostOnly) return { ok: false, status: 409, error: 'Tidak ada penjualan yang HPP-nya berubah dan harga rata-rata bahan sudah sama dengan harga ini.' };

  const id = `hpprecalc_${crypto.randomUUID()}`;
  const actor = actorFrom(auth);
  const now = new Date().toISOString();
  const statements = [
    db.prepare(`
      INSERT INTO hpp_recalculations (
        id, store_id, component_product_id, component_product_name, unit_cost_scaled, effective_from, reason,
        previous_average_cost_scaled, line_count, old_total_scaled, new_total_scaled, delta_total_scaled,
        created_by_role, created_by_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, store.id, input.componentProductId, computed.component.name, input.unitCostScaled, input.from, reason,
      computed.component.averageCostScaled, computed.lines.length, computed.summary.oldTotalScaled,
      computed.summary.newTotalScaled, computed.summary.newTotalScaled - computed.summary.oldTotalScaled,
      actor.role, actor.id, now
    ),
    ...computed.lines.map(line => db.prepare(`
      INSERT INTO hpp_recalculation_lines (
        id, recalculation_id, store_id, business_date, sale_id, sale_item_id, production_run_id,
        component_product_id, component_kind_id, sold_kind_id, quantity, old_cost_scaled, new_cost_scaled, delta_scaled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `hpprecalcline_${crypto.randomUUID()}`, id, store.id, line.businessDate, line.saleId, line.saleItemId, line.runId,
      input.componentProductId, line.componentKindId, line.soldKindId, line.quantity, line.oldCost, line.newCost, line.delta
    )),
    // Penjualan berikutnya langsung memakai harga yang benar.
    db.prepare(`UPDATE products SET average_cost = ?, cost_updated_at = ? WHERE id = ? AND store_id = ?`)
      .bind(input.unitCostScaled, now, input.componentProductId, store.id)
  ];
  await db.batch(statements);
  for (const day of computed.summary.byDate) await invalidateDailyProfitSnapshot(db, store.id, day.businessDate);
  const journals = await postPendingHppCorrections(db, store.id, 200);
  return { ok: true, id, summary: computed.summary, journals };
}

export async function handleHppRecalculationApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/hpp-recalculation')) return null;
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (request.method === 'GET' && pathname === '/api/admin/hpp-recalculation/components') {
    return json({ store, components: await listRecalculableComponents(db, store.id) });
  }

  if (request.method === 'GET' && pathname === '/api/admin/hpp-recalculation') {
    const rows = await db.prepare(`
      SELECT id, component_product_name, unit_cost_scaled, effective_from, reason, previous_average_cost_scaled,
             line_count, old_total_scaled, new_total_scaled, delta_total_scaled, created_by_role, created_at
      FROM hpp_recalculations WHERE store_id = ? ORDER BY created_at DESC LIMIT 50
    `).bind(store.id).all();
    return json({
      store,
      history: (rows.results ?? []).map(row => ({
        id: row.id,
        componentName: row.component_product_name,
        unitCostRupiah: Number(row.unit_cost_scaled) / SCALE,
        previousAverageCostRupiah: Number(row.previous_average_cost_scaled) / SCALE,
        from: row.effective_from,
        reason: row.reason,
        lineCount: Number(row.line_count),
        oldHppRupiah: rupiah(row.old_total_scaled),
        newHppRupiah: rupiah(row.new_total_scaled),
        deltaRupiah: rupiah(row.delta_total_scaled),
        createdByRole: row.created_by_role,
        createdAt: row.created_at
      }))
    });
  }

  if (request.method === 'POST' && (pathname === '/api/admin/hpp-recalculation/preview' || pathname === '/api/admin/hpp-recalculation')) {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload hitung ulang HPP tidak valid.' }, 400);
    const input = parseInput(body.value);
    if (!input.ok) return json({ error: input.error }, 400);

    if (pathname.endsWith('/preview')) {
      const computed = await computeHppRecalculation(db, store.id, input);
      if (!computed.ok) return json({ error: computed.error }, computed.status || 400);
      return json({ component: computed.component.name, summary: computed.summary });
    }

    const reason = text(body.value?.reason, 300);
    if (reason.length < 5) return json({ error: 'Alasan wajib diisi (minimal 5 karakter).' }, 400);
    const applied = await applyHppRecalculation(db, store, auth, input, reason);
    if (!applied.ok) return json({ error: applied.error }, applied.status || 400);
    return json({ ok: true, id: applied.id, summary: applied.summary, journals: applied.journals }, 201);
  }

  return json({ error: 'Route hitung ulang HPP tidak ditemukan.' }, 404);
}
