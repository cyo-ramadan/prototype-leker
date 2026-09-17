(() => {
  const originalFetch = window.fetch.bind(window);

  function isStaffApi(url) {
    return url.origin === location.origin && (
      url.pathname.startsWith('/api/cashier/') ||
      url.pathname.startsWith('/api/staff/')
    );
  }

  // Bos Cyo, 2026-09-17: "harusnya liat persis banget halaman kasir, tapi
  // dia ga bisa write" -- Owner/Admin Gerai/Entity Admin membuka halaman
  // Kasir ini lewat ?readonly=1 secara eksplisit (lihat staff-entry-guard.js
  // dan public/cashier.js) tanpa akun kasir. Fallback token cuma aktif
  // untuk ?readonly=1 -- tanpa itu, "Kasir Login" biasa tetap PERSIS seperti
  // sebelumnya (cuma lekerCashierToken), tidak ikut melonggar cuma karena
  // kebetulan ada token manajemen nganggur di browser yang sama.
  const isReadOnlyPreview = new URLSearchParams(location.search).get('readonly') === '1';

  async function authorizedFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), location.origin);
    if (!isStaffApi(url)) return originalFetch(input, init);

    const headers = new Headers(request ? request.headers : init.headers || {});
    const token = sessionStorage.getItem('lekerCashierToken')
      || (isReadOnlyPreview && (localStorage.getItem('lekerOwnerToken') || localStorage.getItem('lekerEntityAdminToken') || localStorage.getItem('lekerAdminToken')))
      || '';
    if (token) headers.set('Authorization', `Bearer ${token}`);
    else headers.delete('Authorization');

    const body = Object.prototype.hasOwnProperty.call(init, 'body') ? init.body : null;
    if (body instanceof FormData) headers.delete('Content-Type');

    const nextInit = { ...init, headers };
    return request
      ? originalFetch(new Request(request, nextInit))
      : originalFetch(url.toString(), nextInit);
  }

  window.staffAuthorizedFetch = authorizedFetch;
  window.fetch = authorizedFetch;
})();
