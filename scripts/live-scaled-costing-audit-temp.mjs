const BASE = 'https://prototype-leker-v2.daily-napkin.workers.dev';
const STORE = 'G001';
const COST_SCALE = 1_000_000;
const MAX_PAGES = 20;

async function req(path, { method = 'GET', token = '', body, allowError = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(BASE + path, {
      method,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok && !allowError) throw new Error(`${path} HTTP ${response.status}: ${JSON.stringify(payload)}`);
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timeout);
  }
}

function scaledConsistency(displayValue, scaledValue) {
  if (scaledValue == null) return null;
  const scaled = Number(scaledValue);
  const display = Number(displayValue);
  return {
    scaled,
    isSafeInteger: Number.isSafeInteger(scaled),
    displayValue: display,
    roundTripScaled: Math.round(display * COST_SCALE),
    matchesDisplay: Math.round(display * COST_SCALE) === scaled
  };
}

async function allStockMovements(token) {
  const stockPayload = (await req(`/api/admin/stock?store=${STORE}`, { token })).payload;
  const products = stockPayload.stocks || [];
  const movements = [];
  for (const product of products) {
    let before = '';
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ store: STORE, limit: '100' });
      if (before) query.set('before', before);
      const payload = (await req(`/api/admin/stock/${product.productId}/movements?${query}`, { token })).payload;
      for (const movement of payload.movements || []) movements.push({ ...movement, productId: product.productId });
      if (!payload.hasMore || !payload.nextCursor) break;
      before = payload.nextCursor;
      if (page === MAX_PAGES - 1) throw new Error(`Stock movement pagination exceeded ${MAX_PAGES} pages for product ${product.productId}`);
    }
  }
  return { products, movements };
}

function sourceMap(movements, predicate) {
  const map = new Map();
  for (const movement of movements) {
    if (!predicate(movement)) continue;
    if (!movement.sourceId) continue;
    if (!map.has(movement.sourceId)) map.set(movement.sourceId, movement.occurredAt || null);
  }
  return map;
}

async function main() {
  const login = (await req('/api/store-admin/login', {
    method: 'POST',
    body: { username: 'bablil', password: 'bablil123' }
  })).payload;
  const token = login.token;
  if (!token) throw new Error('Admin token missing');

  const { products, movements } = await allStockMovements(token);
  const purchaseSources = sourceMap(movements, movement => movement.sourceType === 'PURCHASE');
  const saleSources = sourceMap(movements, movement => movement.sourceType === 'SALE');
  const productionSources = sourceMap(movements, movement => String(movement.sourceType || '').startsWith('PRODUCTION_'));

  const detailFailures = [];
  const purchaseRecords = [];
  for (const [purchaseId, occurredAt] of purchaseSources) {
    const response = await req(`/api/admin/transactions/detail/PURCHASE/${encodeURIComponent(purchaseId)}?store=${STORE}`, { token, allowError: true });
    if (!response.ok) {
      detailFailures.push({ kind: 'PURCHASE', id: purchaseId, http: response.status, payload: response.payload });
      continue;
    }
    for (const item of response.payload.detail?.items || []) {
      purchaseRecords.push({
        purchaseId,
        occurredAt,
        productId: item.productId,
        unitCost: scaledConsistency(item.unitCost, item.unitCostScaled),
        averageCostBefore: scaledConsistency(item.averageCostBefore, item.averageCostBeforeScaled),
        averageCostAfter: scaledConsistency(item.averageCostAfter, item.averageCostAfterScaled)
      });
    }
  }

  const saleRecords = [];
  for (const [saleId, occurredAt] of saleSources) {
    const response = await req(`/api/admin/transactions/detail/SALE/${encodeURIComponent(saleId)}?store=${STORE}`, { token, allowError: true });
    if (!response.ok) {
      detailFailures.push({ kind: 'SALE', id: saleId, http: response.status, payload: response.payload });
      continue;
    }
    for (const item of response.payload.detail?.items || []) {
      saleRecords.push({
        saleId,
        occurredAt,
        productId: item.productId,
        unitCostSnapshot: scaledConsistency(item.unitCostSnapshot, item.unitCostSnapshotScaled),
        lineCogs: scaledConsistency(item.lineCogs, item.lineCogsScaled),
        productionRunId: item.productionRunId || null
      });
    }
  }

  const productionRecords = [];
  for (const [productionRunId, occurredAt] of productionSources) {
    const response = await req(`/api/admin/transactions/detail/PRODUCTION/${encodeURIComponent(productionRunId)}?store=${STORE}`, { token, allowError: true });
    if (!response.ok) {
      detailFailures.push({ kind: 'PRODUCTION', id: productionRunId, http: response.status, payload: response.payload });
      continue;
    }
    const detail = response.payload.detail || {};
    productionRecords.push({
      productionRunId,
      occurredAt,
      mode: detail.mode,
      hppTotal: scaledConsistency(detail.hppTotal, detail.hppTotalScaled),
      hppPerUnit: scaledConsistency(detail.hppPerUnit, detail.hppPerUnitScaled),
      resolvedHppTotal: detail.hppTotal,
      resolvedHppPerUnit: detail.hppPerUnit,
      legacyFallbackRun: detail.hppTotalScaled == null && detail.hppTotal != null,
      components: (detail.components || []).map(component => ({
        productId: component.productId,
        unitCostSnapshot: scaledConsistency(component.unitCostSnapshot, component.unitCostSnapshotScaled),
        totalCostSnapshot: scaledConsistency(component.totalCostSnapshot, component.totalCostSnapshotScaled),
        resolvedUnitCostSnapshot: component.unitCostSnapshot,
        resolvedTotalCostSnapshot: component.totalCostSnapshot,
        legacyFallback: component.unitCostSnapshotScaled == null && component.unitCostSnapshot != null
      }))
    });
  }

  const purchaseSafe = purchaseRecords.length > 0 && purchaseRecords.every(row =>
    row.unitCost?.isSafeInteger && row.unitCost?.matchesDisplay &&
    row.averageCostBefore?.isSafeInteger && row.averageCostBefore?.matchesDisplay &&
    row.averageCostAfter?.isSafeInteger && row.averageCostAfter?.matchesDisplay
  );
  const saleSafe = saleRecords.length > 0 && saleRecords.every(row =>
    row.unitCostSnapshot?.isSafeInteger && row.unitCostSnapshot?.matchesDisplay &&
    row.lineCogs?.isSafeInteger && row.lineCogs?.matchesDisplay
  );
  const scaledProduction = productionRecords.filter(row => row.hppTotal?.scaled != null);
  const legacyProduction = productionRecords.filter(row => row.legacyFallbackRun);
  const mixedProduction = productionRecords.filter(row =>
    row.hppTotal?.scaled != null && row.components.some(component => component.legacyFallback)
  );
  const productionScaledSafe = scaledProduction.length > 0 && scaledProduction.every(row =>
    row.hppTotal?.isSafeInteger && row.hppTotal?.matchesDisplay &&
    row.hppPerUnit?.isSafeInteger && row.hppPerUnit?.matchesDisplay &&
    row.components.every(component =>
      component.unitCostSnapshot?.isSafeInteger && component.unitCostSnapshot?.matchesDisplay &&
      component.totalCostSnapshot?.isSafeInteger && component.totalCostSnapshot?.matchesDisplay
    )
  );

  const report = {
    generatedAt: new Date().toISOString(),
    store: STORE,
    costScale: COST_SCALE,
    discovery: {
      stockProducts: products.length,
      stockMovements: movements.length,
      purchaseSourceIds: purchaseSources.size,
      saleSourceIds: saleSources.size,
      productionSourceIds: productionSources.size
    },
    counts: {
      purchaseItemsAudited: purchaseRecords.length,
      saleItemsAudited: saleRecords.length,
      productionRunsAudited: productionRecords.length,
      productionRunsScaled: scaledProduction.length,
      productionRunsLegacyFallback: legacyProduction.length,
      productionRunsMixedRunScaledComponentLegacy: mixedProduction.length,
      detailFailures: detailFailures.length
    },
    checks: {
      purchaseUnsuffixedColumnsBehaveAsScaledInteger: purchaseSafe,
      saleUnsuffixedColumnsBehaveAsScaledInteger: saleSafe,
      scaledProductionValuesRoundTripAtOneMillion: productionScaledSafe
    },
    productionRecords,
    purchaseSample: purchaseRecords.slice(0, 20),
    saleSample: saleRecords.slice(0, 20),
    detailFailures,
    note: 'Production Admin API exposes _scaled values and compatibility-resolved display values. For a scaled row it intentionally does not expose the raw legacy REAL column independently; current writer source is required to determine whether that legacy field is NULL.'
  };

  console.log('=== LIVE SCALED COSTING AUDIT ===');
  console.log(JSON.stringify(report, null, 2));

  if (detailFailures.length || !purchaseSafe || !saleSafe || !productionScaledSafe || mixedProduction.length) process.exitCode = 2;
}

main().catch(error => {
  console.error('=== LIVE SCALED COSTING AUDIT FAILED ===');
  console.error(error.stack || error);
  process.exitCode = 1;
});
