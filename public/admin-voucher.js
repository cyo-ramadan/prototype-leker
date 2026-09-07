(() => {
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const voucherState = { products: [], vouchers: [], editingId: '' };

  async function voucherApi(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function notify(message) {
    const node = byId('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => node.classList.remove('show'), 1800);
  }

  function todayOffset(days) {
    const value = new Date();
    value.setDate(value.getDate() + days);
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0')
    ].join('-');
  }

  function injectStyle() {
    if (byId('adminVoucherStyle')) return;
    const style = document.createElement('style');
    style.id = 'adminVoucherStyle';
    style.textContent = `
      .voucher-product-picker{display:grid;gap:7px;max-height:250px;overflow:auto;padding:10px;border:1px solid var(--line);border-radius:12px;background:#fffaf5}
      .voucher-product-picker label{display:flex;align-items:center;gap:9px;font-weight:800}
      .voucher-product-picker input{width:18px;height:18px}
      .voucher-chip-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}
      .voucher-chip{display:inline-flex;padding:5px 8px;border-radius:999px;background:#f1e7dc;font-size:11px;font-weight:800}
      .voucher-progress{font-variant-numeric:tabular-nums}
    `;
    document.head.appendChild(style);
  }

  function mount() {
    const app = byId('adminApp');
    const tabs = document.querySelector('.admin-tabs');
    if (!app || !tabs || byId('tab-vouchers')) return;
    injectStyle();

    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.dataset.tab = 'vouchers';
    button.type = 'button';
    button.textContent = 'Voucher';
    tabs.appendChild(button);

    const section = document.createElement('section');
    section.id = 'tab-vouchers';
    section.className = 'admin-section';
    section.innerHTML = `
      <div class="admin-grid master-layout">
        <form id="voucherMasterForm" class="admin-card sticky-form">
          <input id="voucherMasterId" type="hidden" />
          <div class="form-title-row"><h2 id="voucherMasterFormTitle">Tambah Master Voucher</h2><button id="voucherMasterCancel" class="text-btn hidden" type="button">Batal edit</button></div>
          <label class="admin-field">Nama promo<input id="voucherMasterName" maxlength="100" required /></label>
          <div class="admin-grid two compact">
            <label class="admin-field">Aktif mulai<input id="voucherActiveFrom" type="date" required /></label>
            <label class="admin-field">Aktif sampai<input id="voucherActiveUntil" type="date" required /></label>
          </div>
          <label class="admin-field">Kuota penukaran<input id="voucherUsageQuota" type="number" min="1" step="1" value="1" required /></label>
          <div class="admin-field"><label>Pilih barang dari Master Barang</label><div id="voucherProductPicker" class="voucher-product-picker"></div></div>
          <label class="admin-check"><input id="voucherMasterActive" type="checkbox" checked /> Master aktif</label>
          <button class="primary-btn" type="submit">Simpan Master Voucher</button>
        </form>
        <div class="admin-card list-card"><div class="list-head"><div><h2>Master Voucher</h2><div class="muted">Dibuat Admin, dibagikan CS ke satu customer.</div></div><span id="voucherMasterCount" class="master-count">0</span></div><div id="voucherMasterList" class="master-list"></div></div>
      </div>`;
    app.insertBefore(section, byId('adminToast'));

    button.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(item => item.classList.toggle('active', item === button));
      document.querySelectorAll('.admin-section').forEach(item => item.classList.toggle('active', item === section));
      loadVouchers().catch(error => notify(error.message));
    });
    byId('voucherMasterForm').addEventListener('submit', saveVoucher);
    byId('voucherMasterCancel').addEventListener('click', resetForm);
    resetForm();
  }

  async function loadVouchers() {
    const payload = await voucherApi('/api/admin/vouchers');
    voucherState.products = payload.products || [];
    voucherState.vouchers = payload.vouchers || [];
    renderProductPicker();
    renderVoucherList();
  }

  function renderProductPicker(selected = null) {
    const picker = byId('voucherProductPicker');
    if (!picker) return;
    const checked = selected || new Set([...picker.querySelectorAll('[data-voucher-product]:checked')].map(input => Number(input.value)));
    picker.innerHTML = voucherState.products.length
      ? voucherState.products.map(product => `<label><input data-voucher-product type="checkbox" value="${Number(product.id)}" ${checked.has(Number(product.id)) ? 'checked' : ''} /><span>${esc(product.name)}${product.unitSymbol ? ` · ${esc(product.unitSymbol)}` : ''}</span></label>`).join('')
      : '<div class="empty">Belum ada barang aktif di Master Barang.</div>';
  }

  function renderVoucherList() {
    const target = byId('voucherMasterList');
    if (!target) return;
    byId('voucherMasterCount').textContent = voucherState.vouchers.length;
    target.innerHTML = voucherState.vouchers.length ? voucherState.vouchers.map(voucher => `
      <div class="master-row ${voucher.isActive ? '' : 'inactive'}">
        <div class="master-main">
          <strong>${esc(voucher.name)}</strong>
          <div class="master-meta">${esc(voucher.activeFrom)} s.d. ${esc(voucher.activeUntil)} · ${voucher.isActive ? 'Aktif' : 'Nonaktif'}</div>
          <div class="master-meta voucher-progress">Terpakai ${Number(voucher.redeemedCount)} / ${Number(voucher.usageQuota)}</div>
          <div class="voucher-chip-row">${(voucher.products || []).map(product => `<span class="voucher-chip">${esc(product.name)}</span>`).join('')}</div>
        </div>
        <div class="master-actions"><button class="mini-btn" data-edit-voucher="${esc(voucher.id)}" type="button">Edit</button><button class="mini-btn danger" data-delete-voucher="${esc(voucher.id)}" type="button">Nonaktifkan</button></div>
      </div>`).join('') : '<div class="empty">Belum ada Master Voucher.</div>';
    target.querySelectorAll('[data-edit-voucher]').forEach(button => button.addEventListener('click', () => editVoucher(button.dataset.editVoucher)));
    target.querySelectorAll('[data-delete-voucher]').forEach(button => button.addEventListener('click', () => deactivateVoucher(button.dataset.deleteVoucher)));
  }

  function resetForm() {
    voucherState.editingId = '';
    byId('voucherMasterForm')?.reset();
    if (byId('voucherMasterId')) byId('voucherMasterId').value = '';
    if (byId('voucherMasterFormTitle')) byId('voucherMasterFormTitle').textContent = 'Tambah Master Voucher';
    byId('voucherMasterCancel')?.classList.add('hidden');
    if (byId('voucherActiveFrom')) byId('voucherActiveFrom').value = todayOffset(0);
    if (byId('voucherActiveUntil')) byId('voucherActiveUntil').value = todayOffset(30);
    if (byId('voucherUsageQuota')) byId('voucherUsageQuota').value = '1';
    if (byId('voucherMasterActive')) byId('voucherMasterActive').checked = true;
    renderProductPicker(new Set());
  }

  function editVoucher(id) {
    const voucher = voucherState.vouchers.find(item => item.id === id);
    if (!voucher) return;
    voucherState.editingId = id;
    byId('voucherMasterId').value = id;
    byId('voucherMasterName').value = voucher.name;
    byId('voucherActiveFrom').value = voucher.activeFrom;
    byId('voucherActiveUntil').value = voucher.activeUntil;
    byId('voucherUsageQuota').value = String(voucher.usageQuota);
    byId('voucherMasterActive').checked = voucher.isActive;
    byId('voucherMasterFormTitle').textContent = 'Edit Master Voucher';
    byId('voucherMasterCancel').classList.remove('hidden');
    renderProductPicker(new Set((voucher.products || []).map(product => Number(product.id))));
    byId('voucherMasterForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function saveVoucher(event) {
    event.preventDefault();
    const productIds = [...document.querySelectorAll('[data-voucher-product]:checked')].map(input => Number(input.value));
    if (!productIds.length) return notify('Pilih minimal satu barang untuk Voucher.');
    const id = voucherState.editingId;
    try {
      await voucherApi(id ? `/api/admin/vouchers/${encodeURIComponent(id)}` : '/api/admin/vouchers', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: byId('voucherMasterName').value,
          activeFrom: byId('voucherActiveFrom').value,
          activeUntil: byId('voucherActiveUntil').value,
          usageQuota: Number(byId('voucherUsageQuota').value),
          productIds,
          isActive: byId('voucherMasterActive').checked
        })
      });
      resetForm();
      await loadVouchers();
      notify(id ? 'Master Voucher diperbarui' : 'Master Voucher dibuat');
    } catch (error) {
      notify(error.message);
    }
  }

  async function deactivateVoucher(id) {
    if (!confirm('Nonaktifkan Master Voucher ini? Voucher yang sudah dibagikan tetap menjadi riwayat.')) return;
    try {
      await voucherApi(`/api/admin/vouchers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadVouchers();
      if (voucherState.editingId === id) resetForm();
      notify('Master Voucher dinonaktifkan');
    } catch (error) {
      notify(error.message);
    }
  }

  mount();
})();
