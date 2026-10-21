import { reversePostedPosAccountingFact } from './accounting-pos-reversal.js';
import { invalidateDailyProfitSnapshot } from './net-profit-report.js';
import { reverseHppCorrectionsOfVoidedSales } from './hpp-recalculation.js';
import { buildTransactionAccountingSnapshot } from './accounting-reference.js';
import { purchaseItemStatements, scaledUnitCost } from './cashier-purchase.js';
import { dispatchPosAccountingFact } from './accounting-pos-bridge.js';

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const hold = (code, detail) => ({ ok: false, status: 'HOLD', code, detail });
const fail = (code, detail) => ({ ok: false, status: 'FAILED', code, detail });

const safeCount = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const safeCost = value => value != null && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
const stockBalanceSql = `COALESCE((
  SELECT quantity FROM inventory_stock_balances b
  WHERE b.store_id = products.store_id AND b.product_id = products.id
), 0)`;

// Bos Cyo, 2026-09-24: "kalo angka dari proses penjualan dan turunannya itu
// awalnya + diganti minus dan yang minus diganti + hasilnya bukannya akan
// lebih aman ya untuk soft delete." Hapus penjualan yang memicu produksi
// AUTO_DADAKAN membalik produksinya juga, persis cerminan: hasil produksi
// yang dulu masuk (+) ditarik lagi (-), bahan baku yang dulu keluar (-)
// dikembalikan (+) dengan nilai snapshot waktu dipakai. Yang dibalik hanya
// pergerakan stok yang memang tercatat (barang tanpa Track stok tidak punya
// pergerakan). Aman karena link dadakan hanya boleh resep hasil 1
// (resolveLinkedRecipe): hasil produksi = qty yang dijual, tidak ada sisa
// batch yang bisa sudah terjual ke transaksi lain. Run lama yang ternyata
// hasilnya lebih besar dari yang dijual tetap HOLD, bukan ditebak.
async function loadGeneratedProductionMirror(db, storeId, saleId) {
  const linked = await db.prepare(`
    SELECT DISTINCT production_run_id
    FROM sale_items
    WHERE sale_id = ? AND store_id = ? AND production_run_id IS NOT NULL
  `).bind(saleId, storeId).all();
  const runs = [];
  for (const { production_run_id: runId } of linked.results ?? []) {
    // Nilai produksi = snapshot + koreksi Hitung Ulang HPP untuk produksi ini. Tanpa
    // koreksinya, bahan dikembalikan dengan harga lama yang salah dan Average Cost
    // bahan ikut rusak lagi (DERMO 2-10-2026: Adonan Leker Rp1 -> Rp97,24 sesudah 5
    // penjualan yang sudah dikoreksi dibatalkan).
    const run = await db.prepare(`
      SELECT id, output_product_name, total_output_quantity, requested_sale_quantity, status,
             hpp_total_scaled + COALESCE((SELECT SUM(l.delta_scaled) FROM hpp_recalculation_lines l
                                          WHERE l.production_run_id = production_runs.id AND l.store_id = production_runs.store_id), 0) AS hpp_total_scaled
      FROM production_runs
      WHERE id = ? AND store_id = ? AND mode = 'AUTO_DADAKAN'
      LIMIT 1
    `).bind(runId, storeId).first();
    if (!run || run.status !== 'POSTED') {
      return hold('SALE_AUTO_PRODUCTION_STATE_INVALID', `Produksi dadakan ${runId} tidak ditemukan atau sudah tidak berstatus POSTED.`);
    }
    if (Number(run.total_output_quantity) !== Number(run.requested_sale_quantity)) {
      return hold(
        'SALE_AUTO_PRODUCTION_EXCESS_OUTPUT',
        `Produksi dadakan ${run.output_product_name} menghasilkan ${run.total_output_quantity}, padahal yang dijual ${run.requested_sale_quantity}. Sisa hasil produksi sudah masuk stok umum, jadi pembalik penuh ditahan.`
      );
    }
    if (!safeCost(run.hpp_total_scaled)) {
      return hold('PRODUCTION_COST_SNAPSHOT_REQUIRED', `Snapshot HPP produksi ${run.output_product_name} tidak cukup untuk membalik produksi secara deterministic.`);
    }
    const movements = await db.prepare(`
      SELECT sm.product_id, sm.product_name, sm.unit_id, sm.unit_symbol, sm.direction, sm.quantity, sm.source_type,
             c.total_cost_snapshot_scaled + COALESCE((SELECT SUM(l.delta_scaled) FROM hpp_recalculation_lines l
                                                     WHERE l.production_run_id = sm.source_id AND l.store_id = sm.store_id
                                                       AND l.component_product_id = sm.product_id), 0) AS total_cost_snapshot_scaled
      FROM stock_movements sm
      LEFT JOIN production_run_components c
        ON c.production_run_id = sm.source_id AND c.store_id = sm.store_id AND c.component_product_id = sm.product_id
      WHERE sm.store_id = ? AND sm.source_id = ? AND sm.source_type IN ('PRODUCTION_INPUT', 'PRODUCTION_OUTPUT')
      ORDER BY sm.source_type, sm.product_id
    `).bind(storeId, run.id).all();
    for (const movement of movements.results ?? []) {
      const isInput = movement.source_type === 'PRODUCTION_INPUT';
      if (!safeCount(movement.quantity) || movement.direction !== (isInput ? 'OUT' : 'IN')) {
        return hold('PRODUCTION_MOVEMENT_INVALID', `Mutasi stok produksi ${movement.product_name} tidak konsisten untuk dibalik.`);
      }
      if (isInput && !safeCost(movement.total_cost_snapshot_scaled)) {
        return hold('PRODUCTION_COST_SNAPSHOT_REQUIRED', `Snapshot HPP bahan ${movement.product_name} tidak cukup untuk mengembalikan stok secara deterministic.`);
      }
    }
    runs.push({ id: run.id, hppTotalScaled: Number(run.hpp_total_scaled), movements: movements.results ?? [] });
  }
  return { ok: true, runs };
}

function productionMirrorStatements(db, storeId, runs, permit, actor, now) {
  const statements = [];
  for (const run of runs) {
    for (const movement of run.movements) {
      const quantity = Number(movement.quantity);
      const productId = movement.product_id;
      const returnsComponent = movement.source_type === 'PRODUCTION_INPUT';
      if (returnsComponent) {
        const value = Number(movement.total_cost_snapshot_scaled);
        statements.push(
          db.prepare(`
            INSERT OR IGNORE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
            VALUES (?, ?, 0, ?)
          `).bind(storeId, productId, now),
          db.prepare(`
            UPDATE products
            SET average_cost = CASE
                  WHEN ${stockBalanceSql} <= 0
                    THEN CAST((? + CAST(? / 2 AS INTEGER)) / ? AS INTEGER)
                  ELSE CAST((${stockBalanceSql} * average_cost + ? + CAST((${stockBalanceSql} + ?) / 2 AS INTEGER))
                            / (${stockBalanceSql} + ?) AS INTEGER)
                END,
                cost_updated_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND store_id = ?
          `).bind(value, quantity, quantity, value, quantity, quantity, now, productId, storeId)
        );
      } else {
        // Menarik nilai HPP produksi yang dulu masuk. Kalau saldo sisa <= 0
        // atau nilainya tidak cukup (stok sudah berubah jauh), Average Cost
        // dibiarkan -- tidak pernah jadi negatif atau dibagi nol.
        const value = run.hppTotalScaled;
        statements.push(db.prepare(`
          UPDATE products
          SET average_cost = CASE
                WHEN ${stockBalanceSql} - ? <= 0 THEN average_cost
                WHEN ${stockBalanceSql} * average_cost - ? < 0 THEN average_cost
                ELSE CAST((${stockBalanceSql} * average_cost - ? + CAST((${stockBalanceSql} - ?) / 2 AS INTEGER))
                          / (${stockBalanceSql} - ?) AS INTEGER)
              END,
              cost_updated_at = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND store_id = ?
        `).bind(quantity, value, value, quantity, quantity, now, productId, storeId));
      }
      statements.push(
        db.prepare(`
          UPDATE inventory_stock_balances
          SET quantity = quantity + ?, updated_at = ?
          WHERE store_id = ? AND product_id = ?
        `).bind(returnsComponent ? quantity : -quantity, now, storeId, productId),
        db.prepare(`
          INSERT INTO stock_movements (
            id, source_key, store_id, product_id, product_name, unit_id, unit_symbol,
            direction, quantity, source_type, source_id, drawer_session_id, note,
            actor_role, actor_id, occurred_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PRODUCTION_VOID', ?, drawer_session_id, ?, ?, ?, ?
          FROM production_runs
          WHERE id = ? AND store_id = ?
        `).bind(
          `stock_move_${crypto.randomUUID()}`,
          `PRODUCTION_VOID:${permit.id}:${run.id}:${movement.source_type}:${productId}`,
          storeId, productId, movement.product_name, movement.unit_id, movement.unit_symbol,
          returnsComponent ? 'IN' : 'OUT', quantity, run.id,
          `Permit ${permit.id} · pembalik produksi dadakan (${returnsComponent ? 'bahan kembali' : 'hasil ditarik'})`,
          actor.role, actor.id, now,
          run.id, storeId
        ),
        db.prepare(`
          INSERT INTO product_average_cost_snapshots (id, store_id, product_id, average_cost_scaled, source_type, source_id, created_at)
          SELECT ?, store_id, id, average_cost, 'CORRECTION', ?, ?
          FROM products WHERE id = ? AND store_id = ?
        `).bind(`hpp_snap_${crypto.randomUUID()}`, permit.id, now, productId, storeId)
      );
    }
    statements.push(db.prepare(`
      UPDATE production_runs SET status = 'CANCELLED'
      WHERE id = ? AND store_id = ? AND status = 'POSTED'
    `).bind(run.id, storeId));
  }
  return statements;
}

async function executeSaleCorrection(db, storeId, permit, actor, now) {
  const sale = await db.prepare(`
    SELECT id, customer_id, total_points, voided_at
    FROM sales
    WHERE id = ? AND store_id = ?
    LIMIT 1
  `).bind(permit.subjectId, storeId).first();
  if (!sale) return fail('SALE_NOT_FOUND', 'Penjualan sumber tidak ditemukan.');
  if (sale.voided_at) return { ok: true, duplicate: true };

  const production = await loadGeneratedProductionMirror(db, storeId, permit.subjectId);
  if (!production.ok) return production;

  const rows = await db.prepare(`
    SELECT sm.product_id, sm.product_name, sm.unit_id, sm.unit_symbol, sm.quantity,
           si.line_cogs
    FROM stock_movements sm
    JOIN sale_items si
      ON si.sale_id = sm.source_id
     AND si.store_id = sm.store_id
     AND si.product_id = sm.product_id
    WHERE sm.store_id = ?
      AND sm.source_type = 'SALE'
      AND sm.source_id = ?
      AND sm.direction = 'OUT'
    ORDER BY sm.product_id
  `).bind(storeId, permit.subjectId).all();

  const statements = [];
  for (const row of rows.results ?? []) {
    const quantity = Number(row.quantity || 0);
    const lineCogs = row.line_cogs == null ? null : Number(row.line_cogs);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(lineCogs) || lineCogs < 0) {
      return hold(
        'SALE_COST_SNAPSHOT_REQUIRED',
        `Snapshot HPP ${row.product_name || row.product_id} tidak cukup untuk mengembalikan stok secara deterministic.`
      );
    }

    statements.push(
      db.prepare(`
        INSERT OR IGNORE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
        VALUES (?, ?, 0, ?)
      `).bind(storeId, row.product_id, now),
      db.prepare(`
        UPDATE products
        SET average_cost = CASE
              WHEN COALESCE((SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?), 0) <= 0
                THEN CAST((? + CAST(? / 2 AS INTEGER)) / ? AS INTEGER)
              ELSE CAST((
                COALESCE((SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?), 0) * average_cost
                + ?
                + CAST((COALESCE((SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?), 0) + ?) / 2 AS INTEGER)
              ) / (COALESCE((SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?), 0) + ?) AS INTEGER)
            END,
            cost_updated_at = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND store_id = ?
      `).bind(
        storeId, row.product_id, lineCogs, quantity, quantity,
        storeId, row.product_id, lineCogs,
        storeId, row.product_id, quantity,
        storeId, row.product_id, quantity,
        now, row.product_id, storeId
      ),
      db.prepare(`
        UPDATE inventory_stock_balances
        SET quantity = quantity + ?, updated_at = ?
        WHERE store_id = ? AND product_id = ?
      `).bind(quantity, now, storeId, row.product_id),
      db.prepare(`
        INSERT INTO stock_movements (
          id, source_key, store_id, product_id, product_name, unit_id, unit_symbol,
          direction, quantity, source_type, source_id, drawer_session_id, note,
          actor_role, actor_id, occurred_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, 'IN', ?, 'SALE_VOID', ?, drawer_session_id, ?, ?, ?, ?
        FROM sales
        WHERE id = ? AND store_id = ?
      `).bind(
        `stock_move_${crypto.randomUUID()}`,
        `SALE_VOID:${permit.id}:${row.product_id}`,
        storeId, row.product_id, row.product_name, row.unit_id, row.unit_symbol,
        quantity, permit.subjectId,
        `Permit ${permit.id} · pembalik penjualan`, actor.role, actor.id, now,
        permit.subjectId, storeId
      )
    );
  }

  // Sesudah pembalik penjualan di atas: barang hasil dadakan baru dikembalikan
  // ke stok oleh loop di atas, jadi penarikan hasil produksinya harus jalan
  // sesudahnya supaya saldo yang dibaca sudah termasuk barang yang kembali.
  statements.push(...productionMirrorStatements(db, storeId, production.runs, permit, actor, now));

  if (sale.customer_id && Number(sale.total_points || 0) > 0) {
    statements.push(db.prepare(`
      INSERT INTO customer_point_ledger (
        id, customer_id, share_group_id, source_store_id, points_delta,
        activity_type, reference_type, reference_id, notes, created_at
      )
      SELECT ?, ?, share_group_id, ?, ?, 'ADJUSTMENT', 'SALE_VOID', ?, ?, ?
      FROM customer_point_ledger
      WHERE customer_id = ?
        AND reference_type = 'SALE'
        AND reference_id = ?
        AND activity_type = 'EARN'
      ORDER BY created_at
      LIMIT 1
    `).bind(
      `point_correction_${permit.id}`,
      sale.customer_id,
      storeId,
      -Number(sale.total_points),
      permit.id,
      `Pembalik poin sale ${permit.subjectId}`,
      now,
      sale.customer_id,
      permit.subjectId
    ));
  }

  statements.push(db.prepare(`
    UPDATE sales
    SET voided_at = ?, voided_by_role = ?, voided_by_id = ?, void_reason = ?, void_permit_id = ?
    WHERE id = ? AND store_id = ? AND voided_at IS NULL
  `).bind(now, actor.role, actor.id, text(permit.reason), permit.id, permit.subjectId, storeId));

  try {
    const results = await db.batch(statements);
    const state = results.at(-1);
    if (!state?.success || Number(state.meta?.changes ?? 0) !== 1) return fail('SALE_CORRECTION_CONFLICT', 'Penjualan berubah saat proses ACC.');
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) return fail('SALE_CORRECTION_ALREADY_EXECUTED', 'Pembalik stok penjualan sudah pernah dieksekusi.');
    throw error;
  }
  return { ok: true, duplicate: false };
}

// Harga beli terakhir sesudah pembelian ini dibatalkan = pembelian sah paling akhir selain dirinya.
async function latestOtherPurchaseCost(db, storeId, productId, purchaseId) {
  return db.prepare(`
    SELECT pi.unit_cost, pi.created_at
    FROM purchase_items pi
    JOIN purchases p ON p.id = pi.purchase_id AND p.store_id = pi.store_id
    WHERE pi.store_id = ?
      AND pi.product_id = ?
      AND pi.purchase_id <> ?
      AND p.voided_at IS NULL
    ORDER BY pi.created_at DESC, pi.id DESC
    LIMIT 1
  `).bind(storeId, productId, purchaseId).first();
}

function requestedLines(permit) {
  if (Array.isArray(permit.requestedLines)) return permit.requestedLines;
  try { return JSON.parse(permit.requestedLinesJson || '[]'); } catch { return []; }
}

// Koreksi nominal (Bos Cyo, 2026-10-21: "cs mau hapus, muncul pesan bener mau hapus atau cuma ganti
// nominal doang"): pembelian pengganti dengan barang & qty yang sama, nominal yang diajukan CS. Waktu
// transaksinya ikut pembelian asal supaya laci dan tanggal jurnalnya sama; mutasi stoknya tetap
// berwaktu sekarang supaya Putar Ulang HPP bisa memverifikasi riwayat (src/hpp-putar-ulang.js).
async function replacementPlan(db, purchase, permit, items, now) {
  if (purchase.deposit_id) return { ok: false, result: hold('PURCHASE_AMOUNT_CORRECTION_UNSUPPORTED', 'Pembelian yang dibayar dari Deposit belum bisa diganti nominal; ajukan hapus lalu input ulang.') };
  const method = await db.prepare('SELECT creates_payable FROM payment_methods WHERE store_id = ? AND code = ? LIMIT 1')
    .bind(purchase.store_id, purchase.payment_method).first();
  if (method?.creates_payable) return { ok: false, result: hold('PURCHASE_AMOUNT_CORRECTION_UNSUPPORTED', 'Pembelian yang dicatat sebagai Hutang belum bisa diganti nominal; ajukan hapus lalu input ulang.') };
  const byProduct = new Map(requestedLines(permit).map(line => [Number(line?.productId), Number(line?.lineTotal)]));
  const lines = [];
  for (const item of items) {
    const lineTotal = byProduct.get(Number(item.product_id));
    if (!Number.isSafeInteger(lineTotal) || lineTotal <= 0) {
      return { ok: false, result: fail('PURCHASE_AMOUNT_CORRECTION_INVALID', `Nominal benar untuk ${item.product_name} tidak ada / tidak valid.`) };
    }
    const unitCostScaled = scaledUnitCost(lineTotal, Number(item.quantity));
    if (unitCostScaled === null) return { ok: false, result: fail('PURCHASE_AMOUNT_CORRECTION_INVALID', 'Nominal terlalu besar untuk skala HPP.') };
    lines.push({
      productId: Number(item.product_id), productName: item.product_name, unitId: item.unit_id, unitSymbol: item.unit_symbol,
      quantity: Number(item.quantity), lineTotal, unitCostScaled
    });
  }
  if (byProduct.size !== items.length) return { ok: false, result: fail('PURCHASE_AMOUNT_CORRECTION_INVALID', 'Baris nominal benar tidak sama dengan barang di pembelian asal.') };
  // Satu milidetik sesudah pembalik, supaya urutan mutasinya pasti (pembalik dulu, baru pengganti).
  const replacementNow = new Date(Date.parse(now) + 1).toISOString();
  const id = `purchase_${crypto.randomUUID()}`;
  const totalAmount = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const accounting = await buildTransactionAccountingSnapshot(db, {
    storeId: purchase.store_id, sourceType: 'PURCHASE', sourceId: id, businessEvent: 'PURCHASE_MATERIAL', paymentMethod: purchase.payment_method, now
  });
  const note = `Koreksi nominal ${purchase.id} (izin ${permit.id}): ${purchase.total_amount} → ${totalAmount}${purchase.note ? ` · ${purchase.note}` : ''}`.slice(0, 500);
  const statements = [
    db.prepare(`
      INSERT INTO purchases (id, store_id, drawer_session_id, cashier_id, supplier_id, description, total_amount, note, created_at, payment_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, purchase.store_id, purchase.drawer_session_id, purchase.cashier_id, purchase.supplier_id, purchase.description, totalAmount, note, purchase.created_at, purchase.payment_method),
    accounting.statement
  ];
  for (const item of lines) statements.push(...purchaseItemStatements(db, {
    purchaseId: id, storeId: purchase.store_id, drawerId: purchase.drawer_session_id, cashierId: purchase.cashier_id, item, now: replacementNow
  }));
  return { ok: true, id, totalAmount, statements };
}

// Bos Cyo, 2026-10-21 (Air Mineral Kaliurang): ACC hapus pembelian dulu selalu ditahan (HOLD) begitu
// ada mutasi stok apa pun sesudah pembelian itu -- termasuk pembelian ulang yang benar -- dan uang laci
// tetap salah. Sekarang:
//   - tidak ada mutasi sesudahnya dan HPP masih sama dengan snapshot: dibalik persis seperti dulu;
//   - selain itu: uang laci, stok, dan jurnal tetap dibalik SAAT ACC; harga rata-rata (HPP) bahannya
//     diputar ulang di jam sepi (hppMenunggu, src/hpp-putar-ulang.js);
//   - ditahan hanya kalau stok sekarang lebih kecil dari qty yang dibatalkan.
async function executePurchaseCorrection(db, storeId, permit, actor, now) {
  const purchase = await db.prepare(`
    SELECT id, store_id, drawer_session_id, cashier_id, supplier_id, description, total_amount, note,
           created_at, payment_method, deposit_id, voided_at
    FROM purchases
    WHERE id = ? AND store_id = ?
    LIMIT 1
  `).bind(permit.subjectId, storeId).first();
  if (!purchase) return fail('PURCHASE_NOT_FOUND', 'Pembelian sumber tidak ditemukan.');
  if (purchase.voided_at) return { ok: true, duplicate: true };

  const items = (await db.prepare(`
    SELECT id, product_id, product_name, unit_id, unit_symbol, quantity,
           average_cost_before, average_cost_after
    FROM purchase_items
    WHERE purchase_id = ? AND store_id = ?
    ORDER BY product_id
  `).bind(permit.subjectId, storeId).all()).results ?? [];
  if (!items.length) return hold('PURCHASE_ITEMS_REQUIRED', 'Pembelian tidak mempunyai snapshot itemized untuk pembalik stok/HPP.');

  const plans = [];
  let exact = true;
  for (const item of items) {
    const laterMovement = await db.prepare(`
      SELECT source_type
      FROM stock_movements
      WHERE store_id = ? AND product_id = ?
        AND NOT (source_type = 'PURCHASE' AND source_id = ?)
        AND occurred_at >= ?
      LIMIT 1
    `).bind(storeId, item.product_id, permit.subjectId, purchase.created_at).first();
    const current = await db.prepare(`
      SELECT COALESCE(b.quantity, 0) AS quantity, p.average_cost
      FROM products p
      LEFT JOIN inventory_stock_balances b
        ON b.store_id = p.store_id AND b.product_id = p.id
      WHERE p.id = ? AND p.store_id = ?
      LIMIT 1
    `).bind(item.product_id, storeId).first();
    if (!current || Number(current.quantity || 0) < Number(item.quantity || 0)) {
      return hold(
        'PURCHASE_STOCK_NOT_REVERSIBLE',
        `Stok ${item.product_name} tinggal ${Number(current?.quantity || 0)} ${item.unit_symbol}, lebih kecil dari ${item.quantity} ${item.unit_symbol} yang mau dibatalkan. Hitung stok fisik dan sesuaikan stoknya dulu, lalu tekan Coba lagi.`
      );
    }
    if (laterMovement || Number(current.average_cost || 0) !== Number(item.average_cost_after || 0)) exact = false;
    plans.push({ item, latest: await latestOtherPurchaseCost(db, storeId, item.product_id, permit.subjectId) });
  }

  const replacement = permit.correctionKind === 'AMOUNT' ? await replacementPlan(db, purchase, permit, items, now) : null;
  if (replacement && !replacement.ok) return replacement.result;

  const statements = [];
  for (const { item, latest } of plans) {
    statements.push(db.prepare(`
      UPDATE inventory_stock_balances
      SET quantity = quantity - ?, updated_at = ?
      WHERE store_id = ? AND product_id = ?
    `).bind(item.quantity, now, storeId, item.product_id));
    if (exact) {
      statements.push(
        db.prepare(`
          UPDATE products
          SET average_cost = CASE WHEN average_cost = ? THEN ? ELSE -1 END,
              last_purchase_price = ?,
              last_purchase_at = ?,
              cost_updated_at = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND store_id = ?
        `).bind(
          item.average_cost_after,
          item.average_cost_before,
          Number(latest?.unit_cost || 0),
          latest?.created_at || null,
          now,
          item.product_id,
          storeId
        ),
        db.prepare(`
          INSERT INTO product_average_cost_snapshots (id, store_id, product_id, average_cost_scaled, source_type, source_id, created_at)
          SELECT ?, store_id, id, average_cost, 'CORRECTION', ?, ?
          FROM products WHERE id = ? AND store_id = ?
        `).bind(`hpp_snap_${crypto.randomUUID()}`, permit.id, now, item.product_id, storeId)
      );
    } else {
      // HPP (harga rata-rata) menunggu Putar Ulang HPP di jam sepi; harga beli terakhir dibetulkan sekarang.
      statements.push(db.prepare(`
        UPDATE products SET last_purchase_price = ?, last_purchase_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND store_id = ?
      `).bind(Number(latest?.unit_cost || 0), latest?.created_at || null, item.product_id, storeId));
    }
    statements.push(db.prepare(`
      INSERT INTO stock_movements (
        id, source_key, store_id, product_id, product_name, unit_id, unit_symbol,
        direction, quantity, source_type, source_id, drawer_session_id, note,
        actor_role, actor_id, occurred_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, 'OUT', ?, 'PURCHASE_VOID', ?, drawer_session_id, ?, ?, ?, ?
      FROM purchases
      WHERE id = ? AND store_id = ?
    `).bind(
      `stock_move_${crypto.randomUUID()}`,
      `PURCHASE_VOID:${permit.id}:${item.product_id}`,
      storeId, item.product_id, item.product_name, item.unit_id, item.unit_symbol,
      item.quantity, permit.subjectId,
      `Permit ${permit.id} · pembalik pembelian`, actor.role, actor.id, now,
      permit.subjectId, storeId
    ));
  }

  statements.push(db.prepare(`
    UPDATE purchases
    SET voided_at = ?, voided_by_role = ?, voided_by_id = ?, void_reason = ?, void_permit_id = ?
    WHERE id = ? AND store_id = ? AND voided_at IS NULL
  `).bind(now, actor.role, actor.id, text(permit.reason), permit.id, permit.subjectId, storeId));
  const voidIndex = statements.length - 1;
  if (replacement) statements.push(...replacement.statements);

  try {
    const results = await db.batch(statements);
    const state = results[voidIndex];
    if (!state?.success || Number(state.meta?.changes ?? 0) !== 1) return fail('PURCHASE_CORRECTION_CONFLICT', 'Pembelian berubah saat proses ACC.');
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('check constraint')) return hold('PURCHASE_STATE_CHANGED_DURING_ACC', 'Stok atau HPP berubah saat ACC; seluruh batch dibatalkan. Tekan Coba lagi.');
    if (message.includes('unique')) return fail('PURCHASE_CORRECTION_ALREADY_EXECUTED', 'Pembalik stok pembelian sudah pernah dieksekusi.');
    throw error;
  }
  return {
    ok: true,
    duplicate: false,
    hppMenunggu: !exact,
    replacementId: replacement?.id || null,
    replacementTotal: replacement?.totalAmount ?? null,
    itemNames: items.map(item => item.product_name)
  };
}

async function executeExpenseCorrection(db, storeId, permit, actor, now) {
  const expense = await db.prepare(`SELECT id, voided_at FROM expenses WHERE id = ? AND store_id = ? LIMIT 1`)
    .bind(permit.subjectId, storeId).first();
  if (!expense) return fail('EXPENSE_NOT_FOUND', 'Pengeluaran Operasional sumber tidak ditemukan.');
  if (expense.voided_at) return { ok: true, duplicate: true };
  const result = await db.prepare(`
    UPDATE expenses
    SET voided_at = ?, voided_by_role = ?, voided_by_id = ?, void_reason = ?, void_permit_id = ?
    WHERE id = ? AND store_id = ? AND voided_at IS NULL
  `).bind(now, actor.role, actor.id, text(permit.reason), permit.id, permit.subjectId, storeId).run();
  if (!result.success || Number(result.meta?.changes ?? 0) !== 1) return fail('EXPENSE_CORRECTION_CONFLICT', 'Pengeluaran berubah saat proses ACC.');
  return { ok: true, duplicate: false };
}

export async function executeTransactionCorrection(db, store, permit, actor, now = new Date().toISOString()) {
  let operational;
  if (permit.subjectType === 'SALE') operational = await executeSaleCorrection(db, store.id, permit, actor, now);
  else if (permit.subjectType === 'PURCHASE') operational = await executePurchaseCorrection(db, store.id, permit, actor, now);
  else if (permit.subjectType === 'EXPENSE') operational = await executeExpenseCorrection(db, store.id, permit, actor, now);
  else return fail('CORRECTION_SUBJECT_UNSUPPORTED', 'Jenis transaksi belum mendukung correction.');
  if (!operational.ok) return operational;

  // Laporan untung rugi hari yang sudah lewat disimpan di cache harian; transaksi
  // yang dibatalkan mengubah hari aslinya, jadi cache hari itu dibuang.
  if (!operational.duplicate) {
    const table = { SALE: 'sales', PURCHASE: 'purchases', EXPENSE: 'expenses' }[permit.subjectType];
    const subject = await db.prepare(`SELECT date(created_at, '+7 hours') AS business_date FROM ${table} WHERE id = ? AND store_id = ?`)
      .bind(permit.subjectId, store.id).first();
    if (subject?.business_date) await invalidateDailyProfitSnapshot(db, store.id, subject.business_date);
  }

  const accounting = await reversePostedPosAccountingFact(db, store, {
    factType: permit.subjectType,
    factId: permit.subjectId,
    permitId: permit.id,
    occurredAt: now,
    reason: permit.reason
  });
  // Koreksi Hitung Ulang HPP milik penjualan ini ikut dibalik; kalau gagal di sini,
  // sinkron Akuntansi berikutnya mencoba lagi.
  if (permit.subjectType === 'SALE' && accounting.ok) {
    try { await reverseHppCorrectionsOfVoidedSales(db, store.id, { saleId: permit.subjectId }); }
    catch (error) { console.warn('pembalik koreksi HPP gagal', permit.subjectId, error?.message); }
  }
  // Pembelian pengganti (koreksi nominal) dijurnal lewat jalur yang sama dengan pembelian kasir;
  // kalau gagal di sini, sinkron Akuntansi otomatis mencoba lagi (fact belum POSTED).
  if (operational.replacementId) {
    try { await dispatchPosAccountingFact(db, store, { factType: 'PURCHASE', factId: operational.replacementId }); }
    catch (error) { console.warn('jurnal pembelian pengganti gagal', operational.replacementId, error?.message); }
  }
  return {
    ok: true,
    duplicate: Boolean(operational.duplicate),
    accounting,
    hppMenunggu: Boolean(operational.hppMenunggu),
    replacementId: operational.replacementId || null,
    replacementTotal: operational.replacementTotal ?? null,
    itemNames: operational.itemNames || []
  };
}
