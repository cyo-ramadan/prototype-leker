import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';

const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const flag = value => value === false ? 0 : 1;
const placeholders = count => Array.from({ length: count }, () => '?').join(', ');

function codeText(value, max = 32) {
  return text(value, max)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function positiveInteger(value, max = 1_000_000_000) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= max ? number : null;
}

function actorFromAuth(auth) {
  if (auth.owner) return { role: 'OWNER', id: auth.owner.id };
  if (auth.admin) return { role: 'ADMIN', id: auth.admin.id };
  return { role: auth.authType || 'MANAGEMENT', id: '' };
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function ensureManufacturingDefaults(db, storeId) {
  const typeRows = [
    ['finished', 'FINISHED_GOOD', 'Barang Jadi', 1, 1, 1, 1, 1],
    ['raw', 'RAW_MATERIAL', 'Bahan', 0, 1, 0, 1, 1],
    ['semi', 'SEMI_FINISHED', 'Bahan Setengah Jadi', 0, 1, 1, 1, 1]
  ];
  const unitRows = [
    ['pcs', 'PCS', 'Pcs', 'pcs'],
    ['gram', 'GRAM', 'Gram', 'g'],
    ['kg', 'KG', 'Kilogram', 'kg'],
    ['ml', 'ML', 'Mililiter', 'ml'],
    ['liter', 'LITER', 'Liter', 'L']
  ];
  await db.batch([
    ...typeRows.map(([suffix, code, name, canSell, canPurchase, canProduce, canConsume, trackStock]) => db.prepare(`
      INSERT OR IGNORE INTO item_types (
        id, store_id, code, name, can_sell, can_purchase, can_produce, can_consume, track_stock, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).bind(`item_type_${storeId}_${suffix}`, storeId, code, name, canSell, canPurchase, canProduce, canConsume, trackStock)),
    ...unitRows.map(([suffix, code, name, symbol]) => db.prepare(`
      INSERT OR IGNORE INTO units (id, store_id, code, name, symbol, decimal_scale, is_active)
      VALUES (?, ?, ?, ?, ?, 0, 1)
    `).bind(`unit_${storeId}_${suffix}`, storeId, code, name, symbol))
  ]);
}

export async function getManufacturingReferenceData(db, storeId) {
  await ensureManufacturingDefaults(db, storeId);
  const [types, units] = await db.batch([
    db.prepare(`
      SELECT id, code, name, can_sell, can_purchase, can_produce, can_consume, track_stock, is_active
      FROM item_types WHERE store_id = ? ORDER BY name COLLATE NOCASE
    `).bind(storeId),
    db.prepare(`
      SELECT id, code, name, symbol, decimal_scale, is_active
      FROM units WHERE store_id = ? ORDER BY name COLLATE NOCASE
    `).bind(storeId)
  ]);
  return {
    itemTypes: (types.results ?? []).map(row => ({
      id: row.id,
      code: row.code,
      name: row.name,
      canSell: Boolean(row.can_sell),
      canPurchase: Boolean(row.can_purchase),
      canProduce: Boolean(row.can_produce),
      canConsume: Boolean(row.can_consume),
      trackStock: Boolean(row.track_stock),
      isActive: Boolean(row.is_active)
    })),
    units: (units.results ?? []).map(row => ({
      id: row.id,
      code: row.code,
      name: row.name,
      symbol: row.symbol,
      decimalScale: Number(row.decimal_scale || 0),
      isActive: Boolean(row.is_active)
    }))
  };
}

export async function resolveProductMasterReferences(db, storeId, itemTypeId, baseUnitId, { allowInactive = false } = {}) {
  await ensureManufacturingDefaults(db, storeId);
  const type = itemTypeId
    ? await db.prepare(`SELECT id, is_active FROM item_types WHERE id = ? AND store_id = ?`).bind(itemTypeId, storeId).first()
    : await db.prepare(`SELECT id, is_active FROM item_types WHERE store_id = ? AND code = 'FINISHED_GOOD' LIMIT 1`).bind(storeId).first();
  const unit = baseUnitId
    ? await db.prepare(`SELECT id, is_active FROM units WHERE id = ? AND store_id = ?`).bind(baseUnitId, storeId).first()
    : await db.prepare(`SELECT id, is_active FROM units WHERE store_id = ? AND code = 'PCS' LIMIT 1`).bind(storeId).first();
  if (!type || !unit) return { ok: false, error: 'Tipe barang atau satuan tidak ditemukan di gerai ini.' };
  if (!allowInactive && (!type.is_active || !unit.is_active)) return { ok: false, error: 'Tipe barang atau satuan sudah nonaktif.' };
  return { ok: true, itemTypeId: type.id, baseUnitId: unit.id };
}

async function listRecipeRows(db, storeId, includeArchived = false) {
  const rows = await db.prepare(`
    SELECT r.id, r.output_product_id, p.name AS output_product_name,
           r.output_unit_id, u.symbol AS output_unit_symbol,
           r.output_quantity, r.revision, r.status, r.notes,
           r.created_by_role, r.created_by_id, r.created_at, r.archived_at
    FROM manufacturing_recipes r
    JOIN products p ON p.id = r.output_product_id AND p.store_id = r.store_id
    JOIN units u ON u.id = r.output_unit_id AND u.store_id = r.store_id
    WHERE r.store_id = ? AND (? = 1 OR r.status = 'ACTIVE')
    ORDER BY p.name COLLATE NOCASE, r.revision DESC
    LIMIT 300
  `).bind(storeId, includeArchived ? 1 : 0).all();
  const recipes = rows.results ?? [];
  if (!recipes.length) return [];
  const ids = recipes.map(row => row.id);
  const components = await db.prepare(`
    SELECT c.recipe_id, c.component_product_id, p.name AS component_product_name,
           c.component_unit_id, u.symbol AS component_unit_symbol,
           c.quantity, c.display_order
    FROM manufacturing_recipe_components c
    JOIN products p ON p.id = c.component_product_id AND p.store_id = c.store_id
    JOIN units u ON u.id = c.component_unit_id AND u.store_id = c.store_id
    WHERE c.store_id = ? AND c.recipe_id IN (${placeholders(ids.length)})
    ORDER BY c.recipe_id, c.display_order, c.component_product_id
  `).bind(storeId, ...ids).all();
  const grouped = new Map(ids.map(id => [id, []]));
  for (const row of components.results ?? []) {
    grouped.get(row.recipe_id)?.push({
      productId: Number(row.component_product_id),
      productName: row.component_product_name,
      unitId: row.component_unit_id,
      unitSymbol: row.component_unit_symbol,
      quantity: Number(row.quantity || 0),
      displayOrder: Number(row.display_order || 0)
    });
  }
  return recipes.map(row => ({
    id: row.id,
    outputProductId: Number(row.output_product_id),
    outputProductName: row.output_product_name,
    outputUnitId: row.output_unit_id,
    outputUnitSymbol: row.output_unit_symbol,
    outputQuantity: Number(row.output_quantity || 0),
    revision: Number(row.revision),
    status: row.status,
    notes: row.notes,
    createdByRole: row.created_by_role,
    createdById: row.created_by_id,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    components: grouped.get(row.id) ?? []
  }));
}

async function recipeWouldCycle(db, storeId, outputProductId, componentProductIds) {
  const rows = await db.prepare(`
    SELECT r.output_product_id, c.component_product_id
    FROM manufacturing_recipes r
    JOIN manufacturing_recipe_components c ON c.recipe_id = r.id AND c.store_id = r.store_id
    WHERE r.store_id = ? AND r.status = 'ACTIVE' AND r.output_product_id <> ?
  `).bind(storeId, outputProductId).all();
  const graph = new Map();
  for (const row of rows.results ?? []) {
    const output = Number(row.output_product_id);
    if (!graph.has(output)) graph.set(output, []);
    graph.get(output).push(Number(row.component_product_id));
  }
  graph.set(outputProductId, componentProductIds);

  const visitsOutput = start => {
    const stack = [start];
    const seen = new Set();
    while (stack.length) {
      const current = stack.pop();
      if (current === outputProductId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const next of graph.get(current) ?? []) stack.push(next);
    }
    return false;
  };
  return componentProductIds.some(visitsOutput);
}

async function createRecipeRevision(db, store, auth, payload) {
  const outputProductId = Number(payload?.outputProductId);
  const outputQuantity = positiveInteger(payload?.outputQuantity);
  const requested = Array.isArray(payload?.components) ? payload.components : [];
  if (!Number.isInteger(outputProductId) || !outputQuantity || !requested.length) {
    return { ok: false, response: json({ error: 'Hasil barang, qty hasil bulat, dan minimal satu komponen wajib valid.' }, 400) };
  }

  const normalized = [];
  const seen = new Set();
  for (const [index, component] of requested.entries()) {
    const productId = Number(component?.productId);
    const quantity = positiveInteger(component?.quantity);
    if (!Number.isInteger(productId) || !quantity || seen.has(productId)) {
      return { ok: false, response: json({ error: 'Komponen resep wajib memakai qty bilangan bulat dan tidak boleh duplikat.' }, 400) };
    }
    if (productId === outputProductId) {
      return { ok: false, response: json({ error: 'Barang hasil tidak boleh menjadi komponennya sendiri.' }, 400) };
    }
    seen.add(productId);
    normalized.push({ productId, quantity, displayOrder: index + 1 });
  }

  const output = await db.prepare(`
    SELECT p.id, p.name, p.base_unit_id, COALESCE(t.can_produce, 1) AS can_produce
    FROM products p
    LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    WHERE p.id = ? AND p.store_id = ? AND p.is_active = 1
  `).bind(outputProductId, store.id).first();
  if (!output || !output.base_unit_id || !output.can_produce) {
    return { ok: false, response: json({ error: 'Barang hasil tidak ditemukan atau tipe barang tidak mengizinkan produksi.' }, 400) };
  }

  const componentIds = normalized.map(item => item.productId);
  const componentRows = await db.prepare(`
    SELECT p.id, p.name, p.base_unit_id, COALESCE(t.can_consume, 1) AS can_consume
    FROM products p
    LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    WHERE p.store_id = ? AND p.is_active = 1 AND p.id IN (${placeholders(componentIds.length)})
  `).bind(store.id, ...componentIds).all();
  const componentsById = new Map((componentRows.results ?? []).map(row => [Number(row.id), row]));
  if (componentsById.size !== componentIds.length || normalized.some(item => !componentsById.get(item.productId)?.base_unit_id || !componentsById.get(item.productId)?.can_consume)) {
    return { ok: false, response: json({ error: 'Ada komponen yang tidak ditemukan atau tipe barangnya tidak boleh dikonsumsi.' }, 400) };
  }

  if (await recipeWouldCycle(db, store.id, outputProductId, componentIds)) {
    return { ok: false, response: json({ error: 'Resep membentuk circular BOM. Ubah komponen agar rantai produksi tidak berputar.' }, 409) };
  }

  const revisionRow = await db.prepare(`
    SELECT COALESCE(MAX(revision), 0) + 1 AS next_revision
    FROM manufacturing_recipes WHERE store_id = ? AND output_product_id = ?
  `).bind(store.id, outputProductId).first();
  const revision = Number(revisionRow?.next_revision ?? 1);
  const recipeId = `recipe_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const actor = actorFromAuth(auth);
  const statements = [
    db.prepare(`
      UPDATE manufacturing_recipes
      SET status = 'ARCHIVED', archived_at = ?
      WHERE store_id = ? AND output_product_id = ? AND status = 'ACTIVE'
    `).bind(now, store.id, outputProductId),
    db.prepare(`
      INSERT INTO manufacturing_recipes (
        id, store_id, output_product_id, output_unit_id, output_quantity,
        revision, status, notes, created_by_role, created_by_id, created_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, NULL)
    `).bind(
      recipeId, store.id, outputProductId, output.base_unit_id, outputQuantity,
      revision, text(payload?.notes, 500), actor.role, actor.id, now
    )
  ];
  for (const item of normalized) {
    const product = componentsById.get(item.productId);
    statements.push(db.prepare(`
      INSERT INTO manufacturing_recipe_components (
        id, recipe_id, store_id, component_product_id, component_unit_id,
        quantity, display_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `recipe_component_${crypto.randomUUID()}`, recipeId, store.id, item.productId,
      product.base_unit_id, item.quantity, item.displayOrder
    ));
  }
  try {
    await db.batch(statements);
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      return { ok: false, response: json({ error: 'Resep aktif berubah bersamaan. Refresh lalu simpan ulang.' }, 409) };
    }
    throw error;
  }
  return { ok: true, response: json({ ok: true, id: recipeId, revision }, 201) };
}

export async function handleManufacturingMasterApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/manufacturing/')) return null;
  const db = env.DB;
  const auth = await requireManagement(request, db);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  await ensureManufacturingDefaults(db, store.id);

  if (request.method === 'GET' && pathname === '/api/admin/manufacturing/bootstrap') {
    const refs = await getManufacturingReferenceData(db, store.id);
    const products = await db.prepare(`
      SELECT p.id, p.name, p.item_type_id, p.base_unit_id,
             t.name AS item_type_name, t.code AS item_type_code,
             u.name AS unit_name, u.symbol AS unit_symbol
      FROM products p
      LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
      LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
      WHERE p.store_id = ? AND p.is_active = 1
      ORDER BY p.name COLLATE NOCASE
    `).bind(store.id).all();
    return json({
      store,
      ...refs,
      products: (products.results ?? []).map(row => ({
        id: Number(row.id),
        name: row.name,
        itemTypeId: row.item_type_id || null,
        itemTypeName: row.item_type_name || '',
        itemTypeCode: row.item_type_code || '',
        baseUnitId: row.base_unit_id || null,
        unitName: row.unit_name || '',
        unitSymbol: row.unit_symbol || ''
      }))
    });
  }

  if (request.method === 'POST' && pathname === '/api/admin/manufacturing/item-types') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tipe barang tidak valid.' }, 400);
    const code = codeText(body.value?.code);
    const name = text(body.value?.name, 80);
    if (!code || !name) return json({ error: 'Kode dan nama tipe barang wajib diisi.' }, 400);
    const id = `item_type_${crypto.randomUUID()}`;
    try {
      await db.prepare(`
        INSERT INTO item_types (
          id, store_id, code, name, can_sell, can_purchase, can_produce, can_consume, track_stock, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).bind(
        id, store.id, code, name,
        flag(body.value?.canSell), flag(body.value?.canPurchase), flag(body.value?.canProduce),
        flag(body.value?.canConsume), flag(body.value?.trackStock)
      ).run();
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Kode atau nama tipe barang sudah dipakai.' }, 409);
      throw error;
    }
    return json({ ok: true, id }, 201);
  }

  const typeMatch = pathname.match(/^\/api\/admin\/manufacturing\/item-types\/([^/]+)$/);
  if (typeMatch && request.method === 'PATCH') {
    const id = decodeURIComponent(typeMatch[1]);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tipe barang tidak valid.' }, 400);
    const current = await db.prepare(`SELECT id FROM item_types WHERE id = ? AND store_id = ?`).bind(id, store.id).first();
    if (!current) return json({ error: 'Tipe barang tidak ditemukan.' }, 404);
    const name = text(body.value?.name, 80);
    if (!name) return json({ error: 'Nama tipe barang wajib diisi.' }, 400);
    await db.prepare(`
      UPDATE item_types
      SET name = ?, can_sell = ?, can_purchase = ?, can_produce = ?, can_consume = ?,
          track_stock = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(
      name, flag(body.value?.canSell), flag(body.value?.canPurchase), flag(body.value?.canProduce),
      flag(body.value?.canConsume), flag(body.value?.trackStock), body.value?.isActive === false ? 0 : 1,
      id, store.id
    ).run();
    return json({ ok: true });
  }

  if (request.method === 'POST' && pathname === '/api/admin/manufacturing/units') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload satuan tidak valid.' }, 400);
    const code = codeText(body.value?.code, 20);
    const name = text(body.value?.name, 60);
    const symbol = text(body.value?.symbol, 12);
    if (!code || !name || !symbol || Number(body.value?.decimalScale || 0) !== 0) {
      return json({ error: 'Satuan wajib memakai qty bulat. Buat satuan terkecil jika membutuhkan pecahan.' }, 400);
    }
    const id = `unit_${crypto.randomUUID()}`;
    try {
      await db.prepare(`
        INSERT INTO units (id, store_id, code, name, symbol, decimal_scale, is_active)
        VALUES (?, ?, ?, ?, ?, 0, 1)
      `).bind(id, store.id, code, name, symbol).run();
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Kode atau nama satuan sudah dipakai.' }, 409);
      throw error;
    }
    return json({ ok: true, id }, 201);
  }

  const unitMatch = pathname.match(/^\/api\/admin\/manufacturing\/units\/([^/]+)$/);
  if (unitMatch && request.method === 'PATCH') {
    const id = decodeURIComponent(unitMatch[1]);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload satuan tidak valid.' }, 400);
    const current = await db.prepare(`SELECT id FROM units WHERE id = ? AND store_id = ?`).bind(id, store.id).first();
    if (!current) return json({ error: 'Satuan tidak ditemukan.' }, 404);
    const name = text(body.value?.name, 60);
    const symbol = text(body.value?.symbol, 12);
    if (!name || !symbol || Number(body.value?.decimalScale || 0) !== 0) {
      return json({ error: 'Satuan wajib memakai qty bulat. Gunakan satuan terkecil untuk kebutuhan yang sebelumnya pecahan.' }, 400);
    }
    await db.prepare(`
      UPDATE units
      SET name = ?, symbol = ?, decimal_scale = 0, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(name, symbol, body.value?.isActive === false ? 0 : 1, id, store.id).run();
    return json({ ok: true });
  }

  if (request.method === 'GET' && pathname === '/api/admin/manufacturing/recipes') {
    const includeArchived = new URL(request.url).searchParams.get('includeArchived') === '1';
    return json({ recipes: await listRecipeRows(db, store.id, includeArchived) });
  }

  if (request.method === 'POST' && pathname === '/api/admin/manufacturing/recipes') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload resep tidak valid.' }, 400);
    return (await createRecipeRevision(db, store, auth, body.value)).response;
  }

  const recipeArchiveMatch = pathname.match(/^\/api\/admin\/manufacturing\/recipes\/([^/]+)\/archive$/);
  if (recipeArchiveMatch && request.method === 'POST') {
    const id = decodeURIComponent(recipeArchiveMatch[1]);
    const result = await db.prepare(`
      UPDATE manufacturing_recipes
      SET status = 'ARCHIVED', archived_at = ?
      WHERE id = ? AND store_id = ? AND status = 'ACTIVE'
    `).bind(new Date().toISOString(), id, store.id).run();
    return Number(result.meta?.changes ?? 0) === 1
      ? json({ ok: true })
      : json({ error: 'Resep aktif tidak ditemukan.' }, 404);
  }

  return json({ error: 'Route manufacturing master tidak ditemukan.' }, 404);
}
