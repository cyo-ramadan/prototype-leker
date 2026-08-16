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
  if (!condition) {
    const error = new Error(message);
    if (detail) error.detail = detail;
    throw error;
  }
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
function activeAccounts(s, type) { return s.accounts.filter(a => a.isActive && a.type === type); }
function semanticAccount(s, type, terms) {
  const accounts = activeAccounts(s, type);
  const scored = accounts.map(account => {
    const hay = `${account.code} ${account.name} ${account.subtype}`.toLowerCase();
    const score = terms.reduce((n, term) => n + (hay.includes(term.toLowerCase()) ? 1 : 0), 0);
    return { account, score };
  }).sort((a, b) => b.score - a.score || String(a.account.code).localeCompare(String(b.account.code)));
  return scored[0]?.score > 0 ? scored[0].account : accounts[0] || null;
}
async function ensureAccount(adminToken, s, type, terms, fallbackName) {
  let account = semanticAccount(s, type, terms);
  if (account) return { account, settings: s, created: false };
  const created = await must(`/api/admin/accounting/accounts?store=${STORE}`, {
    method: 'POST', token: adminToken, body: { accountName: fallbackName, accountType: type, subtype: 'API_SMOKE_SUPPORT' }
  }, `create ${type} account`);
  s = await settings(adminToken);
  account = s.accounts.find(a => a.id === created.accountId) || semanticAccount(s, type, [fallbackName]);
  assert(account, `Unable to resolve created ${type} account`, created);
  return { account, settings: s, created: true };
}
async function ensureCoreAccounts(adminToken, s) {
  const changes = [];
  let r = await ensureAccount(adminToken, s, 'ASSET', ['kas', 'cash'], 'Kas Operasional API Smoke'); s = r.settings; if (r.created) changes.push(`created ASSET ${r.account.id}`); const cash = r.account;
  r = await ensureAccount(adminToken, s, 'ASSET', ['persediaan', 'inventory'], 'Persediaan API Smoke'); s = r.settings; if (r.created) changes.push(`created ASSET ${r.account.id}`); const inventory = semanticAccount(s, 'ASSET', ['persediaan', 'inventory']) || r.account;
  r = await ensureAccount(adminToken, s, 'EXPENSE', ['hpp', 'harga pokok'], 'HPP API Smoke'); s = r.settings; if (r.created) changes.push(`created EXPENSE ${r.account.id}`); const cogs = semanticAccount(s, 'EXPENSE', ['hpp', 'harga pokok']) || r.account;
  r = await ensureAccount(adminToken, s, 'REVENUE', ['penjualan', 'pendapatan', 'revenue'], 'Pendapatan Penjualan API Smoke'); s = r.settings; if (r.created) changes.push(`created REVENUE ${r.account.id}`); const revenue = semanticAccount(s, 'REVENUE', ['penjualan', 'pendapatan', 'revenue']) || r.account;
  r = await ensureAccount(adminToken, s, 'EXPENSE', ['beban operasional', 'operasional'], 'Beban Operasional API Smoke'); s = r.settings; if (r.created) changes.push(`created EXPENSE ${r.account.id}`); const operational = semanticAccount(s, 'EXPENSE', ['beban operasional', 'operasional']) || r.account;
  return { settings: s, changes, cash, inventory, cogs, revenue, operational };
}
async function ensureCashPayment(adminToken, s, cashAccount) {
  const changes = [];
  let cash = s.paymentMethods.find(p => p.code === 'CASH');
  const anyDefault = s.paymentMethods.some(p => p.isActive && p.isDefault);
  if (!cash) {
    await must(`/api/admin/settings/accounting/payment-methods?store=${STORE}`, {
      method: 'POST', token: adminToken,
      body: { code: 'CASH', name: 'Tunai', accountId: cashAccount.id, isActive: true, isDefault: !anyDefault }
    }, 'create CASH payment method');
    changes.push('created CASH payment method');
  } else if (!cash.isActive || cash.accountId !== cashAccount.id || (!anyDefault && !cash.isDefault)) {
    await must(`/api/admin/settings/accounting/payment-methods/${encodeURIComponent(cash.id)}?store=${STORE}`, {
      method: 'PATCH', token: adminToken,
      body: { name: cash.name || 'Tunai', accountId: cashAccount.id, isActive: true, isDefault: cash.isDefault || !anyDefault }
    }, 'repair CASH payment method');
    changes.push(`repaired CASH payment ${cash.id}`);
  }
  s = await settings(adminToken);
  cash = s.paymentMethods.find(p => p.code === 'CASH' && p.isActive);
  assert(cash?.accountId, 'CASH payment is not Accounting-ready after repair', cash);
  assert(s.paymentMethods.filter(p => p.isActive && p.isDefault).length === 1, 'Setting Akuntansi must have exactly one active default payment method', s.paymentMethods);
  return { settings: s, cash, changes };
}
async function ensureCategory(adminToken, s, productKindId, accounts) {
  assert(productKindId, 'Selected product has no productKindId');
  const kind = s.productKinds.find(k => k.id === productKindId);
  assert(kind, `Product kind ${productKindId} not present in Setting Akuntansi`);
  let mapping = s.itemCategories.find(c => c.productKindId === productKindId);
  const payload = {
    productKindId,
    name: mapping?.name || kind.name || kind.code,
    inventoryAccountId: accounts.inventory.id,
    cogsAccountId: accounts.cogs.id,
    revenueAccountId: accounts.revenue.id,
    isActive: true
  };
  const valid = mapping && mapping.isActive && mapping.inventoryAccountId && mapping.cogsAccountId && mapping.revenueAccountId;
  if (!valid) {
    if (mapping) {
      await must(`/api/admin/settings/accounting/item-categories/${encodeURIComponent(mapping.id)}?store=${STORE}`, { method: 'PATCH', token: adminToken, body: payload }, `repair item mapping ${kind.code}`);
    } else {
      await must(`/api/admin/settings/accounting/item-categories?store=${STORE}`, { method: 'POST', token: adminToken, body: payload }, `create item mapping ${kind.code}`);
    }
    s = await settings(adminToken);
    mapping = s.itemCategories.find(c => c.productKindId === productKindId && c.isActive);
    return { settings: s, mapping, changed: true };
  }
  return { settings: s, mapping, changed: false };
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
async function ensureTransactionCategory(adminToken, s, code, operationalAccount) {
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
    await must(`/api/admin/settings/accounting/transaction-categories/${encodeURIComponent(category.id)}?store=${STORE}`, {
      method: 'PATCH', token: adminToken, body: { isActive: true }
    }, `activate transaction category ${code}`);
    s = await settings(adminToken);
    category = s.transactionCategories.find(c => c.code === code);
  }
  assert(category, `Transaction category ${code} unresolved`);

  const required = [...(REQUIRED_RULES[code] || [])];
  if (code === 'operational') {
    const activeFixedDebit = category.rules.filter(r => r.isActive && r.side === 'DEBIT' && r.sourceType === 'fixed_account' && r.fixedAccountId);
    if (!activeFixedDebit.length) required.unshift(['DEBIT', 'fixed_account', 'Beban Operasional']);
  }
  for (let index = 0; index < required.length; index += 1) {
    const [side, sourceType, label] = required[index];
    category = s.transactionCategories.find(c => c.code === code);
    const matches = category.rules.filter(r => r.isActive && r.side === side && r.sourceType === sourceType);
    if (!matches.length) {
      await must(`/api/admin/settings/accounting/journal-rules?store=${STORE}`, {
        method: 'POST', token: adminToken,
        body: {
          transactionCategoryId: category.id, label, side, sourceType,
          fixedAccountId: sourceType === 'fixed_account' ? operationalAccount.id : null,
          isActive: true, isDefault: sourceType === 'fixed_account', sortOrder: (index + 1) * 10
        }
      }, `create ${code} rule ${side}:${sourceType}`);
      s = await settings(adminToken);
    } else if (sourceType !== 'fixed_account' && matches.length > 1) {
      for (const duplicate of matches.slice(1)) {
        await must(`/api/admin/settings/accounting/journal-rules/${encodeURIComponent(duplicate.id)}?store=${STORE}`, {
          method: 'PATCH', token: adminToken, body: { isActive: false }
        }, `disable ambiguous duplicate ${duplicate.id}`);
      }
      s = await settings(adminToken);
    }
  }
  category = s.transactionCategories.find(c => c.code === code);
  assert(category.isActive && category.completeness === 'COMPLETE', `Category ${code} is still incomplete`, category);
  return { settings: s, category };
}
async function ensureSettings(adminToken, requiredKinds) {
  let s = await settings(adminToken);
  const accountResult = await ensureCoreAccounts(adminToken, s); s = accountResult.settings;
  const changes = [...accountResult.changes];
  const paymentResult = await ensureCashPayment(adminToken, s, accountResult.cash); s = paymentResult.settings; changes.push(...paymentResult.changes);
  const mappings = new Map();
  for (const kindId of [...new Set(requiredKinds.filter(Boolean))]) {
    const result = await ensureCategory(adminToken, s, kindId, accountResult); s = result.settings; mappings.set(kindId, result.mapping); if (result.changed) changes.push(`item mapping ${kindId}`);
  }
  for (const code of ['sale', 'purchase_material', 'operational']) {
    const before = JSON.stringify(s.transactionCategories.find(c => c.code === code) || null);
    const result = await ensureTransactionCategory(adminToken, s, code, accountResult.operational); s = result.settings;
    if (JSON.stringify(result.category) !== before) changes.push(`transaction category/rules ${code}`);
  }
  return { settings: s, changes, mappings };
}
async function chooseCashier(adminToken) {
  const drawerPayload = await must(`/api/admin/drawers?store=${STORE}`, { token: adminToken }, 'list drawers');
  const open = (drawerPayload.drawers || []).find(d => d.status === 'OPEN');
  if (open) {
    assert(CASHIERS.some(c => c.username === open.cashierUsername), `Open drawer belongs to undocumented cashier ${open.cashierUsername}`, open);
    return { token: await cashierLogin(open.cashierUsername), username: open.cashierUsername, openedBySmoke: false, drawer: open };
  }
  const username = CASHIERS[0].username;
  const token = await cashierLogin(username);
  const opened = await must('/api/cashier/drawer/open', { method: 'POST', token, body: { openingAmount: 0, shiftLabel: 'API SMOKE' } }, 'open smoke drawer');
  return { token, username, openedBySmoke: true, drawer: opened.drawer };
}
async function loadCandidates(adminToken, cashierToken) {
  const [editor, menu, purchases, costs] = await Promise.all([
    must(`/api/admin/master/products/editor?store=${STORE}`, { token: adminToken }, 'product editor'),
    must('/api/cashier/menu', { token: cashierToken }, 'cashier menu'),
    must('/api/cashier/purchases/options', { token: cashierToken }, 'purchase options'),
    must('/api/cashier/cost-masters/options', { token: cashierToken }, 'cost master options')
  ]);
  const byId = new Map((editor.products || []).map(p => [Number(p.id), p]));
  const purchase = (purchases.products || []).find(p => p.productKindId && Number(p.purchasePrice || p.lastPurchasePrice || 0) > 0)
    || (purchases.products || []).find(p => p.productKindId);
  assert(purchase, 'No purchasable product with Product Kind is available', purchases.products);
  const saleCandidates = (menu.products || menu.menu || menu.items || []).map(p => ({ menu: p, editor: byId.get(Number(p.id)) })).filter(x => x.editor?.productKindId);
  saleCandidates.sort((a, b) => Number(b.editor.averageCost > 0) - Number(a.editor.averageCost > 0) || Number(b.editor.stockQuantity > 0) - Number(a.editor.stockQuantity > 0));
  assert(saleCandidates.length, 'No sellable product with Product Kind is available', { menu, editor: editor.products });
  let cost = (costs.costs || []).find(c => c.accountingComponentRuleId && Number(c.outgoingAmount) > 0);
  if (!cost) {
    const master = await must(`/api/admin/master/costs?store=${STORE}`, { token: adminToken }, 'admin cost masters');
    const type = (master.costTypes || []).find(t => t.isActive && t.accountingComponentRuleId);
    assert(type, 'No active cost type linked to an operational Accounting component', master.costTypes);
    const created = await must(`/api/admin/master/costs?store=${STORE}`, {
      method: 'POST', token: adminToken,
      body: { name: 'API Smoke Operasional', contact: 'API Smoke', outgoingAmount: 1000, incomingAmount: 0, costTypeId: type.id, costGroup: 'API Smoke', isActive: true }
    }, 'create API smoke cost master');
    const refreshed = await must('/api/cashier/cost-masters/options', { token: cashierToken }, 'refresh cost options');
    cost = (refreshed.costs || []).find(c => c.id === created.id);
  }
  assert(cost?.accountingComponentRuleId, 'Selected cost master has no Accounting component rule', cost);
  return { purchase, saleCandidates, cost };
}
function journalHas(journal, side, accountId) {
  return (journal.lines || []).some(line => line.side === side && line.accountId === accountId && Number(line.amountScaled || 0) > 0);
}
async function transactionExplorer(adminToken, filter) {
  return must(`/api/admin/transactions?store=${STORE}&filter=${filter}&limit=100`, { token: adminToken }, `transaction explorer ${filter}`);
}
async function verifyFact(adminToken, factType, factId, journalId) {
  const filter = factType === 'SALE' ? 'SALES' : factType === 'PURCHASE' ? 'PURCHASES' : 'OPERATIONS';
  const explorer = await transactionExplorer(adminToken, filter);
  const row = (explorer.transactions || []).find(t => t.id === factId && t.kind === factType);
  assert(row, `${factType} fact ${factId} not found in Transaction Explorer`, explorer.transactions);
  assert(row.accounting?.syncStatus === 'POSTED', `${factType} bridge not POSTED`, row.accounting);
  assert(row.accounting?.journalReference === journalId, `${factType} explorer journal reference mismatch`, { explorer: row.accounting, journalId });
  return row;
}

async function main() {
  log('marker', marker);
  const adminToken = await adminLogin();
  const cashier = await chooseCashier(adminToken);
  log('cashier/drawer', { username: cashier.username, drawer: cashier.drawer, openedBySmoke: cashier.openedBySmoke });

  const candidates = await loadCandidates(adminToken, cashier.token);
  log('selected candidates', { purchase: candidates.purchase, saleCandidates: candidates.saleCandidates.map(x => x.editor), cost: candidates.cost });

  const requiredKinds = [candidates.purchase.productKindId, ...candidates.saleCandidates.map(x => x.editor.productKindId)];
  const config = await ensureSettings(adminToken, requiredKinds);
  log('Setting Akuntansi changes', config.changes.length ? config.changes : ['none; existing configuration already capable']);
  const s = config.settings;
  const cash = s.paymentMethods.find(p => p.code === 'CASH' && p.isActive);
  assert(cash?.accountId, 'CASH payment is not mapped after settings preparation');

  const purchaseMapping = s.itemCategories.find(c => c.productKindId === candidates.purchase.productKindId && c.isActive);
  assert(purchaseMapping?.inventoryAccountId, 'Purchase Product Kind mapping missing', purchaseMapping);
  const purchaseUnitAmount = Math.max(1, Math.round(Number(candidates.purchase.lastPurchasePrice || candidates.purchase.purchasePrice || 1000)));
  const purchaseResponse = await must('/api/cashier/purchases', {
    method: 'POST', token: cashier.token,
    body: {
      items: [{ productId: Number(candidates.purchase.id), quantity: 1, lineTotal: purchaseUnitAmount }],
      description: marker,
      note: 'API-only purchase smoke',
      paymentMethod: 'CASH'
    }
  }, 'PURCHASE transaction');
  assert(purchaseResponse.id, 'Purchase response missing id', purchaseResponse);
  assert(purchaseResponse.accounting?.bridgeStatus === 'POSTED' && purchaseResponse.accounting?.journalReference, 'Purchase Accounting bridge not POSTED', purchaseResponse.accounting);
  const purchaseJournal = await must(`/api/admin/accounting/journals/${encodeURIComponent(purchaseResponse.accounting.journalReference)}?store=${STORE}`, { token: adminToken }, 'purchase journal');
  assert(journalHas(purchaseJournal, 'DEBIT', purchaseMapping.inventoryAccountId), 'Purchase journal did not debit configured inventory account', purchaseJournal);
  assert(journalHas(purchaseJournal, 'CREDIT', cash.accountId), 'Purchase journal did not credit configured payment account', purchaseJournal);
  await verifyFact(adminToken, 'PURCHASE', purchaseResponse.id, purchaseResponse.accounting.journalReference);
  log('PURCHASE PASS', { factId: purchaseResponse.id, journalId: purchaseResponse.accounting.journalReference, journalNumber: purchaseResponse.accounting.journalNumber, expected: { debitInventory: purchaseMapping.inventoryAccountId, creditSettlement: cash.accountId }, lines: purchaseJournal.lines });

  let saleResponse = null;
  let saleCandidate = null;
  const saleFailures = [];
  for (const candidate of candidates.saleCandidates) {
    const mapping = s.itemCategories.find(c => c.productKindId === candidate.editor.productKindId && c.isActive);
    if (!mapping?.inventoryAccountId || !mapping?.cogsAccountId || !mapping?.revenueAccountId) continue;
    const attempt = await request('/api/cashier/sales', {
      method: 'POST', token: cashier.token,
      body: { items: [{ productId: Number(candidate.menu.id), quantity: 1 }], customerName: 'API Smoke', note: marker, paymentMethod: 'CASH' }
    });
    if (attempt.ok) { saleResponse = attempt.payload; saleCandidate = candidate; break; }
    saleFailures.push({ productId: candidate.menu.id, status: attempt.status, payload: attempt.payload });
  }
  assert(saleResponse?.sale?.id, 'No SALE candidate could be committed', saleFailures);
  assert(saleResponse.accounting?.bridgeStatus === 'POSTED' && saleResponse.accounting?.journalReference, 'Sale Accounting bridge not POSTED', saleResponse.accounting);
  const saleId = saleResponse.sale.id;
  const saleMapping = s.itemCategories.find(c => c.productKindId === saleCandidate.editor.productKindId && c.isActive);
  const saleJournal = await must(`/api/admin/accounting/journals/${encodeURIComponent(saleResponse.accounting.journalReference)}?store=${STORE}`, { token: adminToken }, 'sale journal');
  assert(journalHas(saleJournal, 'DEBIT', cash.accountId), 'Sale journal did not debit configured payment account', saleJournal);
  assert(journalHas(saleJournal, 'CREDIT', saleMapping.revenueAccountId), 'Sale journal did not credit configured revenue account', saleJournal);
  assert(journalHas(saleJournal, 'DEBIT', saleMapping.cogsAccountId), 'Sale journal did not debit configured COGS account', saleJournal);
  assert(journalHas(saleJournal, 'CREDIT', saleMapping.inventoryAccountId), 'Sale journal did not credit configured inventory account', saleJournal);
  await verifyFact(adminToken, 'SALE', saleId, saleResponse.accounting.journalReference);
  log('SALE PASS', { factId: saleId, product: saleCandidate.editor.name, journalId: saleResponse.accounting.journalReference, journalNumber: saleResponse.accounting.journalNumber, expected: { debitSettlement: cash.accountId, creditRevenue: saleMapping.revenueAccountId, debitCogs: saleMapping.cogsAccountId, creditInventory: saleMapping.inventoryAccountId }, lines: saleJournal.lines, failedCandidatesBeforeSuccess: saleFailures });

  const operationalCategory = s.transactionCategories.find(c => c.code === 'operational');
  const costRule = operationalCategory?.rules.find(r => r.id === candidates.cost.accountingComponentRuleId && r.isActive && r.side === 'DEBIT' && r.sourceType === 'fixed_account');
  assert(costRule?.fixedAccountId, 'Cost master Accounting component is not an active operational fixed-account Debit rule', { cost: candidates.cost, operationalCategory });
  const expenseResponse = await must('/api/cashier/expenses', {
    method: 'POST', token: cashier.token,
    body: { items: [{ costMasterId: candidates.cost.id, quantity: 1, unitAmount: Math.max(1, Number(candidates.cost.outgoingAmount || 1000)) }], paymentMethod: 'CASH' }
  }, 'EXPENSE transaction');
  const expenseDelivery = expenseResponse.accounting?.deliveries?.[0] || expenseResponse.accounting;
  const expenseId = expenseResponse.ids?.[0] || expenseResponse.id;
  assert(expenseId, 'Expense response missing fact id', expenseResponse);
  assert(expenseDelivery?.bridgeStatus === 'POSTED' && expenseDelivery?.journalReference, 'Expense Accounting bridge not POSTED', expenseResponse.accounting);
  const expenseJournal = await must(`/api/admin/accounting/journals/${encodeURIComponent(expenseDelivery.journalReference)}?store=${STORE}`, { token: adminToken }, 'expense journal');
  assert(journalHas(expenseJournal, 'DEBIT', costRule.fixedAccountId), 'Expense journal did not debit configured cost component account', expenseJournal);
  assert(journalHas(expenseJournal, 'CREDIT', cash.accountId), 'Expense journal did not credit configured payment account', expenseJournal);
  await verifyFact(adminToken, 'EXPENSE', expenseId, expenseDelivery.journalReference);
  log('EXPENSE PASS', { factId: expenseId, costMaster: candidates.cost.name, accountingComponentRuleId: candidates.cost.accountingComponentRuleId, journalId: expenseDelivery.journalReference, journalNumber: expenseDelivery.journalNumber, expected: { debitOperational: costRule.fixedAccountId, creditSettlement: cash.accountId }, lines: expenseJournal.lines });

  const finalSettings = await settings(adminToken);
  const summary = {
    ok: true,
    marker,
    store: STORE,
    cashier: cashier.username,
    drawerId: cashier.drawer?.id,
    settingsChanges: config.changes,
    payment: finalSettings.paymentMethods.find(p => p.code === 'CASH'),
    transactions: {
      purchase: { factId: purchaseResponse.id, journalId: purchaseResponse.accounting.journalReference },
      sale: { factId: saleId, journalId: saleResponse.accounting.journalReference },
      expense: { factId: expenseId, journalId: expenseDelivery.journalReference }
    }
  };
  log('FINAL LIVE SMOKE PASS', summary);
}

main().catch(error => {
  console.error('\n=== LIVE SMOKE FAIL ===');
  console.error(error.stack || error);
  if (error.detail) console.error(JSON.stringify(error.detail, null, 2));
  process.exitCode = 1;
});
