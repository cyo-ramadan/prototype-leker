const BASE = 'https://prototype-leker-v2.daily-napkin.workers.dev';
const STORE = 'G001';

async function req(path, { method = 'GET', token = '', body, allowError = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
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
    clearTimeout(timer);
  }
}

function must(condition, message, detail) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(detail || {})}`);
}

const login = await req('/api/store-admin/login', { method: 'POST', body: { username: 'bablil', password: 'bablil123' } });
must(login.payload.token, 'Admin login failed', login.payload);
const adminToken = login.payload.token;

const drawers = await req(`/api/admin/drawers?store=${STORE}`, { token: adminToken });
const openDrawer = (drawers.payload.drawers || []).find(row => row.status === 'OPEN');
must(openDrawer, 'No OPEN drawer', drawers.payload);
const cashierCred = openDrawer.cashierUsername === 'sigma'
  ? { username: 'sigma', password: 'sigma123' }
  : { username: 'wowo', password: 'wowo123' };
const cashierLogin = await req('/api/cashier/login', { method: 'POST', body: cashierCred });
must(cashierLogin.payload.token, 'Cashier login failed', cashierLogin.payload);
const cashierToken = cashierLogin.payload.token;

const [settings, purchaseOptions, stock, menu, journals] = await Promise.all([
  req(`/api/admin/settings/accounting?store=${STORE}`, { token: adminToken }),
  req('/api/cashier/purchases/options', { token: cashierToken }),
  req(`/api/admin/stock?store=${STORE}`, { token: adminToken, allowError: true }),
  req(`/api/menu?store=${STORE}`),
  req(`/api/admin/accounting/journals?store=${STORE}&from=2026-08-16&to=2026-08-16&limit=200`, { token: adminToken })
]);

const categories = Object.fromEntries((settings.payload.transactionCategories || []).map(row => [row.code, row]));
for (const code of ['sale', 'purchase_material', 'operational']) {
  must(categories[code]?.isActive, `${code} category inactive/missing`, categories[code]);
  must(categories[code]?.completeness === 'COMPLETE', `${code} category incomplete`, categories[code]);
}
const cash = (settings.payload.paymentMethods || []).find(row => row.code === 'CASH' && row.isActive && row.accountId);
must(cash, 'CASH payment mapping missing', settings.payload.paymentMethods);

const productOptions = purchaseOptions.payload.products || [];
const stockRows = stock.ok ? (stock.payload.stocks || []) : [];
const stockByProduct = new Map(stockRows.map(row => [Number(row.productId), row]));
const menuRows = Array.isArray(menu.payload) ? menu.payload : (menu.payload.products || []);
const menuById = new Map(menuRows.map(row => [Number(row.id), row]));
const itemCategoryByKind = new Map((settings.payload.itemCategories || []).filter(row => row.isActive).map(row => [row.productKindId, row]));

const candidates = productOptions.map(option => {
  const itemCategory = itemCategoryByKind.get(option.productKindId) || null;
  const stockRow = stockByProduct.get(Number(option.productId)) || null;
  const menuRow = menuById.get(Number(option.productId)) || null;
  return {
    productId: Number(option.productId),
    productName: option.productName,
    productKindId: option.productKindId,
    productKindCode: option.productKindCode,
    averageCost: Number(option.averageCost || 0),
    purchasePrice: Number(option.purchasePrice || 0),
    stockQuantity: stockRow?.quantity ?? null,
    stockTrackingEnabled: stockRow?.stockTrackingEnabled ?? null,
    salePrice: Number(menuRow?.price || 0),
    itemCategory
  };
}).filter(row => row.productKindId && row.itemCategory);

const recentPurchase = (journals.payload.journals || []).find(row => row.sourceReferenceId?.startsWith('PURCHASE:'));
let purchaseDetail = null;
if (recentPurchase) {
  purchaseDetail = (await req(`/api/admin/accounting/journals/${encodeURIComponent(recentPurchase.journalId)}?store=${STORE}`, { token: adminToken })).payload.journal;
}

console.log('=== LIVE TRANSACTION PRE-AUDIT ===');
console.log(JSON.stringify({
  settings: {
    paymentCash: cash,
    sale: categories.sale,
    purchaseMaterial: categories.purchase_material,
    operational: categories.operational,
    itemCategories: settings.payload.itemCategories
  },
  stockEndpoint: { ok: stock.ok, status: stock.status, error: stock.ok ? null : stock.payload },
  candidates,
  recentPurchase,
  purchaseDetail,
  recentJournals: (journals.payload.journals || []).slice(0, 20)
}, null, 2));
