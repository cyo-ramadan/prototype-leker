import { json } from './http.js';
import { listOrders, listProducts } from './db-multistore.js';
import { requireCashier } from './cashier-auth.js';
import { getOpenDrawer } from './cashier-drawer.js';
import { listOperationalAccountingComponents, listPosPaymentMethods } from './accounting-pos-bridge.js';
import { listCashFlowCounterpartOptions } from './accounting-cash-flow-bridge.js';

export async function handleCashierWorkspaceApi(request, env, pathname) {
  if (request.method !== 'GET' || pathname !== '/api/cashier/workspace') return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const cashier = auth.cashier;
  const [products, orders, drawer, paymentMethods, operationalAccountingComponents, cashFlowCounterparts] = await Promise.all([
    listProducts(env.DB, cashier.store.id),
    listOrders(env.DB, cashier.store.id),
    getOpenDrawer(env.DB, cashier.store.id),
    listPosPaymentMethods(env.DB, cashier.store.id),
    listOperationalAccountingComponents(env.DB, cashier.store.id),
    listCashFlowCounterpartOptions(env.DB, cashier.store.id)
  ]);
  return json({ cashier, products, orders, drawer, paymentMethods, operationalAccountingComponents, cashFlowCounterparts, canWrite: Boolean(drawer && drawer.cashierId === cashier.id) });
}
