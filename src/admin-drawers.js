import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { buildDrawerReport, listStoreDrawers } from './drawer-report.js';

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function handleAdminDrawerApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/drawers')) return null;
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (request.method === 'GET' && pathname === '/api/admin/drawers') {
    return json({ store, drawers: await listStoreDrawers(env.DB, store.id) });
  }

  const match = pathname.match(/^\/api\/admin\/drawers\/([^/]+)$/);
  if (request.method === 'GET' && match) {
    const report = await buildDrawerReport(env.DB, store.id, decodeURIComponent(match[1]));
    return report ? json({ store, report }) : json({ error: 'Laci tidak ditemukan di gerai ini.' }, 404);
  }

  return json({ error: 'Route detail laci admin tidak ditemukan.' }, 404);
}
