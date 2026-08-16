const BASE = 'https://prototype-leker-v2.daily-napkin.workers.dev';
const STORE = 'G001';
const ADMIN = { username: 'bablil', password: 'bablil123' };
const CASHIERS = {
  wowo: { username: 'wowo', password: 'wowo123' },
  sigma: { username: 'sigma', password: 'sigma123' }
};
const marker = `API SMOKE ${new Date().toISOString()}`;

function assert(condition, message, detail = null) {
  if (condition) return;
  const error = new Error(message);
  if (detail) error.detail = detail;
  throw error;
}

function log(label, value) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(value, null, 2));
}

async function request(path, { method = 'GET', token = '', body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
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
  return { ok: response.ok, status: response.status, payload };
}

async function must(path, options = {}, label = path) {
  const result = await request(path, options);
  assert(result.ok, `${label} failed HTTP ${result.status}`, result.payload);
  return result.payload;
}

function journalLines(payload) {
  return payload?.journal?.lines || payload?.lines || [];
}

function hasJournalLine(payload, side, accountId) {
  return journalLines(payload).some(line =>
    line.side === side &&
    line.accountId === accountId &&
    Number(line.amountScaled || line.amount || 0) > 0
  );
}

function deliveryOf(payload) {
  return payload?.accounting?.deliveries?.[0] || payload?.accounting || null;
}

function journalReferenceOf(delivery) {
  return delivery?.journalReference || delivery?.journalId || null;
}

async function verifyExplorer(adminToken, factType, factId, journalId) {
  const filter = factType === 'SALE' ? 'SALES' : factType === 'PURCHASE' ? 'PURCHASES' : 'OPERATIONS';
  const explorer = await must(`/api/admin/transactions?store=${STORE}&filter=${filter}&limit=100`, { token: adminToken }, `${factType} Transaction Explorer`);
  const row = (explorer.transactions || []).find(item => item.id === factId && item.kind === factType);
  assert(row, `${factType} fact ${factId} was not found in Transaction Explorer`, explorer.transactions);
  assert(row.accounting?.syncStatus === 'POSTED', `${factType} fact exists but Accounting syncStatus is not POSTED`, row.accounting);
  assert(row.accounting?.journalReference === journalId, `${factType} explorer journal reference differs from bridge result`, { accounting: row.accounting, journalId });
  return row;
}

async function ensurePosted(adminToken, factType, factId, initialDelivery) {
  if (initialDelivery?.bridgeStatus === 'POSTED' && journalReferenceOf(initialDelivery)) return initialDelivery;
  const synced = await must(`/api/admin/accounting/bridge/sync?store=${STORE}`, {
    method: 'POST', token: adminToken, body: { factType, factId }
  }, `manual bridge sync ${factType}`);
  const delivery = synced?.delivery || synced?.result || synced;
  assert(delivery?.bridgeStatus === 'POSTED' || delivery?.status === 'POSTED' || journalReferenceOf(delivery), `${factType} manual bridge sync did not produce a posted journal`, synced);
  return delivery;
}

async function main() {
  log('SMOKE MARKER', { marker });

  const admin = await must('/api/store-admin/login', { method: 'POST', body: ADMIN }, 'admin login');
  assert(admin.token, 'Admin login returned no token', admin);
  const adminToken = admin.token;

  const drawers = await must(`/api/admin/drawers?store=${STORE}`, { token: adminToken }, 'list drawers');
  const drawer = (drawers.drawers || []).find(item => item.status === 'OPEN');
  assert(drawer, 'No OPEN drawer exists for API smoke', drawers);
  const cashierCreds = CASHIERS[drawer.cashierUsername];
  assert(cashierCreds, `OPEN drawer belongs to cashier without documented demo credential: ${drawer.cashierUsername}`, drawer);
  const cashier = await must('/api/cashier/login', { method: 'POST', body: cashierCreds }, 'cashier login');
  assert(cashier.token, 'Cashier login returned no token', cashier);
  const cashierToken = cashier.token;

  const [settings, workspace, purchaseOptions, costOptions] = await Promise.all([
    must(`/api/admin/settings/accounting?store=${STORE}`, { token: adminToken }, 'Setting Akuntansi'),
    must('/api/cashier/workspace', { token: cashierToken }, 'cashier workspace'),
    must('/api/cashier/purchases/options', { token: cashierToken }, 'purchase options'),
    must('/api/cashier/cost-masters/options', { token: cashierToken }, 'cost options')
  ]);

  const activeDefaults = settings.paymentMethods.filter(item => item.isActive && item.isDefault);
  assert(activeDefaults.length === 1, 'Setting Akuntansi must expose exactly one active default payment method', activeDefaults);
  const cash = settings.paymentMethods.find(item => item.code === 'CASH' && item.isActive);
  assert(cash?.accountId, 'CASH payment method is not linked to an Accounting account', cash);

  const categories = Object.fromEntries(['sale', 'purchase_material', 'operational'].map(code => [code, settings.transactionCategories.find(item => item.code === code)]));
  for (const [code, category] of Object.entries(categories)) {
    assert(category?.isActive, `${code} transaction category is not active`, category);
    assert(category?.completeness === 'COMPLETE', `${code} transaction category is not COMPLETE`, category);
  }

  const saleRules = categories.sale.rules.filter(rule => rule.isActive);
  const purchaseRules = categories.purchase_material.rules.filter(rule => rule.isActive);
  const operationalRules = categories.operational.rules.filter(rule => rule.isActive);
  for (const [side, sourceType] of [
    ['DEBIT', 'payment_method'],
    ['CREDIT', 'item_category_revenue'],
    ['DEBIT', 'item_category_cogs'],
    ['CREDIT', 'item_category_inventory']
  ]) {
    assert(saleRules.some(rule => rule.side === side && rule.sourceType === sourceType), `SALE rule missing ${side}:${sourceType}`, saleRules);
  }
  for (const [side, sourceType] of [['DEBIT', 'item_category_inventory'], ['CREDIT', 'payment_method']]) {
    assert(purchaseRules.some(rule => rule.side === side && rule.sourceType === sourceType), `PURCHASE rule missing ${side}:${sourceType}`, purchaseRules);
  }
  assert(operationalRules.some(rule => rule.side === 'CREDIT' && rule.sourceType === 'payment_method'), 'EXPENSE rule missing CREDIT:payment_method', operationalRules);

  log('SETTING AKUNTANSI READY', {
    paymentMethod: { code: cash.code, accountId: cash.accountId, accountCode: cash.accountCode, accountName: cash.accountName, isDefault: cash.isDefault },
    categories: {
      sale: { completeness: categories.sale.completeness, rules: saleRules.map(rule => ({ id: rule.id, side: rule.side, sourceType: rule.sourceType, fixedAccountId: rule.fixedAccountId })) },
      purchase_material: { completeness: categories.purchase_material.completeness, rules: purchaseRules.map(rule => ({ id: rule.id, side: rule.side, sourceType: rule.sourceType, fixedAccountId: rule.fixedAccountId })) },
      operational: { completeness: categories.operational.completeness, rules: operationalRules.map(rule => ({ id: rule.id, side: rule.side, sourceType: rule.sourceType, fixedAccountId: rule.fixedAccountId })) }
    }
  });

  // PURCHASE: choose a real purchasable product and prove the journal uses its Product Kind mapping.
  const purchaseProduct = (purchaseOptions.products || []).find(item => item.productKindId && Number(item.purchasePrice || item.lastPurchasePrice || 0) > 0)
    || (purchaseOptions.products || []).find(item => item.productKindId);
  assert(purchaseProduct, 'No purchasable product with Product Kind is available', purchaseOptions.products);
  const purchaseMapping = settings.itemCategories.find(item => item.productKindId === purchaseProduct.productKindId && item.isActive);
  assert(purchaseMapping?.inventoryAccountId, `No active item mapping for purchase Product Kind ${purchaseProduct.productKindId}`, purchaseMapping);
  const purchaseAmount = Math.max(1, Math.round(Number(purchaseProduct.purchasePrice || purchaseProduct.lastPurchasePrice || 1000)));
  const purchase = await must('/api/cashier/purchases', {
    method: 'POST', token: cashierToken,
    body: {
      items: [{ productId: Number(purchaseProduct.id), quantity: 1, lineTotal: purchaseAmount }],
      description: marker,
      note: 'API-only PURCHASE smoke',
      paymentMethod: 'CASH'
    }
  }, 'PURCHASE transaction');
  assert(purchase.id, 'PURCHASE response has no fact id', purchase);
  const purchaseDelivery = await ensurePosted(adminToken, 'PURCHASE', purchase.id, deliveryOf(purchase));
  const purchaseJournalId = journalReferenceOf(purchaseDelivery);
  assert(purchaseJournalId, 'PURCHASE has no journal reference after bridge processing', purchaseDelivery);
  const purchaseJournal = await must(`/api/admin/accounting/journals/${encodeURIComponent(purchaseJournalId)}?store=${STORE}`, { token: adminToken }, 'PURCHASE journal');
  assert(hasJournalLine(purchaseJournal, 'DEBIT', purchaseMapping.inventoryAccountId), 'PURCHASE journal did not Debit the Inventory account from Setting Akuntansi', { expectedAccountId: purchaseMapping.inventoryAccountId, lines: journalLines(purchaseJournal) });
  assert(hasJournalLine(purchaseJournal, 'CREDIT', cash.accountId), 'PURCHASE journal did not Credit the payment account from Setting Akuntansi', { expectedAccountId: cash.accountId, lines: journalLines(purchaseJournal) });
  await verifyExplorer(adminToken, 'PURCHASE', purchase.id, purchaseJournalId);
  log('PURCHASE PASS', {
    factId: purchase.id,
    product: { id: purchaseProduct.id, name: purchaseProduct.name, productKindId: purchaseProduct.productKindId },
    journalId: purchaseJournalId,
    expectedFromSetting: { debitInventory: purchaseMapping.inventoryAccountId, creditPayment: cash.accountId },
    lines: journalLines(purchaseJournal)
  });

  // SALE: commit through the API, then read the snapshotted Product Kind from canonical transaction detail.
  const saleFailures = [];
  let sale = null;
  let saleProduct = null;
  for (const product of workspace.products || []) {
    const attempt = await request('/api/cashier/sales', {
      method: 'POST', token: cashierToken,
      body: { items: [{ productId: Number(product.id), quantity: 1 }], customerName: 'API Smoke', note: marker, paymentMethod: 'CASH' }
    });
    if (attempt.ok) {
      sale = attempt.payload;
      saleProduct = product;
      break;
    }
    saleFailures.push({ productId: product.id, name: product.name, status: attempt.status, payload: attempt.payload });
  }
  assert(sale?.sale?.id, 'No SALE candidate could be committed', saleFailures);
  const saleId = sale.sale.id;
  const saleDetail = await must(`/api/admin/transactions/detail/SALE/${encodeURIComponent(saleId)}?store=${STORE}`, { token: adminToken }, 'SALE transaction detail');
  const saleLine = saleDetail?.detail?.items?.[0];
  assert(saleLine?.productKindId, 'SALE detail does not expose the snapshotted Product Kind', saleDetail);
  const saleMapping = settings.itemCategories.find(item => item.productKindId === saleLine.productKindId && item.isActive);
  assert(saleMapping?.inventoryAccountId && saleMapping?.cogsAccountId && saleMapping?.revenueAccountId, `SALE Product Kind ${saleLine.productKindId} is not fully linked in Setting Akuntansi`, saleMapping);
  const saleDelivery = await ensurePosted(adminToken, 'SALE', saleId, deliveryOf(sale));
  const saleJournalId = journalReferenceOf(saleDelivery);
  assert(saleJournalId, 'SALE has no journal reference after bridge processing', saleDelivery);
  const saleJournal = await must(`/api/admin/accounting/journals/${encodeURIComponent(saleJournalId)}?store=${STORE}`, { token: adminToken }, 'SALE journal');
  assert(hasJournalLine(saleJournal, 'DEBIT', cash.accountId), 'SALE journal did not Debit the payment account from Setting Akuntansi', { expectedAccountId: cash.accountId, lines: journalLines(saleJournal) });
  assert(hasJournalLine(saleJournal, 'CREDIT', saleMapping.revenueAccountId), 'SALE journal did not Credit the Revenue account from Setting Akuntansi', { expectedAccountId: saleMapping.revenueAccountId, lines: journalLines(saleJournal) });
  assert(hasJournalLine(saleJournal, 'DEBIT', saleMapping.cogsAccountId), 'SALE journal did not Debit the HPP account from Setting Akuntansi', { expectedAccountId: saleMapping.cogsAccountId, lines: journalLines(saleJournal) });
  assert(hasJournalLine(saleJournal, 'CREDIT', saleMapping.inventoryAccountId), 'SALE journal did not Credit the Inventory account from Setting Akuntansi', { expectedAccountId: saleMapping.inventoryAccountId, lines: journalLines(saleJournal) });
  await verifyExplorer(adminToken, 'SALE', saleId, saleJournalId);
  log('SALE PASS', {
    factId: saleId,
    product: { id: saleProduct.id, name: saleProduct.name, productKindId: saleLine.productKindId },
    journalId: saleJournalId,
    expectedFromSetting: {
      debitPayment: cash.accountId,
      creditRevenue: saleMapping.revenueAccountId,
      debitCogs: saleMapping.cogsAccountId,
      creditInventory: saleMapping.inventoryAccountId
    },
    lines: journalLines(saleJournal),
    failedCandidatesBeforeSuccess: saleFailures
  });

  // EXPENSE: use a real Cost Master whose Cost Type already points at an operational Accounting component rule.
  const cost = (costOptions.costs || []).find(item => item.accountingComponentRuleId && Number(item.outgoingAmount || 0) > 0)
    || (costOptions.costs || []).find(item => item.accountingComponentRuleId);
  assert(cost, 'No Cost Master linked to an operational Accounting component is available', costOptions.costs);
  const costRule = operationalRules.find(rule => rule.id === cost.accountingComponentRuleId && rule.side === 'DEBIT' && rule.sourceType === 'fixed_account' && rule.fixedAccountId);
  assert(costRule?.fixedAccountId, 'Cost Master Accounting component is not an active fixed-account Debit rule in Setting Akuntansi', { cost, operationalRules });
  const expense = await must('/api/cashier/expenses', {
    method: 'POST', token: cashierToken,
    body: {
      items: [{ costMasterId: cost.id, quantity: 1, unitAmount: Math.max(1, Number(cost.outgoingAmount || 1000)) }],
      paymentMethod: 'CASH'
    }
  }, 'EXPENSE transaction');
  const expenseId = expense.ids?.[0] || expense.id;
  assert(expenseId, 'EXPENSE response has no fact id', expense);
  const expenseDelivery = await ensurePosted(adminToken, 'EXPENSE', expenseId, deliveryOf(expense));
  const expenseJournalId = journalReferenceOf(expenseDelivery);
  assert(expenseJournalId, 'EXPENSE has no journal reference after bridge processing', expenseDelivery);
  const expenseJournal = await must(`/api/admin/accounting/journals/${encodeURIComponent(expenseJournalId)}?store=${STORE}`, { token: adminToken }, 'EXPENSE journal');
  assert(hasJournalLine(expenseJournal, 'DEBIT', costRule.fixedAccountId), 'EXPENSE journal did not Debit the configured operational account', { expectedAccountId: costRule.fixedAccountId, lines: journalLines(expenseJournal) });
  assert(hasJournalLine(expenseJournal, 'CREDIT', cash.accountId), 'EXPENSE journal did not Credit the payment account from Setting Akuntansi', { expectedAccountId: cash.accountId, lines: journalLines(expenseJournal) });
  await verifyExplorer(adminToken, 'EXPENSE', expenseId, expenseJournalId);
  log('EXPENSE PASS', {
    factId: expenseId,
    costMaster: { id: cost.id, name: cost.name, accountingComponentRuleId: cost.accountingComponentRuleId },
    journalId: expenseJournalId,
    expectedFromSetting: { debitOperational: costRule.fixedAccountId, creditPayment: cash.accountId },
    lines: journalLines(expenseJournal)
  });

  log('FINAL LIVE TRANSACTION SMOKE PASS', {
    marker,
    store: STORE,
    drawerId: drawer.id,
    cashier: drawer.cashierUsername,
    settingsChanged: false,
    facts: {
      purchase: { id: purchase.id, journalId: purchaseJournalId },
      sale: { id: saleId, journalId: saleJournalId },
      expense: { id: expenseId, journalId: expenseJournalId }
    }
  });
}

main().catch(error => {
  console.error('\n=== LIVE TRANSACTION SMOKE FAIL ===');
  console.error(error.stack || error);
  if (error.detail) console.error(JSON.stringify(error.detail, null, 2));
  process.exitCode = 1;
});
