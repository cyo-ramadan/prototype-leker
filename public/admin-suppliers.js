(() => {
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  let suppliers = [];

  function toast(message) {
    const node = el('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    setTimeout(() => node.classList.remove('show'), 1900);
  }

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function switchSupplierTab() {
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === 'suppliers'));
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-suppliers'));
  }

  function render() {
    el('supplierCount').textContent = suppliers.length;
    el('supplierList').innerHTML = suppliers.length ? suppliers.map(supplier => `
      <div class="master-row contact-row ${supplier.isActive ? '' : 'inactive'}">
        <div class="master-main">
          <strong>${escapeHtml(supplier.name)}</strong>
          <div class="master-meta">${escapeHtml(supplier.phone || 'Tanpa nomor HP')}${supplier.address ? ` · ${escapeHtml(supplier.address)}` : ''}</div>
          ${supplier.notes ? `<div class="master-meta">${escapeHtml(supplier.notes)}</div>` : ''}
        </div>
        <div class="master-actions">
          <button class="mini-btn" data-edit-supplier="${escapeHtml(supplier.id)}" type="button">Edit</button>
          <button class="mini-btn danger" data-delete-supplier="${escapeHtml(supplier.id)}" type="button">Nonaktifkan</button>
        </div>
      </div>`).join('') : '<div class="empty">Belum ada supplier di gerai ini.</div>';
    document.querySelectorAll('[data-edit-supplier]').forEach(button => button.onclick = () => edit(button.dataset.editSupplier));
    document.querySelectorAll('[data-delete-supplier]').forEach(button => button.onclick = () => deactivate(button.dataset.deleteSupplier));
  }

  async function load() {
    try {
      const payload = await request('/api/admin/suppliers');
      suppliers = payload.suppliers || [];
      render();
    } catch (error) { toast(error.message); }
  }

  function reset() {
    el('supplierForm').reset();
    el('supplierId').value = '';
    el('supplierActive').checked = true;
    el('supplierFormTitle').textContent = 'Tambah supplier';
    el('supplierCancelEdit').classList.add('hidden');
  }

  function edit(id) {
    const supplier = suppliers.find(item => item.id === id);
    if (!supplier) return;
    el('supplierId').value = supplier.id;
    el('supplierName').value = supplier.name;
    el('supplierPhone').value = supplier.phone || '';
    el('supplierAddress').value = supplier.address || '';
    el('supplierNotes').value = supplier.notes || '';
    el('supplierActive').checked = supplier.isActive;
    el('supplierFormTitle').textContent = 'Edit supplier';
    el('supplierCancelEdit').classList.remove('hidden');
    switchSupplierTab();
    el('supplierForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function save(event) {
    event.preventDefault();
    const id = el('supplierId').value;
    try {
      await request(id ? `/api/admin/suppliers/${encodeURIComponent(id)}` : '/api/admin/suppliers', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: el('supplierName').value,
          phone: el('supplierPhone').value,
          address: el('supplierAddress').value,
          notes: el('supplierNotes').value,
          isActive: el('supplierActive').checked
        })
      });
      await load();
      reset();
      toast(id ? 'Supplier diperbarui' : 'Supplier ditambahkan');
    } catch (error) { toast(error.message); }
  }

  async function deactivate(id) {
    if (!confirm('Nonaktifkan supplier ini?')) return;
    try {
      await request(`/api/admin/suppliers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
      toast('Supplier dinonaktifkan');
    } catch (error) { toast(error.message); }
  }

  document.querySelector('[data-tab="suppliers"]')?.addEventListener('click', switchSupplierTab);
  el('supplierForm')?.addEventListener('submit', save);
  el('supplierCancelEdit')?.addEventListener('click', reset);

  const gate = el('authGate');
  if (gate) new MutationObserver(() => { if (gate.classList.contains('hidden')) load(); }).observe(gate, { attributes: true, attributeFilter: ['class'] });
  if (gate?.classList.contains('hidden')) load();
})();
