(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 4 }).format(Number(value) || 0);
  const dateTime = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '-';
  const purchaseState = { products: [], rowSeq: 0, selectedProductId: null };

  function insertSalePayment() {
    if (el('salePaymentMethod')) return;
    const note = el('saleNote')?.closest('.field');
    if (!note) return;
    note.insertAdjacentHTML('afterend', '<div class="field"><label>Metode pembayaran</label><select id="salePaymentMethod" class="text-input"><option value="CASH">Tunai</option><option value="NON_CASH">Non Tunai</option></select></div>');
  }

  function purchaseProductLabel(product) {
    return `${product.productName} · ${product.unitSymbol || '-'}`;
  }

  function updatePurchaseRow(row) {
    const quantity = Math.max(0, Number(row.querySelector('[data-purchase-qty]')?.value || 0));
    const unitPrice = Math.max(0, Number(row.dataset.purchaseUnitPrice || 0));
    const lineTotal = Math.round(quantity * unitPrice);
    const lineTotalInput = row.querySelector('[data-purchase-line-total]');
    const lineTotalLabel = row.querySelector('[data-purchase-line-total-label]');
    if (lineTotalInput) lineTotalInput.value = String(lineTotal);
    if (lineTotalLabel) lineTotalLabel.textContent = money(lineTotal);
    updatePurchaseTotal();
  }

  function updatePurchaseTotal() {
    const rows = [...document.querySelectorAll('[data-purchase-row]')];
    const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.querySelector('[data-purchase-line-total]')?.value || 0)), 0);
    if (el('purchaseItemsTotal')) el('purchaseItemsTotal').textContent = money(total);
  }

  function renderPurchaseSearchResults(query = '') {
    const host = el('purchaseProductResults');
    if (!host) return;
    const keyword = query.trim().toLocaleLowerCase('id-ID');
    const matches = purchaseState.products
      .filter(product => !keyword || purchaseProductLabel(product).toLocaleLowerCase('id-ID').includes(keyword))
      .slice(0, 8);
    host.innerHTML = matches.length
      ? matches.map(product => `<button type="button" data-purchase-search-result="${product.productId}"><strong>${esc(product.productName)}</strong><span>${esc(product.unitSymbol || '-')} · harga terakhir ${money(product.lastPurchasePrice)}</span></button>`).join('')
      : '<div class="purchase-search-empty">Barang tidak ditemukan.</div>';
    host.classList.remove('hidden');
  }

  function selectPurchaseProduct(productId) {
    const product = purchaseState.products.find(item => String(item.productId) === String(productId));
    if (!product) return;
    purchaseState.selectedProductId = Number(product.productId);
    el('purchaseProductSearch').value = purchaseProductLabel(product);
    el('purchaseComposerUnitPrice').value = String(Math.max(0, Math.round(Number(product.lastPurchasePrice || 0))) || '');
    el('purchaseComposerUnit').textContent = `Satuan ${product.unitSymbol || '-'} · Harga beli terakhir otomatis ${money(product.lastPurchasePrice)} · masih bisa diedit`;
    el('purchaseProductResults')?.classList.add('hidden');
  }

  function resetPurchaseComposer() {
    purchaseState.selectedProductId = null;
    if (el('purchaseProductSearch')) el('purchaseProductSearch').value = '';
    if (el('purchaseComposerQty')) el('purchaseComposerQty').value = '1';
    if (el('purchaseComposerUnitPrice')) el('purchaseComposerUnitPrice').value = '';
    if (el('purchaseComposerUnit')) el('purchaseComposerUnit').textContent = 'Pilih barang untuk melihat satuan dan harga terakhir.';
    el('purchaseProductResults')?.classList.add('hidden');
    el('purchaseProductSearch')?.focus();
  }

  function addPurchaseRow() {
    const target = el('purchaseItemsRows');
    if (!target) return;
    const product = purchaseState.products.find(item => Number(item.productId) === purchaseState.selectedProductId);
    const quantity = Number(el('purchaseComposerQty')?.value);
    const unitPrice = Number(el('purchaseComposerUnitPrice')?.value);
    if (!product) return toast('Pilih barang dari hasil pencarian Master Barang.');
    if (!Number.isInteger(quantity) || quantity <= 0) return toast('Qty wajib bilangan bulat lebih dari 0.');
    if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0) return toast('Harga beli satuan wajib lebih dari 0.');
    if (target.querySelector(`[data-purchase-product-id="${product.productId}"]`)) return toast('Barang sudah ada di detail. Ubah Qty pada baris tersebut.');
    const id = ++purchaseState.rowSeq;
    const lineTotal = Math.round(quantity * unitPrice);
    target.insertAdjacentHTML('afterbegin', `
      <div data-purchase-row="${id}" data-purchase-product-id="${product.productId}" data-purchase-unit-price="${unitPrice}" class="purchase-detail-row">
        <input data-purchase-product type="hidden" value="${product.productId}" />
        <input data-purchase-line-total type="hidden" value="${lineTotal}" />
        <div class="purchase-detail-product"><strong>${esc(product.productName)}</strong><span>${money(unitPrice)} / ${esc(product.unitSymbol || 'unit')}</span></div>
        <div class="field purchase-detail-quantity"><label>Qty</label><input data-purchase-qty class="text-input" type="number" min="1" step="1" value="${quantity}" required /></div>
        <div class="purchase-detail-total"><strong data-purchase-line-total-label>${money(lineTotal)}</strong><button data-remove-purchase-row="${id}" class="text-btn purchase-detail-remove" type="button">Hapus</button></div>
      </div>`);
    const row = target.querySelector(`[data-purchase-row="${id}"]`);
    row.querySelector('[data-purchase-qty]')?.addEventListener('input', () => updatePurchaseRow(row));
    row.querySelector('[data-remove-purchase-row]')?.addEventListener('click', () => {
      row.remove();
      updatePurchaseTotal();
    });
    resetPurchaseComposer();
    updatePurchaseTotal();
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
        el('purchaseComposerEmpty').textContent = 'Belum ada barang aktif yang bisa dibeli dan ditrack stoknya. Cek Master Barang/Tipe Barang.';
        el('addPurchaseItemRow').disabled = true;
        return;
      }
      el('addPurchaseItemRow').disabled = false;
    } catch (error) {
      editor.dataset.loaded = '';
      el('purchaseComposerEmpty').textContent = error.message;
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
          <div id="purchaseItemsEditor" class="purchase-editor">
            <div class="purchase-composer">
              <div class="field purchase-composer-product"><label>Barang</label><input id="purchaseProductSearch" class="text-input" autocomplete="off" placeholder="Cari barang dari Master Barang" /><div id="purchaseProductResults" class="purchase-search-results hidden"></div></div>
              <div class="field purchase-composer-qty"><label>Qty</label><input id="purchaseComposerQty" class="text-input" type="number" min="1" step="1" value="1" /></div>
              <div class="field purchase-composer-price"><label>Harga beli / unit</label><input id="purchaseComposerUnitPrice" class="text-input" type="number" min="1" step="1" placeholder="Terisi otomatis" /></div>
              <div id="purchaseComposerUnit" class="muted purchase-composer-hint">Pilih barang untuk melihat satuan dan harga terakhir.</div>
              <button id="addPurchaseItemRow" class="secondary-btn purchase-composer-add" type="button">+ Tambah Barang</button>
              <div id="purchaseComposerEmpty" class="muted"></div>
            </div>
            <div class="purchase-detail-head"><strong>Detail Pembelian</strong><span>Item yang akan disimpan</span></div>
            <div id="purchaseItemsRows" class="purchase-detail-list"></div>
            <div class="purchase-detail-subtotal"><span>Subtotal Barang</span><strong id="purchaseItemsTotal">${money(0)}</strong></div>
            <p class="muted">Qty memakai satuan dasar terkecil dan wajib bulat. Average Cost/HPP serta Harga Beli Terakhir di Master Barang diupdate otomatis saat transaksi tersimpan.</p>
          </div>`;
        if (noteField) noteField.insertAdjacentHTML('beforebegin', markup);
        else body.insertAdjacentHTML('beforeend', markup);
        el('purchaseProductSearch')?.addEventListener('focus', () => renderPurchaseSearchResults(el('purchaseProductSearch').value));
        el('purchaseProductSearch')?.addEventListener('input', () => {
          purchaseState.selectedProductId = null;
          el('purchaseComposerUnitPrice').value = '';
          renderPurchaseSearchResults(el('purchaseProductSearch').value);
        });
        el('purchaseProductResults')?.addEventListener('click', event => {
          const button = event.target.closest('[data-purchase-search-result]');
          if (button) selectPurchaseProduct(button.dataset.purchaseSearchResult);
        });
        el('addPurchaseItemRow')?.addEventListener('click', addPurchaseRow);
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
