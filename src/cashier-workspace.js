import { json } from './http.js';
import { listOrders, listProducts } from './db-multistore.js';
import { requireCashier } from './cashier-auth.js';
import { getOpenDrawer } from './cashier-drawer.js';
import { listPosPaymentMethods } from './pos-payment-methods.js';
import { listCashFlowCounterpartOptions } from './accounting-cash-flow-bridge.js';

export async function handleCashierWorkspaceApi(request, env, pathname) {
  if (request.method !== 'GET' || pathname !== '/api/cashier/workspace') return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const cashier = auth.cashier;
  const [products, orders, drawer, paymentMethods, cashFlowCounterparts] = await Promise.all([
    listProducts(env.DB, cashier.store.id),
    listOrders(env.DB, cashier.store.id),
    getOpenDrawer(env.DB, cashier.store.id),
    listPosPaymentMethods(env.DB, cashier.store.id),
    listCashFlowCounterpartOptions(env.DB, cashier.store.id)
  ]);
  return json({
    cashier, products, orders, drawer, paymentMethods, cashFlowCounterparts,
    canWrite: Boolean(drawer),
    isDrawerOwner: Boolean(drawer && drawer.cashierId === cashier.id)
  });
}
