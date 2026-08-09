import { listOrders, listProducts, getOrder } from './db-multistore.js';
import { createOrder, changeOrderStatus, resetOrders } from './orders-multistore.js';
import { getPublicStore, handleAdminApi } from './admin-multistore.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { json, readJson } from './http.js';

function storeTokenFromUrl(url) {
  return url.searchParams.get('store') || DEFAULT_STORE_CODE;
}

async function requirePublicStore(env, url) {
  return resolveStore(env.DB, storeTokenFromUrl(url));
}

async function handleApi(request, env, url) {
  const { pathname } = url;

  if (pathname.startsWith('/api/admin/')) {
    return handleAdminApi(request, env, pathname);
  }

  const store = await requirePublicStore(env, url);
  if (!store) return json({ error: 'Gerai tidak ditemukan atau sedang nonaktif.' }, 404);

  if (request.method === 'GET' && pathname === '/api/menu') {
    return json(await listProducts(env.DB, store.id));
  }

  if (request.method === 'GET' && pathname === '/api/store') {
    return json(await getPublicStore(env.DB, store.id));
  }

  if (request.method === 'GET' && pathname === '/api/orders') {
    return json(await listOrders(env.DB, store.id));
  }

  const statusMatch = pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);

  if (request.method === 'GET' && orderMatch) {
    const order = await getOrder(env.DB, store.id, orderMatch[1]);
    return order ? json(order) : json({ error: 'Order not found' }, 404);
  }

  if (request.method === 'POST' && pathname === '/api/orders') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const result = await createOrder(env.DB, store, body.value);
    return result.ok ? json(result.order, 201) : json({ error: result.error }, result.status);
  }

  if (request.method === 'PATCH' && statusMatch) {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const result = await changeOrderStatus(env.DB, store.id, statusMatch[1], body.value?.status);
    return result.ok ? json(result.order) : json({ error: result.error }, result.status);
  }

  if (request.method === 'POST' && pathname === '/api/reset') {
    return json(await resetOrders(env.DB, store.id));
  }

  return json({ error: 'Not found' }, 404);
}

function assetRoute(pathname) {
  const direct = {
    '/': '/customer.html',
    '/customer': '/customer.html',
    '/cashier': '/cashier.html',
    '/admin': '/admin.html'
  };
  if (direct[pathname]) return direct[pathname];

  const scoped = pathname.match(/^\/s\/([^/]+)(?:\/(customer|cashier|admin))?\/?$/);
  if (scoped) {
    const page = scoped[2] || 'customer';
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
