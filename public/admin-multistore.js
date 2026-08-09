(() => {
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));

  const style = document.createElement('style');
  style.textContent = `
    .store-switcher{display:flex;align-items:end;gap:8px;flex-wrap:wrap;margin:0 0 16px;padding:12px 14px;background:#fff;border:1px solid var(--line);border-radius:16px}
    .store-switcher label{font-size:11px;font-weight:900;color:var(--muted)}
    .store-switcher select{display:block;margin-top:4px;min-width:220px;border:1px solid var(--line);border-radius:10px;padding:9px 10px;background:#fffcf8;font-weight:800}
    .store-code-chip{padding:8px 10px;border-radius:999px;background:var(--ink);color:#fff;font-size:11px;font-weight:900}
    .branch-grid{display:grid;grid-template-columns:minmax(280px,360px) minmax(0,1fr);gap:16px;align-items:start}
    @media(max-width:800px){.branch-grid{grid-template-columns:1fr}.store-switcher select{min-width:0;width:100%}}
  `;
  document.head.appendChild(style);

  const tabs = document.querySelector('.admin-tabs');
  if (tabs && !document.querySelector('[data-tab="branches"]')) {
    tabs.insertAdjacentHTML('afterbegin', '<button class="admin-tab" data-tab="branches" type="button">Gerai</button>');
    document.querySelector('[data-tab="branches"]').addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === 'branches'));
      document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-branches'));
    });
  }

  const firstSection = document.querySelector('.admin-section');
  if (firstSection && !el('tab-branches')) {
    firstSection.insertAdjacentHTML('beforebegin', `
      <section id="tab-branches" class="admin-section">
        <div class="branch-grid">
          <form id="branchForm" class="admin-card sticky-form">
            <h2>Tambah gerai</h2>
            <label class="admin-field">Kode gerai<input id="branchCode" maxlength="16" placeholder="Contoh: MLG01" required /></label>
            <label class="admin-field">Nama gerai<input id="branchName" maxlength="80" placeholder="MAXI Leker Dinoyo" required /></label>
            <label class="admin-field">Alamat<textarea id="branchAddress" rows="3" maxlength="180"></textarea></label>
            <button class="primary-btn" type="submit">Tambah gerai</button>
          </form>
          <div class="admin-card list-card">
            <div class="list-head"><h2>Daftar gerai</h2><span id="branchCount" class="master-count">0</span></div>
            <div id="branchList" class="master-list"></div>
          </div>
        </div>
      </section>`);
  }

  const heading = document.querySelector('.admin-heading');
  if (heading && !el('storeSwitcher')) {
    heading.insertAdjacentHTML('afterend', `
      <div id="storeSwitcher" class="store-switcher">
        <label>Gerai aktif<select id="adminStoreSelect"></select></label>
        <span id="adminStoreCode" class="store-code-chip">${escapeHtml(window.LEKER_STORE_CODE || 'G001')}</span>
        <button id="openBranchMaster" class="secondary-btn" type="button">Kelola gerai</button>
      </div>`);
  }

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const pin = sessionStorage.getItem('lekerAdminPin') || '';
    if (pin) headers['X-Admin-Pin'] = pin;
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function switchStore(code) {
    const normalized = String(code || 'G001').toUpperCase();
    localStorage.setItem('lekerAdminStoreCode', normalized);
    window.LEKER_STORE_CODE = normalized;
    location.href = '/admin';
  }

  function renderStores(stores, currentCode) {
    const select = el('adminStoreSelect');
    if (!select) return;
    select.innerHTML = stores.map(store => `<option value="${escapeHtml(store.code)}" ${store.code === currentCode ? 'selected' : ''}>${escapeHtml(store.code)} · ${escapeHtml(store.storeName)}${store.isActive ? '' : ' (nonaktif)'}</option>`).join('');
    el('adminStoreCode').textContent = currentCode;
    el('branchCount').textContent = stores.length;
    el('branchList').innerHTML = stores.map(store => `
      <div class="master-row contact-row ${store.isActive ? '' : 'inactive'}">
        <div class="master-main">
          <strong>${escapeHtml(store.storeName)}</strong>
          <div class="master-meta">${escapeHtml(store.code)}${store.address ? ` · ${escapeHtml(store.address)}` : ''}</div>
          <div class="master-meta">${store.isActive ? 'Aktif' : 'Nonaktif'}</div>
        </div>
        <div class="master-actions"><button class="mini-btn" type="button" data-use-store="${escapeHtml(store.code)}">Pilih</button></div>
      </div>`).join('');
    document.querySelectorAll('[data-use-store]').forEach(button => button.onclick = () => switchStore(button.dataset.useStore));
  }

  async function syncStores() {
    if (!sessionStorage.getItem('lekerAdminPin')) return;
    try {
      const payload = await request('/api/admin/bootstrap');
      renderStores(payload.stores || [], payload.store?.code || window.LEKER_STORE_CODE || 'G001');
      document.querySelectorAll('[data-store-page]').forEach(link => { link.href = `/s/${encodeURIComponent(payload.store?.code || 'G001')}/${link.dataset.storePage}`; });
    } catch {}
  }

  el('adminStoreSelect')?.addEventListener('change', event => switchStore(event.target.value));
  el('openBranchMaster')?.addEventListener('click', () => document.querySelector('[data-tab="branches"]')?.click());
  el('branchForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const payload = await request('/api/admin/stores', {
        method: 'POST',
        body: JSON.stringify({
          code: el('branchCode').value,
          storeName: el('branchName').value,
          address: el('branchAddress').value
        })
      });
      localStorage.setItem('lekerAdminStoreCode', payload.store.code);
      location.reload();
    } catch (error) {
      const toast = el('adminToast');
      if (toast) { toast.textContent = error.message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2000); }
    }
  });

  const gate = el('authGate');
  if (gate) new MutationObserver(() => { if (gate.classList.contains('hidden')) syncStores(); }).observe(gate, { attributes: true, attributeFilter: ['class'] });
  if (gate?.classList.contains('hidden')) syncStores();
})();
