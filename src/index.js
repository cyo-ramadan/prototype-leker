import { listOrders, listProducts, getOrder } from './db-multistore.js';
import { createOrder, changeOrderStatus, resetOrders } from './orders-multistore.js';
import { getPublicStore, handleAdminApi } from './admin-multistore.js';
import { handleAdminCashierApi, handleCashierAuthApi, requireCashier } from './cashier-auth.js';
import { handleCashierDrawerApi, requireDrawerOwner } from './cashier-drawer.js';
import { handleCashierWorkspaceApi } from './cashier-workspace.js';
import { handleCashierTrackedSaleApi } from './cashier-sales-tracking.js';
import { handleCashierPurchaseApi } from './cashier-purchase.js';
import { handleCashierProductionApi } from './cashier-production.js';
import { handleCashierCustomerSearchApi } from './cashier-customers.js';
import { handleApprovalQueueApi } from './approval-queue.js';
import { handleTransactionVoidPermitApi } from './transaction-void-permits.js';
import { handleStaffPortalApi } from './staff-portal.js';
import { handleAdminCashierRaportApi } from './staff-raport.js';
import { handleAdminDrawerApi } from './admin-drawers.js';
import { handleManufacturingMasterApi } from './manufacturing-master.js';
import { handleAdminProductClassificationApi } from './admin-product-classification.js';
import { handleProductPolicyApi } from './product-policy.js';
import { handleProductMasterApi } from './product-master.js';
import { handleProductKindApi } from './product-kinds.js';
import { handleAccountingWorkspaceApi } from './accounting-workspace.js';
import { handleAccountingReconciliationGuardApi } from './accounting-reconciliation-guard.js';
import { handleAccountingPosBridgeApi } from './accounting-pos-bridge.js';
import { attachAccountingBridgeToCommittedResponse } from './accounting-pos-bridge-response.js';
import { handleAccountingSettingsApi } from './accounting-settings.js';
import { handleWarehouseSettingsApi } from './warehouse-settings.js';
import { handleAccountingReferenceApi } from './accounting-reference.js';
import { handleAdminStockApi } from './admin-stock.js';
import { handleAdminTransactionsApi } from './admin-transactions.js';
import { handleAdminPurchaseDetailApi } from './admin-purchase-detail.js';
import { handleAdminTransactionDetailApi } from './admin-transaction-detail.js';
import { handleAdminProductionDetailApi } from './admin-production-detail.js';
import { handleCustomerApi, optionalCustomerFromRequest } from './customers.js';
import { handleCustomerMembershipApi } from './customer-membership.js';
import { handleCustomerFeedbackApi } from './customer-feedback.js';
import { handleOwnerCustomerSharingApi } from './customer-sharing.js';
import { handleOwnerApi, handleStoreAdminApi } from './owner-auth.js';
import { handleSupplierApi } from './suppliers.js';
import { handleUnifiedLoginApi } from './unified-login.js';
import { handleCostMasterApi } from './cost-master.js';
import { DEFAULT_STORE_CODE, listStores, resolveStore } from './stores.js';
import { json, readJson } from './http.js';

function storeTokenFromUrl(url) {
  return url.searchParams.get('store') || DEFAULT_STORE_CODE;
}

async function requirePublicStore(env, url) {
  return resolveStore(env.DB, storeTokenFromUrl(url));
}

async function handleCashierOrders(request, env, pathname) {
  if (!pathname.startsWith('/api/cashier/')) return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const storeId = auth.cashier.store.id;

  if (request.method === 'GET' && pathname === '/api/cashier/orders') {
    return json({ cashier: auth.cashier, orders: await listOrders(env.DB, storeId) });
  }

  const statusMatch = pathname.match(/^\/api\/cashier\/orders\/([^/]+)\/status$/);
  if (request.method === 'PATCH' && statusMatch) {
    const drawerAuth = await requireDrawerOwner(env.DB, auth.cashier);
    if (!drawerAuth.ok) return drawerAuth.response;
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const result = await changeOrderStatus(env.DB, storeId, statusMatch[1], body.value?.status, drawerAuth.drawer.id);
    return result.ok ? json(result.order) : json({ error: result.error }, result.status);
  }

  if (request.method === 'POST' && pathname === '/api/cashier/reset') {
    const drawerAuth = await requireDrawerOwner(env.DB, auth.cashier);
    if (!drawerAuth.ok) return drawerAuth.response;
    return json(await resetOrders(env.DB, storeId));
  }

  return json({ error: 'Route kasir tidak ditemukan.' }, 404);
}

async function handleApi(request, env, url) {
  const { pathname } = url;

  const unifiedLoginResponse = await handleUnifiedLoginApi(request, env, pathname);
  if (unifiedLoginResponse) return unifiedLoginResponse;
  const costMasterResponse = await handleCostMasterApi(request, env, pathname);
  if (costMasterResponse) return costMasterResponse;
  const membershipResponse = await handleCustomerMembershipApi(request, env, pathname);
  if (membershipResponse) return membershipResponse;
  const feedbackResponse = await handleCustomerFeedbackApi(request, env, pathname);
  if (feedbackResponse) return feedbackResponse;
  const sharingResponse = await handleOwnerCustomerSharingApi(request, env, pathname);
  if (sharingResponse) return sharingResponse;
  const ownerResponse = await handleOwnerApi(request, env, pathname);
  if (ownerResponse) return ownerResponse;
  const storeAdminResponse = await handleStoreAdminApi(request, env, pathname);
  if (storeAdminResponse) return storeAdminResponse;
  const approvalResponse = await handleApprovalQueueApi(request, env, pathname);
  if (approvalResponse) return approvalResponse;
  const permitResponse = await handleTransactionVoidPermitApi(request, env, pathname);
  if (permitResponse) return permitResponse;
  const customerResponse = await handleCustomerApi(request, env, pathname);
  if (customerResponse) return customerResponse;
  const supplierResponse = await handleSupplierApi(request, env, pathname);
  if (supplierResponse) return supplierResponse;
  const adminCashierResponse = await handleAdminCashierApi(request, env, pathname);
  if (adminCashierResponse) return adminCashierResponse;
  const adminDrawerResponse = await handleAdminDrawerApi(request, env, pathname);
  if (adminDrawerResponse) return adminDrawerResponse;
  const productKindResponse = await handleProductKindApi(request, env, pathname);
  if (productKindResponse) return productKindResponse;
  const productMasterResponse = await handleProductMasterApi(request, env, pathname);
  if (productMasterResponse) return productMasterResponse;
  const classificationResponse = await handleAdminProductClassificationApi(request, env, pathname);
  if (classificationResponse) return classificationResponse;
  const productPolicyResponse = await handleProductPolicyApi(request, env, pathname);
  if (productPolicyResponse) return productPolicyResponse;
  const accountingWorkspaceResponse = await handleAccountingWorkspaceApi(request, env, pathname);
  if (accountingWorkspaceResponse) return accountingWorkspaceResponse;
  const accountingReconciliationGuard = await handleAccountingReconciliationGuardApi(request, env, pathname);
  if (accountingReconciliationGuard) return accountingReconciliationGuard;
  const accountingBridgeResponse = await handleAccountingPosBridgeApi(request, env, pathname);
  if (accountingBridgeResponse) return accountingBridgeResponse;
  const accountingSettingsResponse = await handleAccountingSettingsApi(request, env, pathname);
  if (accountingSettingsResponse) return accountingSettingsResponse;
  const warehouseSettingsResponse = await handleWarehouseSettingsApi(request, env, pathname);
  if (warehouseSettingsResponse) return warehouseSettingsResponse;
  const accountingReferenceResponse = await handleAccountingReferenceApi(request, env, pathname);
  if (accountingReferenceResponse) return accountingReferenceResponse;
  const manufacturingMasterResponse = await handleManufacturingMasterApi(request, env, pathname);
  if (manufacturingMasterResponse) return manufacturingMasterResponse;
  const adminStockResponse = await handleAdminStockApi(request, env, pathname);
  if (adminStockResponse) return adminStockResponse;
  const adminProductionDetailResponse = await handleAdminProductionDetailApi(request, env, pathname);
  if (adminProductionDetailResponse) return adminProductionDetailResponse;
  const adminPurchaseDetailResponse = await handleAdminPurchaseDetailApi(request, env, pathname);
  if (adminPurchaseDetailResponse) return adminPurchaseDetailResponse;
  const adminTransactionDetailResponse = await handleAdminTransactionDetailApi(request, env, pathname);
  if (adminTransactionDetailResponse) return adminTransactionDetailResponse;
  const adminTransactionsResponse = await handleAdminTransactionsApi(request, env, pathname);
  if (adminTransactionsResponse) return adminTransactionsResponse;
  const adminRaportResponse = await handleAdminCashierRaportApi(request, env, pathname);
  if (adminRaportResponse) return adminRaportResponse;
  if (pathname.startsWith('/api/admin/')) return handleAdminApi(request, env, pathname);
  const cashierAuthResponse = await handleCashierAuthApi(request, env, pathname);
  if (cashierAuthResponse) return cashierAuthResponse;
  const staffPortalResponse = await handleStaffPortalApi(request, env, pathname);
  if (staffPortalResponse) return staffPortalResponse;
  const cashierCustomerSearchResponse = await handleCashierCustomerSearchApi(request, env, pathname);
  if (cashierCustomerSearchResponse) return cashierCustomerSearchResponse;
  const cashierProductionResponse = await handleCashierProductionApi(request, env, pathname);
  if (cashierProductionResponse) return cashierProductionResponse;
  const cashierWorkspaceResponse = await handleCashierWorkspaceApi(request, env, pathname);
  if (cashierWorkspaceResponse) return cashierWorkspaceResponse;
  const trackedSaleResponse = await handleCashierTrackedSaleApi(request, env, pathname);
  if (trackedSaleResponse) {
    return request.method === 'POST' && pathname === '/api/cashier/sales'
      ? attachAccountingBridgeToCommittedResponse(trackedSaleResponse, env, 'SALE')
      : trackedSaleResponse;
  }
  const purchaseResponse = await handleCashierPurchaseApi(request, env, pathname);
  if (purchaseResponse) {
    if (request.method === 'POST' && pathname === '/api/cashier/purchases') return attachAccountingBridgeToCommittedResponse(purchaseResponse, env, 'PURCHASE');
    if (request.method === 'POST' && pathname === '/api/cashier/expenses') return attachAccountingBridgeToCommittedResponse(purchaseResponse, env, 'EXPENSE');
    return purchaseResponse;
  }
  const cashierDrawerResponse = await handleCashierDrawerApi(request, env, pathname);
  if (cashierDrawerResponse) return cashierDrawerResponse;
  const cashierOrdersResponse = await handleCashierOrders(request, env, pathname);
  if (cashierOrdersResponse) return cashierOrdersResponse;

  if (request.method === 'GET' && pathname === '/api/stores') {
    const stores = await listStores(env.DB);
    return json(stores.map(store => ({ id: store.id, code: store.code, storeName: store.storeName, address: store.address })));
  }

  const store = await requirePublicStore(env, url);
  if (!store) return json({ error: 'Gerai tidak ditemukan atau sedang nonaktif.' }, 404);
  if (request.method === 'GET' && pathname === '/api/menu') return json(await listProducts(env.DB, store.id));
  if (request.method === 'GET' && pathname === '/api/store') return json(await getPublicStore(env.DB, store.id));
  const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (request.method === 'GET' && orderMatch) {
    const order = await getOrder(env.DB, store.id, orderMatch[1]);
    return order ? json(order) : json({ error: 'Order not found' }, 404);
  }
  if (request.method === 'POST' && pathname === '/api/orders') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const customer = await optionalCustomerFromRequest(request, env.DB, store.id);
    const result = await createOrder(env.DB, store, {
      ...body.value,
      customerId: customer?.id || null,
      customerName: customer?.customerName || body.value?.customerName
    });
    return result.ok ? json(result.order, 201) : json({ error: result.error }, result.status);
  }
  if (pathname === '/api/orders' || pathname === '/api/reset' || pathname.match(/^\/api\/orders\/[^/]+\/status$/)) {
    return json({ error: 'Login kasir dan laci aktif diperlukan untuk perubahan data kasir.' }, 401);
  }
  return json({ error: 'Not found' }, 404);
}

function assetRoute(pathname) {
  const direct = { '/': '/customer.html', '/customer': '/customer.html', '/cashier': '/cashier.html', '/staff': '/staff.html', '/admin': '/owner.html', '/owner': '/owner.html' };
  if (direct[pathname]) return direct[pathname];
  const scoped = pathname.match(/^\/s\/([^/]+)(?:\/(customer|cashier|admin))?\/?$/);
  if (scoped) {
    const page = scoped[2] || 'customer';
    if (page === 'admin') return '/branch-admin.html';
    return `/${page}.html`;
  }
  return pathname;
}

async function handleAsset(request, env, pathname) {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = assetRoute(pathname);
  return env.ASSETS.fetch(new Request(assetUrl, request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url);
      return await handleAsset(request, env, url.pathname);
    } catch (error) {
      console.error('prototype-leker request failed', error);
      return json({ error: 'Terjadi kesalahan server.' }, 500);
    }
  }
};
