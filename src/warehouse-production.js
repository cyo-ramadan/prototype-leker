import { buildProductionCostingStatements } from './manufacture-costing.js';

const placeholders = count => Array.from({ length: count }, () => '?').join(', ');
const MAX_COMPONENTS = 50;
const MAX_QUANTITY = 1_000_000_000;

function positiveInteger(value, max = MAX_QUANTITY) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= max ? number : null;
}

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

async function activeOutputProduct(db, storeId, outputProductId, recipeId = '') {
  const requestedRecipeId = String(recipeId || '').trim();
  return db.prepare(`
    SELECT p.id, p.name, p.base_unit_id, p.product_kind_id, p.average_cost,
           u.symbol AS unit_symbol,
           COALESCE(k.code, '') AS product_kind_code,
           COALESCE(k.name, '') AS product_kind_name,
           r.id AS recipe_id, r.revision AS recipe_revision, r.output_quantity AS recipe_output_quantity
    FROM products p
    JOIN manufacturing_recipes r
      ON r.store_id = p.store_id
     AND r.output_product_id = p.id
     AND r.status = 'ACTIVE'
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    LEFT JOIN product_kinds k ON k.id = p.product_kind_id AND k.store_id = p.store_id
    WHERE p.store_id = ? AND p.id = ? AND p.is_active = 1
      AND p.stock_tracking_enabled = 1
      AND COALESCE(t.track_stock, 1) = 1
      AND COALESCE(t.can_produce, 1) = 1
      AND (? = '' OR r.id = ?)
    ORDER BY r.revision DESC
    LIMIT 1
  `).bind(storeId, outputProductId, requestedRecipeId, requestedRecipeId).first();
}

async function recipeTemplateComponents(db, storeId, recipeId) {
  const rows = await db.prepare(`
    SELECT c.component_product_id, c.quantity,
           p.name, p.base_unit_id, p.product_kind_id, p.stock_tracking_enabled,
           p.average_cost, u.symbol AS unit_symbol,
           COALESCE(k.code, '') AS product_kind_code,
           COALESCE(k.name, '') AS product_kind_name,
           COALESCE(t.track_stock, 1) AS type_track_stock,
           COALESCE(t.can_consume, 1) AS can_consume
    FROM manufacturing_recipe_components c
    JOIN products p ON p.id = c.component_product_id AND p.store_id = c.store_id
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    LEFT JOIN product_kinds k ON k.id = p.product_kind_id AND k.store_id = p.store_id
    WHERE c.store_id = ? AND c.recipe_id = ?
    ORDER BY c.display_order, c.component_product_id
  `).bind(storeId, recipeId).all();
  return (rows.results ?? []).map(row => ({
    id: Number(row.component_product_id),
    name: row.name,
    unitId: row.base_unit_id,
    unitSymbol: row.unit_symbol || '',
    productKindId: row.product_kind_id || null,
    productKindCode: row.product_kind_code || '',
    productKindName: row.product_kind_name || '',
    averageCost: Number(row.average_cost || 0),
    quantity: Number(row.quantity || 0),
    trackStock: Boolean(row.stock_tracking_enabled) && Boolean(row.type_track_stock),
    canConsume: Boolean(row.can_consume)
  }));
}

async function materialProducts(db, storeId, productIds) {
  if (!productIds.length) return new Map();
  const rows = await db.prepare(`
    SELECT p.id, p.name, p.base_unit_id, p.product_kind_id, p.average_cost,
           u.symbol AS unit_symbol,
           COALESCE(k.code, '') AS product_kind_code,
           COALESCE(k.name, '') AS product_kind_name,
           p.stock_tracking_enabled,
           COALESCE(t.track_stock, 1) AS type_track_stock,
           COALESCE(t.can_consume, 1) AS can_consume
    FROM products p
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    LEFT JOIN product_kinds k ON k.id = p.product_kind_id AND k.store_id = p.store_id
    WHERE p.store_id = ? AND p.id IN (${placeholders(productIds.length)}) AND p.is_active = 1
  `).bind(storeId, ...productIds).all();
  return new Map((rows.results ?? []).map(row => [Number(row.id), {
    id: Number(row.id),
    name: row.name,
    unitId: row.base_unit_id,
    unitSymbol: row.unit_symbol || '',
    productKindId: row.product_kind_id || null,
    productKindCode: row.product_kind_code || '',
    productKindName: row.product_kind_name || '',
    averageCost: Number(row.average_cost || 0),
    trackStock: Boolean(row.stock_tracking_enabled) && Boolean(row.type_track_stock),
    canConsume: Boolean(row.can_consume)
  }]));
}

function normalizeExplicitComponents(requested, outputProductId) {
  if (!Array.isArray(requested) || !requested.length || requested.length > MAX_COMPONENTS) {
    return { ok: false, error: `Produksi wajib memiliki 1–${MAX_COMPONENTS} bahan baku.` };
  }
  const seen = new Set();
  const components = [];
  for (const raw of requested) {
    const productId = Number(raw?.productId);
    const quantity = positiveInteger(raw?.quantity);
    if (!Number.isInteger(productId) || !quantity || productId === outputProductId || seen.has(productId)) {
      return { ok: false, error: 'Bahan baku / qty tidak valid, duplikat, atau sama dengan barang hasil.' };
    }
    seen.add(productId);
    components.push({ productId, quantity });
  }
  return { ok: true, components };
}

function templateMatchesActual(recipeOutputQuantity, templateComponents, outputQuantity, actualComponents) {
  if (outputQuantity !== recipeOutputQuantity || templateComponents.length !== actualComponents.length) return false;
  const actual = new Map(actualComponents.map(component => [component.productId, component.quantity]));
  return templateComponents.every(component => actual.get(component.id) === component.quantity);
}

function validateCostRange(components) {
  let total = 0;
  for (const component of components) {
    const cost = Number(component.averageCost || 0);
    const lineCost = cost * component.quantity;
    if (!Number.isSafeInteger(cost) || cost < 0 || !Number.isSafeInteger(lineCost)) return false;
    total += lineCost;
    if (!Number.isSafeInteger(total)) return false;
  }
  return true;
}

export async function prepareManualProductionV2(db, {
  storeId, drawerId, cashierId, outputProductId, recipeId,
  outputQuantity, components: requestedComponents, batches, now
}) {
  const productId = Number(outputProductId);
  if (!Number.isInteger(productId)) return { ok: false, status: 400, error: 'Barang hasil produksi tidak valid.' };

  const output = await activeOutputProduct(db, storeId, productId, recipeId);
  if (!output) return { ok: false, status: 409, error: 'Barang hasil belum memiliki resep aktif atau tidak diizinkan untuk produksi.' };
  const recipe = {
    id: output.recipe_id,
    revision: Number(output.recipe_revision || 0),
    outputQuantity: Number(output.recipe_output_quantity || 0)
  };
  if (!positiveInteger(recipe.outputQuantity)) return { ok: false, status: 409, error: 'Qty hasil pada resep acuan tidak valid.' };

  const templateComponents = await recipeTemplateComponents(db, storeId, recipe.id);
  if (!templateComponents.length) return { ok: false, status: 409, error: 'Resep acuan tidak memiliki bahan baku.' };

  const hasExplicitActual = Array.isArray(requestedComponents) && requestedComponents.length > 0;
  let actualOutputQuantity;
  let actualRequests;
  let storedBatches;

  if (hasExplicitActual || outputQuantity !== undefined) {
    actualOutputQuantity = positiveInteger(outputQuantity);
    if (!actualOutputQuantity) return { ok: false, status: 400, error: 'Qty hasil produksi wajib bilangan bulat positif.' };
    const normalized = normalizeExplicitComponents(requestedComponents, productId);
    if (!normalized.ok) return { ok: false, status: 400, error: normalized.error };
    actualRequests = normalized.components;
    storedBatches = 1;
  } else {
    const legacyBatches = positiveInteger(batches, 10_000);
    if (!legacyBatches) return { ok: false, status: 400, error: 'Jumlah batch wajib bilangan bulat positif.' };
    actualOutputQuantity = recipe.outputQuantity * legacyBatches;
    if (!Number.isSafeInteger(actualOutputQuantity) || actualOutputQuantity > MAX_QUANTITY) {
      return { ok: false, status: 400, error: 'Qty hasil produksi terlalu besar.' };
    }
    actualRequests = templateComponents.map(component => ({
      productId: component.id,
      quantity: component.quantity * legacyBatches
    }));
    if (actualRequests.some(component => !positiveInteger(component.quantity))) {
      return { ok: false, status: 400, error: 'Qty bahan hasil perluasan batch terlalu besar.' };
    }
    storedBatches = legacyBatches;
  }

  const materialMap = await materialProducts(db, storeId, actualRequests.map(component => component.productId));
  if (materialMap.size !== actualRequests.length) return { ok: false, status: 400, error: 'Sebagian bahan baku tidak ditemukan pada gerai aktif.' };
  const actualComponents = actualRequests.map(requested => ({ ...materialMap.get(requested.productId), quantity: requested.quantity }));
  const invalidMaterial = actualComponents.find(component => !component.trackStock || !component.canConsume);
  if (invalidMaterial) {
    return { ok: false, status: 409, error: `${invalidMaterial.name} belum diizinkan sebagai bahan produksi / stock tracking belum aktif.` };
  }
  if (!validateCostRange(actualComponents)) return { ok: false, status: 409, error: 'Nilai HPP bahan produksi melampaui batas integer aman.' };

  const outputProduct = {
    id: Number(output.id),
    name: output.name,
    unitId: output.base_unit_id,
    unitSymbol: output.unit_symbol || '',
    productKindId: output.product_kind_id || null,
    productKindCode: output.product_kind_code || '',
    productKindName: output.product_kind_name || ''
  };
  const templateModified = hasExplicitActual
    ? !templateMatchesActual(recipe.outputQuantity, templateComponents, actualOutputQuantity, actualRequests)
    : false;
  const runId = `production_${crypto.randomUUID()}`;
  const statements = [
    db.prepare(`
      INSERT INTO production_runs (
        id, store_id, drawer_session_id, sale_id, mode,
        output_product_id, output_product_name, output_unit_id, output_unit_symbol,
        recipe_id, recipe_revision, batches, output_quantity_per_batch, total_output_quantity,
        requested_sale_quantity, hpp_total, hpp_per_unit, hpp_total_scaled, hpp_per_unit_scaled, status,
        created_by_role, created_by_id, created_at, template_modified,
        output_product_kind_id, output_product_kind_code, output_product_kind_name
      ) VALUES (?, ?, ?, NULL, 'MANUAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 'POSTED', 'CASHIER', ?, ?, ?, ?, ?, ?)
    `).bind(
      runId, storeId, drawerId,
      outputProduct.id, outputProduct.name, outputProduct.unitId, outputProduct.unitSymbol,
      recipe.id, recipe.revision, storedBatches, recipe.outputQuantity, actualOutputQuantity,
      cashierId, now, templateModified ? 1 : 0,
      outputProduct.productKindId, outputProduct.productKindCode, outputProduct.productKindName
    )
  ];

  for (const component of actualComponents) {
    const quantityPerBatch = storedBatches > 1 ? Math.floor(component.quantity / storedBatches) : component.quantity;
    statements.push(db.prepare(`
      INSERT INTO production_run_components (
        id, production_run_id, store_id, component_product_id, component_product_name,
        component_unit_id, component_unit_symbol, quantity_per_batch, total_quantity,
        unit_cost_snapshot, total_cost_snapshot, unit_cost_snapshot_scaled, total_cost_snapshot_scaled,
        component_product_kind_id, component_product_kind_code, component_product_kind_name
      )
      SELECT ?, ?, p.store_id, p.id, p.name, p.base_unit_id, COALESCE(u.symbol, ''), ?, ?,
             NULL, NULL, p.average_cost, p.average_cost * ?,
             p.product_kind_id, COALESCE(k.code, ''), COALESCE(k.name, '')
      FROM products p
      LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
      LEFT JOIN product_kinds k ON k.id = p.product_kind_id AND k.store_id = p.store_id
      WHERE p.id = ? AND p.store_id = ? AND p.is_active = 1
    `).bind(
      `production_component_${crypto.randomUUID()}`, runId,
      quantityPerBatch, component.quantity, component.quantity, component.id, storeId
    ));
    statements.push(...stockDeltaStatements(db, component, -component.quantity, {
      sourceKey: `PRODUCTION_INPUT:${runId}:${component.id}`,
      sourceType: 'PRODUCTION_INPUT', sourceId: runId,
      storeId, drawerId, actorRole: 'CASHIER', actorId: cashierId, now,
      note: `Produksi manual · bahan ${component.name} → ${outputProduct.name}`
    }));
  }

  statements.push(...buildProductionCostingStatements(db, {
    runId,
    storeId,
    outputProductId: outputProduct.id,
    outputQuantity: actualOutputQuantity,
    now
  }));

  statements.push(...stockDeltaStatements(db, outputProduct, actualOutputQuantity, {
    sourceKey: `PRODUCTION_OUTPUT:${runId}:${outputProduct.id}`,
    sourceType: 'PRODUCTION_OUTPUT', sourceId: runId,
    storeId, drawerId, actorRole: 'CASHIER', actorId: cashierId, now,
    note: `Produksi manual · hasil ${outputProduct.name}`
  }));

  return {
    ok: true,
    run: {
      id: runId,
      outputProductId: outputProduct.id,
      outputProductName: outputProduct.name,
      recipeId: recipe.id,
      recipeRevision: recipe.revision,
      templateModified,
      totalOutputQuantity: actualOutputQuantity,
      unitSymbol: outputProduct.unitSymbol,
      components: actualComponents.map(component => ({
        productId: component.id,
        productName: component.name,
        quantity: component.quantity,
        unitSymbol: component.unitSymbol
      }))
    },
    statements
  };
}

export async function listManualProductionOptionsV2(db, storeId) {
  const outputRows = await db.prepare(`
    SELECT p.id, p.name, u.symbol AS unit_symbol,
           r.id AS recipe_id, r.revision, r.output_quantity
    FROM products p
    JOIN manufacturing_recipes r
      ON r.store_id = p.store_id
     AND r.output_product_id = p.id
     AND r.status = 'ACTIVE'
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    WHERE p.store_id = ? AND p.is_active = 1
      AND p.stock_tracking_enabled = 1
      AND COALESCE(t.track_stock, 1) = 1
      AND COALESCE(t.can_produce, 1) = 1
    ORDER BY p.name COLLATE NOCASE, r.revision DESC
  `).bind(storeId).all();
  const recipeIds = (outputRows.results ?? []).map(row => row.recipe_id);
  const componentRows = recipeIds.length ? await db.prepare(`
    SELECT c.recipe_id, c.component_product_id, c.quantity,
           p.name, u.symbol AS unit_symbol
    FROM manufacturing_recipe_components c
    JOIN products p ON p.id = c.component_product_id AND p.store_id = c.store_id
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    WHERE c.store_id = ? AND c.recipe_id IN (${placeholders(recipeIds.length)})
    ORDER BY c.recipe_id, c.display_order, c.component_product_id
  `).bind(storeId, ...recipeIds).all() : { results: [] };
  const componentsByRecipe = new Map(recipeIds.map(id => [id, []]));
  for (const row of componentRows.results ?? []) {
    componentsByRecipe.get(row.recipe_id)?.push({
      productId: Number(row.component_product_id),
      productName: row.name,
      quantity: Number(row.quantity || 0),
      unitSymbol: row.unit_symbol || ''
    });
  }

  const products = (outputRows.results ?? []).map(row => ({
    productId: Number(row.id),
    productName: row.name,
    unitSymbol: row.unit_symbol || '',
    recipeId: row.recipe_id,
    recipeRevision: Number(row.revision || 0),
    outputQuantityPerBatch: Number(row.output_quantity || 0),
    recipes: [{
      recipeId: row.recipe_id,
      recipeRevision: Number(row.revision || 0),
      outputQuantity: Number(row.output_quantity || 0),
      components: componentsByRecipe.get(row.recipe_id) || []
    }]
  }));

  const materialRows = await db.prepare(`
    SELECT p.id, p.name, u.symbol AS unit_symbol
    FROM products p
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    WHERE p.store_id = ? AND p.is_active = 1
      AND p.stock_tracking_enabled = 1
      AND COALESCE(t.track_stock, 1) = 1
      AND COALESCE(t.can_consume, 1) = 1
    ORDER BY p.name COLLATE NOCASE, p.id
  `).bind(storeId).all();

  return {
    products,
    materials: (materialRows.results ?? []).map(row => ({
      productId: Number(row.id),
      productName: row.name,
      unitSymbol: row.unit_symbol || ''
    }))
  };
}
