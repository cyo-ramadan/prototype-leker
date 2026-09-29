(() => {
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  let data = { announcements: [], canPostEntityWide: false };

  const tabs = document.querySelector('.admin-tabs');
  if (tabs && !document.querySelector('[data-tab="announcement"]')) {
    tabs.insertAdjacentHTML('beforeend', '<button class="admin-tab" data-tab="announcement" type="button">📣 Pengumuman</button>');
  }

  const contacts = el('tab-contacts');
  if (contacts && !el('tab-announcement')) {
    contacts.insertAdjacentHTML('afterend', `
      <section id="tab-announcement" class="admin-section">
        <div class="admin-grid master-layout">
          <form id="announcementForm" class="admin-card sticky-form">
            <div class="form-title-row"><h2>Buat pengumuman</h2></div>
            <label class="admin-field">Judul<input id="announcementTitle" maxlength="200" required /></label>
            <label class="admin-field">Isi<textarea id="announcementBody" rows="5" maxlength="5000"></textarea></label>
            <label class="admin-check" id="announcementEntityWideWrap"><input id="announcementEntityWide" type="checkbox" /> Berlaku semua gerai (Entity)</label>
            <button class="primary-btn" type="submit">Kirim Pengumuman</button>
          </form>
          <div class="admin-card list-card">
            <div class="list-head"><h2>Daftar pengumuman</h2><span id="announcementCount" class="master-count">0</span></div>
            <div id="announcementList" class="master-list"></div>
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
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function switchTab() {
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === 'announcement'));
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-announcement'));
  }

  function render() {
    el('announcementEntityWideWrap').classList.toggle('hidden', !data.canPostEntityWide);
    el('announcementCount').textContent = data.announcements.length;
    el('announcementList').innerHTML = data.announcements.length ? data.announcements.map(item => `
      <div class="master-row contact-row ${item.isActive ? '' : 'inactive'}">
        <div class="master-main">
          <strong>${escapeHtml(item.title)}</strong>
          <div class="master-meta">${item.scope === 'ENTITY' ? 'Semua gerai' : 'Gerai ini'} · ${escapeHtml(item.createdBy)} · ${item.isActive ? 'Aktif' : 'Nonaktif'}</div>
          ${item.body ? `<div class="master-meta">${escapeHtml(item.body)}</div>` : ''}
        </div>
        <div class="master-actions">
          ${item.isActive ? `<button class="mini-btn danger" type="button" data-deactivate="${escapeHtml(item.id)}">Nonaktifkan</button>` : ''}
        </div>
      </div>`).join('') : '<div class="empty">Belum ada pengumuman.</div>';

    document.querySelectorAll('[data-deactivate]').forEach(button => button.onclick = () => deactivate(button.dataset.deactivate));
  }

  async function load() {
    try {
      data = await request('/api/admin/announcements');
      render();
    } catch (error) { toast(error.message); }
  }

  async function save(event) {
    event.preventDefault();
    const title = el('announcementTitle').value;
    const body = el('announcementBody').value;
    const entityWide = el('announcementEntityWide').checked;
    try {
      await request('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ title, body, entityWide }) });
      el('announcementForm').reset();
      await load();
      toast('Pengumuman terkirim');
    } catch (error) { toast(error.message); }
  }

  async function deactivate(id) {
    if (!confirm('Nonaktifkan pengumuman ini?')) return;
    try {
      await request(`/api/admin/announcements/${encodeURIComponent(id)}`, { method: 'PATCH' });
      await load();
      toast('Pengumuman dinonaktifkan');
    } catch (error) { toast(error.message); }
  }

  document.querySelector('[data-tab="announcement"]')?.addEventListener('click', switchTab);
  el('announcementForm')?.addEventListener('submit', save);

  const gate = el('authGate');
  if (gate) new MutationObserver(() => { if (gate.classList.contains('hidden')) load(); }).observe(gate, { attributes: true, attributeFilter: ['class'] });
  if (gate?.classList.contains('hidden')) load();
})();
