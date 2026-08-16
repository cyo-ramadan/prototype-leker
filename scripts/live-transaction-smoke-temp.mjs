const BASE = 'https://prototype-leker-v2.daily-napkin.workers.dev';
const STORE = 'G001';
const ADMIN = { username: 'bablil', password: 'bablil123' };
const CASHIERS = [
  { username: 'wowo', password: 'wowo123' },
  { username: 'sigma', password: 'sigma123' }
];
const marker = `API SMOKE ${new Date().toISOString()}`;

function log(label, value) {
  console.log(`\n=== ${label} ===`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}
function assert(condition, message, detail = null) {
  if (condition) return;
  const error = new Error(message);
  if (detail) error.detail = detail;
  throw error;
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
async function adminLogin() {
  const payload = await must('/api/store-admin/login', { method: 'POST', body: ADMIN }, 'admin login');
  assert(payload.token, 'Admin login returned no token', payload);
  return payload.token;
}
async function cashierLogin(username) {
  const creds = CASHIERS.find(item => item.username === username);
  assert(creds, `No documented demo credential for drawer cashier ${username}`);
  const payload = await must('/api/cashier/login', { method: 'POST', body: creds }, `cashier login ${username}`);
  assert(payload.token, `Cashier ${username} login returned no token`, payload);
  return payload.token;
}
async function settings(adminToken) {
  return must(`/api/admin/settings/accounting?store=${STORE}`, { token: adminToken }, 'load Setting Akuntansi');
}
function activeAccount(s, id, type = null) {
  const row = s.accounts.find(a => a.id === id && a.isActive);
  return row && (!type || row.type === type) ? row : null;
}
function semanticAccount(s, type, terms) {
  const rows = s.accounts.filter(a => a.isActive && a.type === type);
  const scored = rows.map(account => {
    const hay = `${account.code} ${account.name} ${account.subtype}`.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (hay.includes(term.toLowerCase()) ? 1 : 0), 0);
    return { account, score };
  }).sort((a, b) => b.score - a.score || String(a.account.code).localeCompare(String(b.account.code)));
  return scored[0]?.score > 0 ? scored[0].account : rows[0] || null;
}
async function ensureAccount(adminToken, s, type, terms, fallbackName) {
  let account = semanticAccount(s, type, terms);
  if (account) return { account, settings: s, created: false };
  const created = await must(`/api/admin/accounting/accounts?store=${STORE}`, {
    method: 'POST', token: adminToken,
    body: { accountName: fallbackName, accountType: type, subtype: 'API_SMOKE_SUPPORT' }
  }, `create ${type} account`);
  s = await settings(adminToken);
  account = s.accounts.find(a => a.id === created.accountId) || semanticAccount(s, type, [fallbackName]);
  assert(account, `Created ${type} account cannot be resolved`, created);
  return { account, settings: s, created: true };
}
async function ensureCoreAccounts(adminToken, s) {
  const changes = [];
  let r = await ensureAccount(adminToken, s, 'ASSET', ['kas', 'cash'], 'Kas Operasional API Smoke'); s = r.settings; if (r.created) changes.push(`created ASSET ${r.account.id}`); const cashFallback = r.account;
  r = await ensureAccount(adminToken, s, 'ASSET', ['persediaan', 'inventory'], 'Persediaan API Smoke'); s = r.settings; if (r.created) changes.push(`created ASSET ${r.account.id}`); const inventory = semanticAccount(s, 'ASSET', ['persediaan', 'inventory']) || r.account;
  r = await ensureAccount(adminToken, s, 'EXPENSE', ['hpp', 'harga pokok'], 'HPP API Smoke'); s = r.settings; if (r.created) changes.push(`created EXPENSE ${r.account.id}`); const cogs = semanticAccount(s, 'EXPENSE', ['hpp', 'harga pokok']) || r.account;
  r = await ensureAccount(adminToken, s, 'REVENUE', ['penjualan', 'pendapatan', 'revenue'], 'Pendapatan Penjualan API Smoke'); s = r.settings; if (r.created) changes.push(`created REVENUE ${r.account.id}`); const revenue = semanticAccount(s, 'REVENUE', ['penjualan', 'pendapatan', 'revenue']) || r.account;
  r = await ensureAccount(adminToken, s, 'EXPENSE', ['beban operasional', 'operasional'], 'Beban Operasional API Smoke'); s = r.settings; if (r.created) changes.push(`created EXPENSE ${r.account.id}`); const operational = semanticAccount(s, 'EXPENSE', ['beban operasional', 'operasional']) || r.account;
  return { settings: s, changes, cashFallback, inventory, cogs, revenue, operational };
}
async function ensureCashPayment(adminToken, s, cashFallback) {
  const changes = [];
  let cash = s.paymentMethods.find(p => p.code === 'CASH');
  const validMapped = cash?.isActive && cash.accountId && activeAccount(s, cash.accountId);
  const activeDefaults = s.paymentMethods.filter(p => p.isActive && p.isDefault);
  if (!cash) {
    await must(`/api/admin/settings/accounting/payment-methods?store=${STORE}`, {
      method: 'POST', token: adminToken,
      body: { code: 'CASH', name: 'Tunai', accountId: cashFallback.id, isActive: true, isDefault: activeDefaults.length === 0 }
    }, 'create CASH payment');
    changes.push('created CASH payment');
  } else if (!validMapped || activeDefaults.length === 0) {
    const accountId = validMapped ? cash.accountId : cashFallback.id;
    await must(`/api/admin/settings/accounting/payment-methods/${encodeURIComponent(cash.id)}?store=${STORE}`, {
      method: 'PATCH', token: adminToken,
      body: { name: cash.name || 'Tunai', accountId, isActive: true, isDefault: cash.isDefault || activeDefaults.length === 0 }
    }, 'repair CASH payment');
    changes.push(`repaired CASH payment ${cash.id}`);
  }
  s = await settings(adminToken);
  cash = s.paymentMethods.find(p => p.code === 'CASH' && p.isActive);
  assert(cash?.accountId && activeAccount(s, cash.accountId), 'CASH payment is not mapped to an active Accounting account', cash);
  assert(s.paymentMethods.filter(p => p.isActive && p.isDefault).length === 1, 'Exactly one active default payment method is required', s.paymentMethods);
  return { settings: s, cash, changes };
}
async function ensureItemMapping(adminToken, s, productKindId, accounts) {
  assert(productKindId, 'Product Kind is required for Accounting mapping');
  const kind = s.productKinds.find(k => k.id === productKindId);
  assert(kind, `Product Kind ${productKindId} is absent from Setting Akuntansi`, s.productKinds);
  let mapping = s.itemCategories.find(c => c.productKindId === productKindId);
  const valid = mapping?.isActive
    && activeAccount(s, mapping.inventoryAccountId, 'ASSET')
    && activeAccount(s, mapping.cogsAccountId, 'EXPENSE')
    && activeAccount(s, mapping.revenueAccountId, 'REVENUE');
  if (valid) return { settings: s, mapping, changed: false };
  const body = {
    productKindId,
    name: mapping?.name || kind.name || kind.code,
    inventoryAccountId: valid ? mapping.inventoryAccountId : accounts.inventory.id,
    cogsAccountId: valid ? mapping.cogsAccountId : accounts.cogs.id,
    revenueAccountId: valid ? mapping.revenueAccountId : accounts.revenue.id,
    isActive: true
  };
  if (mapping) {
    await must(`/api/admin/settings/accounting/item-categories/${encodeURIComponent(mapping.id)}?store=${STORE}`, { method: 'PATCH', token: adminToken, body }, `repair item mapping ${kind.code}`);
  } else {
    await must(`/api/admin/settings/accounting/item-categories?store=${STORE}`, { method: 'POST', token: adminToken, body }, `create item mapping ${kind.code}`);
  }
  s = await settings(adminToken);
  mapping = s.itemCategories.find(c => c.productKindId === productKindId && c.isActive);
  assert(mapping, `Item mapping ${productKindId} not available after repair`);
  return { settings: s, mapping, changed: true };
}
const REQUIRED_RULES = {
  sale: [
    ['DEBIT', 'payment_method', 'Settlement Penjualan'],
    ['CREDIT', 'item_category_revenue', 'Pendapatan Penjualan'],
    ['DEBIT', 'item_category_cogs', 'HPP Penjualan'],
    ['CREDIT', 'item_category_inventory', 'Persediaan Keluar']
  ],
  purchase_material: [
    ['DEBIT', 'item_category_inventory', 'Persediaan Pembelian'],
    ['CREDIT', 'payment_method', 'Settlement Pembelian']
  ],
  operational: [
    ['CREDIT', 'payment_method', 'Settlement Operasional']
  ]
};
async function ensureTransactionRules(adminToken, s, code, operationalAccount) {
  let category = s.transactionCategories.find(c => c.code === code);
  if (!category) {
    const names = { sale: 'Penjualan', purchase_material: 'Pembelian Bahan', operational: 'Operasional' };
    await must(`/api/admin/settings/accounting/transaction-categories?store=${STORE}`, {
      method: 'POST', token: adminToken,
      body: { code, name: names[code], description: `Canonical ${code}`, involvesPayment: true, involvesItemCategory: code !== 'operational', isActive: true }
    }, `create transaction category ${code}`);
    s = await settings(adminToken);
    category = s.transactionCategories.find(c => c.code === code);
  } else if (!category.isActive) {
    await must(`/api/admin/settings/accounting/transaction-categories/${encodeURIComponent(category.id)}?store=${STORE}`, { method: 'PATCH', token: adminToken, body: { isActive: true } }, `activate ${code}`);
    s = await settings(adminToken);
  }
  category = s.transactionCategories.find(c => c.code === code);
  assert(category, `Transaction category ${code} unresolved`);
  const required = [...REQUIRED_RULES[code]];
  if (code === 'operational' && !category.rules.some(r => r.isActive && r.side === 'DEBIT' && r.sourceType === 'fixed_account' && r.fixedAccountId)) {
    required.unshift(['DEBIT', 'fixed_account', 'Beban Operasional']);
  }
  for (let i = 0; i < required.length; i += 1) {
    const [side, sourceType, label] = required[i];
    category = s.transactionCategories.find(c => c.code === code);
    const matches = category.rules.filter(r => r.isActive && r.side === side && r.sourceType === sourceType);
    if (!matches.length) {
      await must(`/api/admin/settings/accounting/journal-rules?store=${STORE}`, {
        method: 'POST', token: adminToken,
        body: { transactionCategoryId: category.id, label, side, sourceType, fixedAccountId: sourceType === 'fixed_account' ? operationalAccount.id : null, isActive: true, isDefault: sourceType === 'fixed_account', sortOrder: (i + 1) * 10 }
      }, `create ${code} ${side}:${sourceType}`);
      s = await settings(adminToken);
    } else if (sourceType !== 'fixed_account' && matches.length > 1) {
      for (const duplicate of matches.slice(1)) {
        await must(`/api/admin/settings/accounting/journal-rules/${encodeURIComponent(duplicate.id)}?store=${STORE}`, { method: 'PATCH', token: adminToken, body: { isActive: false } }, `disable duplicate ${duplicate.id}`);
      }
      s = await settings(adminToken);
    }
  }
  category = s.transactionCategories.find(c => c.code === code);
  assert(category.isActive && category.completeness === 'COMPLETE', `${code} remains incomplete`, category);
  return { settings: s, category };
}
async function prepareSettings(adminToken, purchaseKindId = null) {
  let s = await settings(adminToken);
  const core = await ensureCoreAccounts(adminToken, s); s = core.settings;
  const changes = [...core.changes];
  const payment = await ensureCashPayment(adminToken, s, core.cashFallback); s = payment.settings; changes.push(...payment.changes);
  for (const code of ['sale', 'purchase_material', 'operational']) {
    const before = JSON.stringify(s.transactionCategories.find(c => c.code === code) || null);
    const result = await ensureTransactionRules(adminToken, s, code, core.operational); s = result.settings;
    if (JSON.stringify(result.category) !== before) changes.push(`rules ${code}`);
  }
  if (purchaseKindId) {
    const mapped = await ensureItemMapping(adminToken, s, purchaseKindId, core); s = mapped.settings;
    if (mapped.changed) changes.push(`item mapping ${purchaseKindId}`);
  }
  return { settings: s, core, changes };
}
async function chooseCashier(adminToken) {
  const drawers = await must(`/api/admin/drawers?store=${STORE}`, { token: adminToken }, 'list drawers');
  const open = (drawers.drawers || []).find(d => d.status === 'OPEN');
  if (open) {
    assert(CASHIERS.some(c => c.username === open.cashierUsername), `Open drawer belongs to undocumented cashier ${open.cashierUsername}`, open);
    return { token: await cashierLogin(open.cashierUsername), username: open.cashierUsername, drawer: open };
  }
  const username = CASHIERS[0].username;
  const token = await cashierLogin(username);
  const opened = await must('/api/cashier/drawer/open', { method: 'POST', token, body: { openingAmount: 0, shiftLabel: 'API SMOKE' } }, 'open smoke drawer');
  return { token, username, drawer: opened.drawer || opened };
}
async function candidates(adminToken, cashierToken) {
  const [workspace, purchases, costs, stock] = await Promise.all([
    must('/api/cashier/workspace', { token: cashierToken }, 'cashier workspace'),
    must('/api/cashier/purchases/options', { token: cashierToken }, 'purchase options'),
    must('/api/cashier/cost-masters/options', { token: cashierToken }, 'cost options'),
    must(`/api/admin/stock?store=${STORE}`, { token: adminToken }, 'stock read')
  ]);
  const purchase = (purchases.products || []).find(p => p.productKindId && Number(p.purchasePrice || p.lastPurchasePrice || 0) > 0)
    || (purchases.products || []).find(p => p.productKindId);
  assert(purchase, 'No purchasable product with Product Kind', purchases.products);
  const stockById = new Map((stock.stocks || []).map(row => [Number(row.productId), row]));
  const saleCandidates = (workspace.products || []).map(menu => ({ menu, stock: stockById.get(Number(menu.id)) || null }));
  saleCandidates.sort((a, b) => {
    const ar = Number(Boolean(a.stock?.quantity > 0 || (a.stock?.productionMode === 'DADAKAN' && a.stock?.activeRecipe)));
    const br = Number(Boolean(b.stock?.quantity > 0 || (b.stock?.productionMode === 'DADAKAN' && b.stock?.activeRecipe)));
    return br - ar;
  });
  assert(saleCandidates.length, 'No sellable products in cashier workspace', workspace.products);
  let cost = (costs.costs || []).find(c => c.accountingComponentRuleId && Number(c.outgoingAmount) > 0);
  if (!cost) {
    const master = await must(`/api/admin/master/costs?store=${STORE}`, { token: adminToken }, 'admin cost master');
    const type = (master.costTypes || []).find(t => t.isActive && t.accountingComponentRuleId);
    assert(type, 'No active cost type linked to Accounting component', master.costTypes);
    const created = await must(`/api/admin/master/costs?store=${STORE}`, {
      method: 'POST', token: adminToken,
      body: { name: 'API Smoke Operasional', contact: 'API Smoke', outgoingAmount: 1000, incomingAmount: 0, costTypeId: type.id, costGroup: 'API Smoke', isActive: true }
    }, 'create smoke cost master');
    const refreshed = await must('/api/cashier/cost-masters/options', { token: cashierToken }, 'refresh cost options');
    cost = (refreshed.costs || []).find(c => c.id === created.id);
  }
  assert(cost?.accountingComponentRuleId, 'Cost master has no Accounting component rule', cost);
  return { purchase, saleCandidates, cost };
}
function linesOf(payload) { return payload.journal?.lines || payload.lines || []; }
function journalHas(payload, side, accountId) {
  return linesOf(payload).some(line => line.side === side && line.accountId === accountId && Number(line.amountScaled || 0) > 0);
}
async function verifyExplorer(adminToken, factType, factId, journalId) {
  const filter = factType === 'SALE' ? 'SALES' : factType === 'PURCHASE' ? 'PURCHASES' : 'OPERATIONS';
  const explorer = await must(`/api/admin/transactions?store=${STORE}&filter=${filter}&limit=100`, { token: adminToken }, `${factType} explorer`);
  const row = (explorer.transactions || []).find(t => t.id === factId && t.kind === factType);
  assert(row, `${factType} fact absent from Transaction Explorer`, explorer.transactions);
  assert(row.accounting?.syncStatus === 'POSTED', `${factType} delivery not POSTED`, row.accounting);
  assert(row.accounting?.journalReference === journalId, `${factType} journal reference mismatch`, row.accounting);
  return row;
}
async function syncFact(adminToken, factType, factId) {
  return must(`/api/admin/accounting/bridge/sync?store=${STORE}`, { method: 'POST', token: adminToken, body: { factType, factId } }, `sync ${factType}`);
}

async function main() {
  log('marker', marker);
  const adminToken = await adminLogin();
  const cashier = await chooseCashier(adminToken);
  log('cashier/drawer', { username: cashier.username, drawer: cashier.drawer });
  const selected = await candidates(adminToken, cashier.token);
  log('API candidates', { purchase: selected.purchase, saleCandidates: selected.saleCandidates, cost: selected.cost });

  let config = await prepareSettings(adminToken, selected.purchase.productKindId);
  let s = config.settings;
  const cash = s.paymentMethods.find(p => p.code === 'CASH' && p.isActive);
  assert(cash?.accountId, 'CASH mapping unresolved');
  log('Setting Akuntansi initial changes', config.changes.length ? config.changes : ['none; already capable']);

  const purchaseMapping = s.itemCategories.find(c => c.productKindId === selected.purchase.productKindId && c.isActive);
  assert(purchaseMapping?.inventoryAccountId, 'Purchase item mapping unresolved', purchaseMapping);
  const unitAmount = Math.max(1, Math.round(Number(selected.purchase.lastPurchasePrice || selected.purchase.purchasePrice || 1000)));
  const purchase = await must('/api/cashier/purchases', {
    method: 'POST', token: cashier.token,
    body: { items: [{ productId: Number(selected.purchase.id), quantity: 1, lineTotal: unitAmount }], description: marker, note: 'API-only PURCHASE smoke', paymentMethod: 'CASH' }
  }, 'PURCHASE');
  assert(purchase.id, 'Purchase response missing id', purchase);
  let purchaseDelivery = purchase.accounting;
  if (purchaseDelivery?.bridgeStatus !== 'POSTED') purchaseDelivery = await syncFact(adminToken, 'PURCHASE', purchase.id);
  const purchaseJournalId = purchaseDelivery.journalReference || purchaseDelivery.journalId;
  assert(purchaseJournalId, 'Purchase journal missing after bridge sync', purchaseDelivery);
  const purchaseJournal = await must(`/api/admin/accounting/journals/${encodeURIComponent(purchaseJournalId)}?store=${STORE}`, { token: adminToken }, 'purchase journal');
  assert(journalHas(purchaseJournal, 'DEBIT', purchaseMapping.inventoryAccountId), 'Purchase journal does not Debit configured Inventory', purchaseJournal);
  assert(journalHas(purchaseJournal, 'CREDIT', cash.accountId), 'Purchase journal does not Credit configured settlement', purchaseJournal);
  await verifyExplorer(adminToken, 'PURCHASE', purchase.id, purchaseJournalId);
  log('PURCHASE PASS', { factId: purchase.id, journalId: purchaseJournalId, expected: { debitInventory: purchaseMapping.inventoryAccountId, creditSettlement: cash.accountId }, lines: linesOf(purchaseJournal) });

  let sale = null;
  let saleCandidate = null;
  const saleFailures = [];
  for (const candidate of selected.saleCandidates) {
    const attempt = await request('/api/cashier/sales', {
      method: 'POST', token: cashier.token,
      body: { items: [{ productId: Number(candidate.menu.id), quantity: 1 }], customerName: 'API Smoke', note: marker, paymentMethod: 'CASH' }
    });
    if (attempt.ok) { sale = attempt.payload; saleCandidate = candidate; break; }
    saleFailures.push({ productId: candidate.menu.id, name: candidate.menu.name, status: attempt.status, payload: attempt.payload });
  }
  assert(sale?.sale?.id, 'No SALE candidate committed', saleFailures);
  const saleId = sale.sale.id;
  const saleDetailPayload = await must(`/api/admin/transactions/detail/SALE/${encodeURIComponent(saleId)}?store=${STORE}`, { token: adminToken }, 'sale detail');
  const saleItem = saleDetailPayload.detail?.items?.[0];
  assert(saleItem?.productKindId, 'Committed SALE has no snapshotted Product Kind', saleDetailPayload);
  const saleMapped = await ensureItemMapping(adminToken, s, saleItem.productKindId, config.core);
  s = saleMapped.settings;
  if (saleMapped.changed) config.changes.push(`item mapping ${saleItem.productKindId}`);
  const saleMapping = s.itemCategories.find(c => c.productKindId === saleItem.productKindId && c.isActive);
  let saleDelivery = sale.accounting;
  if (saleDelivery?.bridgeStatus !== 'POSTED') saleDelivery = await syncFact(adminToken, 'SALE', saleId);
  const saleJournalId = saleDelivery.journalReference || saleDelivery.journalId;
  assert(saleJournalId, 'Sale journal missing after bridge sync', saleDelivery);
  const saleJournal = await must(`/api/admin/accounting/journals/${encodeURIComponent(saleJournalId)}?store=${STORE}`, { token: adminToken }, 'sale journal');
  assert(journalHas(saleJournal, 'DEBIT', cash.accountId), 'Sale journal does not Debit configured settlement', saleJournal);
  assert(journalHas(saleJournal, 'CREDIT', saleMapping.revenueAccountId), 'Sale journal does not Credit configured Revenue', saleJournal);
  assert(journalHas(saleJournal, 'DEBIT', saleMapping.cogsAccountId), 'Sale journal does not Debit configured HPP', saleJournal);
  assert(journalHas(saleJournal, 'CREDIT', saleMapping.inventoryAccountId), 'Sale journal does not Credit configured Inventory', saleJournal);
  await verifyExplorer(adminToken, 'SALE', saleId, saleJournalId);
  log('SALE PASS', { factId: saleId, product: saleCandidate.menu.name, productKindId: saleItem.productKindId, journalId: saleJournalId, expected: { debitSettlement: cash.accountId, creditRevenue: saleMapping.revenueAccountId, debitCogs: saleMapping.cogsAccountId, creditInventory: saleMapping.inventoryAccountId }, lines: linesOf(saleJournal), failedCandidatesBeforeSuccess: saleFailures });

  const operational = s.transactionCategories.find(c => c.code === 'operational');
  const costRule = operational?.rules.find(r => r.id === selected.cost.accountingComponentRuleId && r.isActive && r.side === 'DEBIT' && r.sourceType === 'fixed_account');
  assert(costRule?.fixedAccountId, 'Cost master component is not an active operational fixed-account Debit rule', { cost: selected.cost, operational });
  const expense = await must('/api/cashier/expenses', {
    method: 'POST', token: cashier.token,
    body: { items: [{ costMasterId: selected.cost.id, quantity: 1, unitAmount: Math.max(1, Number(selected.cost.outgoingAmount || 1000)) }], paymentMethod: 'CASH' }
  }, 'EXPENSE');
  const expenseId = expense.ids?.[0] || expense.id;
  assert(expenseId, 'Expense response missing id', expense);
  let expenseDelivery = expense.accounting?.deliveries?.[0] || expense.accounting;
  if (expenseDelivery?.bridgeStatus !== 'POSTED') expenseDelivery = await syncFact(adminToken, 'EXPENSE', expenseId);
  const expenseJournalId = expenseDelivery.journalReference || expenseDelivery.journalId;
  assert(expenseJournalId, 'Expense journal missing after bridge sync', expenseDelivery);
  const expenseJournal = await must(`/api/admin/accounting/journals/${encodeURIComponent(expenseJournalId)}?store=${STORE}`, { token: adminToken }, 'expense journal');
  assert(journalHas(expenseJournal, 'DEBIT', costRule.fixedAccountId), 'Expense journal does not Debit configured operational account', expenseJournal);
  assert(journalHas(expenseJournal, 'CREDIT', cash.accountId), 'Expense journal does not Credit configured settlement', expenseJournal);
  await verifyExplorer(adminToken, 'EXPENSE', expenseId, expenseJournalId);
  log('EXPENSE PASS', { factId: expenseId, costMaster: selected.cost.name, componentRuleId: selected.cost.accountingComponentRuleId, journalId: expenseJournalId, expected: { debitOperational: costRule.fixedAccountId, creditSettlement: cash.accountId }, lines: linesOf(expenseJournal) });

  log('FINAL LIVE SMOKE PASS', {
    marker,
    store: STORE,
    cashier: cashier.username,
    drawerId: cashier.drawer?.id,
    settingsChanges: config.changes,
    transactions: {
      purchase: { factId: purchase.id, journalId: purchaseJournalId },
      sale: { factId: saleId, journalId: saleJournalId },
      expense: { factId: expenseId, journalId: expenseJournalId }
    }
  });
}

main().catch(error => {
  console.error('\n=== LIVE SMOKE FAIL ===');
  console.error(error.stack || error);
  if (error.detail) console.error(JSON.stringify(error.detail, null, 2));
  process.exitCode = 1;
});
