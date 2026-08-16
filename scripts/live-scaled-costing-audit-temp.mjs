const BASE = 'https://prototype-leker-v2.daily-napkin.workers.dev';
const STORE = 'G001';
const COST_SCALE = 1_000_000;
const MAX_PAGES = 20;

async function req(path, { method = 'GET', token = '', body } = {}) {
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
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${JSON.stringify(payload)}`);
    return payload;
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

async function allTransactions(token, filter) {
  const rows = [];
  let before = '';
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ store: STORE, filter, limit: '100' });
    if (before) query.set('before', before);
    const payload = await req(`/api/admin/transactions?${query}`, { token });
    rows.push(...(payload.transactions || []));
    if (!payload.hasMore || !payload.nextCursor) return rows;
    before = payload.nextCursor;
  }
  throw new Error(`${filter} pagination exceeded ${MAX_PAGES} pages`);
}

async function main() {
  const login = await req('/api/store-admin/login', {
    method: 'POST',
    body: { username: 'bablil', password: 'bablil123' }
  });
  const token = login.token;
  if (!token) throw new Error('Admin token missing');

  const [purchaseTx, saleTx, inventoryTx] = await Promise.all([
    allTransactions(token, 'PURCHASES'),
    allTransactions(token, 'SALES'),
    allTransactions(token, 'INVENTORY')
  ]);
  const productionTx = inventoryTx.filter(row => row.kind === 'PRODUCTION');

  const purchaseRecords = [];
  for (const tx of purchaseTx) {
    const payload = await req(`/api/admin/transactions/detail/PURCHASE/${encodeURIComponent(tx.id)}?store=${STORE}`, { token });
    for (const item of payload.detail?.items || []) {
      purchaseRecords.push({
        purchaseId: tx.id,
        occurredAt: tx.occurredAt,
        productId: item.productId,
        unitCost: scaledConsistency(item.unitCost, item.unitCostScaled),
        averageCostBefore: scaledConsistency(item.averageCostBefore, item.averageCostBeforeScaled),
        averageCostAfter: scaledConsistency(item.averageCostAfter, item.averageCostAfterScaled)
      });
    }
  }

  const saleRecords = [];
  for (const tx of saleTx) {
    const payload = await req(`/api/admin/transactions/detail/SALE/${encodeURIComponent(tx.id)}?store=${STORE}`, { token });
    for (const item of payload.detail?.items || []) {
      saleRecords.push({
        saleId: tx.id,
        occurredAt: tx.occurredAt,
        productId: item.productId,
        unitCostSnapshot: scaledConsistency(item.unitCostSnapshot, item.unitCostSnapshotScaled),
        lineCogs: scaledConsistency(item.lineCogs, item.lineCogsScaled),
        productionRunId: item.productionRunId || null
      });
    }
  }

  const productionRecords = [];
  for (const tx of productionTx) {
    const payload = await req(`/api/admin/transactions/detail/PRODUCTION/${encodeURIComponent(tx.id)}?store=${STORE}`, { token });
    const detail = payload.detail || {};
    productionRecords.push({
      productionRunId: tx.id,
      occurredAt: tx.occurredAt,
      mode: detail.mode,
      hppTotal: scaledConsistency(detail.hppTotal, detail.hppTotalScaled),
      hppPerUnit: scaledConsistency(detail.hppPerUnit, detail.hppPerUnitScaled),
      legacyFallbackRun: detail.hppTotalScaled == null && detail.hppTotal != null,
      components: (detail.components || []).map(component => ({
        productId: component.productId,
        unitCostSnapshot: scaledConsistency(component.unitCostSnapshot, component.unitCostSnapshotScaled),
        totalCostSnapshot: scaledConsistency(component.totalCostSnapshot, component.totalCostSnapshotScaled),
        legacyFallback: component.unitCostSnapshotScaled == null && component.unitCostSnapshot != null
      }))
    });
  }

  const purchaseSafe = purchaseRecords.every(row =>
    row.unitCost?.isSafeInteger && row.unitCost?.matchesDisplay &&
    row.averageCostBefore?.isSafeInteger && row.averageCostBefore?.matchesDisplay &&
    row.averageCostAfter?.isSafeInteger && row.averageCostAfter?.matchesDisplay
  );
  const saleSafe = saleRecords.every(row =>
    row.unitCostSnapshot?.isSafeInteger && row.unitCostSnapshot?.matchesDisplay &&
    row.lineCogs?.isSafeInteger && row.lineCogs?.matchesDisplay
  );
  const scaledProduction = productionRecords.filter(row => row.hppTotal?.scaled != null);
  const legacyProduction = productionRecords.filter(row => row.legacyFallbackRun);
  const mixedProduction = productionRecords.filter(row =>
    row.hppTotal?.scaled != null && row.components.some(component => component.legacyFallback)
  );
  const productionScaledSafe = scaledProduction.every(row =>
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
    counts: {
      purchaseTransactions: purchaseTx.length,
      purchaseItems: purchaseRecords.length,
      saleTransactions: saleTx.length,
      saleItems: saleRecords.length,
      productionRuns: productionRecords.length,
      productionRunsScaled: scaledProduction.length,
      productionRunsLegacyFallback: legacyProduction.length,
      productionRunsMixedRunScaledComponentLegacy: mixedProduction.length
    },
    checks: {
      purchaseUnsuffixedColumnsBehaveAsScaledInteger: purchaseSafe,
      saleUnsuffixedColumnsBehaveAsScaledInteger: saleSafe,
      scaledProductionValuesRoundTripAtOneMillion: productionScaledSafe
    },
    productionRecords,
    purchaseSample: purchaseRecords.slice(0, 12),
    saleSample: saleRecords.slice(0, 12),
    note: 'Production Admin API exposes _scaled values and compatibility-resolved display values. For a scaled row it intentionally does not expose the raw legacy REAL column independently; current writer source must be used to determine whether that legacy field is NULL.'
  };

  console.log('=== LIVE SCALED COSTING AUDIT ===');
  console.log(JSON.stringify(report, null, 2));

  if (!purchaseSafe || !saleSafe || !productionScaledSafe || mixedProduction.length) {
    process.exitCode = 2;
  }
}

main().catch(error => {
  console.error('=== LIVE SCALED COSTING AUDIT FAILED ===');
  console.error(error.stack || error);
  process.exitCode = 1;
});
