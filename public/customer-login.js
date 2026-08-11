(() => {
  const storeCode = String(window.LEKER_STORE_CODE || 'G001').toUpperCase();
  const tokenKey = `lekerCustomerToken:${storeCode}`;
  let customerToken = sessionStorage.getItem(tokenKey) || '';
  let customer = null;
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));

  const originalFetch = window.fetch.bind(window);
  window.fetch = function customerIdentityFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const rawUrl = request ? request.url : String(input);
    const url = new URL(rawUrl, location.origin);
    const method = String(init.method || request?.method || 'GET').toUpperCase();
    const shouldAttach = customerToken && url.origin === location.origin && (
      url.pathname.startsWith('/api/customer/') ||
      (url.pathname === '/api/orders' && method === 'POST')
    );
    if (!shouldAttach) return originalFetch(input, init);

    const headers = new Headers(request ? request.headers : init.headers || {});
    headers.set('Authorization', `Bearer ${customerToken}`);
    if (request) return originalFetch(new Request(request, { ...init, headers }));
    return originalFetch(url.toString(), { ...init, headers });
  };

  const topbar = document.querySelector('.topbar');
  if (topbar && !el('entryLoginBtn')) {
    const button = document.createElement('button');
    button.id = 'entryLoginBtn';
    button.className = 'entry-login-btn';
    button.type = 'button';
    button.textContent = 'Login';
    const pill = topbar.querySelector('.pill');
    if (pill) topbar.insertBefore(button, pill);
    else topbar.appendChild(button);
  }

  document.body.insertAdjacentHTML('beforeend', `
    <div id="entryLoginModal" class="entry-login-backdrop hidden" aria-hidden="true">
      <section class="entry-login-card" role="dialog" aria-modal="true" aria-labelledby="entryLoginTitle">
        <div class="entry-login-head">
          <div><div class="muted">MAXI Leker · ${escapeHtml(storeCode)}</div><h2 id="entryLoginTitle">Login</h2></div>
          <button id="entryLoginClose" class="entry-login-close" type="button" aria-label="Tutup">×</button>
        </div>
        <div id="entryAccountView" class="hidden"></div>
        <div id="entryLoginView">
          <form id="entryLoginForm" class="entry-login-form">
            <div class="entry-login-note">Masukkan akun. Sistem otomatis mengenali Owner, Kasir, atau Pelanggan. Untuk beli, login tetap optional.</div>
            <div class="field"><label>Username</label><input id="entryUsername" class="text-input" autocomplete="username" maxlength="40" required /></div>
            <div class="field"><label>Password</label><input id="entryPassword" class="text-input" type="password" autocomplete="current-password" required /></div>
            <button id="entrySubmit" class="primary-btn" type="submit">LOGIN</button>
            <div id="entryLoginMessage" class="entry-login-message" aria-live="polite"></div>
          </form>
          <button id="continueGuestBtn" class="secondary-btn" type="button" style="width:100%;margin-top:8px">Lanjut beli tanpa login</button>
        </div>
      </section>
    </div>`);

  function modal(open) {
    el('entryLoginModal').classList.toggle('hidden', !open);
    el('entryLoginModal').setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open && !customer) setTimeout(() => el('entryUsername')?.focus(), 40);
  }

  function renderCustomer() {
    const button = el('entryLoginBtn');
    if (!button) return;
    if (!customer) {
      button.textContent = 'Login';
      button.classList.remove('customer-active');
      el('entryAccountView').classList.add('hidden');
      el('entryLoginView').classList.remove('hidden');
      return;
    }

    button.textContent = `👤 ${customer.customerName}`;
    button.classList.add('customer-active');
    el('entryLoginView').classList.add('hidden');
    el('entryAccountView').classList.remove('hidden');
    el('entryAccountView').innerHTML = `
      <div class="entry-account-card">
        <strong>${escapeHtml(customer.customerName)}</strong>
        <span>${escapeHtml(customer.store?.code || storeCode)} · Pelanggan login</span>
        <span class="entry-account-id">Customer ID: ${escapeHtml(customer.customerCode || customer.id)}</span>
        <div class="entry-login-actions">
          <button id="entryCustomerLogout" class="secondary-btn" type="button">Logout pelanggan</button>
          <button id="entryCustomerContinue" class="primary-btn" type="button">Lanjut belanja</button>
        </div>
      </div>`;
    el('entryCustomerLogout').onclick = logoutCustomer;
    el('entryCustomerContinue').onclick = () => modal(false);
    const nameInput = el('customerName');
    if (nameInput && !nameInput.value.trim()) nameInput.value = customer.customerName;
  }

  async function login(event) {
    event.preventDefault();
    const username = el('entryUsername').value.trim();
    const password = el('entryPassword').value;
    el('entryLoginMessage').textContent = '';
    el('entrySubmit').disabled = true;
    try {
      const response = await originalFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Login gagal.');

      if (payload.role === 'OWNER') {
        sessionStorage.setItem('lekerOwnerToken', payload.token);
        location.href = payload.redirect || '/admin';
        return;
      }

      if (payload.role === 'CASHIER') {
        sessionStorage.setItem('lekerCashierToken', payload.token);
        location.href = payload.redirect || '/cashier';
        return;
      }

      if (payload.role !== 'CUSTOMER' || !payload.customer) {
        throw new Error('Role akun tidak dikenali.');
      }

      customerToken = payload.token;
      customer = payload.customer;
      sessionStorage.setItem(tokenKey, customerToken);
      el('entryPassword').value = '';
      renderCustomer();
    } catch (error) {
      el('entryLoginMessage').textContent = error.message;
    } finally {
      el('entrySubmit').disabled = false;
    }
  }

  async function logoutCustomer() {
    try {
      if (customerToken) await window.fetch('/api/customer/logout', { method: 'POST' });
    } catch {}
    customerToken = '';
    customer = null;
    sessionStorage.removeItem(tokenKey);
    renderCustomer();
  }

  async function restoreCustomer() {
    if (!customerToken) return renderCustomer();
    try {
      const response = await window.fetch('/api/customer/me', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error('expired');
      customer = payload.customer;
    } catch {
      customerToken = '';
      customer = null;
      sessionStorage.removeItem(tokenKey);
    }
    renderCustomer();
  }

  el('entryLoginBtn')?.addEventListener('click', () => modal(true));
  el('entryLoginClose')?.addEventListener('click', () => modal(false));
  el('continueGuestBtn')?.addEventListener('click', () => modal(false));
  el('entryLoginModal')?.addEventListener('click', event => { if (event.target === el('entryLoginModal')) modal(false); });
  el('entryLoginForm')?.addEventListener('submit', login);
  restoreCustomer();
})();
