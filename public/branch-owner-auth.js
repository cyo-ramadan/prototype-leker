(() => {
  const ownerToken = sessionStorage.getItem('lekerOwnerToken') || '';
  const adminToken = sessionStorage.getItem('lekerAdminToken') || '';
  const adminStoreCode = String(sessionStorage.getItem('lekerAdminStoreCode') || '').toUpperCase();
  const currentStoreCode = String(window.LEKER_STORE_CODE || 'G001').toUpperCase();
  const isOwner = Boolean(ownerToken);
  const token = ownerToken || adminToken;

  if (!token) {
    location.replace(`/s/${encodeURIComponent(currentStoreCode)}/customer`);
    return;
  }

  if (!isOwner && adminStoreCode && adminStoreCode !== currentStoreCode) {
    location.replace(`/s/${encodeURIComponent(adminStoreCode)}/admin`);
    return;
  }

  // Existing branch-master UI still expects a local admin marker. Actual
  // authorization is the bearer session added below, not this marker.
  sessionStorage.setItem('lekerAdminPin', isOwner ? 'OWNER_SESSION' : 'STORE_ADMIN_SESSION');

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
      sessionStorage.removeItem(isOwner ? 'lekerOwnerToken' : 'lekerAdminToken');
      if (!isOwner) sessionStorage.removeItem('lekerAdminStoreCode');
      sessionStorage.removeItem('lekerAdminPin');
      location.replace(isOwner ? '/admin' : `/s/${encodeURIComponent(currentStoreCode)}/customer`);
    }
    return response;
  };

  async function leaveWorkspace() {
    if (isOwner) {
      location.href = '/admin';
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
      location.href = isOwner ? '/admin' : `/s/${encodeURIComponent(currentStoreCode)}/customer`;
    }, { capture: true });

    const legacyLock = document.getElementById('logoutBtn');
    if (legacyLock) {
      legacyLock.textContent = isOwner ? 'Owner Console' : 'Logout Admin';
      legacyLock.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        leaveWorkspace();
      }, true);
    }
  });
})();
