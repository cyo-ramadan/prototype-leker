export function saleHppSnapshotSelect() {
  return 'p.average_cost, p.average_cost * ?';
}

export function buildProductionCostingStatements(db, {
  runId, storeId, outputProductId, outputQuantity, now
}) {
  return [
    db.prepare(`
      UPDATE production_runs
      SET hpp_total_scaled = COALESCE((
            SELECT SUM(total_cost_snapshot_scaled)
            FROM production_run_components
            WHERE production_run_id = ?
          ), 0),
          hpp_per_unit_scaled = CAST((
            COALESCE((
              SELECT SUM(total_cost_snapshot_scaled)
              FROM production_run_components
              WHERE production_run_id = ?
            ), 0) + CAST(total_output_quantity / 2 AS INTEGER)
          ) / total_output_quantity AS INTEGER)
      WHERE id = ? AND store_id = ?
    `).bind(runId, runId, runId, storeId),
    db.prepare(`
      INSERT INTO product_average_cost_history (
        id, store_id, product_id, previous_average_cost_scaled, new_average_cost_scaled,
        change_reason, reference_type, reference_id, created_at
      )
      SELECT ?, p.store_id, p.id, p.average_cost,
             CASE
               WHEN COALESCE((
                 SELECT quantity FROM inventory_stock_balances
                 WHERE store_id = ? AND product_id = ?
               ), 0) <= 0
                 THEN COALESCE((SELECT hpp_per_unit_scaled FROM production_runs WHERE id = ?), 0)
               ELSE CAST((
                 COALESCE((
                   SELECT quantity FROM inventory_stock_balances
                   WHERE store_id = ? AND product_id = ?
                 ), 0) * p.average_cost
                 + COALESCE((SELECT hpp_total_scaled FROM production_runs WHERE id = ?), 0)
                 + CAST((
                   COALESCE((
                     SELECT quantity FROM inventory_stock_balances
                     WHERE store_id = ? AND product_id = ?
                   ), 0) + ?
                 ) / 2 AS INTEGER)
               ) / (
                 COALESCE((
                   SELECT quantity FROM inventory_stock_balances
                   WHERE store_id = ? AND product_id = ?
                 ), 0) + ?
               ) AS INTEGER)
             END,
             'PRODUCTION', 'PRODUCTION_RUN', ?, ?
      FROM products p
      WHERE p.id = ? AND p.store_id = ?
    `).bind(
      `product_cost_history_${crypto.randomUUID()}`,
      storeId, outputProductId, runId,
      storeId, outputProductId, runId,
      storeId, outputProductId, outputQuantity,
      storeId, outputProductId, outputQuantity,
      runId, now, outputProductId, storeId
    ),
    db.prepare(`
      UPDATE products
      SET average_cost = CASE
            WHEN COALESCE((
              SELECT quantity FROM inventory_stock_balances
              WHERE store_id = ? AND product_id = ?
            ), 0) <= 0
              THEN COALESCE((SELECT hpp_per_unit_scaled FROM production_runs WHERE id = ?), 0)
            ELSE CAST((
              COALESCE((
                SELECT quantity FROM inventory_stock_balances
                WHERE store_id = ? AND product_id = ?
              ), 0) * average_cost
              + COALESCE((SELECT hpp_total_scaled FROM production_runs WHERE id = ?), 0)
              + CAST((
                COALESCE((
                  SELECT quantity FROM inventory_stock_balances
                  WHERE store_id = ? AND product_id = ?
                ), 0) + ?
              ) / 2 AS INTEGER)
            ) / (
              COALESCE((
                SELECT quantity FROM inventory_stock_balances
                WHERE store_id = ? AND product_id = ?
              ), 0) + ?
            ) AS INTEGER)
          END,
          cost_updated_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(
      storeId, outputProductId, runId,
      storeId, outputProductId, runId,
      storeId, outputProductId, outputQuantity,
      storeId, outputProductId, outputQuantity,
      now, outputProductId, storeId
    )
  ];
}
