(() => {
  const ownerToken = localStorage.getItem('lekerOwnerToken') || '';
  const entityAdminToken = localStorage.getItem('lekerEntityAdminToken') || '';
  const adminToken = localStorage.getItem('lekerAdminToken') || '';
  const adminStoreCode = String(localStorage.getItem('lekerAdminStoreCode') || '').toUpperCase();
  const currentStoreCode = String(window.LEKER_STORE_CODE || 'G001').toUpperCase();
  const isOwner = Boolean(ownerToken);
  const isEntityAdmin = !isOwner && Boolean(entityAdminToken);
  // Entity Admin, like Owner, navigates freely between stores under its
  // Entity -- only the plain Store Admin is pinned to one store_id and needs
  // the redirect-back-to-its-own-store guard below.
  const token = ownerToken || entityAdminToken || adminToken;

  if (!token) {
    location.replace(`/s/${encodeURIComponent(currentStoreCode)}/customer`);
    return;
  }

  // Bos Cyo, 2026-09-17: Entity Admin landed on the bare /branch-admin entry
  // point (bookmark/shortcut/browser-suggested URL, no /s/:code/ prefix) and
  // got a confusing "hanya berwenang pada gerai di bawah entity ..." failure.
  // Root cause: without a store code in the URL, store-context.js has no
  // Entity-Admin-aware fallback (only Store Admin's fixed adminStoreCode is
  // remembered) and silently defaults to G001 -- a store that is essentially
  // never under the Entity Admin's own entity, so the workspace bootstrap
  // always fails. Unlike Store Admin (pinned to one store, safe to redirect
  // to), Entity Admin has no single "right" store to guess here -- send them
  // back to their own picker (/entity-admin) instead of guessing wrong.
  if (isEntityAdmin && !/^\/s\//.test(location.pathname)) {
    location.replace('/entity-admin');
    return;
  }

  if (!isOwner && !isEntityAdmin && adminStoreCode && adminStoreCode !== currentStoreCode) {
    location.replace(`/s/${encodeURIComponent(adminStoreCode)}/admin`);
    return;
  }

  // Existing branch-master UI still expects a local admin marker. Actual
  // authorization is the bearer session added below, not this marker.
  localStorage.setItem('lekerAdminPin', isOwner ? 'OWNER_SESSION' : isEntityAdmin ? 'ENTITY_ADMIN_SESSION' : 'STORE_ADMIN_SESSION');

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function managementScopedFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), location.origin);
    const isManagedApi = url.origin === location.origin && url.pathname.startsWith('/api/admin/');
    if (!isManagedApi) return originalFetch(input, init);

    const headers = new Headers(request ? request.headers : init.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    const nextInit = { ...init, headers };
    const response = request
      ? await originalFetch(new Request(request, nextInit))
      : await originalFetch(url.toString(), nextInit);

    if (response.status === 401) {
      localStorage.removeItem(isOwner ? 'lekerOwnerToken' : isEntityAdmin ? 'lekerEntityAdminToken' : 'lekerAdminToken');
      if (!isOwner && !isEntityAdmin) localStorage.removeItem('lekerAdminStoreCode');
      localStorage.removeItem('lekerAdminPin');
      location.replace(isOwner ? '/admin' : isEntityAdmin ? '/entity-admin' : `/s/${encodeURIComponent(currentStoreCode)}/customer`);
    }
    return response;
  };

  async function leaveWorkspace() {
    if (isOwner) {
      location.href = '/admin';
      return;
    }

    if (isEntityAdmin) {
      try {
        await originalFetch('/api/entity-admin/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${entityAdminToken}` }
        });
      } catch {}
      localStorage.removeItem('lekerEntityAdminToken');
      localStorage.removeItem('lekerAdminPin');
      location.href = '/entity-admin';
      return;
    }

    try {
      await originalFetch(`/api/store-admin/logout?store=${encodeURIComponent(currentStoreCode)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
    } catch {}
    localStorage.removeItem('lekerAdminToken');
    localStorage.removeItem('lekerAdminStoreCode');
    localStorage.removeItem('lekerAdminPin');
    location.href = `/s/${encodeURIComponent(currentStoreCode)}/customer`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const authBtn = document.getElementById('authBtn');
    if (authBtn) authBtn.addEventListener('click', () => {
      location.href = isOwner ? '/admin' : isEntityAdmin ? '/entity-admin' : `/s/${encodeURIComponent(currentStoreCode)}/customer`;
    }, { capture: true });

    const legacyLock = document.getElementById('logoutBtn');
    if (legacyLock) {
      legacyLock.textContent = isOwner ? 'Owner Console' : isEntityAdmin ? 'Kembali ke Entity Admin' : 'Logout Admin';
      legacyLock.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        leaveWorkspace();
      }, true);
    }
  });
})();
