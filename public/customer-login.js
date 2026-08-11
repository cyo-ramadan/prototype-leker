(() => {
  const storeCode = String(window.LEKER_STORE_CODE || 'G001').toUpperCase();
  const tokenKey = `lekerCustomerToken:${storeCode}`;
  let customerToken = sessionStorage.getItem(tokenKey) || '';
  let customer = null;
  let role = 'customer';
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
          <div class="entry-role-tabs" role="tablist">
            <button class="entry-role-btn active" data-entry-role="customer" type="button">Pelanggan</button>
            <button class="entry-role-btn" data-entry-role="cashier" type="button">Kasir</button>
            <button class="entry-role-btn" data-entry-role="owner" type="button">Owner</button>
          </div>
          <form id="entryLoginForm" class="entry-login-form">
            <div id="entryRoleHelp" class="entry-login-note">Login pelanggan bersifat optional. Tanpa login tetap bisa beli.</div>
            <div class="field"><label>Username</label><input id="entryUsername" class="text-input" autocomplete="username" maxlength="40" required /></div>
            <div class="field"><label>Password</label><input id="entryPassword" class="text-input" type="password" autocomplete="current-password" required /></div>
            <button id="entrySubmit" class="primary-btn" type="submit">LOGIN PELANGGAN</button>
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

  function setRole(nextRole) {
    role = nextRole;
    document.querySelectorAll('[data-entry-role]').forEach(button => button.classList.toggle('active', button.dataset.entryRole === role));
    const copy = {
      customer: ['Login pelanggan bersifat optional. Tanpa login tetap bisa beli.', 'LOGIN PELANGGAN'],
      cashier: ['Akun kasir otomatis membawa gerai tempat kasir ditugaskan.', 'LOGIN KASIR'],
      owner: ['Owner adalah akun tertinggi untuk membuat dan membuka workspace gerai.', 'LOGIN OWNER']
    }[role];
    el('entryRoleHelp').textContent = copy[0];
    el('entrySubmit').textContent = copy[1];
    el('entryLoginMessage').textContent = '';
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
    try {
      if (role === 'owner') {
        const response = await originalFetch('/api/owner/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Login Owner gagal.');
        sessionStorage.setItem('lekerOwnerToken', payload.token);
        location.href = '/admin';
        return;
      }

      if (role === 'cashier') {
        const response = await originalFetch('/api/cashier/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Login kasir gagal.');
        sessionStorage.setItem('lekerCashierToken', payload.token);
        location.href = '/cashier';
        return;
      }

      const response = await originalFetch('/api/customer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Login pelanggan gagal.');
      customerToken = payload.token;
      customer = payload.customer;
      sessionStorage.setItem(tokenKey, customerToken);
      el('entryPassword').value = '';
      renderCustomer();
    } catch (error) {
      el('entryLoginMessage').textContent = error.message;
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
    setRole('customer');
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
  document.querySelectorAll('[data-entry-role]').forEach(button => button.addEventListener('click', () => setRole(button.dataset.entryRole)));
  setRole('customer');
  restoreCustomer();
})();
