(() => {
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  let customers = [];

  const legacyTab = document.querySelector('[data-tab="contacts"]');
  const legacySection = el('tab-contacts');
  if (legacyTab) legacyTab.hidden = true;
  if (legacySection) legacySection.hidden = true;

  const tabs = document.querySelector('.admin-tabs');
  if (tabs && !document.querySelector('[data-tab="customers"]')) {
    const supplierTab = document.querySelector('[data-tab="suppliers"]');
    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.dataset.tab = 'customers';
    button.type = 'button';
    button.textContent = 'Pelanggan';
    supplierTab?.insertAdjacentElement('afterend', button);
    if (!supplierTab) tabs.appendChild(button);
  }

  if (legacySection && !el('tab-customers')) {
    legacySection.insertAdjacentHTML('afterend', `
      <section id="tab-customers" class="admin-section">
        <div class="admin-grid master-layout">
          <form id="customerMasterForm" class="admin-card sticky-form">
            <input id="customerMasterId" type="hidden" />
            <div class="form-title-row"><h2 id="customerMasterTitle">Tambah pelanggan</h2><button id="customerMasterCancel" class="text-btn hidden" type="button">Batal edit</button></div>
            <label class="admin-field">Nama pelanggan<input id="customerMasterName" maxlength="100" required /></label>
            <label class="admin-field">No. HP<input id="customerMasterPhone" maxlength="40" /></label>
            <label class="admin-field">Email<input id="customerMasterEmail" type="email" maxlength="120" /></label>
            <label class="admin-field">Username login <span class="field-note">optional</span><input id="customerMasterUsername" maxlength="40" autocomplete="off" /></label>
            <label class="admin-field">Password <span id="customerPasswordNote" class="field-note">isi jika pelanggan perlu login</span><input id="customerMasterPassword" type="password" minlength="6" autocomplete="new-password" /></label>
            <label class="admin-field">Catatan<textarea id="customerMasterNotes" rows="3" maxlength="500"></textarea></label>
            <label class="admin-check"><input id="customerMasterActive" type="checkbox" checked /> Aktif</label>
            <button class="primary-btn" type="submit">Simpan pelanggan</button>
          </form>
          <div class="admin-card list-card">
            <div class="list-head"><h2>Master pelanggan</h2><span id="customerMasterCount" class="master-count">0</span></div>
            <div class="muted" style="margin-bottom:10px">Customer ID selalu dibuat. Username/password hanya diperlukan jika pelanggan ingin login.</div>
            <div id="customerMasterList" class="master-list"></div>
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
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function switchTab() {
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === 'customers'));
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-customers'));
  }

  function render() {
    el('customerMasterCount').textContent = customers.length;
    el('customerMasterList').innerHTML = customers.length ? customers.map(customer => `
      <div class="master-row contact-row ${customer.isActive ? '' : 'inactive'}">
        <div class="master-main">
          <strong>${escapeHtml(customer.customerName)}</strong>
          <div class="master-meta">ID ${escapeHtml(customer.customerCode)}</div>
          <div class="master-meta">${escapeHtml([customer.phone, customer.email].filter(Boolean).join(' · ') || 'Tanpa kontak')}</div>
          <div class="master-meta">${customer.hasLogin ? `Login @${escapeHtml(customer.username)}` : 'Belum punya akun login'} · ${customer.isActive ? 'Aktif' : 'Nonaktif'}</div>
        </div>
        <div class="master-actions">
          <button class="mini-btn" type="button" data-edit-customer="${escapeHtml(customer.id)}">Edit</button>
          <button class="mini-btn danger" type="button" data-delete-customer="${escapeHtml(customer.id)}">Nonaktifkan</button>
        </div>
      </div>`).join('') : '<div class="empty">Belum ada pelanggan di gerai ini.</div>';
    document.querySelectorAll('[data-edit-customer]').forEach(button => button.onclick = () => edit(button.dataset.editCustomer));
    document.querySelectorAll('[data-delete-customer]').forEach(button => button.onclick = () => deactivate(button.dataset.deleteCustomer));
  }

  async function load() {
    try {
      const payload = await request('/api/admin/customers');
      customers = payload.customers || [];
      render();
    } catch (error) { toast(error.message); }
  }

  function resetForm() {
    el('customerMasterForm').reset();
    el('customerMasterId').value = '';
    el('customerMasterActive').checked = true;
    el('customerMasterTitle').textContent = 'Tambah pelanggan';
    el('customerMasterCancel').classList.add('hidden');
    el('customerPasswordNote').textContent = 'isi jika pelanggan perlu login';
  }

  function edit(id) {
    const customer = customers.find(item => item.id === id);
    if (!customer) return;
    el('customerMasterId').value = customer.id;
    el('customerMasterName').value = customer.customerName;
    el('customerMasterPhone').value = customer.phone || '';
    el('customerMasterEmail').value = customer.email || '';
    el('customerMasterUsername').value = customer.username || '';
    el('customerMasterPassword').value = '';
    el('customerMasterNotes').value = customer.notes || '';
    el('customerMasterActive').checked = customer.isActive;
    el('customerMasterTitle').textContent = `Edit ${customer.customerCode}`;
    el('customerMasterCancel').classList.remove('hidden');
    el('customerPasswordNote').textContent = customer.hasLogin ? 'kosongkan jika password tidak diubah' : 'isi minimal 6 karakter untuk aktifkan login';
    switchTab();
    el('customerMasterForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function save(event) {
    event.preventDefault();
    const id = el('customerMasterId').value;
    const payload = {
      customerName: el('customerMasterName').value,
      phone: el('customerMasterPhone').value,
      email: el('customerMasterEmail').value,
      username: el('customerMasterUsername').value,
      password: el('customerMasterPassword').value,
      notes: el('customerMasterNotes').value,
      isActive: el('customerMasterActive').checked
    };
    try {
      await request(id ? `/api/admin/customers/${encodeURIComponent(id)}` : '/api/admin/customers', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(payload)
      });
      await load();
      resetForm();
      toast(id ? 'Pelanggan diperbarui' : 'Pelanggan ditambahkan');
    } catch (error) { toast(error.message); }
  }

  async function deactivate(id) {
    if (!confirm('Nonaktifkan pelanggan ini? Session login pelanggan juga akan diputus.')) return;
    try {
      await request(`/api/admin/customers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
      toast('Pelanggan dinonaktifkan');
    } catch (error) { toast(error.message); }
  }

  document.querySelector('[data-tab="customers"]')?.addEventListener('click', switchTab);
  el('customerMasterForm')?.addEventListener('submit', save);
  el('customerMasterCancel')?.addEventListener('click', resetForm);

  const gate = el('authGate');
  if (gate) new MutationObserver(() => { if (gate.classList.contains('hidden')) load(); }).observe(gate, { attributes: true, attributeFilter: ['class'] });
  if (gate?.classList.contains('hidden')) load();
})();
