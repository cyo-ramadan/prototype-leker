import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { createRecipeRevision } from './manufacturing-master.js';

// Resep Entity (ADR-050, Bos Cyo 2026-10-01): template resep dimiliki Entity,
// dirujuk lewat Kode Barang. Template tidak pernah memotong stok; ia
// "diterapkan" ke gerai dan hasilnya adalah revisi manufacturing_recipes milik
// gerai itu (jalur validasi yang sama dengan Master Resep gerai).
//
//   GET  /api/admin/entity-recipes                    template ACTIVE entity
//   PUT  /api/admin/entity-recipes                    simpan template (revisi baru)
//   GET  /api/admin/entity-recipes/:id/preview        kesiapan tiap gerai entity
//   POST /api/admin/entity-recipes/:id/apply          {storeIds:[...]} terapkan
//
// Semua hanya untuk Owner / Entity Admin.

const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const unitCodeText = value => String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 20);
const positiveInteger = value => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 1_000_000_000 ? number : null;
};
const placeholders = count => Array.from({ length: count }, () => '?').join(',');

const actorFromAuth = auth => {
  if (auth.owner) return { role: 'OWNER', id: auth.owner.id || '' };
  if (auth.entityAdmin) return { role: 'ENTITY_ADMIN', id: auth.entityAdmin.id || '' };
  return { role: 'LEGACY_PIN', id: '' };
};

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

async function loadTemplates(db, entityId, { templateId = null } = {}) {
  const rows = await db.prepare(`
    SELECT t.id, t.output_master_id, om.code AS output_code, om.name AS output_name,
           t.variant_label, t.output_quantity, t.output_unit_code, t.revision, t.status, t.notes, t.created_at
    FROM entity_recipe_templates t
    JOIN product_masters om ON om.id = t.output_master_id
    WHERE t.entity_id = ? AND t.status = 'ACTIVE' ${templateId ? 'AND t.id = ?' : ''}
    ORDER BY om.code COLLATE NOCASE, t.variant_label
    LIMIT 300
  `).bind(...(templateId ? [entityId, templateId] : [entityId])).all();
  const templates = rows.results ?? [];
  if (!templates.length) return [];
  const ids = templates.map(row => row.id);
  const components = await db.prepare(`
    SELECT c.template_id, c.component_master_id, cm.code AS component_code, cm.name AS component_name,
           c.unit_code, c.quantity, c.display_order
    FROM entity_recipe_template_components c
    JOIN product_masters cm ON cm.id = c.component_master_id
    WHERE c.template_id IN (${placeholders(ids.length)})
    ORDER BY c.template_id, c.display_order
  `).bind(...ids).all();
  const grouped = new Map(ids.map(id => [id, []]));
  for (const row of components.results ?? []) {
    grouped.get(row.template_id)?.push({
      masterId: row.component_master_id,
      code: row.component_code,
      name: row.component_name || '',
      unitCode: row.unit_code,
      quantity: Number(row.quantity)
    });
  }
  return templates.map(row => ({
    id: row.id,
    outputMasterId: row.output_master_id,
    outputCode: row.output_code,
    outputName: row.output_name || '',
    variantLabel: row.variant_label || '',
    outputQuantity: Number(row.output_quantity),
    outputUnitCode: row.output_unit_code,
    revision: Number(row.revision),
    notes: row.notes || '',
    createdAt: row.created_at,
    components: grouped.get(row.id) ?? []
  }));
}

// Graf bahan antar Kode Barang pada template ACTIVE entity; template baru tidak
// boleh membuat putaran (hasil menjadi bahan dirinya sendiri secara tidak langsung).
async function wouldCycle(db, entityId, outputMasterId, componentMasterIds) {
  const rows = await db.prepare(`
    SELECT t.output_master_id, c.component_master_id
    FROM entity_recipe_templates t
    JOIN entity_recipe_template_components c ON c.template_id = t.id
    WHERE t.entity_id = ? AND t.status = 'ACTIVE' AND t.output_master_id <> ?
  `).bind(entityId, outputMasterId).all();
  const graph = new Map();
  for (const row of rows.results ?? []) {
    if (!graph.has(row.output_master_id)) graph.set(row.output_master_id, []);
    graph.get(row.output_master_id).push(row.component_master_id);
  }
  graph.set(outputMasterId, componentMasterIds);
  return componentMasterIds.some(start => {
    const stack = [start];
    const seen = new Set();
    while (stack.length) {
      const current = stack.pop();
      if (current === outputMasterId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const next of graph.get(current) ?? []) stack.push(next);
    }
    return false;
  });
}

async function saveTemplate(db, store, auth, payload) {
  const outputMasterId = text(payload?.outputMasterId, 80);
  const variantLabel = text(payload?.variantLabel, 40);
  const outputQuantity = positiveInteger(payload?.outputQuantity);
  const outputUnitCode = unitCodeText(payload?.outputUnitCode);
  const requested = Array.isArray(payload?.components) ? payload.components : [];
  if (!outputMasterId || !outputQuantity || !outputUnitCode || !requested.length) {
    return json({ error: 'Kode Barang hasil, qty hasil bulat, satuan hasil, dan minimal satu bahan wajib diisi.' }, 400);
  }

  const components = [];
  const seen = new Set();
  for (const [index, component] of requested.entries()) {
    const masterId = text(component?.masterId, 80);
    const quantity = positiveInteger(component?.quantity);
    const unitCode = unitCodeText(component?.unitCode);
    if (!masterId || !quantity || !unitCode || seen.has(masterId)) {
      return json({ error: 'Setiap bahan wajib punya Kode Barang, qty bulat, satuan, dan tidak boleh duplikat.' }, 400);
    }
    if (masterId === outputMasterId) return json({ error: 'Barang hasil tidak boleh menjadi bahannya sendiri.' }, 400);
    seen.add(masterId);
    components.push({ masterId, quantity, unitCode, displayOrder: index + 1 });
  }

  const ids = [outputMasterId, ...components.map(item => item.masterId)];
  const owned = await db.prepare(`
    SELECT id FROM product_masters WHERE entity_id = ? AND id IN (${placeholders(ids.length)})
  `).bind(store.entityId, ...ids).all();
  if ((owned.results ?? []).length !== ids.length) {
    return json({ error: 'Ada Kode Barang yang tidak ditemukan di entity ini.', code: 'PRODUCT_MASTER_ENTITY_MISMATCH' }, 400);
  }
  if (await wouldCycle(db, store.entityId, outputMasterId, components.map(item => item.masterId))) {
    return json({ error: 'Resep membentuk putaran antar Kode Barang. Ubah bahan agar rantai produksi tidak berputar.' }, 409);
  }

  const revisionRow = await db.prepare(`
    SELECT COALESCE(MAX(revision), 0) + 1 AS next_revision FROM entity_recipe_templates WHERE output_master_id = ?
  `).bind(outputMasterId).first();
  const revision = Number(revisionRow?.next_revision ?? 1);
  const templateId = `ertemplate_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const actor = actorFromAuth(auth);
  const statements = [
    db.prepare(`
      UPDATE entity_recipe_templates SET status = 'ARCHIVED', archived_at = ?
      WHERE output_master_id = ? AND variant_label = ? AND status = 'ACTIVE'
    `).bind(now, outputMasterId, variantLabel),
    db.prepare(`
      INSERT INTO entity_recipe_templates (
        id, entity_id, output_master_id, variant_label, output_quantity, output_unit_code,
        revision, status, notes, created_by_role, created_by_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
    `).bind(templateId, store.entityId, outputMasterId, variantLabel, outputQuantity, outputUnitCode, revision, text(payload?.notes, 500), actor.role, actor.id, now),
    ...components.map(item => db.prepare(`
      INSERT INTO entity_recipe_template_components (id, template_id, component_master_id, unit_code, quantity, display_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(`ertc_${crypto.randomUUID()}`, templateId, item.masterId, item.unitCode, item.quantity, item.displayOrder))
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) return json({ error: 'Resep Entity berubah bersamaan. Refresh lalu simpan ulang.' }, 409);
    throw error;
  }
  return json({ ok: true, id: templateId, revision }, 201);
}

// Barang gerai untuk sekumpulan Kode Barang: tepat satu barang aktif per Kode
// Barang, beserta kode satuan dasarnya.
async function storeProductsByMaster(db, storeId, masterIds) {
  const rows = await db.prepare(`
    SELECT p.id, p.name, p.product_master_id, p.linked_recipe_id, u.code AS unit_code
    FROM products p
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    WHERE p.store_id = ? AND p.is_active = 1 AND p.product_master_id IN (${placeholders(masterIds.length)})
  `).bind(storeId, ...masterIds).all();
  const byMaster = new Map();
  for (const row of rows.results ?? []) {
    if (!byMaster.has(row.product_master_id)) byMaster.set(row.product_master_id, []);
    byMaster.get(row.product_master_id).push(row);
  }
  return byMaster;
}

// Kesiapan satu template di satu gerai. status: READY | REPLACES | UP_TO_DATE | BLOCKED.
async function assessStore(db, template, store) {
  const masterIds = [template.outputMasterId, ...template.components.map(item => item.masterId)];
  const products = await storeProductsByMaster(db, store.id, masterIds);
  const problems = [];
  const resolved = new Map();
  const check = (masterId, label, unitCode) => {
    const found = products.get(masterId) ?? [];
    if (!found.length) { problems.push(`${label} belum diaktifkan di gerai ini`); return; }
    if (found.length > 1) { problems.push(`${label} punya lebih dari satu barang aktif di gerai ini`); return; }
    const [product] = found;
    if (!product.unit_code) { problems.push(`${label} belum punya satuan dasar`); return; }
    if (product.unit_code !== unitCode) {
      problems.push(`${label} memakai satuan ${product.unit_code} di gerai ini, resep Entity memakai ${unitCode}`);
      return;
    }
    resolved.set(masterId, product);
  };
  check(template.outputMasterId, template.outputName || template.outputCode, template.outputUnitCode);
  for (const component of template.components) check(component.masterId, component.name || component.code, component.unitCode);

  const base = { storeId: store.id, storeCode: store.code, storeName: store.storeName };
  const applied = await db.prepare(`
    SELECT recipe_id, applied_at FROM entity_recipe_applications WHERE template_id = ? AND store_id = ?
  `).bind(template.id, store.id).first();
  if (applied) return { ...base, status: 'UP_TO_DATE', appliedAt: applied.applied_at, problems: [] };
  if (problems.length) return { ...base, status: 'BLOCKED', problems };

  const output = resolved.get(template.outputMasterId);
  const existing = await db.prepare(`
    SELECT id, revision FROM manufacturing_recipes
    WHERE store_id = ? AND output_product_id = ? AND variant_label = ? AND status = 'ACTIVE'
  `).bind(store.id, Number(output.id), template.variantLabel).first();
  return {
    ...base,
    status: existing ? 'REPLACES' : 'READY',
    outputProductId: Number(output.id),
    replacesRecipeId: existing?.id || null,
    replacesRevision: existing ? Number(existing.revision) : null,
    problems: []
  };
}

async function entityStores(db, entityId) {
  const rows = await db.prepare(`
    SELECT id, code, store_name FROM stores WHERE entity_id = ? AND is_active = 1 ORDER BY code
  `).bind(entityId).all();
  return (rows.results ?? []).map(row => ({ id: row.id, code: row.code, storeName: row.store_name }));
}

async function applyToStore(db, auth, template, store, assessment) {
  const products = await storeProductsByMaster(db, store.id, template.components.map(item => item.masterId));
  const payload = {
    outputProductId: assessment.outputProductId,
    outputQuantity: template.outputQuantity,
    variantLabel: template.variantLabel,
    notes: `Dari Resep Entity ${template.outputCode}${template.variantLabel ? ` (${template.variantLabel})` : ''} rev ${template.revision}`,
    components: template.components.map(item => ({ productId: Number(products.get(item.masterId)[0].id), quantity: item.quantity }))
  };
  const actor = actorFromAuth(auth);
  const created = await createRecipeRevision(db, store, auth, payload, {
    repointFromRecipeId: assessment.replacesRecipeId,
    extraStatements: recipeId => [db.prepare(`
      INSERT INTO entity_recipe_applications (id, template_id, store_id, recipe_id, applied_by_role, applied_by_id, applied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(`erapp_${crypto.randomUUID()}`, template.id, store.id, recipeId, actor.role, actor.id, new Date().toISOString())]
  });
  if (created.ok) return { storeId: store.id, storeCode: store.code, status: 'APPLIED', recipeId: created.id, revision: created.revision };
  const body = await created.response.json().catch(() => ({}));
  return { storeId: store.id, storeCode: store.code, status: 'FAILED', error: body.error || 'Gagal menerapkan resep.' };
}

export async function handleEntityRecipeApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/entity-recipes')) return null;
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  if (!(auth.owner || auth.entityAdmin)) {
    return json({ error: 'Resep Entity hanya bisa dikelola Entity Admin atau Owner.', code: 'ENTITY_LEVEL_ONLY' }, 403);
  }
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  if (!store.entityId) return json({ error: 'Gerai ini belum terhubung ke Entity mana pun.', code: 'STORE_WITHOUT_ENTITY' }, 409);

  if (request.method === 'GET' && pathname === '/api/admin/entity-recipes') {
    return json({ store, templates: await loadTemplates(db, store.entityId) });
  }

  if (request.method === 'PUT' && pathname === '/api/admin/entity-recipes') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload Resep Entity tidak valid.' }, 400);
    return saveTemplate(db, store, auth, body.value);
  }

  const match = pathname.match(/^\/api\/admin\/entity-recipes\/([^/]+)\/(preview|apply)$/);
  if (match) {
    const [template] = await loadTemplates(db, store.entityId, { templateId: decodeURIComponent(match[1]) });
    if (!template) return json({ error: 'Resep Entity aktif tidak ditemukan.' }, 404);
    const stores = await entityStores(db, store.entityId);

    if (request.method === 'GET' && match[2] === 'preview') {
      const assessments = [];
      for (const target of stores) assessments.push(await assessStore(db, template, target));
      return json({ template, stores: assessments });
    }

    if (request.method === 'POST' && match[2] === 'apply') {
      const body = await readJson(request);
      const storeIds = Array.isArray(body.value?.storeIds) ? [...new Set(body.value.storeIds.map(id => text(id, 80)).filter(Boolean))] : [];
      if (!body.ok || !storeIds.length) return json({ error: 'Pilih minimal satu gerai untuk diterapkan.' }, 400);
      const results = [];
      for (const storeId of storeIds) {
        const target = stores.find(item => item.id === storeId);
        if (!target) { results.push({ storeId, status: 'FAILED', error: 'Gerai bukan bagian dari entity ini.' }); continue; }
        // Dinilai ulang saat menerapkan: pratinjau bisa basi.
        const assessment = await assessStore(db, template, target);
        if (assessment.status === 'UP_TO_DATE') { results.push({ storeId, storeCode: target.code, status: 'SKIPPED', error: 'Revisi ini sudah diterapkan di gerai ini.' }); continue; }
        if (assessment.status === 'BLOCKED') { results.push({ storeId, storeCode: target.code, status: 'BLOCKED', problems: assessment.problems }); continue; }
        results.push(await applyToStore(db, auth, template, target, assessment));
      }
      return json({ ok: true, results });
    }
  }

  return json({ error: 'Route Resep Entity tidak ditemukan.' }, 404);
}
