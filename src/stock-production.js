import { buildProductionCostingStatements } from './manufacture-costing.js';

const placeholders = count => Array.from({ length: count }, () => '?').join(', ');

function movementStatement(db, {
  sourceKey, storeId, productId, productName, unitId, unitSymbol,
  direction, quantity, sourceType, sourceId, drawerId, note, actorRole, actorId, now
}) {
  return db.prepare(`
    INSERT INTO stock_movements (
      id, source_key, store_id, product_id, product_name, unit_id, unit_symbol,
      direction, quantity, source_type, source_id, drawer_session_id, note,
      actor_role, actor_id, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    `stock_move_${crypto.randomUUID()}`, sourceKey, storeId, productId, productName, unitId, unitSymbol,
    direction, quantity, sourceType, sourceId, drawerId, note, actorRole, actorId, now
  );
}

function stockDeltaStatements(db, product, delta, context) {
  const quantity = Math.abs(delta);
  if (!product.trackStock || !quantity) return [];
  const direction = delta < 0 ? 'OUT' : 'IN';
  return [
    db.prepare(`
      INSERT OR IGNORE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at)
      VALUES (?, ?, 0, ?)
    `).bind(context.storeId, product.id, context.now),
    db.prepare(`
      UPDATE inventory_stock_balances
      SET quantity = quantity + ?, updated_at = ?
      WHERE store_id = ? AND product_id = ?
    `).bind(delta, context.now, context.storeId, product.id),
    movementStatement(db, {
      sourceKey: context.sourceKey,
      storeId: context.storeId,
      productId: product.id,
      productName: product.name,
      unitId: product.unitId,
      unitSymbol: product.unitSymbol,
      direction,
      quantity,
      sourceType: context.sourceType,
      sourceId: context.sourceId,
      drawerId: context.drawerId,
      note: context.note || '',
      actorRole: context.actorRole,
      actorId: context.actorId,
      now: context.now
    })
  ];
}

async function loadSaleProducts(db, storeId, productIds) {
  const rows = await db.prepare(`
    SELECT p.id, p.name, p.base_unit_id, p.points_per_unit,
           p.production_mode, p.linked_recipe_id, p.stock_tracking_enabled,
           u.symbol AS unit_symbol,
           COALESCE(t.track_stock, 1) AS type_track_stock,
           COALESCE(t.can_produce, 1) AS can_produce,
           r.id AS recipe_id, r.revision AS recipe_revision, r.output_quantity AS recipe_output_quantity
    FROM products p
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    LEFT JOIN manufacturing_recipes r
      ON r.id = p.linked_recipe_id
     AND r.store_id = p.store_id
     AND r.output_product_id = p.id
     AND r.status = 'ACTIVE'
    WHERE p.store_id = ? AND p.id IN (${placeholders(productIds.length)})
  `).bind(storeId, ...productIds).all();
  return new Map((rows.results ?? []).map(row => [Number(row.id), {
    id: Number(row.id),
    name: row.name,
    unitId: row.base_unit_id,
    unitSymbol: row.unit_symbol || '',
    pointsPerUnit: Number(row.points_per_unit || 0),
    productionMode: row.production_mode || 'STOCK',
    recipeLinkEnabled: Boolean(row.linked_recipe_id),
    stockTrackingEnabled: Boolean(row.stock_tracking_enabled),
    trackStock: Boolean(row.stock_tracking_enabled) && Boolean(row.type_track_stock),
    canProduce: Boolean(row.can_produce),
    recipe: row.recipe_id ? {
      id: row.recipe_id,
      revision: Number(row.recipe_revision || 0),
      outputQuantity: Number(row.recipe_output_quantity || 0)
    } : null
  }]));
}

async function loadRecipeComponents(db, storeId, recipeIds) {
  if (!recipeIds.length) return new Map();
  const rows = await db.prepare(`
    SELECT c.recipe_id, c.component_product_id, c.quantity,
           p.name AS component_product_name, p.base_unit_id,
           p.stock_tracking_enabled, u.symbol AS unit_symbol,
           COALESCE(t.track_stock, 1) AS type_track_stock
    FROM manufacturing_recipe_components c
    JOIN products p ON p.id = c.component_product_id AND p.store_id = c.store_id
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    WHERE c.store_id = ? AND c.recipe_id IN (${placeholders(recipeIds.length)})
    ORDER BY c.recipe_id, c.display_order, c.component_product_id
  `).bind(storeId, ...recipeIds).all();
  const grouped = new Map(recipeIds.map(id => [id, []]));
  for (const row of rows.results ?? []) {
    grouped.get(row.recipe_id)?.push({
      id: Number(row.component_product_id),
      name: row.component_product_name,
      unitId: row.base_unit_id,
      unitSymbol: row.unit_symbol || '',
      quantityPerBatch: Number(row.quantity || 0),
      trackStock: Boolean(row.stock_tracking_enabled) && Boolean(row.type_track_stock)
    });
  }
  return grouped;
}

function productionRunStatements(db, {
  runId, storeId, drawerId, saleId, mode, product, recipe, batches,
  requestedSaleQuantity, components, actorRole, actorId, now, notePrefix
}) {
  const totalOutputQuantity = batches * recipe.outputQuantity;
  const statements = [
    db.prepare(`
      INSERT INTO production_runs (
        id, store_id, drawer_session_id, sale_id, mode,
        output_product_id, output_product_name, output_unit_id, output_unit_symbol,
        recipe_id, recipe_revision, batches, output_quantity_per_batch, total_output_quantity,
        requested_sale_quantity, hpp_total, hpp_per_unit, hpp_total_scaled, hpp_per_unit_scaled, status,
        created_by_role, created_by_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 'POSTED', ?, ?, ?)
    `).bind(
      runId, storeId, drawerId, saleId, mode,
      product.id, product.name, product.unitId, product.unitSymbol,
      recipe.id, recipe.revision, batches, recipe.outputQuantity, totalOutputQuantity,
      requestedSaleQuantity, actorRole, actorId, now
    )
  ];

  for (const component of components) {
    const totalQuantity = component.quantityPerBatch * batches;
    statements.push(db.prepare(`
      INSERT INTO production_run_components (
        id, production_run_id, store_id, component_product_id, component_product_name,
        component_unit_id, component_unit_symbol, quantity_per_batch, total_quantity,
        unit_cost_snapshot, total_cost_snapshot,
        unit_cost_snapshot_scaled, total_cost_snapshot_scaled
      )
      SELECT ?, ?, ?, p.id, p.name, ?, ?, ?, ?, NULL, NULL, p.average_cost, p.average_cost * ?
      FROM products p
      WHERE p.id = ? AND p.store_id = ?
    `).bind(
      `production_component_${crypto.randomUUID()}`, runId, storeId,
      component.unitId, component.unitSymbol, component.quantityPerBatch, totalQuantity,
      totalQuantity, component.id, storeId
    ));
    statements.push(...stockDeltaStatements(db, component, -totalQuantity, {
      sourceKey: `PRODUCTION_INPUT:${runId}:${component.id}`,
      sourceType: 'PRODUCTION_INPUT', sourceId: runId,
      storeId, drawerId, actorRole, actorId, now,
      note: `${notePrefix} · komponen ${product.name}`
    }));
  }

  statements.push(...buildProductionCostingStatements(db, {
    runId,
    storeId,
    outputProductId: product.id,
    outputQuantity: totalOutputQuantity,
    now
  }));

  statements.push(...stockDeltaStatements(db, product, totalOutputQuantity, {
    sourceKey: `PRODUCTION_OUTPUT:${runId}:${product.id}`,
    sourceType: 'PRODUCTION_OUTPUT', sourceId: runId,
    storeId, drawerId, actorRole, actorId, now,
    note: `${notePrefix} · hasil ${product.name}`
  }));
  return { statements, totalOutputQuantity };
}

function validateTrackedProduction(product, components) {
  if (!product.trackStock) {
    return { ok: false, status: 409, error: `${product.name} wajib mengaktifkan Track & enforce stok sebelum diproduksi.` };
  }
  const untracked = components.find(component => !component.trackStock);
  if (untracked) {
    return { ok: false, status: 409, error: `Komponen ${untracked.name} belum mengaktifkan Track & enforce stok.` };
  }
  return { ok: true };
}

export async function prepareSaleStockProduction(db, {
  storeId, drawerId, cashierId, saleId, lines, now
}) {
  const ids = [...new Set(lines.map(line => Number(line.productId)))];
  const products = await loadSaleProducts(db, storeId, ids);
  if (products.size !== ids.length) return { ok: false, status: 400, error: 'Policy stok barang penjualan tidak lengkap.' };

  const recipeIds = [];
  for (const line of lines) {
    const product = products.get(Number(line.productId));
    if (product.productionMode === 'DADAKAN') {
      if (!product.recipeLinkEnabled || !product.recipe || product.recipe.outputQuantity < 1) {
        return { ok: false, status: 409, error: `${product.name} mode DADAKAN tetapi belum terhubung ke resep aktif.` };
      }
      if (!product.trackStock) {
        return { ok: false, status: 409, error: `${product.name} mode DADAKAN wajib mengaktifkan Track & enforce stok.` };
      }
      recipeIds.push(product.recipe.id);
    }
  }
  const componentsByRecipe = await loadRecipeComponents(db, storeId, [...new Set(recipeIds)]);
  const statements = [];
  const enrichedLines = [];
  let totalPoints = 0;

  for (const line of lines) {
    const product = products.get(Number(line.productId));
    const linePoints = product.pointsPerUnit * Number(line.quantity);
    totalPoints += linePoints;
    const enriched = {
      ...line,
      pointsPerUnit: product.pointsPerUnit,
      linePoints,
      recipeId: null,
      productionRunId: null
    };

    if (product.productionMode === 'DADAKAN') {
      const recipe = product.recipe;
      const components = componentsByRecipe.get(recipe.id) || [];
      if (!components.length) return { ok: false, status: 409, error: `Resep ${product.name} tidak memiliki komponen.` };
      const tracking = validateTrackedProduction(product, components);
      if (!tracking.ok) return tracking;
      const batches = Math.ceil(Number(line.quantity) / recipe.outputQuantity);
      const runId = `production_${crypto.randomUUID()}`;
      enriched.recipeId = recipe.id;
      enriched.productionRunId = runId;
      const run = productionRunStatements(db, {
        runId, storeId, drawerId, saleId, mode: 'AUTO_DADAKAN', product, recipe, batches,
        requestedSaleQuantity: Number(line.quantity), components,
        actorRole: 'CASHIER', actorId: cashierId, now, notePrefix: 'Auto produksi dadakan'
      });
      statements.push(...run.statements);
    }

    statements.push(...stockDeltaStatements(db, product, -Number(line.quantity), {
      sourceKey: `SALE:${saleId}:${product.id}`,
      sourceType: 'SALE', sourceId: saleId,
      storeId, drawerId, actorRole: 'CASHIER', actorId: cashierId, now,
      note: product.productionMode === 'DADAKAN' ? 'Penjualan setelah auto-produksi dadakan' : 'Penjualan stok'
    }));
    enrichedLines.push(enriched);
  }

  return { ok: true, lines: enrichedLines, totalPoints, statements };
}

export async function prepareManualProduction(db, {
  storeId, drawerId, cashierId, outputProductId, batches, now
}) {
  const productId = Number(outputProductId);
  const batchCount = Number(batches);
  if (!Number.isInteger(productId) || !Number.isInteger(batchCount) || batchCount < 1 || batchCount > 10_000) {
    return { ok: false, status: 400, error: 'Barang hasil dan jumlah batch wajib bilangan bulat positif.' };
  }
  const products = await loadSaleProducts(db, storeId, [productId]);
  const product = products.get(productId);
  if (!product || !product.canProduce || !product.recipe || product.recipe.outputQuantity < 1) {
    return { ok: false, status: 409, error: 'Barang belum memiliki Recipe Linked aktif atau tipenya tidak mengizinkan produksi.' };
  }
  const componentsByRecipe = await loadRecipeComponents(db, storeId, [product.recipe.id]);
  const components = componentsByRecipe.get(product.recipe.id) || [];
  if (!components.length) return { ok: false, status: 409, error: 'Recipe Linked tidak memiliki komponen.' };
  const tracking = validateTrackedProduction(product, components);
  if (!tracking.ok) return tracking;
  const runId = `production_${crypto.randomUUID()}`;
  const run = productionRunStatements(db, {
    runId, storeId, drawerId, saleId: null, mode: 'MANUAL', product, recipe: product.recipe,
    batches: batchCount, requestedSaleQuantity: null, components,
    actorRole: 'CASHIER', actorId: cashierId, now, notePrefix: 'Produksi manual'
  });
  return {
    ok: true,
    run: {
      id: runId,
      outputProductId: product.id,
      outputProductName: product.name,
      recipeId: product.recipe.id,
      recipeRevision: product.recipe.revision,
      batches: batchCount,
      outputQuantityPerBatch: product.recipe.outputQuantity,
      totalOutputQuantity: run.totalOutputQuantity,
      unitSymbol: product.unitSymbol,
      components: components.map(component => ({
        productId: component.id,
        productName: component.name,
        quantityPerBatch: component.quantityPerBatch,
        totalQuantity: component.quantityPerBatch * batchCount,
        unitSymbol: component.unitSymbol
      }))
    },
    statements: run.statements
  };
}

export async function listManualProductionOptions(db, storeId) {
  const rows = await db.prepare(`
    SELECT p.id, p.name, u.symbol AS unit_symbol,
           r.id AS recipe_id, r.revision, r.output_quantity
    FROM products p
    JOIN manufacturing_recipes r
      ON r.id = p.linked_recipe_id
     AND r.store_id = p.store_id
     AND r.output_product_id = p.id
     AND r.status = 'ACTIVE'
    LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    WHERE p.store_id = ? AND p.is_active = 1
      AND p.stock_tracking_enabled = 1
      AND COALESCE(t.track_stock, 1) = 1
      AND COALESCE(t.can_produce, 1) = 1
    ORDER BY p.name COLLATE NOCASE
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    productId: Number(row.id),
    productName: row.name,
    unitSymbol: row.unit_symbol || '',
    recipeId: row.recipe_id,
    recipeRevision: Number(row.revision),
    outputQuantityPerBatch: Number(row.output_quantity)
  }));
}

export function stockPostingFailure(error) {
  const message = String(error?.message ?? error).toLowerCase();
  if (message.includes('check constraint')) {
    return { status: 409, error: 'Stok tidak cukup. Cek panel Stok Barang atau lakukan produksi/penyesuaian terlebih dahulu.' };
  }
  if (message.includes('stock_movement_scope_mismatch')) {
    return { status: 409, error: 'Satuan stok barang berubah dan tidak cocok dengan snapshot transaksi.' };
  }
  return null;
}
