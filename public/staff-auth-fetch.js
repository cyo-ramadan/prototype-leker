(() => {
  const originalFetch = window.fetch.bind(window);

  function isStaffApi(url) {
    return url.origin === location.origin && (
      url.pathname.startsWith('/api/cashier/') ||
      url.pathname.startsWith('/api/cashdrawer/') ||
      url.pathname.startsWith('/api/staff/')
    );
  }

  async function authorizedFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), location.origin);
    if (!isStaffApi(url)) return originalFetch(input, init);

    const headers = new Headers(request ? request.headers : init.headers || {});
    const token = sessionStorage.getItem('lekerCashierToken') || '';
    if (token) headers.set('Authorization', `Bearer ${token}`);
    else headers.delete('Authorization');

    const nextInit = { ...init, headers };
    return request
      ? originalFetch(new Request(request, nextInit))
      : originalFetch(url.toString(), nextInit);
  }

  window.staffAuthorizedFetch = authorizedFetch;
  window.fetch = authorizedFetch;
})();
