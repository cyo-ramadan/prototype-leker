import { json } from './http.js';
import { listOrders, listProducts } from './db-multistore.js';
import { requireCashierOrReadOnlyManagement } from './cashier-auth.js';
import { getOpenDrawer } from './cashier-drawer.js';
import { listPosPaymentMethods } from './pos-payment-methods.js';
import { listCashFlowCounterpartOptions } from './accounting-cash-flow-bridge.js';
import { listActiveSharedAccountsForStore } from './entity-shared-accounts.js';

export async function handleCashierWorkspaceApi(request, env, pathname) {
  if (request.method !== 'GET' || pathname !== '/api/cashier/workspace') return null;
  const auth = await requireCashierOrReadOnlyManagement(request, env);
  if (!auth.ok) return auth.response;
  const cashier = auth.cashier;
  const [products, orders, drawer, paymentMethods, cashFlowCounterparts, sharedAccounts] = await Promise.all([
    listProducts(env.DB, cashier.store.id),
    listOrders(env.DB, cashier.store.id),
    getOpenDrawer(env.DB, cashier.store.id),
    listPosPaymentMethods(env.DB, cashier.store.id),
    listCashFlowCounterpartOptions(env.DB, cashier.store.id),
    listActiveSharedAccountsForStore(env.DB, cashier.store.id)
  ]);
  // Owner/Admin Gerai/Entity Admin yang cuma melihat (bukan kasir sungguhan)
  // TIDAK PERNAH boleh menulis, apa pun status laci-nya -- dipaksa false di
  // sini, bukan cuma mengandalkan drawer.cashierId yang kebetulan tidak
  // cocok dengan id sintetis "readonly:*".
  const canWrite = auth.readOnly ? false : Boolean(drawer && drawer.cashierId === cashier.id);
  return json({ cashier, products, orders, drawer, paymentMethods, cashFlowCounterparts, sharedAccounts, canWrite, readOnly: Boolean(auth.readOnly) });
}
