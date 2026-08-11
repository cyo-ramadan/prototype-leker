(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const dateTime = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '-';

  function insertSalePayment() {
    if (el('salePaymentMethod')) return;
    const note = el('saleNote')?.closest('.field');
    if (!note) return;
    note.insertAdjacentHTML('afterend', '<div class="field"><label>Metode pembayaran</label><select id="salePaymentMethod" class="text-input"><option value="CASH">Tunai</option><option value="NON_CASH">Non Tunai</option></select></div>');
  }

  function enhanceDialog() {
    const title = el('cashierDialogTitle')?.textContent || '';
    const body = el('cashierDialogBody');
    if (!body) return;
    if (title === 'Buka Laci' && !el('dialogShiftLabel')) {
      body.insertAdjacentHTML('afterbegin', '<div class="field"><label>Shift <span class="muted">optional</span></label><input id="dialogShiftLabel" class="text-input" maxlength="60" placeholder="Contoh: S4" /></div>');
    }
    if (title === 'Tutup Laci' && !el('dialogClosingNote')) {
      body.insertAdjacentHTML('beforeend', '<div class="field"><label>Keterangan pulang <span class="muted">optional</span></label><textarea id="dialogClosingNote" rows="3" maxlength="500" placeholder="Catatan akhir shift"></textarea></div>');
    }
    if ((title === 'Beli Bahan' || title === 'Pengeluaran') && !el('dialogPaymentMethod')) {
      body.insertAdjacentHTML('beforeend', '<div class="field"><label>Metode pembayaran</label><select id="dialogPaymentMethod" class="text-input"><option value="CASH">Tunai</option><option value="NON_CASH">Non Tunai</option></select></div>');
    }
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function cashierEnhancedFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), location.origin);
    const method = String(init.method || request?.method || 'GET').toUpperCase();
    const supported = url.origin === location.origin && method === 'POST' && [
      '/api/cashier/sales',
      '/api/cashier/purchases',
      '/api/cashier/expenses',
      '/api/cashier/drawer/open',
      '/api/cashier/drawer/close'
    ].includes(url.pathname);
    if (!supported || request) return originalFetch(input, init);

    let body;
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { return originalFetch(input, init); }
    if (url.pathname === '/api/cashier/sales') body.paymentMethod = el('salePaymentMethod')?.value || 'CASH';
    if (url.pathname === '/api/cashier/purchases' || url.pathname === '/api/cashier/expenses') body.paymentMethod = el('dialogPaymentMethod')?.value || 'CASH';
    if (url.pathname === '/api/cashier/drawer/open') body.shiftLabel = el('dialogShiftLabel')?.value || '';
    if (url.pathname === '/api/cashier/drawer/close') body.closingNote = el('dialogClosingNote')?.value || '';
    return originalFetch(input, { ...init, body: JSON.stringify(body) });
  };

  function ensureHistoryUi() {
    insertSalePayment();
    const actions = document.querySelector('.drawer-actions');
    if (actions && !el('drawerHistoryBtn')) {
      const button = document.createElement('button');
      button.id = 'drawerHistoryBtn';
      button.className = 'drawer-action-btn';
      button.type = 'button';
      button.textContent = '📚 Detail Laci';
      button.addEventListener('click', openDrawerHistory);
      actions.appendChild(button);
    }
    if (!el('cashierDrawerHistoryDialog')) {
      document.body.insertAdjacentHTML('beforeend', `
        <dialog id="cashierDrawerHistoryDialog" class="cashier-dialog" style="max-width:min(1080px,96vw);width:96vw">
          <div class="cashier-dialog-head"><div><div class="muted">Gerai kasir</div><h2>Detail Laci</h2></div><button id="cashierDrawerHistoryClose" class="cart-close-btn" type="button">×</button></div>
          <div id="cashierDrawerHistoryList" class="drawer-history-grid"></div>
          <div id="cashierDrawerHistoryReport" class="drawer-report-panel hidden"></div>
        </dialog>`);
      el('cashierDrawerHistoryClose').onclick = () => el('cashierDrawerHistoryDialog').close();
    }
  }

  async function cashierRequest(path) {
    const token = sessionStorage.getItem('lekerCashierToken') || '';
    const response = await originalFetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  async function openDrawerHistory() {
    ensureHistoryUi();
    const dialog = el('cashierDrawerHistoryDialog');
    const list = el('cashierDrawerHistoryList');
    const report = el('cashierDrawerHistoryReport');
    report.classList.add('hidden');
    list.innerHTML = '<div class="muted">Memuat riwayat laci...</div>';
    if (!dialog.open) dialog.showModal();
    try {
      const payload = await cashierRequest('/api/cashier/drawers');
      const drawers = payload.drawers || [];
      list.innerHTML = drawers.length ? drawers.map(drawer => `
        <article class="drawer-history-row">
          <div><strong>${esc(drawer.cashierName)} · ${esc(drawer.status)}</strong><small>ID ${esc(drawer.id)}${drawer.shiftLabel ? ` · Shift ${esc(drawer.shiftLabel)}` : ''}</small><small>Datang ${dateTime(drawer.openedAt)} · Pulang ${dateTime(drawer.closedAt)}</small><small>Modal ${money(drawer.openingAmount)} · @${esc(drawer.cashierUsername)}</small></div>
          <div class="drawer-history-actions"><button class="mini-btn" type="button" data-cashier-drawer-detail="${esc(drawer.id)}">Lihat Detail</button></div>
        </article>`).join('') : '<div class="empty">Belum ada riwayat laci di gerai ini.</div>';
      document.querySelectorAll('[data-cashier-drawer-detail]').forEach(button => button.onclick = () => loadDrawerDetail(button.dataset.cashierDrawerDetail));
    } catch (error) {
      list.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
    }
  }

  async function loadDrawerDetail(id) {
    const panel = el('cashierDrawerHistoryReport');
    panel.classList.remove('hidden');
    panel.innerHTML = '<div class="muted">Memuat detail...</div>';
    try {
      const payload = await cashierRequest(`/api/cashier/drawers/${encodeURIComponent(id)}/details`);
      panel.innerHTML = window.MAXIDrawerReport?.render(payload.report) || '<div class="empty">Renderer detail laci belum tersedia.</div>';
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      panel.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
    }
  }

  const dialogBody = el('cashierDialogBody');
  if (dialogBody) new MutationObserver(enhanceDialog).observe(dialogBody, { childList: true, subtree: true });
  ensureHistoryUi();

  // Replace the old compact active-drawer summary with the canonical full drawer history/report.
  el('drawerDetailsBtn')?.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    openDrawerHistory();
  }, true);
})();
