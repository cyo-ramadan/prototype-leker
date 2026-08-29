(() => {
  const match = location.pathname.match(/^\/s\/([^/]+)/);
  const pathStore = match ? decodeURIComponent(match[1]).toUpperCase() : '';
  // Detecting "is this the admin page" from the URL shape is fragile -- it
  // missed a real report of admins reaching /branch-admin directly (no /s/:code
  // prefix, and not ending in "/admin" either, so the old regex silently
  // treated it as a customer page and picked the wrong remembered-store key).
  // Each HTML shell now says explicitly which page it is before loading this
  // script, so this no longer depends on guessing from the path.
  const isAdmin = window.LEKER_PAGE_CONTEXT === 'admin';
  const rememberedKey = isAdmin ? 'lekerAdminStoreCode' : 'lekerCustomerStoreCode';
  // An entry point without a /s/:code prefix (a bookmarked /branch-admin, a bare
  // "/", a home-screen shortcut) carries no gerai in the URL. For an Admin the
  // login already recorded which gerai this session belongs to, so trust that
  // before any fallback: otherwise the page loads as G001 while the session
  // belongs to another gerai, and every scoped request goes to the wrong gerai.
  const adminSessionStore = isAdmin
    ? String(sessionStorage.getItem('lekerAdminStoreCode') || '').toUpperCase()
    : '';
  const selected = pathStore || adminSessionStore || localStorage.getItem(rememberedKey) || 'G001';

  window.LEKER_STORE_CODE = selected;
  // A bare "/" or "/customer" load (no /s/:code prefix -- bookmark, home-screen
  // shortcut, app reopen) has no path to read the store from. Remember the last
  // /s/:code page the browser actually visited so those entry points land back
  // on the same gerai instead of silently defaulting to G001.
  if (pathStore) {
    try { localStorage.setItem(rememberedKey, pathStore); } catch {}
  }
  window.lekerStorePath = page => `/s/${encodeURIComponent(window.LEKER_STORE_CODE || 'G001')}/${page}`;

  const originalFetch = window.fetch.bind(window);
  window.fetch = function scopedFetch(input, init) {
    const requestUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(requestUrl, location.origin);

    if (url.origin === location.origin && url.pathname.startsWith('/api/') && !url.searchParams.has('store')) {
      url.searchParams.set('store', window.LEKER_STORE_CODE || 'G001');
    }

    if (url.origin === location.origin && url.pathname === '/menu.json' && (window.LEKER_STORE_CODE || 'G001') !== 'G001') {
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }

    if (input instanceof Request) return originalFetch(new Request(url.toString(), input), init);
    return originalFetch(url.toString(), init);
  };

  const originalGetItem = Storage.prototype.getItem;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  const scopedKey = function(key) {
    if (this === window.localStorage && key === 'lekerActiveOrderId') {
      return `${key}:${window.LEKER_STORE_CODE || 'G001'}`;
    }
    return key;
  };
  Storage.prototype.getItem = function(key) { return originalGetItem.call(this, scopedKey.call(this, key)); };
  Storage.prototype.setItem = function(key, value) { return originalSetItem.call(this, scopedKey.call(this, key), value); };
  Storage.prototype.removeItem = function(key) { return originalRemoveItem.call(this, scopedKey.call(this, key)); };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-store-code]').forEach(node => { node.textContent = window.LEKER_STORE_CODE; });
    document.querySelectorAll('[data-store-page]').forEach(link => { link.href = window.lekerStorePath(link.dataset.storePage); });
  });
})();
