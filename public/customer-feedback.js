(() => {
  const storeCode = String(window.LEKER_STORE_CODE || 'G001').toUpperCase();
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
  }[char]));

  let catalog = null;
  let selectedCategory = '';
  let rewardPoints = 500;

  const style = document.createElement('style');
  style.textContent = `
    .customer-feedback-trigger{position:fixed;left:18px;bottom:18px;z-index:42;border:0;border-radius:16px;padding:12px 16px;font:inherit;font-weight:800;cursor:pointer;box-shadow:0 12px 34px rgba(0,0,0,.18);background:#fff;color:#1f2937}
    .customer-feedback-trigger span{display:block;font-size:11px;font-weight:700;opacity:.68;margin-top:2px}
    .customer-feedback-backdrop{position:fixed;inset:0;z-index:80;background:rgba(15,23,42,.64);display:grid;place-items:center;padding:18px}
    .customer-feedback-backdrop.hidden{display:none}
    .customer-feedback-card{width:min(680px,100%);max-height:min(88vh,820px);overflow:auto;background:#fff;border-radius:22px;padding:20px;box-shadow:0 28px 80px rgba(0,0,0,.25)}
    .customer-feedback-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}
    .customer-feedback-head h2{margin:3px 0 0}
    .customer-feedback-close{border:0;background:#f1f5f9;border-radius:12px;width:38px;height:38px;font-size:24px;cursor:pointer}
    .customer-feedback-reward{padding:13px 15px;border-radius:16px;background:#fff7ed;border:1px solid #fed7aa;margin:12px 0;font-weight:800}
    .customer-feedback-privacy{padding:12px 14px;border-radius:14px;background:#f8fafc;color:#475569;font-size:13px;line-height:1.5;margin-bottom:14px}
    .customer-feedback-categories{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0 16px}
    .customer-feedback-category{border:1px solid #dbe2ea;background:#fff;border-radius:14px;padding:12px 8px;font:inherit;font-weight:800;cursor:pointer}
    .customer-feedback-category.active{border-color:#111827;background:#111827;color:#fff}
    .customer-feedback-issues{display:grid;gap:8px}
    .customer-feedback-issue{display:flex;align-items:flex-start;gap:10px;border:1px solid #e5e7eb;border-radius:14px;padding:11px 12px;cursor:pointer;background:#fff}
    .customer-feedback-issue input{margin-top:3px;flex:0 0 auto}
    .customer-feedback-note{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:14px;padding:12px;font:inherit;resize:vertical;min-height:88px}
    .customer-feedback-actions{display:flex;gap:10px;margin-top:14px}
    .customer-feedback-submit{flex:1;border:0;border-radius:14px;padding:13px 16px;background:#111827;color:#fff;font:inherit;font-weight:900;cursor:pointer}
    .customer-feedback-submit:disabled{opacity:.5;cursor:not-allowed}
    .customer-feedback-state{text-align:center;padding:18px 8px}
    .customer-feedback-state strong{display:block;font-size:20px;margin-bottom:8px}
    .customer-feedback-login{border:0;border-radius:14px;padding:12px 16px;background:#111827;color:#fff;font:inherit;font-weight:800;cursor:pointer;margin-top:10px}
    .customer-feedback-message{min-height:20px;margin-top:10px;color:#b91c1c;font-size:13px}
    @media(max-width:620px){
      .customer-feedback-trigger{left:12px;bottom:12px;padding:10px 13px;border-radius:14px}
      .customer-feedback-card{padding:16px;border-radius:18px}
      .customer-feedback-categories{grid-template-columns:1fr}
    }
  `;
  document.head.appendChild(style);

  const trigger = document.createElement('button');
  trigger.id = 'customerFeedbackTrigger';
  trigger.className = 'customer-feedback-trigger';
  trigger.type = 'button';
  trigger.innerHTML = '💬 Kotak Saran<span>+500 poin apresiasi</span>';
  document.body.appendChild(trigger);

  document.body.insertAdjacentHTML('beforeend', `
    <div id="customerFeedbackModal" class="customer-feedback-backdrop hidden" aria-hidden="true">
      <section class="customer-feedback-card" role="dialog" aria-modal="true" aria-labelledby="customerFeedbackTitle">
        <div class="customer-feedback-head">
          <div><div class="muted">MAXI Leker · ${escapeHtml(storeCode)}</div><h2 id="customerFeedbackTitle">Kotak Saran</h2></div>
          <button id="customerFeedbackClose" class="customer-feedback-close" type="button" aria-label="Tutup">×</button>
        </div>
        <div id="customerFeedbackBody"></div>
      </section>
    </div>
  `);

  function openModal() {
    el('customerFeedbackModal').classList.remove('hidden');
    el('customerFeedbackModal').setAttribute('aria-hidden', 'false');
    prepareFeedback();
  }

  function closeModal() {
    el('customerFeedbackModal').classList.add('hidden');
    el('customerFeedbackModal').setAttribute('aria-hidden', 'true');
  }

  async function api(path, options = {}) {
    const response = await fetch(path, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request gagal (${response.status})`);
      error.code = payload.code || '';
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function loadCatalog() {
    if (catalog) return catalog;
    const payload = await api('/api/customer/feedback/catalog', { cache: 'no-store' });
    catalog = payload.categories || [];
    rewardPoints = Number(payload.rewardPoints || rewardPoints);
    trigger.querySelector('span').textContent = `+${rewardPoints.toLocaleString('id-ID')} poin apresiasi`;
    return catalog;
  }

  function renderLoginRequired() {
    el('customerFeedbackBody').innerHTML = `
      <div class="customer-feedback-state">
        <strong>Login pelanggan dulu ya 👤</strong>
        <p class="muted">Kotak saran terhubung ke akun pelanggan supaya laporan aman dan bonus poin masuk ke akun yang benar.</p>
        <button id="customerFeedbackOpenLogin" class="customer-feedback-login" type="button">Buka Login</button>
      </div>
    `;
    el('customerFeedbackOpenLogin').onclick = () => {
      closeModal();
      el('entryLoginBtn')?.click();
    };
  }

  function renderUnavailable() {
    el('customerFeedbackBody').innerHTML = `
      <div class="customer-feedback-state">
        <strong>Kotak saran belum tersedia saat ini</strong>
        <p class="muted">Terima kasih sudah ikut menjaga kualitas. Silakan gunakan kembali saat fitur tersedia untuk akun ini.</p>
      </div>
    `;
  }

  function selectedConfig() {
    return (catalog || []).find(item => item.code === selectedCategory);
  }

  function syncSubmitState() {
    const button = el('customerFeedbackSubmit');
    if (!button) return;
    const hasIssue = Boolean(document.querySelector('[data-feedback-issue]:checked'));
    const hasNote = Boolean(el('customerFeedbackNote')?.value.trim());
    button.disabled = !selectedCategory || (!hasIssue && !hasNote);
  }

  function renderIssues() {
    const area = el('customerFeedbackIssues');
    if (!area) return;
    const config = selectedConfig();
    if (!config) {
      area.innerHTML = '<div class="muted">Pilih salah satu kategori di atas.</div>';
      syncSubmitState();
      return;
    }
    area.innerHTML = `
      <div class="muted" style="margin-bottom:8px">Centang semua yang sesuai:</div>
      <div class="customer-feedback-issues">
        ${(config.issues || []).map(issue => `
          <label class="customer-feedback-issue">
            <input type="checkbox" data-feedback-issue value="${escapeHtml(issue.code)}" />
            <span>${escapeHtml(issue.label)}</span>
          </label>
        `).join('')}
      </div>
    `;
    document.querySelectorAll('[data-feedback-issue]').forEach(input => {
      input.addEventListener('change', syncSubmitState);
    });
    syncSubmitState();
  }

  function renderForm() {
    selectedCategory = '';
    el('customerFeedbackBody').innerHTML = `
      <div class="customer-feedback-reward">🎁 Tips apresiasi Rp500 dikreditkan sebagai <b>+${rewardPoints.toLocaleString('id-ID')} poin</b> setelah laporan diterima.</div>
      <div class="customer-feedback-privacy">🔒 Privasi pelapor dijaga. Laporan masuk ke Admin/Owner untuk evaluasi mingguan dan identitas pelapor tidak dibagikan ke CS atau kasir melalui fitur ini.</div>
      <div class="muted">Pilih area yang ingin dievaluasi:</div>
      <div id="customerFeedbackCategories" class="customer-feedback-categories">
        ${(catalog || []).map(item => `<button class="customer-feedback-category" type="button" data-feedback-category="${escapeHtml(item.code)}">${escapeHtml(item.label)}</button>`).join('')}
      </div>
      <div id="customerFeedbackIssues"></div>
      <div style="margin-top:16px">
        <label for="customerFeedbackNote"><b>Saran lain</b> <span class="muted">(optional jika sudah centang)</span></label>
        <textarea id="customerFeedbackNote" class="customer-feedback-note" maxlength="1200" placeholder="Tulis detail yang belum terwakili dari pilihan di atas..."></textarea>
      </div>
      <div class="customer-feedback-actions">
        <button id="customerFeedbackSubmit" class="customer-feedback-submit" type="button" disabled>Laporkan</button>
      </div>
      <div id="customerFeedbackMessage" class="customer-feedback-message" aria-live="polite"></div>
    `;

    document.querySelectorAll('[data-feedback-category]').forEach(button => {
      button.onclick = () => {
        selectedCategory = button.dataset.feedbackCategory;
        document.querySelectorAll('[data-feedback-category]').forEach(item => item.classList.toggle('active', item === button));
        renderIssues();
      };
    });
    el('customerFeedbackNote').addEventListener('input', syncSubmitState);
    el('customerFeedbackSubmit').onclick = submitFeedback;
    renderIssues();
  }

  async function prepareFeedback() {
    el('customerFeedbackBody').innerHTML = '<div class="customer-feedback-state"><strong>Menyiapkan kotak saran...</strong></div>';
    try {
      await loadCatalog();
      if (!window.LEKER_CUSTOMER) return renderLoginRequired();
      const access = await api(`/api/customer/feedback/access?store=${encodeURIComponent(storeCode)}`, { cache: 'no-store' });
      if (!access.available) return renderUnavailable();
      rewardPoints = Number(access.rewardPoints || rewardPoints);
      renderForm();
    } catch (error) {
      if (error.code === 'CUSTOMER_LOGIN_REQUIRED' || error.status === 401) return renderLoginRequired();
      if (error.code === 'CUSTOMER_FEEDBACK_UNAVAILABLE') return renderUnavailable();
      el('customerFeedbackBody').innerHTML = `<div class="customer-feedback-state"><strong>Belum bisa membuka kotak saran</strong><p class="muted">${escapeHtml(error.message)}</p></div>`;
    }
  }

  async function refreshVisiblePoints() {
    try {
      const payload = await api('/api/customer/points', { cache: 'no-store' });
      const node = document.querySelector('.entry-points b');
      if (node) node.textContent = Number(payload.points || 0).toLocaleString('id-ID');
      return Number(payload.points || 0);
    } catch {
      return null;
    }
  }

  async function submitFeedback() {
    const button = el('customerFeedbackSubmit');
    const message = el('customerFeedbackMessage');
    const issues = [...document.querySelectorAll('[data-feedback-issue]:checked')].map(input => input.value);
    const manualNote = el('customerFeedbackNote').value.trim();
    button.disabled = true;
    button.textContent = 'Mengirim...';
    message.textContent = '';

    try {
      const payload = await api(`/api/customer/feedback?store=${encodeURIComponent(storeCode)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: selectedCategory, issues, manualNote })
      });
      const pointBalance = await refreshVisiblePoints();
      el('customerFeedbackBody').innerHTML = `
        <div class="customer-feedback-state">
          <strong>✅ Saran sudah masuk</strong>
          <p>Nomor laporan <b>${escapeHtml(payload.feedbackCode || '')}</b></p>
          <p class="muted">+${Number(payload.rewardPoints || rewardPoints).toLocaleString('id-ID')} poin sudah dikreditkan.${pointBalance === null ? '' : ` Total poin sekarang: ${pointBalance.toLocaleString('id-ID')}.`}</p>
          <p class="muted">Terima kasih. Laporan ini masuk bahan evaluasi manajemen.</p>
        </div>
      `;
    } catch (error) {
      if (error.code === 'CUSTOMER_FEEDBACK_UNAVAILABLE') return renderUnavailable();
      if (error.code === 'CUSTOMER_LOGIN_REQUIRED' || error.status === 401) return renderLoginRequired();
      message.textContent = error.message;
      button.disabled = false;
      button.textContent = 'Laporkan';
    }
  }

  trigger.addEventListener('click', openModal);
  el('customerFeedbackClose').addEventListener('click', closeModal);
  el('customerFeedbackModal').addEventListener('click', event => {
    if (event.target === el('customerFeedbackModal')) closeModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !el('customerFeedbackModal').classList.contains('hidden')) closeModal();
  });
})();
