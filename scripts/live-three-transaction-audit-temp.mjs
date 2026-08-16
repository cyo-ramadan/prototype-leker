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

const [settings, purchaseOptions, stock, menu, journals, editor, kinds] = await Promise.all([
  req(`/api/admin/settings/accounting?store=${STORE}`, { token: adminToken }),
  req('/api/cashier/purchases/options', { token: cashierToken }),
  req(`/api/admin/stock?store=${STORE}`, { token: adminToken, allowError: true }),
  req(`/api/menu?store=${STORE}`),
  req(`/api/admin/accounting/journals?store=${STORE}&from=2026-08-16&to=2026-08-16&limit=200`, { token: adminToken }),
  req(`/api/admin/master/products/editor?store=${STORE}`, { token: adminToken, allowError: true }),
  req(`/api/admin/master/product-kinds?store=${STORE}`, { token: adminToken, allowError: true })
]);

const categories = Object.fromEntries((settings.payload.transactionCategories || []).map(row => [row.code, row]));
for (const code of ['sale', 'purchase_material', 'operational']) {
  must(categories[code]?.isActive, `${code} category inactive/missing`, categories[code]);
  must(categories[code]?.completeness === 'COMPLETE', `${code} category incomplete`, categories[code]);
}
const cash = (settings.payload.paymentMethods || []).find(row => row.code === 'CASH' && row.isActive && row.accountId);
must(cash, 'CASH payment mapping missing', settings.payload.paymentMethods);

const stockRows = stock.ok ? (stock.payload.stocks || []) : [];
const stockByProduct = new Map(stockRows.map(row => [Number(row.productId), row]));
const menuRows = Array.isArray(menu.payload) ? menu.payload : (menu.payload.products || []);
const menuById = new Map(menuRows.map(row => [Number(row.id), row]));
const allItemCategories = settings.payload.itemCategories || [];
const itemCategoryByKind = new Map(allItemCategories.map(row => [row.productKindId, row]));

const editorProducts = editor.ok ? (editor.payload.products || []) : [];
const syntheticProducts = editorProducts.filter(row => /API Smoke/i.test(row.name || '') || /API_SMOKE/i.test(row.productKindCode || ''));
const syntheticCandidates = syntheticProducts.map(product => ({
  productId: Number(product.id),
  productName: product.name,
  isActive: product.isActive,
  productKindId: product.productKindId,
  productKindCode: product.productKindCode,
  productKindName: product.productKindName,
  stockTrackingEnabled: product.stockTrackingEnabled,
  stockQuantity: product.stockQuantity,
  averageCost: product.averageCost,
  lastPurchasePrice: product.lastPurchasePrice,
  salePrice: Number(menuById.get(Number(product.id))?.price || product.price || 0),
  itemCategory: itemCategoryByKind.get(product.productKindId) || null,
  stockRow: stockByProduct.get(Number(product.id)) || null
}));

const recentPurchase = (journals.payload.journals || []).find(row => row.sourceReferenceId?.startsWith('PURCHASE:'));
let purchaseDetail = null;
if (recentPurchase) purchaseDetail = (await req(`/api/admin/accounting/journals/${encodeURIComponent(recentPurchase.journalId)}?store=${STORE}`, { token: adminToken })).payload.journal;

console.log('=== LIVE SYNTHETIC SALE CANDIDATE AUDIT ===');
console.log(JSON.stringify({
  settings: { paymentCash: cash, sale: categories.sale, purchaseMaterial: categories.purchase_material, operational: categories.operational, itemCategories: allItemCategories },
  health: { stock: { ok: stock.ok, status: stock.status }, editor: { ok: editor.ok, status: editor.status }, kinds: { ok: kinds.ok, status: kinds.status } },
  productKinds: kinds.ok ? (kinds.payload.productKinds || kinds.payload.kinds || []) : kinds.payload,
  syntheticCandidates,
  purchaseOptions: purchaseOptions.payload.products || [],
  recentPurchase,
  purchaseDetail
}, null, 2));
