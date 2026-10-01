(() => {
  // Laporan Permit (Bos Cyo, 2026-10-01): baca semua permit gerai dalam satu
  // tempat, bisa dipilih kategorinya (presensi, hapus transaksi, uang kas, arus
  // barang, aset, tutup laci), difilter per karyawan pengaju, status, dan
  // tanggal. Baca-saja; keputusan ACC/Tolak tetap di tempat masing-masing
  // permit. Backend: src/permit-report.js.
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const STATUS_LABELS = { PENDING: ['Menunggu', '#8b5d00'], APPROVED: ['Di-ACC', '#2f9e44'], REJECTED: ['Ditolak', '#a4133c'], EXPIRED: ['Kadaluarsa', '#6c757d'] };
  const ROLE_LABELS = { OWNER: 'Owner', ENTITY_ADMIN: 'Admin Entity', ADMIN: 'Admin Gerai', AUTO_PERMIT: 'Auto Permit', SYSTEM: 'Sistem', LEGACY_PIN: 'Admin' };
  let optionsLoaded = false;

  const dateTime = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '';
  const jakartaToday = () => new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const shiftDate = (date, days) => { const base = new Date(`${date}T00:00:00Z`); base.setUTCDate(base.getUTCDate() + days); return base.toISOString().slice(0, 10); };

  function mount() {
    const tabs = document.querySelector('.admin-tabs');
    const shell = document.getElementById('adminApp');
    if (!tabs || !shell || el('tab-permit-report')) return;

    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.dataset.tab = 'permit-report';
    button.type = 'button';
    button.textContent = '🗂️ Laporan Permit';
    button.addEventListener('click', () => { switchTab('permit-report'); if (!optionsLoaded) { applyDefaultRange(); run(); } });
    tabs.appendChild(button);

    shell.insertAdjacentHTML('beforeend', `
      <section id="tab-permit-report" class="admin-section">
        <div class="admin-card">
          <div class="list-head"><div><h2>Laporan Permit</h2><div class="muted">Semua permit gerai ini dalam satu tempat: presensi, hapus transaksi, uang kas, arus barang, aset, dan tutup laci. Hanya untuk dibaca; ACC dan Tolak tetap di tempat masing-masing permit.</div></div></div>
          <div class="admin-grid two compact">
            <label class="admin-field">Kategori<select id="permitReportCategory"><option value="ALL">Semua kategori</option></select></label>
            <label class="admin-field">Karyawan pengaju<select id="permitReportRequester"><option value="">Semua karyawan</option></select></label>
            <label class="admin-field">Status<select id="permitReportStatus">
              <option value="ALL">Semua status</option><option value="PENDING">Menunggu</option><option value="APPROVED">Di-ACC</option><option value="REJECTED">Ditolak</option><option value="EXPIRED">Kadaluarsa</option>
            </select></label>
            <div></div>
            <label class="admin-field">Dari tanggal<input id="permitReportFrom" type="date" /></label>
            <label class="admin-field">Sampai tanggal<input id="permitReportTo" type="date" /></label>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
            <button class="text-btn" type="button" data-permit-range="7">7 hari terakhir</button>
            <button class="text-btn" type="button" data-permit-range="30">30 hari terakhir</button>
            <button class="text-btn" type="button" data-permit-range="90">90 hari terakhir</button>
          </div>
          <button id="permitReportRun" class="primary-btn" type="button">Tampilkan</button>
          <div id="permitReportStatusLine" class="muted" style="margin-top:10px"></div>
        </div>
        <div id="permitReportSummary" class="admin-card" style="margin-top:16px;display:none"></div>
        <div id="permitReportList" class="admin-card" style="margin-top:16px;display:none"></div>
      </section>`);

    el('permitReportRun').addEventListener('click', () => run());
    ['permitReportCategory', 'permitReportRequester', 'permitReportStatus'].forEach(id => el(id).addEventListener('change', () => run()));
    document.querySelectorAll('[data-permit-range]').forEach(item => {
      item.onclick = () => { applyDefaultRange(Number(item.dataset.permitRange)); run(); };
    });
  }

  function applyDefaultRange(days = 30) {
    const today = jakartaToday();
    el('permitReportTo').value = today;
    el('permitReportFrom').value = shiftDate(today, -(days - 1));
  }

  function setStatusLine(message) { const node = el('permitReportStatusLine'); if (node) node.textContent = message; }

  function fillOptions(payload) {
    const category = el('permitReportCategory');
    const chosenCategory = category.value;
    category.innerHTML = '<option value="ALL">Semua kategori</option>' + (payload.categories || []).map(item => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.label)}</option>`).join('');
    category.value = chosenCategory || 'ALL';
    const requester = el('permitReportRequester');
    const chosenRequester = requester.value;
    requester.innerHTML = '<option value="">Semua karyawan</option>' + (payload.requesters || []).map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    requester.value = chosenRequester;
    optionsLoaded = true;
  }

  function chip(status) {
    const [label, color] = STATUS_LABELS[status] || [status, '#6c757d'];
    return `<span style="font-weight:800;color:${color}">${escapeHtml(label)}</span>`;
  }

  function renderSummary(payload) {
    const box = el('permitReportSummary');
    const totals = payload.summary.byStatus;
    const perCategory = (payload.categories || []).map(item => {
      const counts = payload.summary.byCategory[item.code];
      if (!counts) return '';
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
      if (!total) return '';
      return `<div class="master-row"><div class="master-main"><strong>${escapeHtml(item.label)}</strong><div class="master-meta">${total} permit · ${counts.PENDING} menunggu · ${counts.APPROVED} di-ACC · ${counts.REJECTED} ditolak${counts.EXPIRED ? ` · ${counts.EXPIRED} kadaluarsa` : ''}</div></div></div>`;
    }).join('');
    box.style.display = 'block';
    box.innerHTML = `<div class="list-head"><h2>Ringkasan</h2><span class="master-count">${payload.summary.total}</span></div>
      <div class="master-meta" style="margin-bottom:8px">${totals.PENDING} menunggu · ${totals.APPROVED} di-ACC · ${totals.REJECTED} ditolak · ${totals.EXPIRED} kadaluarsa · periode ${escapeHtml(payload.filters.from)} s/d ${escapeHtml(payload.filters.to)}</div>
      ${perCategory || '<div class="empty">Tidak ada permit pada filter ini.</div>'}`;
  }

  function renderList(payload) {
    const box = el('permitReportList');
    box.style.display = 'block';
    const rows = payload.rows || [];
    box.innerHTML = `<div class="list-head"><h2>Daftar permit</h2><span class="master-count">${rows.length}</span></div>`
      + (rows.length ? rows.map(row => `
        <div class="master-row" style="align-items:flex-start">
          <div class="master-main">
            <strong>${escapeHtml(row.requesterName)}</strong> · ${chip(row.status)} · <span class="master-meta">${escapeHtml(row.categoryLabel)}</span>
            <div class="master-meta">${escapeHtml(row.summary)}</div>
            ${row.reason ? `<div class="master-meta">Alasan: ${escapeHtml(row.reason)}</div>` : ''}
            <div class="master-meta">Diajukan ${escapeHtml(dateTime(row.createdAt))}${row.decidedAt ? ` · diputuskan ${escapeHtml(dateTime(row.decidedAt))}${row.decidedByRole ? ` oleh ${escapeHtml(ROLE_LABELS[row.decidedByRole] || row.decidedByRole)}` : ''}` : ''}</div>
            ${row.decisionNote ? `<div class="master-meta">Catatan: ${escapeHtml(row.decisionNote)}</div>` : ''}
          </div>
        </div>`).join('') : '<div class="empty">Tidak ada permit yang cocok.</div>')
      + (payload.truncated ? '<div class="master-meta" style="margin-top:8px">Menampilkan 200 permit terbaru. Persempit periode atau filter untuk melihat sisanya.</div>' : '');
  }

  async function run() {
    const params = new URLSearchParams({
      store: window.LEKER_STORE_CODE || 'G001',
      category: el('permitReportCategory').value || 'ALL',
      status: el('permitReportStatus').value || 'ALL'
    });
    if (el('permitReportRequester').value) params.set('requester', el('permitReportRequester').value);
    if (el('permitReportFrom').value) params.set('from', el('permitReportFrom').value);
    if (el('permitReportTo').value) params.set('to', el('permitReportTo').value);
    setStatusLine('Memuat laporan...');
    try {
      const response = await fetch(`/api/admin/permit-report?${params}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
      fillOptions(payload);
      renderSummary(payload);
      renderList(payload);
      setStatusLine('');
    } catch (error) { setStatusLine(error.message); }
  }

  mount();
})();
