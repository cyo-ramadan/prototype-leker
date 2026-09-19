(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const dateTime = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '-';
  let drawers = [];
  let closePermits = [];

  const productTab = document.querySelector('[data-tab="products"]');
  if (productTab) productTab.textContent = 'Data Barang';

  // Bos Cyo, 2026-09-15: "koneksi akuntansi itu ga butuh sepertinya, kalo
  // aman hapus aja" -- tab placeholder "Akuntansi" (data-tab="accounting")
  // dihapus. Aman: id section-nya (tab-accounting) beda dari Accounting
  // Workspace beneran (tab-accounting-workspace, admin-accounting-workspace.js),
  // jadi tidak ada yang tabrakan. admin-transactions-ui.js sebelumnya
  // menumpangi tab ini buat kartu status "Koneksi Akuntansi/NOT_CONNECTED" --
  // itu juga sudah dilepas di sana.
  const tabs = document.querySelector('.admin-tabs');
  if (tabs) {
    const additions = [
      ['reports', '📈 Laporan'],
      ['drawers', '📚 Detail Laci']
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
  if (app && !el('tab-drawers')) {
    const toast = el('adminToast');
    const sections = `
      <section id="tab-reports" class="admin-section">
        <div class="admin-card admin-placeholder"><div class="admin-placeholder-inner"><div class="admin-eyebrow">Coming next</div><h2>Laporan</h2><p class="muted">Menu laporan disiapkan kosong dulu. Detail operasional shift tersedia lewat Detail Laci.</p></div></div>
      </section>
      <section id="tab-drawers" class="admin-section">
        <div class="admin-card">
          <div class="list-head"><div><h2>Pengajuan Tutup Laci Sebelumnya</h2><div class="muted">Kasir gantian jaga mengajukan tutup paksa laci kasir sebelumnya yang masih terbuka -- ACC di sini yang benar-benar menutup lacinya.</div></div><span id="adminClosePermitCount" class="master-count">0</span></div>
          <div id="adminClosePermitList" class="master-list" style="margin-top:14px"></div>
        </div>
        <div class="admin-card" style="margin-top:16px">
          <div class="list-head"><div><h2>Detail Laci Gerai</h2><div class="muted">Semua laci di gerai ini, termasuk penanggung jawab pembuka laci.</div></div><span id="adminDrawerCount" class="master-count">0</span></div>
          <div id="adminDrawerList" class="drawer-history-grid" style="margin-top:14px"></div>
        </div>
      </section>`;
    if (toast) toast.insertAdjacentHTML('beforebegin', sections);
    else app.insertAdjacentHTML('beforeend', sections);
  }

  function switchTab(tab) {
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === `tab-${tab}`));
    if (tab === 'drawers') { loadDrawers(); loadClosePermits(); }
  }

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { cache: 'no-store', ...options, headers });
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
        <div class="drawer-history-actions">
          <button class="admin-tx-btn admin-tx-btn-primary" type="button" data-admin-drawer="${esc(drawer.id)}">🔍 Lihat Detail</button>
        </div>
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

  // Bos Cyo, 2026-09-19: "kasih tombol kasir bisa permit tutup laci kasir
  // sebelumnya karna sudah waktu dia untuk jaga. nanti admin acc kan
  // akhirnya di force close." ACC di sini yang benar-benar menutup laci
  // lama (src/cashier-drawer-close-permit.js) -- bukan sekadar mencatat
  // keputusan, jadi daftar drawer di bawahnya ikut di-refresh setelahnya.
  function renderClosePermits() {
    el('adminClosePermitCount').textContent = closePermits.length;
    el('adminClosePermitList').innerHTML = closePermits.length ? closePermits.map(permit => `
      <div class="master-row contact-row">
        <div class="master-main">
          <strong>Tutup laci ${esc(permit.targetCashierName)}</strong>
          <div class="master-meta">Diajukan oleh ${esc(permit.requestedByCashierName)} · ${dateTime(permit.createdAt)}</div>
          <div class="master-meta">Saldo kas fisik ${money(permit.closingAmount)}${permit.depositAmount ? ` · Setoran ${money(permit.depositAmount)}` : ''}</div>
          ${permit.reason ? `<div class="master-meta">Alasan: ${esc(permit.reason)}</div>` : ''}
        </div>
        <div class="master-actions">
          <button class="mini-btn" type="button" data-acc-close-permit="${esc(permit.id)}">ACC</button>
          <button class="mini-btn danger" type="button" data-reject-close-permit="${esc(permit.id)}">Tolak</button>
        </div>
      </div>`).join('') : '<div class="empty">Tidak ada pengajuan tutup laci yang menunggu ACC.</div>';
    document.querySelectorAll('[data-acc-close-permit]').forEach(button => button.onclick = () => decideClosePermit(button.dataset.accClosePermit, 'ACC'));
    document.querySelectorAll('[data-reject-close-permit]').forEach(button => button.onclick = () => decideClosePermit(button.dataset.rejectClosePermit, 'REJECT'));
  }

  async function loadClosePermits() {
    try {
      const payload = await request('/api/admin/drawer/close-permits');
      closePermits = payload.permits || [];
      renderClosePermits();
    } catch (error) { toast(error.message); }
  }

  async function decideClosePermit(id, decision) {
    const note = decision === 'REJECT' ? (prompt('Alasan penolakan (opsional):', '') ?? '') : '';
    try {
      await request(`/api/admin/drawer/close-permits/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ decision, note })
      });
      await Promise.all([loadClosePermits(), loadDrawers()]);
      toast(decision === 'ACC' ? 'Laci berhasil ditutup paksa' : 'Pengajuan ditolak');
    } catch (error) { toast(error.message); }
  }

  // Bos Cyo, 2026-09-15: Detail Laci Admin sebelumnya buka panel inline di
  // bawah daftar (toggle + scrollIntoView), sementara Kasir buka modal
  // beneran (dialog) -- ga kerasa "satu tombol di-share". Sekarang sama-sama
  // lewat window.openAdminDetailModal(), modal shell yang sudah dipakai
  // Transaksi & Stok.
  async function openReport(id) {
    window.openAdminDetailModal({
      head: '<div class="admin-eyebrow">Rincian Laci</div><h2>Memuat...</h2>',
      body: '<div class="muted">Memuat rincian laci...</div>'
    });
    try {
      const payload = await request(`/api/admin/drawers/${encodeURIComponent(id)}`);
      window.openAdminDetailModal({
        head: `<div class="admin-eyebrow">Rincian Laci</div><h2>Gerai ${esc(payload.store?.code || window.LEKER_STORE_CODE || '')}</h2>`,
        body: window.MAXIDrawerReport?.render(payload.report) || '<div class="empty">Renderer detail belum tersedia.</div>'
      });
    } catch (error) {
      window.openAdminDetailModal({
        head: '<div class="admin-eyebrow">Rincian Laci</div><h2>Gagal memuat</h2>',
        body: `<div class="empty">${esc(error.message)}</div>`
      });
    }
  }

  ['reports','drawers'].forEach(tab => {
    document.querySelector(`[data-tab="${tab}"]`)?.addEventListener('click', () => switchTab(tab));
  });

  const gate = el('authGate');
  if (gate) new MutationObserver(() => { if (gate.classList.contains('hidden')) { loadDrawers(); loadClosePermits(); } }).observe(gate, { attributes: true, attributeFilter: ['class'] });
})();
