(() => {
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  let data = { templates: [] };

  const tabs = document.querySelector('.admin-tabs');
  if (tabs && !document.querySelector('[data-tab="daily-task"]')) {
    tabs.insertAdjacentHTML('beforeend', '<button class="admin-tab" data-tab="daily-task" type="button">🗒️ Daily Task</button>');
  }

  const contacts = el('tab-contacts');
  if (contacts && !el('tab-daily-task')) {
    contacts.insertAdjacentHTML('afterend', `
      <section id="tab-daily-task" class="admin-section">
        <div class="admin-grid master-layout">
          <form id="dailyTaskForm" class="admin-card sticky-form">
            <input id="dailyTaskId" type="hidden" />
            <div class="form-title-row"><h2 id="dailyTaskFormTitle">Tambah tugas harian</h2><button id="dailyTaskCancelEdit" class="text-btn hidden" type="button">Batal edit</button></div>
            <div class="admin-tip" style="margin-bottom:12px">Daftar tugas ini yang muncul di tombol "Daily Task" Portal Staf gerai ini, contoh: pakai apron, bersih-bersih, tes rasa.</div>
            <label class="admin-field">Judul tugas<input id="dailyTaskTitle" maxlength="100" required /></label>
            <label class="admin-field">Deskripsi <span class="field-note">opsional</span><textarea id="dailyTaskDescription" rows="2" maxlength="500"></textarea></label>
            <label class="admin-field">Urutan tampil <span class="field-note">angka kecil tampil duluan</span><input id="dailyTaskSortOrder" type="number" step="1" value="0" /></label>
            <label class="admin-check"><input id="dailyTaskActive" type="checkbox" checked /> Aktif</label>
            <button class="primary-btn" type="submit">Simpan tugas</button>
          </form>
          <div class="admin-card list-card">
            <div class="list-head"><h2>Daftar tugas harian gerai ini</h2><span id="dailyTaskCount" class="master-count">0</span></div>
            <div id="dailyTaskList" class="master-list"></div>
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
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === 'daily-task'));
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-daily-task'));
  }

  function render() {
    el('dailyTaskCount').textContent = data.templates.length;
    el('dailyTaskList').innerHTML = data.templates.length ? data.templates.map(item => `
      <div class="master-row contact-row ${item.isActive ? '' : 'inactive'}">
        <div class="master-main">
          <strong>${escapeHtml(item.title)}</strong>
          ${item.description ? `<div class="master-meta">${escapeHtml(item.description)}</div>` : ''}
          <div class="master-meta">Urutan ${item.sortOrder} · ${item.isActive ? 'Aktif' : 'Nonaktif'}</div>
        </div>
        <div class="master-actions">
          <button class="mini-btn" type="button" data-edit="${escapeHtml(item.id)}">Edit</button>
          <button class="mini-btn ${item.isActive ? 'danger' : ''}" type="button" data-toggle="${escapeHtml(item.id)}">${item.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button>
        </div>
      </div>`).join('') : '<div class="empty">Belum ada tugas harian di gerai ini.</div>';

    document.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => editTemplate(button.dataset.edit));
    document.querySelectorAll('[data-toggle]').forEach(button => button.onclick = () => toggleActive(button.dataset.toggle));
  }

  async function load() {
    try {
      data = await request('/api/admin/daily-task-templates');
      render();
    } catch (error) { toast(error.message); }
  }

  function resetForm() {
    el('dailyTaskForm').reset();
    el('dailyTaskId').value = '';
    el('dailyTaskSortOrder').value = 0;
    el('dailyTaskActive').checked = true;
    el('dailyTaskFormTitle').textContent = 'Tambah tugas harian';
    el('dailyTaskCancelEdit').classList.add('hidden');
  }

  function editTemplate(id) {
    const item = data.templates.find(entry => entry.id === id);
    if (!item) return;
    el('dailyTaskId').value = item.id;
    el('dailyTaskTitle').value = item.title;
    el('dailyTaskDescription').value = item.description || '';
    el('dailyTaskSortOrder').value = item.sortOrder;
    el('dailyTaskActive').checked = item.isActive;
    el('dailyTaskFormTitle').textContent = 'Edit tugas harian';
    el('dailyTaskCancelEdit').classList.remove('hidden');
    switchTab();
    el('dailyTaskForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function save(event) {
    event.preventDefault();
    const id = el('dailyTaskId').value;
    const payload = {
      title: el('dailyTaskTitle').value,
      description: el('dailyTaskDescription').value,
      sortOrder: Number(el('dailyTaskSortOrder').value) || 0,
      isActive: el('dailyTaskActive').checked
    };
    try {
      await request(id ? `/api/admin/daily-task-templates/${encodeURIComponent(id)}` : '/api/admin/daily-task-templates', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(payload)
      });
      await load();
      resetForm();
      toast(id ? 'Tugas diperbarui' : 'Tugas ditambahkan');
    } catch (error) { toast(error.message); }
  }

  async function toggleActive(id) {
    const item = data.templates.find(entry => entry.id === id);
    if (!item) return;
    try {
      await request(`/api/admin/daily-task-templates/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ isActive: !item.isActive }) });
      await load();
      toast(item.isActive ? 'Tugas dinonaktifkan' : 'Tugas diaktifkan');
    } catch (error) { toast(error.message); }
  }

  document.querySelector('[data-tab="daily-task"]')?.addEventListener('click', switchTab);
  el('dailyTaskForm')?.addEventListener('submit', save);
  el('dailyTaskCancelEdit')?.addEventListener('click', resetForm);

  const gate = el('authGate');
  if (gate) new MutationObserver(() => { if (gate.classList.contains('hidden')) load(); }).observe(gate, { attributes: true, attributeFilter: ['class'] });
  if (gate?.classList.contains('hidden')) load();
})();
