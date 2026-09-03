(() => {
  const ownerToken = sessionStorage.getItem('lekerOwnerToken') || '';
  const entityAdminToken = sessionStorage.getItem('lekerEntityAdminToken') || '';
  const adminToken = sessionStorage.getItem('lekerAdminToken') || '';
  const adminStoreCode = String(sessionStorage.getItem('lekerAdminStoreCode') || '').toUpperCase();
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

  if (!isOwner && !isEntityAdmin && adminStoreCode && adminStoreCode !== currentStoreCode) {
    location.replace(`/s/${encodeURIComponent(adminStoreCode)}/admin`);
    return;
  }

  // Existing branch-master UI still expects a local admin marker. Actual
  // authorization is the bearer session added below, not this marker.
  sessionStorage.setItem('lekerAdminPin', isOwner ? 'OWNER_SESSION' : isEntityAdmin ? 'ENTITY_ADMIN_SESSION' : 'STORE_ADMIN_SESSION');

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
      sessionStorage.removeItem(isOwner ? 'lekerOwnerToken' : isEntityAdmin ? 'lekerEntityAdminToken' : 'lekerAdminToken');
      if (!isOwner && !isEntityAdmin) sessionStorage.removeItem('lekerAdminStoreCode');
      sessionStorage.removeItem('lekerAdminPin');
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
      sessionStorage.removeItem('lekerEntityAdminToken');
      sessionStorage.removeItem('lekerAdminPin');
      location.href = '/entity-admin';
      return;
    }

    try {
      await originalFetch(`/api/store-admin/logout?store=${encodeURIComponent(currentStoreCode)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
    } catch {}
    sessionStorage.removeItem('lekerAdminToken');
    sessionStorage.removeItem('lekerAdminStoreCode');
    sessionStorage.removeItem('lekerAdminPin');
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
