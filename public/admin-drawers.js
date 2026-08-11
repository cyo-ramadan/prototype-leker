(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const dateTime = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '-';
  let drawers = [];

  const productTab = document.querySelector('[data-tab="products"]');
  if (productTab) productTab.textContent = 'Data Barang';

  const tabs = document.querySelector('.admin-tabs');
  if (tabs) {
    const additions = [
      ['accounting', 'Akuntansi'],
      ['reports', 'Laporan'],
      ['drawers', 'Detail Laci']
    ];
    for (const [key, label] of additions) {
      if (document.querySelector(`[data-tab="${key}"]`)) continue;
      const button = document.createElement('button');
      button.className = 'admin-tab';
      button.dataset.tab = key;
      button.type = 'button';
      button.textContent = label;
      tabs.appendChild(button);
    }
  }

  const app = el('adminApp');
  if (app && !el('tab-accounting')) {
    const toast = el('adminToast');
    const sections = `
      <section id="tab-accounting" class="admin-section">
        <div class="admin-card admin-placeholder"><div class="admin-placeholder-inner"><div class="admin-eyebrow">Coming next</div><h2>Akuntansi</h2><p class="muted">Menu disiapkan dulu. Belum ada jurnal atau mapping akun yang dibuat otomatis di prototype.</p></div></div>
      </section>
      <section id="tab-reports" class="admin-section">
        <div class="admin-card admin-placeholder"><div class="admin-placeholder-inner"><div class="admin-eyebrow">Coming next</div><h2>Laporan</h2><p class="muted">Menu laporan disiapkan kosong dulu. Detail operasional shift tersedia lewat Detail Laci.</p></div></div>
      </section>
      <section id="tab-drawers" class="admin-section">
        <div class="admin-card">
          <div class="list-head"><div><h2>Detail Laci Gerai</h2><div class="muted">Semua laci di gerai ini, termasuk penanggung jawab pembuka laci.</div></div><span id="adminDrawerCount" class="master-count">0</span></div>
          <div id="adminDrawerList" class="drawer-history-grid" style="margin-top:14px"></div>
        </div>
        <div id="adminDrawerReportPanel" class="admin-card drawer-report-panel hidden"></div>
      </section>`;
    if (toast) toast.insertAdjacentHTML('beforebegin', sections);
    else app.insertAdjacentHTML('beforeend', sections);
  }

  function switchTab(tab) {
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === `tab-${tab}`));
    if (tab === 'drawers') loadDrawers();
  }

  async function request(path) {
    const response = await fetch(path, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function toast(message) {
    const node = el('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 2200);
  }

  function renderDrawers() {
    el('adminDrawerCount').textContent = drawers.length;
    el('adminDrawerList').innerHTML = drawers.length ? drawers.map(drawer => `
      <article class="drawer-history-row">
        <div>
          <strong>${esc(drawer.cashierName)} · ${esc(drawer.status)}</strong>
          <small>ID ${esc(drawer.id)}${drawer.shiftLabel ? ` · Shift ${esc(drawer.shiftLabel)}` : ''}</small>
          <small>Datang ${dateTime(drawer.openedAt)} · Pulang ${dateTime(drawer.closedAt)}</small>
          <small>Modal ${money(drawer.openingAmount)} · Penanggung jawab @${esc(drawer.cashierUsername)}</small>
        </div>
        <div class="drawer-history-actions"><button class="mini-btn" type="button" data-admin-drawer="${esc(drawer.id)}">Lihat Detail</button></div>
      </article>`).join('') : '<div class="empty">Belum ada riwayat laci di gerai ini.</div>';
    document.querySelectorAll('[data-admin-drawer]').forEach(button => button.onclick = () => openReport(button.dataset.adminDrawer));
  }

  async function loadDrawers() {
    try {
      const payload = await request('/api/admin/drawers');
      drawers = payload.drawers || [];
      renderDrawers();
    } catch (error) { toast(error.message); }
  }

  async function openReport(id) {
    try {
      const payload = await request(`/api/admin/drawers/${encodeURIComponent(id)}`);
      const panel = el('adminDrawerReportPanel');
      panel.innerHTML = `<div class="list-head"><div><h2>Rincian Laci</h2><div class="muted">Gerai ${esc(payload.store?.code || window.LEKER_STORE_CODE || '')}</div></div><button id="closeAdminDrawerReport" class="mini-btn" type="button">Tutup Detail</button></div><div style="margin-top:14px">${window.MAXIDrawerReport?.render(payload.report) || '<div class="empty">Renderer detail belum tersedia.</div>'}</div>`;
      panel.classList.remove('hidden');
      el('closeAdminDrawerReport').onclick = () => panel.classList.add('hidden');
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { toast(error.message); }
  }

  ['accounting','reports','drawers'].forEach(tab => {
    document.querySelector(`[data-tab="${tab}"]`)?.addEventListener('click', () => switchTab(tab));
  });

  const gate = el('authGate');
  if (gate) new MutationObserver(() => { if (gate.classList.contains('hidden')) loadDrawers(); }).observe(gate, { attributes: true, attributeFilter: ['class'] });
})();
