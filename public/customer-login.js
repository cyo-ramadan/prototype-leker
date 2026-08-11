(() => {
  const storeCode = String(window.LEKER_STORE_CODE || 'G001').toUpperCase();
  const tokenKey = `lekerCustomerToken:${storeCode}`;
  const recentOrdersKey = `lekerRecentOrderIds:${storeCode}`;
  let customerToken = sessionStorage.getItem(tokenKey) || '';
  let customer = null;
  let points = 0;
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const rupiah = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const statusLabel = status => ({ NEW:'Diterima', PREPARING:'Sedang dibuat', READY:'Siap diambil', COMPLETED:'Selesai', CANCELLED:'Dibatalkan' }[status] || status || '-');

  function recentOrderIds() {
    try {
      const parsed = JSON.parse(localStorage.getItem(recentOrdersKey) || '[]');
      return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 10) : [];
    } catch { return []; }
  }

  function rememberOrder(id) {
    if (!id) return;
    const next = [id, ...recentOrderIds().filter(item => item !== id)].slice(0, 10);
    localStorage.setItem(recentOrdersKey, JSON.stringify(next));
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function customerIdentityFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const rawUrl = request ? request.url : String(input);
    const url = new URL(rawUrl, location.origin);
    const method = String(init.method || request?.method || 'GET').toUpperCase();
    const shouldAttach = customerToken && url.origin === location.origin && (
      url.pathname.startsWith('/api/customer/') ||
      (url.pathname === '/api/orders' && method === 'POST')
    );

    const headers = new Headers(request ? request.headers : init.headers || {});
    if (shouldAttach) headers.set('Authorization', `Bearer ${customerToken}`);
    const response = request
      ? await originalFetch(new Request(request, { ...init, headers }))
      : await originalFetch(url.toString(), { ...init, headers });

    if (url.origin === location.origin && url.pathname === '/api/orders' && method === 'POST' && response.ok) {
      response.clone().json().then(payload => rememberOrder(payload?.id)).catch(() => {});
    }
    return response;
  };

  const topbar = document.querySelector('.topbar');
  if (topbar && !el('entryLoginBtn')) {
    const ordersButton = document.createElement('button');
    ordersButton.id = 'entryOrdersBtn';
    ordersButton.className = 'entry-login-btn entry-orders-btn';
    ordersButton.type = 'button';
    ordersButton.textContent = '📋 Pesanan Saya';

    const loginButton = document.createElement('button');
    loginButton.id = 'entryLoginBtn';
    loginButton.className = 'entry-login-btn';
    loginButton.type = 'button';
    loginButton.textContent = 'Login';

    const pill = topbar.querySelector('.pill');
    if (pill) {
      topbar.insertBefore(ordersButton, pill);
      topbar.insertBefore(loginButton, pill);
    } else {
      topbar.append(ordersButton, loginButton);
    }
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
            <div class="entry-login-note">Masukkan akun. Sistem otomatis mengenali Owner, Admin Gerai, Kasir, atau Pelanggan. Untuk beli, login tetap optional.</div>
            <div class="field"><label>Username</label><input id="entryUsername" class="text-input" autocomplete="username" maxlength="40" required /></div>
            <div class="field"><label>Password</label><input id="entryPassword" class="text-input" type="password" autocomplete="current-password" required /></div>
            <button id="entrySubmit" class="primary-btn" type="submit">LOGIN</button>
            <div id="entryLoginMessage" class="entry-login-message" aria-live="polite"></div>
          </form>
          <div class="entry-login-split">
            <button id="entryRegisterOpen" class="secondary-btn" type="button">Daftar jadi pelanggan</button>
            <button id="continueGuestBtn" class="secondary-btn" type="button">Lanjut beli tanpa login</button>
          </div>
        </div>

        <div id="entryRegisterView" class="hidden">
          <form id="entryRegisterForm" class="entry-login-form">
            <div class="entry-login-note"><b>Daftar pelanggan ${escapeHtml(storeCode)}</b><br>Setelah dikirim, akun berstatus menunggu dan baru aktif setelah disetujui Admin Gerai.</div>
            <div class="field"><label>Nama pelanggan</label><input id="entryRegisterName" class="text-input" maxlength="100" required /></div>
            <div class="field"><label>No. HP</label><input id="entryRegisterPhone" class="text-input" maxlength="40" /></div>
            <div class="field"><label>Email</label><input id="entryRegisterEmail" class="text-input" type="email" maxlength="120" /></div>
            <div class="field"><label>Username</label><input id="entryRegisterUsername" class="text-input" minlength="3" maxlength="40" autocomplete="username" required /></div>
            <div class="field"><label>Password</label><input id="entryRegisterPassword" class="text-input" type="password" minlength="6" autocomplete="new-password" required /></div>
            <button id="entryRegisterSubmit" class="primary-btn" type="submit">KIRIM PENDAFTARAN</button>
            <div id="entryRegisterMessage" class="entry-login-message" aria-live="polite"></div>
          </form>
          <button id="entryRegisterBack" class="text-btn entry-back-btn" type="button">← Kembali ke login</button>
        </div>

        <div id="entryOrdersView" class="hidden">
          <div id="entryOrdersList" class="entry-orders-list"></div>
          <button id="entryOrdersBack" class="secondary-btn" type="button" style="width:100%;margin-top:10px">Kembali</button>
        </div>
      </section>
    </div>`);

  function showView(name) {
    ['entryAccountView','entryLoginView','entryRegisterView','entryOrdersView'].forEach(id => el(id)?.classList.add('hidden'));
    el(name)?.classList.remove('hidden');
  }

  function modal(open) {
    el('entryLoginModal').classList.toggle('hidden', !open);
    el('entryLoginModal').setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open && !customer && !el('entryLoginView').classList.contains('hidden')) setTimeout(() => el('entryUsername')?.focus(), 40);
  }

  function syncCustomerName() {
    window.LEKER_CUSTOMER = customer;
    const input = el('customerName');
    if (!input) return;
    if (customer) {
      input.value = customer.customerName || '';
      input.readOnly = true;
      input.classList.add('customer-name-locked');
      input.title = 'Nama mengikuti akun pelanggan yang sedang login.';
    } else {
      input.readOnly = false;
      input.classList.remove('customer-name-locked');
      input.removeAttribute('title');
    }
  }

  async function loadPoints() {
    if (!customerToken || !customer) { points = 0; return; }
    try {
      const response = await window.fetch('/api/customer/points', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      points = response.ok ? Number(payload.points || 0) : 0;
    } catch { points = 0; }
  }

  function renderCustomer() {
    const button = el('entryLoginBtn');
    if (!button) return;
    syncCustomerName();
    if (!customer) {
      button.textContent = 'Login';
      button.classList.remove('customer-active');
      showView('entryLoginView');
      return;
    }

    button.textContent = `👤 ${customer.customerName}`;
    button.classList.add('customer-active');
    showView('entryAccountView');
    el('entryAccountView').innerHTML = `
      <div class="entry-account-card">
        <strong>${escapeHtml(customer.customerName)}</strong>
        <span>${escapeHtml(customer.store?.code || storeCode)} · Pelanggan login</span>
        <span class="entry-account-id">Customer ID: ${escapeHtml(customer.customerCode || customer.id)}</span>
        <span class="entry-points">⭐ Poin: <b>${Number(points || 0).toLocaleString('id-ID')}</b></span>
        <div class="entry-login-actions">
          <button id="entryCustomerLogout" class="secondary-btn" type="button">Logout pelanggan</button>
          <button id="entryCustomerContinue" class="primary-btn" type="button">Lanjut belanja</button>
        </div>
      </div>`;
    el('entryCustomerLogout').onclick = logoutCustomer;
    el('entryCustomerContinue').onclick = () => modal(false);
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
      if (payload.role === 'ADMIN') {
        sessionStorage.setItem('lekerAdminToken', payload.token);
        sessionStorage.setItem('lekerAdminStoreCode', payload.admin?.store?.code || storeCode);
        location.href = payload.redirect || `/s/${encodeURIComponent(payload.admin?.store?.code || storeCode)}/admin`;
        return;
      }
      if (payload.role === 'CASHIER') {
        sessionStorage.setItem('lekerCashierToken', payload.token);
        location.href = payload.redirect || '/cashier';
        return;
      }
      if (payload.role !== 'CUSTOMER' || !payload.customer) throw new Error('Role akun tidak dikenali.');

      customerToken = payload.token;
      customer = payload.customer;
      sessionStorage.setItem(tokenKey, customerToken);
      el('entryPassword').value = '';
      await loadPoints();
      renderCustomer();
    } catch (error) {
      el('entryLoginMessage').textContent = error.message;
    } finally {
      el('entrySubmit').disabled = false;
    }
  }

  async function register(event) {
    event.preventDefault();
    el('entryRegisterMessage').textContent = '';
    el('entryRegisterSubmit').disabled = true;
    try {
      const response = await originalFetch('/api/customer/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: el('entryRegisterName').value,
          phone: el('entryRegisterPhone').value,
          email: el('entryRegisterEmail').value,
          username: el('entryRegisterUsername').value,
          password: el('entryRegisterPassword').value
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Pendaftaran gagal.');
      el('entryRegisterForm').reset();
      el('entryRegisterMessage').innerHTML = `✅ Request <b>${escapeHtml(payload.request?.requestCode || '')}</b> terkirim. Status: <b>PENDING</b>. Tunggu Admin Gerai menyetujui sebelum login.`;
    } catch (error) {
      el('entryRegisterMessage').textContent = error.message;
    } finally {
      el('entryRegisterSubmit').disabled = false;
    }
  }

  async function logoutCustomer() {
    try { if (customerToken) await window.fetch('/api/customer/logout', { method: 'POST' }); } catch {}
    customerToken = '';
    customer = null;
    points = 0;
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
      await loadPoints();
    } catch {
      customerToken = '';
      customer = null;
      points = 0;
      sessionStorage.removeItem(tokenKey);
    }
    renderCustomer();
  }

  async function loadGuestOrders() {
    const ids = recentOrderIds();
    const orders = [];
    for (const id of ids.slice(0, 6)) {
      try {
        const response = await originalFetch(`/api/orders/${encodeURIComponent(id)}`, { cache: 'no-store' });
        if (response.ok) orders.push(await response.json());
      } catch {}
    }
    return orders;
  }

  function renderOrders(orders, loggedIn) {
    el('entryLoginTitle').textContent = 'Status Pesanan';
    showView('entryOrdersView');
    el('entryOrdersList').innerHTML = orders.length ? orders.map(order => `
      <article class="entry-order-row">
        <div><strong>${escapeHtml(order.orderNo)}</strong><span>${escapeHtml(order.store?.code || storeCode)} · ${escapeHtml(statusLabel(order.status))}</span></div>
        <div class="entry-order-total">${rupiah(order.total)}</div>
      </article>`).join('') : `<div class="empty">${loggedIn ? 'Belum ada pesanan pada akun ini.' : 'Belum ada pesanan tersimpan di perangkat ini. Guest tetap bisa melihat order terbaru setelah membuat pesanan.'}</div>`;
  }

  async function showOrders() {
    modal(true);
    el('entryLoginTitle').textContent = 'Status Pesanan';
    showView('entryOrdersView');
    el('entryOrdersList').innerHTML = '<div class="empty">Memuat pesanan...</div>';
    try {
      if (customerToken && customer) {
        const response = await window.fetch('/api/customer/orders', { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Gagal memuat pesanan.');
        renderOrders(payload.orders || [], true);
      } else {
        renderOrders(await loadGuestOrders(), false);
      }
    } catch (error) {
      el('entryOrdersList').innerHTML = `<div class="entry-login-message">${escapeHtml(error.message)}</div>`;
    }
  }

  function backFromSpecialView() {
    el('entryLoginTitle').textContent = customer ? 'Akun Pelanggan' : 'Login';
    renderCustomer();
  }

  el('entryLoginBtn')?.addEventListener('click', () => {
    el('entryLoginTitle').textContent = customer ? 'Akun Pelanggan' : 'Login';
    renderCustomer();
    modal(true);
  });
  el('entryOrdersBtn')?.addEventListener('click', showOrders);
  el('entryLoginClose')?.addEventListener('click', () => modal(false));
  el('continueGuestBtn')?.addEventListener('click', () => modal(false));
  el('entryRegisterOpen')?.addEventListener('click', () => {
    el('entryLoginTitle').textContent = 'Daftar Pelanggan';
    showView('entryRegisterView');
  });
  el('entryRegisterBack')?.addEventListener('click', backFromSpecialView);
  el('entryOrdersBack')?.addEventListener('click', backFromSpecialView);
  el('entryLoginModal')?.addEventListener('click', event => { if (event.target === el('entryLoginModal')) modal(false); });
  el('entryLoginForm')?.addEventListener('submit', login);
  el('entryRegisterForm')?.addEventListener('submit', register);
  document.addEventListener('click', event => {
    if (event.target?.id === 'newOrderBtn' || event.target?.id === 'backToMenuBtn') setTimeout(syncCustomerName, 0);
  });

  restoreCustomer();
})();
