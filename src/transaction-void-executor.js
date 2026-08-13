import { reversePostedPosAccountingFact } from './accounting-pos-reversal.js';

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);

function hold(code, detail) {
  return { ok: false, status: 'HOLD', code, detail };
}

function fail(code, detail) {
  return { ok: false, status: 'FAILED', code, detail };
}

async function salePlan(db, storeId, saleId) {
  const sale = await db.prepare(`
    SELECT id, customer_id, total_points, created_at, voided_at
    FROM sales
    WHERE id = ? AND store_id = ?
    LIMIT 1
  `).bind(saleId, storeId).first();
  if (!sale) return fail('SALE_NOT_FOUND', 'Penjualan sumber tidak ditemukan.');
  if (sale.voided_at) return { ok: true, duplicate: true, statements: [], detail: 'Penjualan sudah di-soft-delete sebelumnya.' };

  const production = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM sale_items
    WHERE sale_id = ? AND store_id = ? AND production_run_id IS NOT NULL
  `).bind(saleId, storeId).first();
  if (Number(production?.count || 0) > 0) {
    return hold(
      'SALE_AUTO_PRODUCTION_VOID_POLICY_REQUIRED',
      'Penjualan ini mempunyai produksi AUTO_DADAKAN. Perlu keputusan apakah produksi ikut dibatalkan atau hasil produksinya tetap menjadi stok.'
    );
  }

  const movements = await db.prepare(`
    SELECT sm.product_id, sm.product_name, sm.unit_id, sm.unit_symbol, sm.quantity,
           si.line_cogs, si.unit_cost_snapshot
    FROM stock_movements sm
    LEFT JOIN sale_items si
      ON si.sale_id = sm.source_id
     AND si.store_id = sm.store_id
     AND si.product_id = sm.product_id
    WHERE sm.store_id = ?
      AND sm.source_type = 'SALE'
      AND sm.source_id = ?
      AND sm.direction = 'OUT'
    ORDER BY sm.product_id
  `).bind(storeId, saleId).all();

  const statements = [];
  for (const row of movements.results ?? []) {
    const quantity = Number(row.quantity || 0);
    const lineCogs = row.line_cogs == null ? null : Number(row.line_cogs);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(lineCogs) || lineCogs < 0) {
      return hold('SALE_COST_SNAPSHOT_REQUIRED', `Snapshot HPP penjualan ${row.product_name || row.product_id} tidak cukup untuk reversal stok yang deterministic.`);
    }

    statements.push(
      db.prepare(`
        INSERT OR IGNORE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
        VALUES (?, ?, 0, ?)
      `),
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
            cost_updated_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND store_id = ?
      `),
      db.prepare(`
        UPDATE inventory_stock_balances
        SET quantity = quantity + ?, updated_at = ?
        WHERE store_id = ? AND product_id = ?
      `),
      db.prepare(`
        INSERT INTO stock_movements (
          id, source_key, store_id, product_id, product_name, unit_id, unit_symbol,
          direction, quantity, source_type, source_id, drawer_session_id, note,
          actor_role, actor_id, occurred_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, 'IN', ?, 'SALE_VOID', ?, drawer_session_id, ?, ?, ?, ?
        FROM sales WHERE id = ? AND store_id = ?
      `)
    );

    const base = statements.length - 4;
    statements[base] = statements[base].bind(storeId, row.product_id, '__NOW__');
    statements[base + 1] = statements[base + 1].bind(
      storeId, row.product_id, lineCogs, quantity, quantity,
      storeId, row.product_id, lineCogs,
      storeId, row.product_id, quantity,
      storeId, row.product_id, quantity,
      '__NOW__', row.product_id, storeId
    );
    statements[base + 2] = statements[base + 2].bind(quantity, '__NOW__', storeId, row.product_id);
    statements[base + 3] = statements[base + 3].bind(
      `stock_move_${crypto.randomUUID()}`,
      `SALE_VOID:${saleId}:${row.product_id}`,
      storeId,
      row.product_id,
      row.product_name,
      row.unit_id,
      row.unit_symbol,
      quantity,
      saleId,
      'Soft-delete penjualan · stok dikembalikan memakai snapshot HPP original',
      '__ROLE__', '__ACTOR__', '__NOW__',
      saleId, storeId
    );
  }

  return {
    ok: true,
    statements,
    customerId: sale.customer_id || null,
    totalPoints: Number(sale.total_points || 0),
    createdAt: sale.created_at
  };
}

async function previousPurchaseCost(db, storeId, productId, createdAt, purchaseId) {
  return db.prepare(`
    SELECT pi.unit_cost, pi.created_at
    FROM purchase_items pi
    WHERE pi.store_id = ? AND pi.product_id = ?
      AND pi.purchase_id <> ?
      AND pi.created_at < ?
      AND NOT EXISTS (
        SELECT 1 FROM purchases p
        WHERE p.id = pi.purchase_id AND p.store_id = pi.store_id AND p.voided_at IS NOT NULL
      )
    ORDER BY pi.created_at DESC, pi.id DESC
    LIMIT 1
  `).bind(storeId, productId, purchaseId, createdAt).first();
}

async function purchasePlan(db, storeId, purchaseId) {
  const purchase = await db.prepare(`
    SELECT id, created_at, voided_at
    FROM purchases
    WHERE id = ? AND store_id = ?
    LIMIT 1
  `).bind(purchaseId, storeId).first();
  if (!purchase) return fail('PURCHASE_NOT_FOUND', 'Pembelian sumber tidak ditemukan.');
  if (purchase.voided_at) return { ok: true, duplicate: true, statements: [], detail: 'Pembelian sudah di-soft-delete sebelumnya.' };

  const items = await db.prepare(`
    SELECT id, product_id, product_name, unit_id, unit_symbol, quantity,
           average_cost_before, average_cost_after, created_at
    FROM purchase_items
    WHERE purchase_id = ? AND store_id = ?
    ORDER BY product_id
  `).bind(purchaseId, storeId).all();
  if (!(items.results ?? []).length) return hold('PURCHASE_ITEMS_REQUIRED', 'Pembelian tidak mempunyai snapshot itemized untuk reversal stok/HPP.');

  const plans = [];
  for (const item of items.results ?? []) {
    const downstream = await db.prepare(`
      SELECT source_type, source_id, occurred_at
      FROM stock_movements
      WHERE store_id = ? AND product_id = ?
        AND NOT (source_type = 'PURCHASE' AND source_id = ?)
        AND occurred_at >= ?
      ORDER BY occurred_at, id
      LIMIT 1
    `).bind(storeId, item.product_id, purchaseId, purchase.created_at).first();
    if (downstream) {
      return hold(
        'PURCHASE_DOWNSTREAM_STOCK_EXISTS',
        `Pembelian ${item.product_name} sudah diikuti mutasi stok ${downstream.source_type}. Reversal HPP ditahan agar history downstream tidak direkonstruksi spekulatif.`
      );
    }

    const state = await db.prepare(`
      SELECT COALESCE(b.quantity, 0) AS quantity, p.average_cost
      FROM products p
      LEFT JOIN inventory_stock_balances b ON b.store_id = p.store_id AND b.product_id = p.id
      WHERE p.id = ? AND p.store_id = ?
      LIMIT 1
    `).bind(item.product_id, storeId).first();
    const quantity = Number(item.quantity || 0);
    if (!state || Number(state.quantity || 0) < quantity) {
      return hold('PURCHASE_STOCK_NOT_REVERSIBLE', `Stok ${item.product_name} sudah lebih kecil dari qty pembelian yang akan dibalik.`);
    }
    if (Number(state.average_cost || 0) !== Number(item.average_cost_after || 0)) {
      return hold('PURCHASE_COST_STATE_CHANGED', `Average Cost ${item.product_name} sudah berubah dari snapshot setelah pembelian.`);
    }
    const previous = await previousPurchaseCost(db, storeId, item.product_id, purchase.created_at, purchaseId);
    plans.push({ item, previous });
  }

  return { ok: true, plans, createdAt: purchase.created_at };
}

function bindSaleStatements(plan, { db, storeId, saleId, permitId, actorRole, actorId, now }) {
  const bound = [];
  for (const statement of plan.statements || []) {
    // Statements were prepared with sentinel bindings because D1 prepared statements cannot be cloned.
    // Rebuild from their SQL is not exposed, so sale statements are constructed again below instead.
    void statement;
  }

  return Promise.resolve().then(async () => {
    const movements = await db.prepare(`
      SELECT sm.product_id, sm.product_name, sm.unit_id, sm.unit_symbol, sm.quantity,
             si.line_cogs
      FROM stock_movements sm
      LEFT JOIN sale_items si
        ON si.sale_id = sm.source_id AND si.store_id = sm.store_id AND si.product_id = sm.product_id
      WHERE sm.store_id = ? AND sm.source_type = 'SALE' AND sm.source_id = ? AND sm.direction = 'OUT'
      ORDER BY sm.product_id
    `).bind(storeId, saleId).all();
    for (const row of movements.results ?? []) {
      const quantity = Number(row.quantity);
      const lineCogs = Number(row.line_cogs);
      bound.push(
        db.prepare(`INSERT OR IGNORE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, 0, ?)`).bind(storeId, row.product_id, now),
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
              cost_updated_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND store_id = ?
        `).bind(
          storeId, row.product_id, lineCogs, quantity, quantity,
          storeId, row.product_id, lineCogs,
          storeId, row.product_id, quantity,
          storeId, row.product_id, quantity,
          now, row.product_id, storeId
        ),
        db.prepare(`UPDATE inventory_stock_balances SET quantity = quantity + ?, updated_at = ? WHERE store_id = ? AND product_id = ?`).bind(quantity, now, storeId, row.product_id),
        db.prepare(`
          INSERT INTO stock_movements (
            id, source_key, store_id, product_id, product_name, unit_id, unit_symbol,
            direction, quantity, source_type, source_id, drawer_session_id, note,
            actor_role, actor_id, occurred_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, 'IN', ?, 'SALE_VOID', ?, drawer_session_id, ?, ?, ?, ?
          FROM sales WHERE id = ? AND store_id = ?
        `).bind(
          `stock_move_${crypto.randomUUID()}`,
          `SALE_VOID:${saleId}:${row.product_id}`,
          storeId, row.product_id, row.product_name, row.unit_id, row.unit_symbol,
          quantity, saleId,
          `Permit ${permitId} · soft-delete penjualan`, actorRole, actorId, now,
          saleId, storeId
        )
      );
    }
    return bound;
  });
}

async function executeSale(db, storeId, permit, actor, now) {
  const plan = await salePlan(db, storeId, permit.subjectId);
  if (!plan.ok || plan.duplicate) return plan;
  const statements = await bindSaleStatements(plan, {
    db, storeId, saleId: permit.subjectId, permitId: permit.id,
    actorRole: actor.role, actorId: actor.id, now
  });
  if (plan.customerId && plan.totalPoints > 0) {
    statements.push(db.prepare(`
      INSERT INTO customer_point_ledger (
        id, customer_id, share_group_id, source_store_id, points_delta,
        activity_type, reference_type, reference_id, notes, created_at
      )
      SELECT ?, ?, share_group_id, ?, ?, 'ADJUSTMENT', 'SALE_VOID', ?, ?, ?
      FROM customer_point_ledger
      WHERE customer_id = ? AND reference_type = 'SALE' AND reference_id = ? AND activity_type = 'EARN'
      ORDER BY created_at LIMIT 1
    `).bind(
      `point_void_${permit.id}`, plan.customerId, storeId, -plan.totalPoints,
      permit.id, `Pembalik poin sale ${permit.subjectId}`, now,
      plan.customerId, permit.subjectId
    ));
  }
  statements.push(db.prepare(`
    UPDATE sales
    SET voided_at = ?, voided_by_role = ?, voided_by_id = ?, void_reason = ?, void_permit_id = ?
    WHERE id = ? AND store_id = ? AND voided_at IS NULL
  `).bind(now, actor.role, actor.id, text(permit.reason, 500), permit.id, permit.subjectId, storeId));
  try {
    await db.batch(statements);
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) return fail('SALE_VOID_ALREADY_EXECUTED', 'Reversal stok penjualan sudah pernah dieksekusi.');
    throw error;
  }
  return { ok: true, operationalStatus: 'EXECUTED' };
}

async function executePurchase(db, storeId, permit, actor, now) {
  const plan = await purchasePlan(db, storeId, permit.subjectId);
  if (!plan.ok || plan.duplicate) return plan;
  const statements = [];
  for (const { item, previous } of plan.plans) {
    const previousUnitCost = Number(previous?.unit_cost || 0);
    const purchasePriceCompat = Math.floor((previousUnitCost + 500000) / 1000000);
    statements.push(
      db.prepare(`
        UPDATE inventory_stock_balances
        SET quantity = quantity - ?, updated_at = ?
        WHERE store_id = ? AND product_id = ? AND quantity >= ?
      `).bind(item.quantity, now, storeId, item.product_id, item.quantity),
      db.prepare(`
        UPDATE products
        SET average_cost = ?,
            last_purchase_price = ?,
            purchase_price = ?,
            last_purchase_at = ?,
            cost_updated_at = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND store_id = ? AND average_cost = ?
      `).bind(
        item.average_cost_before,
        previousUnitCost,
        purchasePriceCompat,
        previous?.created_at || null,
        now,
        item.product_id, storeId, item.average_cost_after
      ),
      db.prepare(`
        INSERT INTO stock_movements (
          id, source_key, store_id, product_id, product_name, unit_id, unit_symbol,
          direction, quantity, source_type, source_id, drawer_session_id, note,
          actor_role, actor_id, occurred_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, 'OUT', ?, 'PURCHASE_VOID', ?, drawer_session_id, ?, ?, ?, ?
        FROM purchases WHERE id = ? AND store_id = ?
      `).bind(
        `stock_move_${crypto.randomUUID()}`,
        `PURCHASE_VOID:${permit.subjectId}:${item.product_id}`,
        storeId, item.product_id, item.product_name, item.unit_id, item.unit_symbol,
        item.quantity, permit.subjectId,
        `Permit ${permit.id} · soft-delete pembelian`, actor.role, actor.id, now,
        permit.subjectId, storeId
      )
    );
  }
  statements.push(db.prepare(`
    UPDATE purchases
    SET voided_at = ?, voided_by_role = ?, voided_by_id = ?, void_reason = ?, void_permit_id = ?
    WHERE id = ? AND store_id = ? AND voided_at IS NULL
  `).bind(now, actor.role, actor.id, text(permit.reason, 500), permit.id, permit.subjectId, storeId));
  try {
    await db.batch(statements);
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('CHECK constraint')) return hold('PURCHASE_STOCK_CHANGED_DURING_ACC', 'Stok berubah saat ACC. Refresh dan periksa transaksi downstream sebelum mencoba lagi.');
    if (message.includes('UNIQUE')) return fail('PURCHASE_VOID_ALREADY_EXECUTED', 'Reversal stok pembelian sudah pernah dieksekusi.');
    throw error;
  }
  return { ok: true, operationalStatus: 'EXECUTED' };
}

async function executeExpense(db, storeId, permit, actor, now) {
  const expense = await db.prepare(`SELECT id, voided_at FROM expenses WHERE id = ? AND store_id = ? LIMIT 1`).bind(permit.subjectId, storeId).first();
  if (!expense) return fail('EXPENSE_NOT_FOUND', 'Pengeluaran Operasional sumber tidak ditemukan.');
  if (expense.voided_at) return { ok: true, duplicate: true, operationalStatus: 'EXECUTED' };
  const result = await db.prepare(`
    UPDATE expenses
    SET voided_at = ?, voided_by_role = ?, voided_by_id = ?, void_reason = ?, void_permit_id = ?
    WHERE id = ? AND store_id = ? AND voided_at IS NULL
  `).bind(now, actor.role, actor.id, text(permit.reason, 500), permit.id, permit.subjectId, storeId).run();
  if (!result.success || Number(result.meta?.changes ?? 0) !== 1) return fail('EXPENSE_VOID_CONFLICT', 'Pengeluaran berubah saat proses ACC.');
  return { ok: true, operationalStatus: 'EXECUTED' };
}

export async function executeTransactionVoid(db, store, permit, actor, now = new Date().toISOString()) {
  let operational;
  if (permit.subjectType === 'SALE') operational = await executeSale(db, store.id, permit, actor, now);
  else if (permit.subjectType === 'PURCHASE') operational = await executePurchase(db, store.id, permit, actor, now);
  else if (permit.subjectType === 'EXPENSE') operational = await executeExpense(db, store.id, permit, actor, now);
  else return fail('VOID_SUBJECT_UNSUPPORTED', 'Jenis transaksi belum mendukung soft-delete.');

  if (!operational.ok) return operational;

  const accounting = await reversePostedPosAccountingFact(db, store, {
    factType: permit.subjectType,
    factId: permit.subjectId,
    permitId: permit.id,
    occurredAt: now,
    reason: permit.reason
  });

  return {
    ok: true,
    duplicate: Boolean(operational.duplicate),
    operationalStatus: 'EXECUTED',
    accounting
  };
}
