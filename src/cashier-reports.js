import { json } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { listStoreStockBalances, listStoreStockBalancesForProducts } from './admin-stock.js';
import { getProductGroupItems } from './product-groups.js';

function parseProductIds(raw) {
  return String(raw || '')
    .split(',')
    .map(part => Number(part.trim()))
    .filter(id => Number.isInteger(id) && id > 0);
}

// Tombol Laporan > Saldo Stok. Tiga cara pilih cakupan barang -- semuanya
// lewat listStoreStockBalances(ForProducts), query yang sama dengan Data
// Stok, supaya angkanya tidak pernah bisa berbeda antar tampilan.
export async function handleCashierReportsApi(request, env, pathname) {
  if (!pathname.startsWith('/api/cashier/reports/')) return null;
  if (request.method !== 'GET') return json({ error: 'Laporan kasir saat ini read-only.' }, 405);
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const storeId = auth.cashier.store.id;

  if (pathname !== '/api/cashier/reports/stock-balance') return json({ error: 'Route laporan tidak ditemukan.' }, 404);

  const url = new URL(request.url);
  const scope = String(url.searchParams.get('scope') || '').trim().toUpperCase();

  if (scope === 'ALL') {
    return json({ scope, stocks: await listStoreStockBalances(env.DB, storeId) });
  }

  if (scope === 'SELECTED') {
    const productIds = parseProductIds(url.searchParams.get('productIds'));
    if (!productIds.length) return json({ error: 'Pilih minimal 1 barang.' }, 400);
    return json({ scope, stocks: await listStoreStockBalancesForProducts(env.DB, storeId, productIds) });
  }

  if (scope === 'GROUP') {
    const groupId = String(url.searchParams.get('groupId') || '').trim();
    if (!groupId) return json({ error: 'Group barang wajib dipilih.' }, 400);
    const detail = await getProductGroupItems(env.DB, storeId, groupId);
    if (!detail.ok) return json({ error: detail.error }, 404);
    const productIds = detail.items.map(item => item.productId);
    return json({ scope, group: detail.group, stocks: await listStoreStockBalancesForProducts(env.DB, storeId, productIds) });
  }

  return json({ error: 'Scope laporan tidak dikenali.' }, 400);
}
