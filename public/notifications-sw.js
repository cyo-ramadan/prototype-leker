/* Push only: no fetch/cache handler; operational data stays fresh. */
const notificationPath = value => {
  try {
    const url = new URL(value || '/login', self.location.origin);
    if (url.origin !== self.location.origin || url.username || url.password || !/^\/(?:entity-admin|admin|owner|cashier|staff|login|s\/[^/]+\/admin)(?:\/|$)/.test(url.pathname)) return '/login';
    // Keep route only: no query string could expose credentials in navigation.
    return url.pathname;
  } catch { return '/login'; }
};
self.addEventListener('push', event => {
  let data = {}; try { data = event.data?.json() || {}; } catch {}
  event.waitUntil((async () => {
    await self.registration.showNotification('MAXI · Notifikasi baru', {
      body: 'Ada pemberitahuan untuk akun Anda. Buka aplikasi untuk melihat detail.',
      tag: typeof data.tag === 'string' ? data.tag : 'maxi-notification',
      silent: data.silent === true, data: { url: notificationPath(data.url) }
    });
    for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) client.postMessage({ type: 'notifications-changed' });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = notificationPath(event.notification.data?.url);
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = clients.find(c => new URL(c.url).origin === self.location.origin && new URL(c.url).pathname === url);
    if (client) { await client.focus(); client.postMessage({ type: 'notifications-changed' }); return; }
    await self.clients.openWindow(url);
  })());
});
