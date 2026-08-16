(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 4 }).format(Number(value) || 0);
  const dateTime = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '-';
  const purchaseState = { products: [], rowSeq: 0 };

  function insertSalePayment() {
    if (el('salePaymentMethod')) return;
    const note = el('saleNote')?.closest('.field');
    if (!note) return;
    note.insertAdjacentHTML('afterend', '<div class="field"><label>Metode pembayaran</label><select id="salePaymentMethod" class="text-input"><option value="CASH">Tunai</option><option value="NON_CASH">Non Tunai</option></select></div>');
  }

  function purchaseProductOptions(selectedId = '') {
    return `<option value="" ${selectedId ? '' : 'selected'}>None</option>` + purchaseState.products.map(product => `<option value="${product.productId}" ${String(product.productId) === String(selectedId) ? 'selected' : ''}>${esc(product.productName)} · ${esc(product.unitSymbol || '-')}</option>`).join('');
  }

  function updatePurchaseRow(row) {
    const product = purchaseState.products.find(item => String(item.productId) === String(row.querySelector('[data-purchase-product]')?.value));
    const quantity = Math.max(0, Number(row.querySelector('[data-purchase-qty]')?.value || 0));
    const lineTotal = Math.max(0, Number(row.querySelector('[data-purchase-line-total]')?.value || 0));
    const unitCost = quantity > 0 ? lineTotal / quantity : 0;
    const info = row.querySelector('[data-purchase-cost-preview]');
    if (info) {
      info.textContent = product
        ? `Unit ${product.unitSymbol || '-'} · Harga/unit ${money(unitCost)} · Avg sekarang ${money(product.averageCost)} · Beli terakhir ${money(product.lastPurchasePrice)}`
        : 'Pilih barang.';
    }
    updatePurchaseTotal();
  }

  function updatePurchaseTotal() {
    const rows = [...document.querySelectorAll('[data-purchase-row]')];
    const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.querySelector('[data-purchase-line-total]')?.value || 0)), 0);
    if (el('purchaseItemsTotal')) el('purchaseItemsTotal').textContent = money(total);
  }

  function addPurchaseRow(productId = '') {
    const target = el('purchaseItemsRows');
    if (!target) return;
    const id = ++purchaseState.rowSeq;
    const selected = productId || '';
    const product = purchaseState.products.find(item => String(item.productId) === String(selected));
    const suggested = Math.max(0, Math.round(Number(product?.lastPurchasePrice || 0)));
    target.insertAdjacentHTML('beforeend', `
      <div data-purchase-row="${id}" class="purchase-item-row">
        <div class="purchase-item-heading"><strong>Barang ${id}</strong><button data-remove-purchase-row="${id}" class="mini-btn danger purchase-item-remove" type="button" aria-label="Hapus barang ${id}">×</button></div>
        <div class="field purchase-item-product"><label>Cari barang</label><select data-purchase-product class="text-input">${purchaseProductOptions(selected)}</select></div>
        <div class="field purchase-item-quantity"><label>Qty</label><input data-purchase-qty class="text-input" type="number" min="1" step="1" value="1" required /></div>
        <div class="field purchase-item-total"><label>Total baris</label><input data-purchase-line-total class="text-input" type="number" min="1" step="1" value="${suggested || ''}" required /></div>
        <div data-purchase-cost-preview class="muted purchase-item-preview"></div>
      </div>`);
    const row = target.querySelector(`[data-purchase-row="${id}"]`);
    row.querySelector('[data-purchase-product]')?.addEventListener('change', () => {
      const next = purchaseState.products.find(item => String(item.productId) === String(row.querySelector('[data-purchase-product]').value));
      const qty = Math.max(1, Number(row.querySelector('[data-purchase-qty]').value || 1));
      if (next?.lastPurchasePrice > 0) row.querySelector('[data-purchase-line-total]').value = String(Math.round(next.lastPurchasePrice * qty));
      updatePurchaseRow(row);
    });
    row.querySelector('[data-purchase-qty]')?.addEventListener('input', () => updatePurchaseRow(row));
    row.querySelector('[data-purchase-line-total]')?.addEventListener('input', () => updatePurchaseRow(row));
    row.querySelector('[data-remove-purchase-row]')?.addEventListener('click', () => {
      row.remove();
      if (!target.children.length) addPurchaseRow();
      updatePurchaseTotal();
    });
    updatePurchaseRow(row);
  }

  async function preparePurchaseItemsEditor() {
    if (!el('purchaseItemsEditor') || el('purchaseItemsEditor')?.dataset.loaded === '1') return;
    const editor = el('purchaseItemsEditor');
    editor.dataset.loaded = 'loading';
    try {
      const payload = await cashierRequest('/api/cashier/purchases/options');
      purchaseState.products = payload.products || [];
      editor.dataset.loaded = '1';
      const rows = el('purchaseItemsRows');
      rows.innerHTML = '';
      if (!purchaseState.products.length) {
        rows.innerHTML = '<div class="muted">Belum ada barang aktif yang bisa dibeli dan ditrack stoknya. Cek Master Barang/Tipe Barang.</div>';
        el('addPurchaseItemRow').disabled = true;
        return;
      }
      el('addPurchaseItemRow').disabled = false;
      for (let index = 0; index < 5; index += 1) addPurchaseRow();
    } catch (error) {
      editor.dataset.loaded = '';
      el('purchaseItemsRows').innerHTML = `<div class="muted">${esc(error.message)}</div>`;
    }
  }

  function purchaseItemsPayload() {
    return [...document.querySelectorAll('[data-purchase-row]')].map(row => ({
      productId: Number(row.querySelector('[data-purchase-product]')?.value),
      quantity: Number(row.querySelector('[data-purchase-qty]')?.value),
      lineTotal: Number(row.querySelector('[data-purchase-line-total]')?.value)
    }));
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
    if (title === 'Beli Bahan') {
      if (!el('purchaseItemsEditor')) {
        const descriptionField = el('dialogPurchaseDescription')?.closest('.field');
        const amountField = el('dialogPurchaseAmount')?.closest('.field');
        if (descriptionField) descriptionField.style.display = 'none';
        if (amountField) amountField.style.display = 'none';
        if (el('dialogPurchaseDescription')) el('dialogPurchaseDescription').required = false;
        if (el('dialogPurchaseAmount')) el('dialogPurchaseAmount').required = false;
        [
          el('dialogPurchaseProduct')?.closest('.field'),
          el('dialogPurchaseQty')?.closest('.field'),
          el('dialogPurchaseLineTotal')?.closest('.field'),
          el('dialogPurchaseAddLine'), el('dialogPurchaseLines'), el('dialogPurchaseGrandTotal')
        ].filter(Boolean).forEach(node => { node.style.display = 'none'; });
        const noteField = el('dialogPurchaseNote')?.closest('.field');
        const markup = `
          <div id="purchaseItemsEditor" class="field">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><label>Barang Pembelian</label><button id="addPurchaseItemRow" class="mini-btn" type="button">+ Barang</button></div>
            <div id="purchaseItemsRows"></div>
            <div style="display:flex;justify-content:space-between;margin-top:10px;font-weight:900"><span>Total Pembelian</span><span id="purchaseItemsTotal">${money(0)}</span></div>
            <p class="muted">Qty memakai satuan dasar terkecil dan wajib bulat. Average Cost/HPP serta Harga Beli Terakhir di Master Barang diupdate otomatis saat transaksi tersimpan.</p>
          </div>`;
        if (noteField) noteField.insertAdjacentHTML('beforebegin', markup);
        else body.insertAdjacentHTML('beforeend', markup);
        el('addPurchaseItemRow')?.addEventListener('click', () => addPurchaseRow());
      }
      if (!el('dialogPurchasePayment') && !el('dialogPaymentMethod')) {
        body.insertAdjacentHTML('beforeend', `
          <div class="field"><label>Cara bayar</label><select id="dialogPaymentMethod" class="text-input">
            <option value="CASH">Cash / Kas</option>
            <option value="BANK">Bank / Transfer</option>
            <option value="PAYABLE">Hutang / Utang Usaha</option>
          </select></div>
          <p class="muted">Cara bayar dipakai untuk Accounting mapping. Cash mengurangi ekspektasi kas laci; Bank/Hutang tidak.</p>`);
        if (el('cashierDialogEyebrow')) el('cashierDialogEyebrow').textContent = 'Pembelian · Stock + Cost Fact';
      }
      preparePurchaseItemsEditor();
    }
    if (title === 'Pengeluaran' && !el('dialogPaymentMethod')) {
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
    if (url.pathname === '/api/cashier/purchases') {
      body.paymentMethod = el('dialogPurchasePayment')?.value || el('dialogPaymentMethod')?.value || 'CASH';
      body.items = purchaseItemsPayload().filter(item => item.productId > 0);
      body.description = '';
      body.totalAmount = body.items.reduce((sum, item) => sum + (Number(item.lineTotal) || 0), 0);
    }
    if (url.pathname === '/api/cashier/expenses') body.paymentMethod = el('dialogPaymentMethod')?.value || 'CASH';
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

  el('drawerDetailsBtn')?.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    openDrawerHistory();
  }, true);
})();
