(() => {
  const el = id => document.getElementById(id);
  let data = { entityContent: '', storeContent: '', canEditEntity: false };

  const tabs = document.querySelector('.admin-tabs');
  if (tabs && !document.querySelector('[data-tab="manual-book"]')) {
    tabs.insertAdjacentHTML('beforeend', '<button class="admin-tab" data-tab="manual-book" type="button">📘 Manual Book</button>');
  }

  const contacts = el('tab-contacts');
  if (contacts && !el('tab-manual-book')) {
    contacts.insertAdjacentHTML('afterend', `
      <section id="tab-manual-book" class="admin-section">
        <div class="admin-card" id="manualBookEntityCard">
          <div class="form-title-row"><h2>Manual Book -- Info Entity</h2></div>
          <div class="admin-tip" style="margin-bottom:10px">Berlaku untuk SEMUA gerai di entity ini. Cuma Owner/Entity Admin yang bisa mengubah bagian ini.</div>
          <textarea id="manualBookEntityContent" rows="8" placeholder="Isi panduan kerja untuk seluruh entity..."></textarea>
          <button id="manualBookEntitySave" class="primary-btn" type="button" style="margin-top:10px">Simpan Info Entity</button>
        </div>
        <div class="admin-card">
          <div class="form-title-row"><h2>Manual Book -- Info Gerai Ini</h2></div>
          <div class="admin-tip" style="margin-bottom:10px">Tambahan khusus gerai ini saja, ditampilkan setelah Info Entity di Portal Staf.</div>
          <textarea id="manualBookStoreContent" rows="8" placeholder="Isi panduan tambahan khusus gerai ini..."></textarea>
          <button id="manualBookStoreSave" class="primary-btn" type="button" style="margin-top:10px">Simpan Info Gerai</button>
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
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function switchTab() {
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === 'manual-book'));
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-manual-book'));
  }

  function render() {
    el('manualBookEntityContent').value = data.entityContent || '';
    el('manualBookStoreContent').value = data.storeContent || '';
    el('manualBookEntityContent').disabled = !data.canEditEntity;
    el('manualBookEntitySave').disabled = !data.canEditEntity;
    el('manualBookEntityCard').classList.toggle('hidden', !data.canEditEntity && !data.entityContent);
  }

  async function load() {
    try {
      data = await request('/api/admin/manual-book');
      render();
    } catch (error) { toast(error.message); }
  }

  async function saveEntity() {
    try {
      await request('/api/admin/manual-book/entity', { method: 'PATCH', body: JSON.stringify({ content: el('manualBookEntityContent').value }) });
      toast('Info Entity disimpan');
    } catch (error) { toast(error.message); }
  }

  async function saveStore() {
    try {
      await request('/api/admin/manual-book/store', { method: 'PATCH', body: JSON.stringify({ content: el('manualBookStoreContent').value }) });
      toast('Info Gerai disimpan');
    } catch (error) { toast(error.message); }
  }

  document.querySelector('[data-tab="manual-book"]')?.addEventListener('click', switchTab);
  el('manualBookEntitySave')?.addEventListener('click', saveEntity);
  el('manualBookStoreSave')?.addEventListener('click', saveStore);

  const gate = el('authGate');
  if (gate) new MutationObserver(() => { if (gate.classList.contains('hidden')) load(); }).observe(gate, { attributes: true, attributeFilter: ['class'] });
  if (gate?.classList.contains('hidden')) load();
})();
