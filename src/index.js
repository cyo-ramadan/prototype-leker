import { listOrders, listProducts, getOrder } from './db-multistore.js';
import { createOrder, changeOrderStatus, resetOrders } from './orders-multistore.js';
import { getPublicStore, handleAdminApi } from './admin-multistore.js';
import { handleAdminCashierApi, handleCashierAuthApi, requireCashier } from './cashier-auth.js';
import { handleCashierDrawerApi, requireDrawerOwner } from './cashier-drawer.js';
import { handleCashierWorkspaceApi } from './cashier-workspace.js';
import { handleCashierTrackedSaleApi } from './cashier-sales-tracking.js';
import { handleApprovalQueueApi } from './approval-queue.js';
import { handleStaffPortalApi } from './staff-portal.js';
import { handleAdminDrawerApi } from './admin-drawers.js';
import { handleManufacturingMasterApi } from './manufacturing-master.js';
import { handleAdminTransactionsApi } from './admin-transactions.js';
import { handleCustomerApi, optionalCustomerFromRequest } from './customers.js';
import { handleCustomerMembershipApi } from './customer-membership.js';
import { handleOwnerCustomerSharingApi } from './customer-sharing.js';
import { handleOwnerApi, handleStoreAdminApi } from './owner-auth.js';
import { handleSupplierApi } from './suppliers.js';
import { handleUnifiedLoginApi } from './unified-login.js';
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

  const membershipResponse = await handleCustomerMembershipApi(request, env, pathname);
  if (membershipResponse) return membershipResponse;

  const sharingResponse = await handleOwnerCustomerSharingApi(request, env, pathname);
  if (sharingResponse) return sharingResponse;

  const ownerResponse = await handleOwnerApi(request, env, pathname);
  if (ownerResponse) return ownerResponse;

  const storeAdminResponse = await handleStoreAdminApi(request, env, pathname);
  if (storeAdminResponse) return storeAdminResponse;

  const approvalResponse = await handleApprovalQueueApi(request, env, pathname);
  if (approvalResponse) return approvalResponse;

  const customerResponse = await handleCustomerApi(request, env, pathname);
  if (customerResponse) return customerResponse;

  const supplierResponse = await handleSupplierApi(request, env, pathname);
  if (supplierResponse) return supplierResponse;

  const adminCashierResponse = await handleAdminCashierApi(request, env, pathname);
  if (adminCashierResponse) return adminCashierResponse;

  const adminDrawerResponse = await handleAdminDrawerApi(request, env, pathname);
  if (adminDrawerResponse) return adminDrawerResponse;

  const manufacturingMasterResponse = await handleManufacturingMasterApi(request, env, pathname);
  if (manufacturingMasterResponse) return manufacturingMasterResponse;

  const adminTransactionsResponse = await handleAdminTransactionsApi(request, env, pathname);
  if (adminTransactionsResponse) return adminTransactionsResponse;

  if (pathname.startsWith('/api/admin/')) return handleAdminApi(request, env, pathname);

  const cashierAuthResponse = await handleCashierAuthApi(request, env, pathname);
  if (cashierAuthResponse) return cashierAuthResponse;

  const staffPortalResponse = await handleStaffPortalApi(request, env, pathname);
  if (staffPortalResponse) return staffPortalResponse;

  const cashierWorkspaceResponse = await handleCashierWorkspaceApi(request, env, pathname);
  if (cashierWorkspaceResponse) return cashierWorkspaceResponse;

  const trackedSaleResponse = await handleCashierTrackedSaleApi(request, env, pathname);
  if (trackedSaleResponse) return trackedSaleResponse;

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
  const direct = {
    '/': '/customer.html',
    '/customer': '/customer.html',
    '/cashier': '/cashier.html',
    '/staff': '/staff.html',
    '/admin': '/owner.html',
    '/owner': '/owner.html'
  };
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