(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
  }[char]));
  const categoryName = code => ({
    PRODUCT_QUALITY: 'Mutu Produk',
    SERVICE: 'Pelayanan',
    CLEANLINESS: 'Kebersihan'
  }[code] || code || '-');
  const isBranch = /^\/s\/[^/]+\/admin\/?$/.test(location.pathname);
  const branchStoreCode = String(window.LEKER_STORE_CODE || location.pathname.split('/')[2] || '').toUpperCase();
  let cachedFeedback = [];

  const style = document.createElement('style');
  style.textContent = `
    .feedback-management-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
    .feedback-management-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .feedback-management-tools select{border:1px solid #d1d5db;border-radius:10px;padding:8px 10px;background:#fff}
    .feedback-management-list{display:grid;gap:10px;margin-top:14px}
    .feedback-management-row{border:1px solid #e5e7eb;border-radius:16px;padding:14px;background:#fff}
    .feedback-management-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;color:#64748b;font-size:12px}
    .feedback-management-badge{display:inline-flex;padding:5px 8px;border-radius:999px;background:#f1f5f9;color:#0f172a;font-weight:800}
    .feedback-management-row ul{margin:8px 0 0;padding-left:20px}
    .feedback-management-note{margin-top:10px;padding:10px 12px;border-radius:12px;background:#f8fafc;white-space:pre-wrap}
    .feedback-management-privacy{margin-top:10px;font-size:12px;color:#64748b}
  `;
  document.head.appendChild(style);

  async function feedbackApi(path) {
    const headers = {};
    if (!isBranch) {
      const token = sessionStorage.getItem('lekerOwnerToken') || '';
      if (!token) throw new Error('Login Owner diperlukan.');
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(path, { cache: 'no-store', headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Gagal memuat kotak saran (${response.status})`);
    return payload;
  }

  function formatDate(value) {
    if (!value) return '-';
    try {
      return new Intl.DateTimeFormat('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Jakarta'
      }).format(new Date(value));
    } catch {
      return value;
    }
  }

  function feedbackRowsHtml(rows) {
    if (!rows.length) return '<div class="empty">Belum ada laporan customer pada filter ini.</div>';
    return rows.map(item => `
      <article class="feedback-management-row">
        <div class="feedback-management-meta">
          <span class="feedback-management-badge">${escapeHtml(item.categoryLabel || categoryName(item.category))}</span>
          <span>${escapeHtml(item.store?.code || '')} · ${escapeHtml(item.store?.storeName || '')}</span>
          <span>${escapeHtml(formatDate(item.createdAt))}</span>
          <span>${escapeHtml(item.feedbackCode || '')}</span>
        </div>
        ${(item.issues || []).length ? `<ul>${item.issues.map(issue => `<li>${escapeHtml(issue.label)}</li>`).join('')}</ul>` : ''}
        ${item.manualNote ? `<div class="feedback-management-note">${escapeHtml(item.manualNote)}</div>` : ''}
        <div class="feedback-management-privacy">🔒 ${escapeHtml(item.reporter?.label || 'Identitas pelapor dilindungi')}</div>
      </article>
    `).join('');
  }

  function renderFiltered(container) {
    const filter = container.querySelector('[data-feedback-filter]')?.value || '';
    const rows = filter ? cachedFeedback.filter(item => item.category === filter) : cachedFeedback;
    const list = container.querySelector('[data-feedback-list]');
    const count = container.querySelector('[data-feedback-count]');
    if (count) count.textContent = String(rows.length);
    if (list) list.innerHTML = feedbackRowsHtml(rows);
  }

  async function load(container) {
    const list = container.querySelector('[data-feedback-list]');
    if (list) list.innerHTML = '<div class="empty">Memuat komentar customer...</div>';
    try {
      const path = isBranch
        ? `/api/admin/customer-feedback?store=${encodeURIComponent(branchStoreCode)}`
        : '/api/admin/customer-feedback';
      const payload = await feedbackApi(path);
      cachedFeedback = payload.feedback || [];
      renderFiltered(container);
    } catch (error) {
      if (list) list.innerHTML = `<div class="admin-message">${escapeHtml(error.message)}</div>`;
    }
  }

  function panelInnerHtml(title) {
    return `
      <div class="feedback-management-head">
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p class="muted">Komentar customer untuk evaluasi manajemen. Identitas pelapor disembunyikan dari list ini.</p>
        </div>
        <div class="feedback-management-tools">
          <select data-feedback-filter aria-label="Filter kategori">
            <option value="">Semua kategori</option>
            <option value="PRODUCT_QUALITY">Mutu Produk</option>
            <option value="SERVICE">Pelayanan</option>
            <option value="CLEANLINESS">Kebersihan</option>
          </select>
          <button class="secondary-btn" data-feedback-refresh type="button">Refresh</button>
          <span class="master-count" data-feedback-count>0</span>
        </div>
      </div>
      <div class="feedback-management-list" data-feedback-list></div>
    `;
  }

  function bindPanel(container) {
    container.querySelector('[data-feedback-filter]')?.addEventListener('change', () => renderFiltered(container));
    container.querySelector('[data-feedback-refresh]')?.addEventListener('click', () => load(container));
  }

  function initBranch() {
    const tabs = document.querySelector('.admin-tabs');
    const app = document.getElementById('adminApp');
    if (!tabs || !app) return;

    let tab = document.querySelector('[data-customer-feedback-tab]');
    if (!tab) {
      tab = document.createElement('button');
      tab.className = 'admin-tab';
      tab.type = 'button';
      tab.textContent = 'Kotak Saran';
      tab.dataset.customerFeedbackTab = 'true';
      tab.dataset.tab = 'customer-feedback';
      tabs.appendChild(tab);
    }

    let section = document.getElementById('tab-customer-feedback');
    if (!section) {
      section = document.createElement('section');
      section.id = 'tab-customer-feedback';
      section.className = 'admin-section';
      const toast = document.getElementById('adminToast');
      app.insertBefore(section, toast || null);
    }

    if (!section.querySelector('[data-feedback-list]')) {
      section.innerHTML = `<div class="admin-card">${panelInnerHtml('Komentar Customer')}</div>`;
    }
    bindPanel(section);

    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(node => node.classList.remove('active'));
      document.querySelectorAll('.admin-section').forEach(node => node.classList.remove('active'));
      tab.classList.add('active');
      section.classList.add('active');
      load(section);
    });
  }

  function initOwner() {
    const app = document.getElementById('ownerApp');
    if (!app || document.getElementById('ownerCustomerFeedbackPanel')) return;

    const section = document.createElement('section');
    section.id = 'ownerCustomerFeedbackPanel';
    section.className = 'admin-card';
    section.style.marginTop = '18px';
    section.innerHTML = panelInnerHtml('Komentar Customer · Semua Gerai');
    app.appendChild(section);
    bindPanel(section);

    let loaded = false;
    const maybeLoad = () => {
      const visible = !app.classList.contains('hidden');
      const token = sessionStorage.getItem('lekerOwnerToken') || '';
      if (visible && token && !loaded) {
        loaded = true;
        load(section);
      }
      if (!visible) loaded = false;
    };

    maybeLoad();
    new MutationObserver(maybeLoad).observe(app, { attributes: true, attributeFilter: ['class'] });
  }

  if (isBranch) initBranch();
  else initOwner();
})();
