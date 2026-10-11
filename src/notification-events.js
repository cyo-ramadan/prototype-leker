import { notificationActor, listNotificationActors, collectGeneralNotifications } from './management-notifications.js';
import { resolveStore, DEFAULT_STORE_CODE } from './stores.js';

// Only completed writes to facts represented in the inbox trigger collection.
// Ordinary sales, reads, and notification settings never scan other users.
export function isNotificationEventMutation(request) {
  const path = new URL(request.url).pathname;
  if (request.method === 'POST') return /^\/api\/cashier\/employee-deposits\/[^/]+\/payments$/.test(path)
    || /^\/api\/cashier\/approval-requests(?:\/stock-adjustment-batch)?$/.test(path)
    || path === '/api/admin/announcements';
  if (request.method === 'PATCH') return /^\/api\/admin\/employee-deposits\/payments\/[^/]+$/.test(path)
    || /^\/api\/management\/approval-requests\/(?:session\/)?[^/]+$/.test(path);
  return false;
}

export async function queueNotificationEvent(request, env, dependencies = {}) {
  if (!isNotificationEventMutation(request)) return { actors: 0 };
  const authenticate = dependencies.notificationActor || notificationActor;
  const list = dependencies.listNotificationActors || listNotificationActors;
  const collect = dependencies.collectGeneralNotifications || collectGeneralNotifications;
  const findStore = dependencies.resolveStore || resolveStore;
  const actor = await authenticate(request, env);
  if (!actor) return { actors: 0 };
  const url = new URL(request.url);
  let entityId = actor.entityId;
  let storeId = actor.storeId || null;
  if (!storeId) {
    const store = await findStore(env.DB, url.searchParams.get('store') || DEFAULT_STORE_CODE);
    if (!store?.entityId || (entityId && store.entityId !== entityId)) return { actors: 0 };
    entityId = store.entityId;
    storeId = store.id;
  }
  if (!entityId) return { actors: 0 };
  // An entity announcement can reach multiple stores. Collection still applies
  // each recipient's store visibility; no body-provided recipient is trusted.
  if (url.pathname === '/api/admin/announcements') storeId = null;
  const actors = await list(env, { entityId, storeId });
  let failed = 0;
  for (const recipient of actors) {
    try { await collect(env, recipient); }
    catch (error) { failed++; console.error('notification collection failed', { name: error?.name }); }
  }
  return { actors: actors.length, failed };
}