(() => {
  const state = {
    tab: 'transactions',
    filter: 'ALL',
    transactions: [],
    txCursor: null,
    txHasMore: false,
    stocks: [],
    selectedProductId: null,
    movements: [],
    stockCursor: null,
    stockHasMore: false
  };

  const FILTERS = [
    ['ALL', 'Semua'], ['SALES', 'Penjualan'], ['PURCHASES', 'Pembelian'],
    ['OPERATIONS', 'Operasional'], ['INVENTORY', 'Mutasi Barang'], ['ASSETS', 'Aset']
  ];
  const KIND_LABEL = {
    SALE: 'Penjualan', PURCHASE: 'Pembelian', EXPENSE: 'Pengeluaran', OTHER_INCOME: 'Pendapatan Lain',
    CASH_FLOW: 'Arus Kas', GOODS_FLOW: 'Arus Barang', ASSET: 'Aset', PRODUCTION: 'Produksi'
  };
  const MOVEMENT_SOURCE_LABEL = {
    SALE: 'Penjualan', GOODS_FLOW: 'Arus Barang', PRODUCTION_INPUT: 'Produksi · bahan keluar',
    PRODUCTION_OUTPUT: 'Produksi · hasil masuk', STOCK_ADJUSTMENT: 'Penyesuaian stok', PURCHASE: 'Pembelian'
  };

  function ensureDialog() {
    if (el('cashierDataDialog')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="cashierDataDialog" class="cashier-dialog" style="max-width:min(1080px,96vw);width:96vw">
        <div class="cashier-dialog-head">
          <div><div class="muted">Data gerai · read-only</div><h2>Data Transaksi &amp; Stok</h2></div>
          <button id="cashierDataClose" class="cart-close-btn" type="button">×</button>
        </div>
        <div class="cashier-data-tabs" style="display:flex;gap:8px;margin:10px 0">
          <button id="cashierDataTabTransactions" class="mini-btn" type="button">Transaksi</button>
          <button id="cashierDataTabStock" class="mini-btn" type="button">Stok</button>
        </div>
        <div id="cashierDataTransactions"></div>
        <div id="cashierDataStock" class="hidden"></div>
      </dialog>`);
    el('cashierDataClose').onclick = () => el('cashierDataDialog').close();
  }

  function activateTab(tab) {
    state.tab = tab;
    el('cashierDataTabTransactions').classList.toggle('active', tab === 'transactions');
    el('cashierDataTabStock').classList.toggle('active', tab === 'stock');
    el('cashierDataTransactions').classList.toggle('hidden', tab !== 'transactions');
    el('cashierDataStock').classList.toggle('hidden', tab !== 'stock');
    if (tab === 'transactions') loadTransactions({ reset: true });
    else loadStocks();
  }

  async function openDataExplorer() {
    ensureDialog();
    el('cashierDataTabTransactions').onclick = () => activateTab('transactions');
    el('cashierDataTabStock').onclick = () => activateTab('stock');
    el('cashierDataDialog').showModal();
    activateTab(state.tab);
  }

  function transactionKindLabel(kind) { return KIND_LABEL[kind] || kind; }

  function renderFilters() {
    return `<div class="field" style="margin-bottom:10px"><label>Filter</label><select id="cashierDataFilter" class="text-input">${FILTERS.map(([value, label]) => `<option value="${value}" ${value === state.filter ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></div>`;
  }

  function renderTransactionRows() {
    if (!state.transactions.length) return '<div class="empty">Belum ada transaksi.</div>';
    return state.transactions.map(row => `
      <div class="master-row">
        <div class="master-main">
          <strong>${escapeHtml(transactionKindLabel(row.kind))} · ${row.amount == null ? '-' : rupiah(row.amount)}</strong>
          <div class="master-meta">${escapeHtml(row.description || '')}</div>
          <small>${formatDateTime(row.occurredAt)} · ${escapeHtml(row.status || '')}${row.cashierName ? ` · ${escapeHtml(row.cashierName)}` : ''}</small>
        </div>
      </div>`).join('');
  }

  async function loadTransactions({ reset }) {
    const host = el('cashierDataTransactions');
    if (reset) {
      state.transactions = [];
      state.txCursor = null;
      host.innerHTML = `${renderFilters()}<div class="muted">Memuat transaksi...</div>`;
      el('cashierDataFilter').value = state.filter;
      el('cashierDataFilter').addEventListener('change', event => {
        state.filter = event.target.value;
        loadTransactions({ reset: true });
      });
    }
    try {
      const url = new URL('/api/cashier/data/transactions', location.origin);
      url.searchParams.set('filter', state.filter);
      url.searchParams.set('limit', '50');
      if (!reset && state.txCursor) url.searchParams.set('before', state.txCursor);
      const payload = await api(`${url.pathname}${url.search}`);
      state.transactions = reset ? (payload.transactions || []) : [...state.transactions, ...(payload.transactions || [])];
      state.txCursor = payload.nextCursor || null;
      state.txHasMore = Boolean(payload.nextCursor);
      renderTransactionsPanel();
    } catch (error) {
      if (reset) host.innerHTML = `${renderFilters()}<div class="empty">${escapeHtml(error.message)}</div>`;
      else toast(error.message);
    }
  }

  function renderTransactionsPanel() {
    const host = el('cashierDataTransactions');
    host.innerHTML = `${renderFilters()}<div class="master-list">${renderTransactionRows()}</div><div style="display:flex;justify-content:center;margin-top:10px"><button id="cashierDataTxMore" class="secondary-btn ${state.txHasMore ? '' : 'hidden'}" type="button">Muat lagi</button></div>`;
    el('cashierDataFilter').value = state.filter;
    el('cashierDataFilter').addEventListener('change', event => {
      state.filter = event.target.value;
      loadTransactions({ reset: true });
    });
    el('cashierDataTxMore')?.addEventListener('click', () => loadTransactions({ reset: false }));
  }

  async function loadStocks() {
    const host = el('cashierDataStock');
    host.innerHTML = '<div class="muted">Memuat saldo stok...</div>';
    try {
      const payload = await api('/api/cashier/data/stock');
      state.stocks = payload.stocks || [];
      renderStockList();
    } catch (error) {
      host.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  }

  function renderStockList() {
    const host = el('cashierDataStock');
    host.innerHTML = `
      <label class="admin-field" style="margin-bottom:10px">Cari barang<input id="cashierDataStockSearch" class="text-input" type="search" placeholder="Nama barang" /></label>
      <div id="cashierDataStockList" class="master-list"></div>
      <div id="cashierDataStockDetail" class="hidden" style="margin-top:14px"></div>`;
    renderStockRows();
    el('cashierDataStockSearch').addEventListener('input', renderStockRows);
  }

  function renderStockRows() {
    const list = el('cashierDataStockList');
    if (!list) return;
    const query = String(el('cashierDataStockSearch')?.value || '').trim().toLocaleLowerCase('id-ID');
    const visible = state.stocks.filter(item => !query || (item.productName || '').toLocaleLowerCase('id-ID').includes(query));
    list.innerHTML = visible.length ? visible.map(item => {
      const qty = item.quantity == null ? 'Belum diinisialisasi' : `${item.quantity} ${escapeHtml(item.unitSymbol || '')}`;
      return `<article class="master-row" style="align-items:center">
        <div class="master-main">
          <strong>${escapeHtml(item.productName)}</strong>
          <div class="master-meta">${escapeHtml(item.itemTypeName || 'Tanpa tipe')}</div>
          <div class="master-prices"><span>Saldo</span><span><b>${qty}</b></span></div>
        </div>
        <div class="master-actions"><button class="mini-btn" type="button" data-cashier-stock-detail="${item.productId}">Lihat Mutasi</button></div>
      </article>`;
    }).join('') : '<div class="empty">Barang tidak ditemukan.</div>';
    list.querySelectorAll('[data-cashier-stock-detail]').forEach(button => button.addEventListener('click', () => loadMovements(Number(button.dataset.cashierStockDetail), { reset: true })));
  }

  async function loadMovements(productId, { reset }) {
    const detail = el('cashierDataStockDetail');
    if (reset) {
      state.selectedProductId = productId;
      state.movements = [];
      state.stockCursor = null;
      detail.classList.remove('hidden');
      detail.innerHTML = '<div class="muted">Memuat mutasi stok...</div>';
    }
    try {
      const url = new URL(`/api/cashier/data/stock/${productId}/movements`, location.origin);
      url.searchParams.set('limit', '50');
      if (!reset && state.stockCursor) url.searchParams.set('before', state.stockCursor);
      const payload = await api(`${url.pathname}${url.search}`);
      state.movements = reset ? (payload.movements || []) : [...state.movements, ...(payload.movements || [])];
      state.stockCursor = payload.nextCursor || null;
      state.stockHasMore = Boolean(payload.nextCursor);
      renderMovementsDetail(payload.product);
    } catch (error) {
      if (reset) detail.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
      else toast(error.message);
    }
  }

  function renderMovementsDetail(product) {
    const detail = el('cashierDataStockDetail');
    const qty = product.quantity == null ? 'Belum diinisialisasi' : `${product.quantity} ${escapeHtml(product.unitSymbol || '')}`;
    detail.innerHTML = `
      <div class="list-head"><div><h3>${escapeHtml(product.productName)}</h3><div class="muted">Saldo saat ini: <b>${qty}</b></div></div><button id="cashierDataStockCloseDetail" class="mini-btn" type="button">Tutup</button></div>
      <div class="master-list" style="margin-top:10px">${state.movements.length ? state.movements.map(row => `
        <div class="master-row">
          <div class="master-main">
            <strong>${row.direction === 'IN' ? '＋' : '−'} ${row.quantity} ${escapeHtml(product.unitSymbol || '')} · ${escapeHtml(MOVEMENT_SOURCE_LABEL[row.sourceType] || row.sourceType)}</strong>
            <div class="master-meta">${formatDateTime(row.occurredAt)}</div>
          </div>
        </div>`).join('') : '<div class="empty">Belum ada mutasi stok tercatat.</div>'}</div>
      <div style="display:flex;justify-content:center;margin-top:10px"><button id="cashierDataStockMore" class="secondary-btn ${state.stockHasMore ? '' : 'hidden'}" type="button">Muat lagi</button></div>`;
    el('cashierDataStockCloseDetail')?.addEventListener('click', () => detail.classList.add('hidden'));
    el('cashierDataStockMore')?.addEventListener('click', () => loadMovements(product.productId, { reset: false }));
  }

  el('drawerDetailsBtn')?.addEventListener('click', openDataExplorer);
})();
