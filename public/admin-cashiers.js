(() => {
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  let data = { cashiers: [], stores: [] };

  const tabs = document.querySelector('.admin-tabs');
  if (tabs && !document.querySelector('[data-tab="cashiers"]')) {
    tabs.insertAdjacentHTML('beforeend', '<button class="admin-tab" data-tab="cashiers" type="button">Kasir</button>');
  }

  const contacts = el('tab-contacts');
  if (contacts && !el('tab-cashiers')) {
    contacts.insertAdjacentHTML('afterend', `
      <section id="tab-cashiers" class="admin-section">
        <div class="admin-grid master-layout">
          <form id="cashierForm" class="admin-card sticky-form">
            <input id="cashierId" type="hidden" />
            <div class="form-title-row"><h2 id="cashierFormTitle">Tambah kasir</h2><button id="cashierCancelEdit" class="text-btn hidden" type="button">Batal edit</button></div>
            <label class="admin-field">Username<input id="cashierUsername" maxlength="40" autocomplete="off" required /></label>
            <label class="admin-field">Password <span id="cashierPasswordNote" class="field-note">min. 6 karakter</span><input id="cashierPassword" type="password" minlength="6" autocomplete="new-password" required /></label>
            <label class="admin-field">Nama karyawan<input id="cashierEmployeeName" maxlength="100" required /></label>
            <label class="admin-field">Gerai<select id="cashierStore" required></select></label>
            <label class="admin-check"><input id="cashierActive" type="checkbox" checked /> Aktif</label>
            <button class="primary-btn" type="submit">Simpan kasir</button>
          </form>
          <div class="admin-card list-card">
            <div class="list-head"><h2>Master kasir</h2><span id="cashierCount" class="master-count">0</span></div>
            <div id="cashierList" class="master-list"></div>
          </div>
        </div>
      </section>`);
  }

  function toast(message) {
    const node = el('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    setTimeout(() => node.classList.remove('show'), 2000);
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

  function switchTab() {
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === 'cashiers'));
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-cashiers'));
  }

  function render() {
    const select = el('cashierStore');
    if (select) {
      const selected = select.value;
      select.innerHTML = data.stores.map(store => `<option value="${escapeHtml(store.id)}">${escapeHtml(store.code)} · ${escapeHtml(store.storeName)}${store.isActive ? '' : ' (nonaktif)'}</option>`).join('');
      if (data.stores.some(store => store.id === selected)) select.value = selected;
      else {
        const preferred = data.stores.find(store => store.code === (window.LEKER_STORE_CODE || 'G001'));
        if (preferred) select.value = preferred.id;
      }
    }

    el('cashierCount').textContent = data.cashiers.length;
    el('cashierList').innerHTML = data.cashiers.length ? data.cashiers.map(cashier => `
      <div class="master-row contact-row ${cashier.isActive ? '' : 'inactive'}">
        <div class="master-main">
          <strong>${escapeHtml(cashier.employeeName)}</strong>
          <div class="master-meta">@${escapeHtml(cashier.username)} · ${escapeHtml(cashier.store.code)} · ${escapeHtml(cashier.store.storeName)}</div>
          <div class="master-meta">${cashier.isActive ? 'Aktif' : 'Nonaktif'}</div>
        </div>
        <div class="master-actions">
          <button class="mini-btn" type="button" data-edit-cashier="${escapeHtml(cashier.id)}">Edit</button>
          <button class="mini-btn danger" type="button" data-delete-cashier="${escapeHtml(cashier.id)}">Nonaktifkan</button>
        </div>
      </div>`).join('') : '<div class="empty">Belum ada kasir.</div>';

    document.querySelectorAll('[data-edit-cashier]').forEach(button => button.onclick = () => editCashier(button.dataset.editCashier));
    document.querySelectorAll('[data-delete-cashier]').forEach(button => button.onclick = () => deactivateCashier(button.dataset.deleteCashier));
  }

  async function load() {
    if (!sessionStorage.getItem('lekerAdminPin')) return;
    try {
      data = await request('/api/admin/cashiers');
      render();
    } catch (error) { toast(error.message); }
  }

  function resetForm() {
    el('cashierForm').reset();
    el('cashierId').value = '';
    el('cashierActive').checked = true;
    el('cashierFormTitle').textContent = 'Tambah kasir';
    el('cashierCancelEdit').classList.add('hidden');
    el('cashierPassword').required = true;
    el('cashierPasswordNote').textContent = 'min. 6 karakter';
    render();
  }

  function editCashier(id) {
    const cashier = data.cashiers.find(item => item.id === id);
    if (!cashier) return;
    el('cashierId').value = cashier.id;
    el('cashierUsername').value = cashier.username;
    el('cashierPassword').value = '';
    el('cashierPassword').required = false;
    el('cashierPasswordNote').textContent = 'kosongkan jika tidak diubah';
    el('cashierEmployeeName').value = cashier.employeeName;
    el('cashierStore').value = cashier.store.id;
    el('cashierActive').checked = cashier.isActive;
    el('cashierFormTitle').textContent = 'Edit kasir';
    el('cashierCancelEdit').classList.remove('hidden');
    switchTab();
    el('cashierForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function save(event) {
    event.preventDefault();
    const id = el('cashierId').value;
    const payload = {
      username: el('cashierUsername').value,
      password: el('cashierPassword').value,
      employeeName: el('cashierEmployeeName').value,
      storeId: el('cashierStore').value,
      isActive: el('cashierActive').checked
    };
    try {
      await request(id ? `/api/admin/cashiers/${encodeURIComponent(id)}` : '/api/admin/cashiers', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(payload)
      });
      await load();
      resetForm();
      toast(id ? 'Kasir diperbarui' : 'Kasir ditambahkan');
    } catch (error) { toast(error.message); }
  }

  async function deactivateCashier(id) {
    if (!confirm('Nonaktifkan kasir ini? Session login kasir juga akan diputus.')) return;
    try {
      await request(`/api/admin/cashiers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
      toast('Kasir dinonaktifkan');
    } catch (error) { toast(error.message); }
  }

  document.querySelector('[data-tab="cashiers"]')?.addEventListener('click', switchTab);
  el('cashierForm')?.addEventListener('submit', save);
  el('cashierCancelEdit')?.addEventListener('click', resetForm);

  const gate = el('authGate');
  if (gate) new MutationObserver(() => {
    const unlocked = gate.classList.contains('hidden');
    el('tab-cashiers')?.querySelectorAll('input,select,button').forEach(node => { node.disabled = !unlocked; });
    if (unlocked) load();
  }).observe(gate, { attributes: true, attributeFilter: ['class'] });

  if (gate?.classList.contains('hidden')) load();
  else el('tab-cashiers')?.querySelectorAll('input,select,button').forEach(node => { node.disabled = true; });
})();
