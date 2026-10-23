(() => {
  // Bos Cyo, 2026-09-19: "portal staf kasih tombol daily task ya ... pengaturan task juga di set up
  // oleh admin dari panel nya." Bos Cyo, 2026-10-24: "task dayli nya bisa diliat di centangin di
  // portalstaf, tapi bikinnya dipengaturan" -- halaman ini masuk grup Pengaturan (nav-groups.js) dan
  // memuat semua yang dulu dipaten: Tugas Buka Laci per gerai (langkah wajib + daftar barang opname,
  // src/tugas-buka-laci.js), daftar aset yang dicek saat buka laci, dan tugas harian yang dicentang CS
  // di Portal Staf. Tidak ada isi tugas yang di-hardcode di sini.
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  let data = { templates: [] };
  let opening = null;
  let chosenIds = new Set();

  const tabs = document.querySelector('.admin-tabs');
  if (tabs && !document.querySelector('[data-tab="daily-task"]')) {
    tabs.insertAdjacentHTML('beforeend', '<button class="admin-tab" data-tab="daily-task" type="button">⚙ Tugas Harian &amp; Buka Laci</button>');
  }

  const contacts = el('tab-contacts');
  if (contacts && !el('tab-daily-task')) {
    contacts.insertAdjacentHTML('afterend', `
      <section id="tab-daily-task" class="admin-section">
        <div class="admin-grid master-layout">
          <form id="openingCheckForm" class="admin-card">
            <div class="form-title-row"><h2>Tugas Buka Laci</h2></div>
            <div id="openingCheckTenant" class="admin-tip" style="margin-bottom:12px">Memuat...</div>
            <p class="muted" style="margin-top:0">Langkah yang dicentang wajib dikerjakan CS setiap buka laci, sebelum laci bisa dipakai jualan. Kalau semua dimatikan, laci langsung bisa dipakai.</p>
            <label class="admin-check"><input id="openingStockEnabled" type="checkbox" checked /> Stok opname</label>
            <label class="admin-check"><input id="openingCashEnabled" type="checkbox" checked /> Hitung uang laci</label>
            <label class="admin-check"><input id="openingAssetEnabled" type="checkbox" checked /> Cek aset (daftar di bawah)</label>
            <div id="openingStockBlock" style="margin-top:10px">
              <div class="admin-field">Barang yang dihitung saat stok opname</div>
              <label class="admin-check"><input type="radio" name="openingStockMode" value="MATERIALS" checked /> Semua Bahan &amp; Bahan Setengah Jadi (barang baru otomatis ikut)</label>
              <label class="admin-check"><input type="radio" name="openingStockMode" value="CUSTOM" /> Pilih barang sendiri</label>
              <div id="openingStockPicker" class="hidden" style="margin-top:8px">
                <input id="openingStockSearch" class="text-input" type="search" placeholder="Cari barang..." autocomplete="off" />
                <div class="master-actions" style="margin:8px 0"><button id="openingPickMaterials" class="mini-btn" type="button">Centang semua bahan</button><button id="openingPickNone" class="mini-btn" type="button">Kosongkan</button><span id="openingPickCount" class="master-meta"></span></div>
                <div id="openingStockList" class="master-list" style="max-height:320px;overflow:auto"></div>
              </div>
            </div>
            <button class="primary-btn" type="submit" style="margin-top:12px">Simpan pengaturan buka laci</button>
          </form>
          <form id="dailyTaskForm" class="admin-card sticky-form">
            <input id="dailyTaskId" type="hidden" />
            <div class="form-title-row"><h2 id="dailyTaskFormTitle">Tambah tugas / aset</h2><button id="dailyTaskCancelEdit" class="text-btn hidden" type="button">Batal edit</button></div>
            <div class="admin-tip" style="margin-bottom:12px">"Tugas harian" muncul di Daily Task Portal Staf dan dicentang CS (contoh: bersih-bersih, tes rasa). "Aset cek buka laci" dicek CS Ada/Tidak ada di Tugas Buka Laci (contoh: apron).</div>
            <label class="admin-field">Jenis<select id="dailyTaskKind"><option value="TASK">Tugas harian</option><option value="ASSET">Aset cek buka laci</option></select></label>
            <label class="admin-field">Judul tugas / nama aset<input id="dailyTaskTitle" maxlength="100" required /></label>
            <label class="admin-field">Deskripsi <span class="field-note">opsional</span><textarea id="dailyTaskDescription" rows="2" maxlength="500"></textarea></label>
            <label class="admin-field">Urutan tampil <span class="field-note">angka kecil tampil duluan</span><input id="dailyTaskSortOrder" type="number" step="1" value="0" /></label>
            <label class="admin-check"><input id="dailyTaskActive" type="checkbox" checked /> Aktif</label>
            <button class="primary-btn" type="submit">Simpan</button>
          </form>
          <div class="admin-card list-card">
            <div class="list-head"><h2>Aset cek buka laci</h2><span id="dailyAssetCount" class="master-count">0</span></div>
            <div id="dailyAssetList" class="master-list"></div>
          </div>
          <div class="admin-card list-card">
            <div class="list-head"><h2>Tugas harian (dicentang di Portal Staf)</h2><span id="dailyTaskCount" class="master-count">0</span></div>
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

  function rowHtml(item) {
    return `
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
      </div>`;
  }

  function render() {
    const assets = data.templates.filter(item => item.kind === 'ASSET');
    const tasks = data.templates.filter(item => item.kind !== 'ASSET');
    el('dailyAssetCount').textContent = assets.length;
    el('dailyTaskCount').textContent = tasks.length;
    el('dailyAssetList').innerHTML = assets.length ? assets.map(rowHtml).join('') : '<div class="empty">Belum ada aset. Kalau kosong sama sekali, CS tetap dicek Apron (bawaan).</div>';
    el('dailyTaskList').innerHTML = tasks.length ? tasks.map(rowHtml).join('') : '<div class="empty">Belum ada tugas harian di gerai ini.</div>';
    document.querySelectorAll('#tab-daily-task [data-edit]').forEach(button => button.onclick = () => editTemplate(button.dataset.edit));
    document.querySelectorAll('#tab-daily-task [data-toggle]').forEach(button => button.onclick = () => toggleActive(button.dataset.toggle));
  }

  function stockMode() {
    return document.querySelector('input[name="openingStockMode"]:checked')?.value || 'MATERIALS';
  }

  function renderStockPicker() {
    const custom = stockMode() === 'CUSTOM';
    el('openingStockBlock').classList.toggle('hidden', !el('openingStockEnabled').checked);
    el('openingStockPicker').classList.toggle('hidden', !custom);
    if (!custom || !opening) return;
    const query = el('openingStockSearch').value.trim().toLowerCase();
    const products = opening.products.filter(item => !query || `${item.productName} ${item.unitSymbol}`.toLowerCase().includes(query));
    el('openingPickCount').textContent = `${chosenIds.size} dipilih`;
    el('openingStockList').innerHTML = products.length ? products.map(item => `
      <label class="master-row" style="cursor:pointer"><span class="master-main"><input type="checkbox" data-opening-product="${Number(item.productId)}" ${chosenIds.has(item.productId) ? 'checked' : ''} /> <strong>${escapeHtml(item.productName)}</strong> <span class="master-meta">${escapeHtml(item.unitSymbol || '')}</span></span></label>`).join('')
      : '<div class="empty">Barang tidak ditemukan.</div>';
  }

  function renderOpening() {
    if (!opening) return;
    const settings = opening.settings;
    el('openingCheckTenant').textContent = opening.tenantEnabled
      ? 'Saklar usaha Tugas Buka Laci: AKTIF. Atur langkahnya untuk gerai ini di bawah.'
      : 'Saklar usaha Tugas Buka Laci sedang MATI (diatur Owner di kebijakan tenant), jadi pengaturan di bawah belum berlaku.';
    el('openingStockEnabled').checked = settings.stockEnabled;
    el('openingCashEnabled').checked = settings.cashEnabled;
    el('openingAssetEnabled').checked = settings.assetEnabled;
    const mode = document.querySelector(`input[name="openingStockMode"][value="${settings.stockMode}"]`);
    if (mode) mode.checked = true;
    chosenIds = new Set(settings.stockMode === 'CUSTOM' ? settings.stockProductIds : opening.materialProductIds);
    renderStockPicker();
  }

  async function load() {
    try {
      const [templates, openingSettings] = await Promise.all([
        request('/api/admin/daily-task-templates'),
        request('/api/admin/opening-check-settings')
      ]);
      data = templates;
      opening = openingSettings;
      render();
      renderOpening();
    } catch (error) { toast(error.message); }
  }

  async function saveOpening(event) {
    event.preventDefault();
    try {
      const result = await request('/api/admin/opening-check-settings', {
        method: 'PUT',
        body: JSON.stringify({
          stockEnabled: el('openingStockEnabled').checked,
          cashEnabled: el('openingCashEnabled').checked,
          assetEnabled: el('openingAssetEnabled').checked,
          stockMode: stockMode(),
          stockProductIds: [...chosenIds]
        })
      });
      opening = { ...opening, settings: result.settings };
      renderOpening();
      toast('Pengaturan Tugas Buka Laci disimpan · berlaku untuk laci yang dibuka berikutnya');
    } catch (error) { toast(error.message); }
  }

  function resetForm() {
    el('dailyTaskForm').reset();
    el('dailyTaskId').value = '';
    el('dailyTaskSortOrder').value = 0;
    el('dailyTaskActive').checked = true;
    el('dailyTaskKind').value = 'TASK';
    el('dailyTaskFormTitle').textContent = 'Tambah tugas / aset';
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
    el('dailyTaskKind').value = item.kind === 'ASSET' ? 'ASSET' : 'TASK';
    el('dailyTaskFormTitle').textContent = item.kind === 'ASSET' ? 'Edit aset' : 'Edit tugas harian';
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
      isActive: el('dailyTaskActive').checked,
      kind: el('dailyTaskKind').value
    };
    try {
      await request(id ? `/api/admin/daily-task-templates/${encodeURIComponent(id)}` : '/api/admin/daily-task-templates', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(payload)
      });
      await load();
      resetForm();
      toast(id ? 'Diperbarui' : 'Ditambahkan');
    } catch (error) { toast(error.message); }
  }

  async function toggleActive(id) {
    const item = data.templates.find(entry => entry.id === id);
    if (!item) return;
    try {
      await request(`/api/admin/daily-task-templates/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ isActive: !item.isActive }) });
      await load();
      toast(item.isActive ? 'Dinonaktifkan' : 'Diaktifkan');
    } catch (error) { toast(error.message); }
  }

  document.querySelector('[data-tab="daily-task"]')?.addEventListener('click', switchTab);
  el('dailyTaskForm')?.addEventListener('submit', save);
  el('dailyTaskCancelEdit')?.addEventListener('click', resetForm);
  el('openingCheckForm')?.addEventListener('submit', saveOpening);
  el('openingStockEnabled')?.addEventListener('change', renderStockPicker);
  document.querySelectorAll('input[name="openingStockMode"]').forEach(input => input.addEventListener('change', renderStockPicker));
  el('openingStockSearch')?.addEventListener('input', renderStockPicker);
  el('openingStockList')?.addEventListener('change', event => {
    const input = event.target instanceof Element ? event.target.closest('[data-opening-product]') : null;
    if (!input) return;
    const productId = Number(input.dataset.openingProduct);
    if (input.checked) chosenIds.add(productId); else chosenIds.delete(productId);
    el('openingPickCount').textContent = `${chosenIds.size} dipilih`;
  });
  el('openingPickMaterials')?.addEventListener('click', () => { chosenIds = new Set(opening?.materialProductIds || []); renderStockPicker(); });
  el('openingPickNone')?.addEventListener('click', () => { chosenIds = new Set(); renderStockPicker(); });

  // Entity Admin -> Pengaturan -> Pengaturan Gerai menautkan ke /s/<gerai>/admin#tab=daily-task (atau
  // #tab=store); di semua skin tab yang diminta langsung dibuka sekali setelah login.
  let hashHandled = false;
  function openRequestedTab() {
    if (hashHandled) return;
    hashHandled = true;
    const requested = new URLSearchParams(location.hash.replace(/^#/, '')).get('tab');
    if (requested) setTimeout(() => document.querySelector(`.admin-tab[data-tab="${CSS.escape(requested)}"]`)?.click(), 0);
  }

  const gate = el('authGate');
  if (gate) new MutationObserver(() => { if (gate.classList.contains('hidden')) { load(); openRequestedTab(); } }).observe(gate, { attributes: true, attributeFilter: ['class'] });
  if (gate?.classList.contains('hidden')) { load(); openRequestedTab(); }
})();
