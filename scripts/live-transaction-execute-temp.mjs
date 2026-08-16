const BASE = 'https://prototype-leker-v2.daily-napkin.workers.dev';
const STORE = 'G001';
const ADMIN = { username: 'bablil', password: 'bablil123' };
const CASHIERS = { wowo: { username: 'wowo', password: 'wowo123' }, sigma: { username: 'sigma', password: 'sigma123' } };
const stamp = Date.now();
const marker = `API SMOKE ${new Date().toISOString()}`;
const testKindCode = `API_SMOKE_${stamp}`.slice(0, 32);
const testKindName = `API Smoke Barang ${stamp}`;
const testProductName = `[API SMOKE] Barang ${stamp}`;

function assert(condition, message, detail = null) {
  if (condition) return;
  const error = new Error(message);
  if (detail) error.detail = detail;
  throw error;
}
function log(label, value) { console.log(`\n=== ${label} ===`); console.log(JSON.stringify(value, null, 2)); }
async function request(path, { method = 'GET', token = '', body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let payload; try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  return { ok: response.ok, status: response.status, payload };
}
async function must(path, options = {}, label = path) {
  const result = await request(path, options);
  assert(result.ok, `${label} failed HTTP ${result.status}`, result.payload);
  return result.payload;
}
function lines(payload) { return payload?.journal?.lines || payload?.lines || []; }
function hasLine(payload, side, accountId) { return lines(payload).some(line => line.side === side && line.accountId === accountId && Number(line.amountScaled || line.amount || 0) > 0); }
function deliveryOf(payload) { return payload?.accounting?.deliveries?.[0] || payload?.accounting || null; }
function journalIdOf(delivery) { return delivery?.journalReference || delivery?.journalId || null; }
async function ensurePosted(adminToken, factType, factId, initial) {
  if (initial?.bridgeStatus === 'POSTED' && journalIdOf(initial)) return initial;
  const synced = await must(`/api/admin/accounting/bridge/sync?store=${STORE}`, { method: 'POST', token: adminToken, body: { factType, factId } }, `sync ${factType}`);
  const delivery = synced?.delivery || synced?.result || synced;
  assert(journalIdOf(delivery), `${factType} did not produce a journal after sync`, synced);
  return delivery;
}
async function verifyExplorer(adminToken, factType, factId, journalId) {
  const filter = factType === 'SALE' ? 'SALES' : factType === 'PURCHASE' ? 'PURCHASES' : 'OPERATIONS';
  const explorer = await must(`/api/admin/transactions?store=${STORE}&filter=${filter}&limit=100`, { token: adminToken }, `${factType} explorer`);
  const row = (explorer.transactions || []).find(item => item.id === factId && item.kind === factType);
  assert(row, `${factType} fact missing from Transaction Explorer`, { factId, rows: explorer.transactions });
  assert(row.accounting?.syncStatus === 'POSTED', `${factType} Accounting status is not POSTED`, row.accounting);
  assert(row.accounting?.journalReference === journalId, `${factType} journal reference mismatch`, { accounting: row.accounting, journalId });
}

let adminToken = '';
let cashierToken = '';
let testKindId = '';
let testMappingId = '';
let testProductId = null;
let cleanupAttempted = false;

async function cleanup() {
  if (cleanupAttempted || !adminToken) return;
  cleanupAttempted = true;
  const results = [];
  if (testProductId) {
    const r = await request(`/api/admin/master/products/editor/${testProductId}?store=${STORE}`, { method: 'PATCH', token: adminToken, body: { isActive: false } });
    results.push({ target: 'product', id: testProductId, status: r.status, ok: r.ok, note: r.ok ? 'deactivated' : 'endpoint may return 500 after mutation; verify separately if needed' });
  }
  if (testMappingId) {
    const r = await request(`/api/admin/settings/accounting/item-categories/${encodeURIComponent(testMappingId)}?store=${STORE}`, { method: 'PATCH', token: adminToken, body: { isActive: false } });
    results.push({ target: 'itemCategory', id: testMappingId, status: r.status, ok: r.ok });
  }
  if (testKindId) {
    const r = await request(`/api/admin/master/product-kinds/${encodeURIComponent(testKindId)}?store=${STORE}`, { method: 'PATCH', token: adminToken, body: { name: testKindName, isActive: false } });
    results.push({ target: 'productKind', id: testKindId, status: r.status, ok: r.ok });
  }
  log('SYNTHETIC MASTER CLEANUP', results);
}

async function main() {
  log('SMOKE MARKER', { marker });
  const admin = await must('/api/store-admin/login', { method: 'POST', body: ADMIN }, 'admin login');
  adminToken = admin.token;
  assert(adminToken, 'Admin login returned no token', admin);

  const drawers = await must(`/api/admin/drawers?store=${STORE}`, { token: adminToken }, 'drawers');
  const drawer = (drawers.drawers || []).find(row => row.status === 'OPEN');
  assert(drawer, 'No OPEN drawer for smoke test', drawers);
  const credentials = CASHIERS[drawer.cashierUsername];
  assert(credentials, `No documented credential for open-drawer cashier ${drawer.cashierUsername}`, drawer);
  const cashier = await must('/api/cashier/login', { method: 'POST', body: credentials }, 'cashier login');
  cashierToken = cashier.token;
  assert(cashierToken, 'Cashier login returned no token', cashier);

  const settings = await must(`/api/admin/settings/accounting?store=${STORE}`, { token: adminToken }, 'Setting Akuntansi');
  const cash = settings.paymentMethods.find(p => p.code === 'CASH' && p.isActive && p.accountId);
  assert(cash?.isDefault, 'CASH must be the active default mapped payment method for this smoke', cash);
  const saleCategory = settings.transactionCategories.find(c => c.code === 'sale');
  const purchaseCategory = settings.transactionCategories.find(c => c.code === 'purchase_material');
  const operationalCategory = settings.transactionCategories.find(c => c.code === 'operational');
  for (const category of [saleCategory, purchaseCategory, operationalCategory]) assert(category?.isActive && category.completeness === 'COMPLETE', 'Required transaction category is not COMPLETE', category);
  const saleRules = saleCategory.rules.filter(r => r.isActive);
  for (const [side, sourceType] of [['DEBIT','payment_method'],['CREDIT','item_category_revenue'],['DEBIT','item_category_cogs'],['CREDIT','item_category_inventory']]) assert(saleRules.some(r => r.side === side && r.sourceType === sourceType), `SALE rule missing ${side}:${sourceType}`, saleRules);
  const purchaseRules = purchaseCategory.rules.filter(r => r.isActive);
  for (const [side, sourceType] of [['DEBIT','item_category_inventory'],['CREDIT','payment_method']]) assert(purchaseRules.some(r => r.side === side && r.sourceType === sourceType), `PURCHASE rule missing ${side}:${sourceType}`, purchaseRules);
  const operationalRules = operationalCategory.rules.filter(r => r.isActive);
  assert(operationalRules.some(r => r.side === 'DEBIT' && r.sourceType === 'fixed_account' && r.fixedAccountId), 'Operational Debit component missing', operationalRules);
  assert(operationalRules.some(r => r.side === 'CREDIT' && r.sourceType === 'payment_method'), 'Operational payment Credit missing', operationalRules);

  const inventory = settings.accounts.find(a => a.isActive && a.code === '1303' && a.type === 'ASSET') || settings.accounts.find(a => a.isActive && a.subtype === 'INVENTORY' && a.type === 'ASSET');
  const cogs = settings.accounts.find(a => a.isActive && a.code === '5101' && a.type === 'EXPENSE') || settings.accounts.find(a => a.isActive && a.subtype === 'COGS' && a.type === 'EXPENSE');
  const revenue = settings.accounts.find(a => a.isActive && a.code === '4101' && a.type === 'REVENUE') || settings.accounts.find(a => a.isActive && a.subtype === 'SALES' && a.type === 'REVENUE');
  assert(inventory && cogs && revenue, 'Accounting-owned accounts needed for synthetic Product Kind are missing', { inventory, cogs, revenue });
  log('SETTING AKUNTANSI READY', { cashAccountId: cash.accountId, inventoryAccountId: inventory.id, cogsAccountId: cogs.id, revenueAccountId: revenue.id, saleRules, purchaseRules, operationalRules });

  const kindCreated = await must(`/api/admin/master/product-kinds?store=${STORE}`, { method: 'POST', token: adminToken, body: { code: testKindCode, name: testKindName } }, 'create synthetic Product Kind');
  testKindId = kindCreated.id;
  assert(testKindId, 'Synthetic Product Kind response missing id', kindCreated);
  const mappingCreated = await must(`/api/admin/settings/accounting/item-categories?store=${STORE}`, { method: 'POST', token: adminToken, body: { productKindId: testKindId, name: testKindName, inventoryAccountId: inventory.id, cogsAccountId: cogs.id, revenueAccountId: revenue.id, isActive: true } }, 'map synthetic Product Kind in Setting Akuntansi');
  testMappingId = mappingCreated.id;
  assert(testMappingId, 'Synthetic item-category mapping response missing id', mappingCreated);

  const productCreate = await request(`/api/admin/master/products/editor?store=${STORE}`, {
    method: 'POST', token: adminToken,
    body: { name: testProductName, purchasePrice: 1000, price: 2000, category: 'API Smoke', emoji: '🧪', productKindId: testKindId, itemTypeId: 'item_type_store_001_finished', baseUnitId: 'unit_store_001_pcs', stockTrackingEnabled: true, isActive: true }
  });
  if (productCreate.ok) testProductId = Number(productCreate.payload.id);
  if (!testProductId) {
    const optionsAfterCreate = await must('/api/cashier/purchases/options', { token: cashierToken }, 'verify synthetic product after Product Master response');
    const created = (optionsAfterCreate.products || []).find(p => p.productName === testProductName && p.productKindId === testKindId);
    assert(created, 'Product Master did not expose the synthetic product after create attempt', { createStatus: productCreate.status, createPayload: productCreate.payload, products: optionsAfterCreate.products });
    testProductId = Number(created.productId);
  }
  log('SYNTHETIC MASTER READY', { testKindId, testMappingId, testProductId, testProductName, productCreateHttp: productCreate.status });

  const purchase = await must('/api/cashier/purchases', { method: 'POST', token: cashierToken, body: { items: [{ productId: testProductId, quantity: 1, lineTotal: 1000 }], description: marker, note: 'API-only PURCHASE smoke', paymentMethod: 'CASH' } }, 'PURCHASE transaction');
  assert(purchase.id, 'PURCHASE fact id missing', purchase);
  const purchaseDelivery = await ensurePosted(adminToken, 'PURCHASE', purchase.id, deliveryOf(purchase));
  const purchaseJournalId = journalIdOf(purchaseDelivery);
  const purchaseJournal = await must(`/api/admin/accounting/journals/${encodeURIComponent(purchaseJournalId)}?store=${STORE}`, { token: adminToken }, 'PURCHASE journal');
  assert(hasLine(purchaseJournal, 'DEBIT', inventory.id), 'PURCHASE did not Debit Setting Akuntansi Inventory account', { expected: inventory.id, lines: lines(purchaseJournal) });
  assert(hasLine(purchaseJournal, 'CREDIT', cash.accountId), 'PURCHASE did not Credit Setting Akuntansi payment account', { expected: cash.accountId, lines: lines(purchaseJournal) });
  await verifyExplorer(adminToken, 'PURCHASE', purchase.id, purchaseJournalId);
  log('PURCHASE PASS', { factId: purchase.id, journalId: purchaseJournalId, expected: { debit: inventory.id, credit: cash.accountId }, lines: lines(purchaseJournal) });

  const workspaceAfterPurchase = await must('/api/cashier/workspace', { token: cashierToken }, 'workspace after purchase');
  const sellable = (workspaceAfterPurchase.products || []).find(p => Number(p.id) === testProductId);
  assert(sellable, 'Synthetic product is not available to SALE after PURCHASE', workspaceAfterPurchase.products);
  const sale = await must('/api/cashier/sales', { method: 'POST', token: cashierToken, body: { items: [{ productId: testProductId, quantity: 1 }], customerName: 'API Smoke', note: marker, paymentMethod: 'CASH' } }, 'SALE transaction');
  const saleId = sale?.sale?.id;
  assert(saleId, 'SALE fact id missing', sale);
  const saleDelivery = await ensurePosted(adminToken, 'SALE', saleId, deliveryOf(sale));
  const saleJournalId = journalIdOf(saleDelivery);
  const saleJournal = await must(`/api/admin/accounting/journals/${encodeURIComponent(saleJournalId)}?store=${STORE}`, { token: adminToken }, 'SALE journal');
  assert(hasLine(saleJournal, 'DEBIT', cash.accountId), 'SALE did not Debit Setting Akuntansi payment account', { expected: cash.accountId, lines: lines(saleJournal) });
  assert(hasLine(saleJournal, 'CREDIT', revenue.id), 'SALE did not Credit Setting Akuntansi Revenue account', { expected: revenue.id, lines: lines(saleJournal) });
  assert(hasLine(saleJournal, 'DEBIT', cogs.id), 'SALE did not Debit Setting Akuntansi HPP account', { expected: cogs.id, lines: lines(saleJournal) });
  assert(hasLine(saleJournal, 'CREDIT', inventory.id), 'SALE did not Credit Setting Akuntansi Inventory account', { expected: inventory.id, lines: lines(saleJournal) });
  await verifyExplorer(adminToken, 'SALE', saleId, saleJournalId);
  log('SALE PASS', { factId: saleId, journalId: saleJournalId, expected: { debitPayment: cash.accountId, creditRevenue: revenue.id, debitCogs: cogs.id, creditInventory: inventory.id }, lines: lines(saleJournal) });

  const costOptions = await must('/api/cashier/cost-masters/options', { token: cashierToken }, 'cost options');
  const cost = (costOptions.costs || []).find(c => c.accountingComponentRuleId && Number(c.outgoingAmount || 0) > 0) || (costOptions.costs || []).find(c => c.accountingComponentRuleId);
  assert(cost, 'No Cost Master linked to an Accounting component', costOptions.costs);
  const costRule = operationalRules.find(r => r.id === cost.accountingComponentRuleId && r.isActive && r.side === 'DEBIT' && r.sourceType === 'fixed_account' && r.fixedAccountId);
  assert(costRule?.fixedAccountId, 'Cost Master component does not resolve to operational Debit fixed account', { cost, operationalRules });
  const expense = await must('/api/cashier/expenses', { method: 'POST', token: cashierToken, body: { items: [{ costMasterId: cost.id, quantity: 1, unitAmount: Math.max(1, Number(cost.outgoingAmount || 1000)) }], paymentMethod: 'CASH' } }, 'EXPENSE transaction');
  const expenseId = expense.ids?.[0] || expense.id;
  assert(expenseId, 'EXPENSE fact id missing', expense);
  const expenseDelivery = await ensurePosted(adminToken, 'EXPENSE', expenseId, deliveryOf(expense));
  const expenseJournalId = journalIdOf(expenseDelivery);
  const expenseJournal = await must(`/api/admin/accounting/journals/${encodeURIComponent(expenseJournalId)}?store=${STORE}`, { token: adminToken }, 'EXPENSE journal');
  assert(hasLine(expenseJournal, 'DEBIT', costRule.fixedAccountId), 'EXPENSE did not Debit configured operational account', { expected: costRule.fixedAccountId, lines: lines(expenseJournal) });
  assert(hasLine(expenseJournal, 'CREDIT', cash.accountId), 'EXPENSE did not Credit configured payment account', { expected: cash.accountId, lines: lines(expenseJournal) });
  await verifyExplorer(adminToken, 'EXPENSE', expenseId, expenseJournalId);
  log('EXPENSE PASS', { factId: expenseId, journalId: expenseJournalId, costMasterId: cost.id, componentRuleId: cost.accountingComponentRuleId, expected: { debit: costRule.fixedAccountId, credit: cash.accountId }, lines: lines(expenseJournal) });

  log('FINAL LIVE TRANSACTION SMOKE PASS', { marker, store: STORE, drawerId: drawer.id, cashier: drawer.cashierUsername, facts: { purchase: { id: purchase.id, journalId: purchaseJournalId }, sale: { id: saleId, journalId: saleJournalId }, expense: { id: expenseId, journalId: expenseJournalId } } });
}

main().then(cleanup).catch(async error => {
  console.error('\n=== LIVE TRANSACTION SMOKE FAIL ===');
  console.error(error.stack || error);
  if (error.detail) console.error(JSON.stringify(error.detail, null, 2));
  try { await cleanup(); } catch (cleanupError) { console.error('Cleanup failed:', cleanupError.stack || cleanupError); }
  process.exitCode = 1;
});
