const BASE = 'https://prototype-leker-v2.daily-napkin.workers.dev';
const STORE = 'G001';
async function call(path, { method = 'GET', token = '', body } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let payload; try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}
const admin = await call('/api/store-admin/login', { method: 'POST', body: { username: 'bablil', password: 'bablil123' } });
const drawers = await call(`/api/admin/drawers?store=${STORE}`, { token: admin.token });
const open = drawers.drawers.find(d => d.status === 'OPEN');
if (!open) throw new Error('No open drawer');
const creds = open.cashierUsername === 'sigma' ? { username: 'sigma', password: 'sigma123' } : { username: 'wowo', password: 'wowo123' };
const cashier = await call('/api/cashier/login', { method: 'POST', body: creds });
const [settings, workspace, purchases, costs, bridge] = await Promise.all([
  call(`/api/admin/settings/accounting?store=${STORE}`, { token: admin.token }),
  call('/api/cashier/workspace', { token: cashier.token }),
  call('/api/cashier/purchases/options', { token: cashier.token }),
  call('/api/cashier/cost-masters/options', { token: cashier.token }),
  call(`/api/admin/accounting/bridge?store=${STORE}`, { token: admin.token })
]);
console.log('=== LIVE DIAGNOSTICS PASS ===');
console.log(JSON.stringify({
  drawer: open,
  cashier: workspace.cashier,
  paymentMethods: settings.paymentMethods,
  itemCategories: settings.itemCategories,
  productKinds: settings.productKinds,
  transactionCategories: settings.transactionCategories,
  workspaceProducts: workspace.products,
  workspacePaymentMethods: workspace.paymentMethods,
  operationalAccountingComponents: workspace.operationalAccountingComponents,
  purchaseProducts: purchases.products,
  costOptions: costs.costs,
  bridgeSummary: bridge.summary
}, null, 2));
