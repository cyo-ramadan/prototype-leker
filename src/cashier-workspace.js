import { json } from './http.js';
import { listOrders, listProducts } from './db-multistore.js';
import { requireCashier } from './cashier-auth.js';
import { getOpenDrawer } from './cashier-drawer.js';

export async function handleCashierWorkspaceApi(request, env, pathname) {
  if (request.method !== 'GET' || pathname !== '/api/cashier/workspace') return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const cashier = auth.cashier;
  const [products, orders, drawer] = await Promise.all([
    listProducts(env.DB, cashier.store.id),
    listOrders(env.DB, cashier.store.id),
    getOpenDrawer(env.DB, cashier.store.id)
  ]);
  return json({
    cashier,
    products,
    orders,
    drawer,
    canWrite: Boolean(drawer && drawer.cashierId === cashier.id)
  });
}
