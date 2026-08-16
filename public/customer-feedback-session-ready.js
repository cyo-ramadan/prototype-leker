(() => {
  const storeCode = String(window.LEKER_STORE_CODE || 'G001').toUpperCase();
  const tokenKey = `lekerCustomerToken:${storeCode}`;
  const hasCustomerSession = Boolean(sessionStorage.getItem(tokenKey));

  // customer-login.js restores the authenticated customer asynchronously after page load.
  // Customer Feedback only needs to know that a valid-looking customer session exists so
  // it can ask the server for authoritative access. A 401 response still falls back to login.
  if (hasCustomerSession && !window.LEKER_CUSTOMER) {
    window.LEKER_CUSTOMER = { sessionRestoring: true };
  }
})();
