import { listOrders, listProducts, getOrder } from './db.js';
import { createOrder, changeOrderStatus, resetOrders } from './orders.js';
import { getPublicStore, handleAdminApi } from './admin.js';
import { json, readJson } from './http.js';

async function handleApi(request, env, pathname) {
  if (request.method === 'GET' && pathname === '/api/menu') {
    return json(await listProducts(env.DB));
  }

  if (request.method === 'GET' && pathname === '/api/store') {
    return json(await getPublicStore(env.DB));
  }

  if (pathname.startsWith('/api/admin/')) {
    return handleAdminApi(request, env, pathname);
  }

  if (request.method === 'GET' && pathname === '/api/orders') {
    return json(await listOrders(env.DB));
  }

  const statusMatch = pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);

  if (request.method === 'GET' && orderMatch) {
    const order = await getOrder(env.DB, orderMatch[1]);
    return order ? json(order) : json({ error: 'Order not found' }, 404);
  }

  if (request.method === 'POST' && pathname === '/api/orders') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);

    const result = await createOrder(env.DB, body.value);
    return result.ok ? json(result.order, 201) : json({ error: result.error }, result.status);
  }

  if (request.method === 'PATCH' && statusMatch) {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);

    const result = await changeOrderStatus(env.DB, statusMatch[1], body.value?.status);
    return result.ok ? json(result.order) : json({ error: result.error }, result.status);
  }

  if (request.method === 'POST' && pathname === '/api/reset') {
    return json(await resetOrders(env.DB));
  }

  return json({ error: 'Not found' }, 404);
}

async function handleAsset(request, env, pathname) {
  const routes = {
    '/': '/customer.html',
    '/customer': '/customer.html',
    '/cashier': '/cashier.html',
    '/admin': '/admin.html'
  };

  const assetUrl = new URL(request.url);
  assetUrl.pathname = routes[pathname] ?? pathname;
  return env.ASSETS.fetch(new Request(assetUrl, request));
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    try {
      if (pathname.startsWith('/api/')) return await handleApi(request, env, pathname);
      return await handleAsset(request, env, pathname);
    } catch (error) {
      console.error('prototype-leker request failed', error);
      return json({ error: 'Terjadi kesalahan server.' }, 500);
    }
  }
};
