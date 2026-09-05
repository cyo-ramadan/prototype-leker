(() => {
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  let data = { employees: [], linkableAccounts: [], store: null, canCreateEntityLevel: false };

  const tabs = document.querySelector('.admin-tabs');
  if (tabs && !document.querySelector('[data-tab="employees"]')) {
    tabs.insertAdjacentHTML('beforeend', '<button class="admin-tab" data-tab="employees" type="button">Karyawan</button>');
  }

  const anchor = el('tab-contacts');
  if (anchor && !el('tab-employees')) {
    anchor.insertAdjacentHTML('afterend', `
      <section id="tab-employees" class="admin-section">
        <div class="admin-grid master-layout">
          <form id="employeeForm" class="admin-card sticky-form">
            <input id="employeeId" type="hidden" />
            <div class="form-title-row"><h2 id="employeeFormTitle">Tambah karyawan</h2><button id="employeeCancelEdit" class="text-btn hidden" type="button">Batal edit</button></div>
            <div class="admin-tip" style="margin-bottom:12px">Karyawan dicatat sebagai orang, terpisah dari username. Perekrut default gerai ini: <b id="employeeStoreLabel">-</b></div>
            <label class="admin-field">Nama lengkap<input id="employeeName" maxlength="100" required /></label>
            <label class="admin-field">No. HP<input id="employeePhone" maxlength="40" /></label>
            <label class="admin-field">No. identitas <span class="field-note">optional</span><input id="employeeIdNumber" maxlength="40" /></label>
            <label class="admin-field">Alamat<textarea id="employeeAddress" rows="2" maxlength="200"></textarea></label>
            <label class="admin-field">Catatan<textarea id="employeeNote" rows="2" maxlength="500"></textarea></label>
            <label class="admin-check hidden" id="employeeEntityLevelWrap"><input id="employeeEntityLevel" type="checkbox" /> Karyawan tingkat Entity (tidak menempel gerai, mis. OB kantor)</label>
            <button class="primary-btn" type="submit">Simpan karyawan</button>
          </form>
          <div class="admin-card list-card">
            <div class="list-head"><h2>Master karyawan entity</h2><span id="employeeCount" class="master-count">0</span></div>
            <div class="admin-tip" style="margin-bottom:10px">Semua karyawan di bawah badan usaha yang sama tampil di sini, termasuk rekrutan gerai lain — supaya bisa ditautkan ke username gerai ini saat backup.</div>
            <div id="employeeList" class="master-list"></div>
          </div>
        </div>
      </section>`);
  }

  function toast(message) {
    const node = el('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    setTimeout(() => node.classList.remove('show'), 2400);
  }

  function storeQuery() {
    const code = window.LEKER_STORE_CODE || (data.store && data.store.code);
    return code ? `?store=${encodeURIComponent(code)}` : '';
  }

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function switchTab() {
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === 'employees'));
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-employees'));
  }

  function originLabel(employee) {
    if (employee.entityLevel) return 'Entity · tanpa gerai';
    if (employee.ownedByThisStore) return `Rekrutan gerai ini`;
    return `Rekrutan ${escapeHtml(employee.homeStoreCode || employee.homeStoreName || 'gerai lain')}`;
  }

  function linkRow(link) {
    return `
      <div class="master-meta">
        @${escapeHtml(link.username)} · ${escapeHtml(link.accountType === 'CASHIER' ? 'Kasir' : link.accountType === 'STORE_ADMIN' ? 'Admin Gerai' : 'Entity Admin')}${link.storeCode ? ` · ${escapeHtml(link.storeCode)}` : ''}
        <button class="mini-btn danger" type="button" data-unlink="${escapeHtml(link.id)}">Lepas</button>
      </div>`;
  }

  function linkPicker(employee) {
    if (!data.linkableAccounts.length) {
      return '<div class="master-meta muted">Tidak ada username kosong di gerai ini.</div>';
    }
    const options = data.linkableAccounts.map(account =>
      `<option value="${escapeHtml(account.accountType)}|${escapeHtml(account.accountId)}">@${escapeHtml(account.username)} · ${escapeHtml(account.accountType === 'CASHIER' ? 'Kasir' : 'Admin Gerai')}</option>`
    ).join('');
    return `
      <div class="master-meta">
        <select data-link-select="${escapeHtml(employee.id)}" class="text-input" style="max-width:220px">
          <option value="">Tautkan ke username…</option>${options}
        </select>
        <button class="mini-btn" type="button" data-link-apply="${escapeHtml(employee.id)}">Tautkan</button>
      </div>`;
  }

  function render() {
    if (el('employeeStoreLabel')) el('employeeStoreLabel').textContent = data.store ? `${data.store.code} · ${data.store.storeName}` : (window.LEKER_STORE_CODE || 'G001');
    el('employeeEntityLevelWrap')?.classList.toggle('hidden', !data.canCreateEntityLevel);
    el('employeeCount').textContent = data.employees.length;

    el('employeeList').innerHTML = data.employees.length ? data.employees.map(employee => `
      <div class="master-row contact-row ${employee.status === 'ACTIVE' ? '' : 'inactive'}">
        <div class="master-main">
          <strong>${escapeHtml(employee.fullName)}</strong>
          <div class="master-meta">${originLabel(employee)} · ${employee.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif'}</div>
          ${employee.phone ? `<div class="master-meta">${escapeHtml(employee.phone)}</div>` : ''}
          ${employee.links.length ? employee.links.map(linkRow).join('') : '<div class="master-meta muted">Belum tertaut username mana pun.</div>'}
          ${employee.status === 'ACTIVE' ? linkPicker(employee) : ''}
        </div>
        <div class="master-actions">
          ${employee.canManage === false ? '' : `<button class="mini-btn" type="button" data-edit-employee="${escapeHtml(employee.id)}">Edit</button>`}
          ${employee.canManage === false || employee.status !== 'ACTIVE' ? '' : `<button class="mini-btn danger" type="button" data-deactivate-employee="${escapeHtml(employee.id)}">Nonaktifkan</button>`}
        </div>
      </div>`).join('') : '<div class="empty">Belum ada karyawan terdaftar di badan usaha ini.</div>';

    document.querySelectorAll('[data-edit-employee]').forEach(button => button.onclick = () => editEmployee(button.dataset.editEmployee));
    document.querySelectorAll('[data-deactivate-employee]').forEach(button => button.onclick = () => deactivateEmployee(button.dataset.deactivateEmployee));
    document.querySelectorAll('[data-unlink]').forEach(button => button.onclick = () => unlinkAccount(button.dataset.unlink));
    document.querySelectorAll('[data-link-apply]').forEach(button => button.onclick = () => linkAccount(button.dataset.linkApply));
  }

  async function load() {
    try {
      const payload = await request(`/api/admin/employees${storeQuery()}`);
      data = payload;
      // Gerai hanya boleh mengubah karyawan rekrutannya sendiri; Entity
      // Admin/Owner bebas. Server tetap yang menegakkan, ini cuma supaya
      // tombolnya tidak ditawarkan percuma.
      for (const employee of data.employees) {
        employee.canManage = data.canCreateEntityLevel || employee.ownedByThisStore;
      }
      render();
    } catch (error) { toast(error.message); }
  }

  function resetForm() {
    el('employeeForm').reset();
    el('employeeId').value = '';
    el('employeeFormTitle').textContent = 'Tambah karyawan';
    el('employeeCancelEdit').classList.add('hidden');
    el('employeeEntityLevelWrap')?.classList.toggle('hidden', !data.canCreateEntityLevel);
  }

  function editEmployee(id) {
    const employee = data.employees.find(item => item.id === id);
    if (!employee) return;
    el('employeeId').value = employee.id;
    el('employeeName').value = employee.fullName;
    el('employeePhone').value = employee.phone;
    el('employeeIdNumber').value = employee.idNumber;
    el('employeeAddress').value = employee.address;
    el('employeeNote').value = employee.note;
    el('employeeFormTitle').textContent = 'Edit karyawan';
    el('employeeCancelEdit').classList.remove('hidden');
    // Perekrut tidak bisa dipindah lewat edit -- itu keputusan lain, bukan
    // koreksi data diri.
    el('employeeEntityLevelWrap')?.classList.add('hidden');
    switchTab();
    el('employeeForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function save(event) {
    event.preventDefault();
    const id = el('employeeId').value;
    const payload = {
      fullName: el('employeeName').value,
      phone: el('employeePhone').value,
      idNumber: el('employeeIdNumber').value,
      address: el('employeeAddress').value,
      note: el('employeeNote').value
    };
    if (!id && el('employeeEntityLevel')?.checked) payload.scope = 'ENTITY';
    try {
      await request(id ? `/api/admin/employees/${encodeURIComponent(id)}${storeQuery()}` : `/api/admin/employees${storeQuery()}`, {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(payload)
      });
      await load();
      resetForm();
      toast(id ? 'Data karyawan diperbarui' : 'Karyawan ditambahkan');
    } catch (error) { toast(error.message); }
  }

  async function deactivateEmployee(id) {
    if (!confirm('Nonaktifkan karyawan ini? Semua tautan username harus sudah dilepas.')) return;
    try {
      await request(`/api/admin/employees/${encodeURIComponent(id)}${storeQuery()}`, { method: 'DELETE' });
      await load();
      toast('Karyawan dinonaktifkan');
    } catch (error) { toast(error.message); }
  }

  async function linkAccount(employeeId) {
    const select = document.querySelector(`[data-link-select="${employeeId}"]`);
    const value = select?.value || '';
    if (!value) return toast('Pilih username dulu.');
    const [accountType, accountId] = value.split('|');
    try {
      await request(`/api/admin/employees/${encodeURIComponent(employeeId)}/links${storeQuery()}`, {
        method: 'POST',
        body: JSON.stringify({ accountType, accountId })
      });
      await load();
      toast('Username ditautkan');
    } catch (error) { toast(error.message); }
  }

  async function unlinkAccount(linkId) {
    const reason = prompt('Alasan melepas tautan (opsional):', '') ?? '';
    try {
      await request(`/api/admin/employee-links/${encodeURIComponent(linkId)}${storeQuery()}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason })
      });
      await load();
      toast('Tautan username dilepas');
    } catch (error) { toast(error.message); }
  }

  document.querySelector('[data-tab="employees"]')?.addEventListener('click', switchTab);
  el('employeeForm')?.addEventListener('submit', save);
  el('employeeCancelEdit')?.addEventListener('click', resetForm);

  const gate = el('authGate');
  if (gate) new MutationObserver(() => { if (gate.classList.contains('hidden')) load(); }).observe(gate, { attributes: true, attributeFilter: ['class'] });
  if (gate?.classList.contains('hidden')) load();
})();
