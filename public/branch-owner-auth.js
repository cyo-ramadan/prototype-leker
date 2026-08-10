(() => {
  const token = sessionStorage.getItem('lekerOwnerToken') || '';
  if (!token) {
    location.replace('/admin');
    return;
  }

  // Existing branch-master UI still expects a local admin marker. The actual
  // authorization is the Owner bearer session added below, not this marker.
  sessionStorage.setItem('lekerAdminPin', 'OWNER_SESSION');

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function ownerScopedFetch(input, init = {}) {
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
      sessionStorage.removeItem('lekerOwnerToken');
      sessionStorage.removeItem('lekerAdminPin');
      location.replace('/admin');
    }
    return response;
  };

  document.addEventListener('DOMContentLoaded', () => {
    const authBtn = document.getElementById('authBtn');
    if (authBtn) authBtn.addEventListener('click', () => location.href = '/admin', { capture: true });

    const legacyLock = document.getElementById('logoutBtn');
    if (legacyLock) {
      legacyLock.textContent = 'Owner Console';
      legacyLock.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        location.href = '/admin';
      }, true);
    }
  });
})();
