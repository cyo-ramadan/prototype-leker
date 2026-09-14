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
      <dialog id="cashierDataDialog" class="cashier-dialog cashier-dialog-plain" style="max-width:min(1080px,96vw);width:96vw">
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

  function transactionKindLabel(row) {
    if (row.kind === 'GOODS_FLOW' && row.operationalPayload?.purpose === 'STOCK_ADJUSTMENT') return 'Penyesuaian Stok';
    return KIND_LABEL[row.kind] || row.kind;
  }

  function renderFilters() {
    return `<div class="field" style="margin-bottom:10px"><label>Filter</label><select id="cashierDataFilter" class="text-input">${FILTERS.map(([value, label]) => `<option value="${value}" ${value === state.filter ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></div>`;
  }

  function renderTransactionRows() {
    if (!state.transactions.length) return '<div class="empty">Belum ada transaksi.</div>';
    return state.transactions.map(row => `
      <div class="master-row" style="align-items:flex-start">
        <div class="master-main">
          <strong>${escapeHtml(transactionKindLabel(row))} · ${row.amount == null ? '-' : rupiah(row.amount)}</strong>
          <div class="master-meta">${escapeHtml(row.description || '')}</div>
          <div class="master-meta">ID ${escapeHtml(String(row.id))}</div>
          <small>${formatDateTime(row.occurredAt)} · ${escapeHtml(row.status || '')}${row.cashierName ? ` · ${escapeHtml(row.cashierName)}` : ''}</small>
        </div>
        <div class="master-actions"><button class="mini-btn" type="button" data-cashier-tx-detail-kind="${escapeHtml(row.kind)}" data-cashier-tx-detail-id="${escapeHtml(String(row.id))}">Detail</button></div>
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
    host.innerHTML = `${renderFilters()}<div class="master-list">${renderTransactionRows()}</div><div style="display:flex;justify-content:center;margin-top:10px"><button id="cashierDataTxMore" class="secondary-btn ${state.txHasMore ? '' : 'hidden'}" type="button">Muat lagi</button></div><div id="cashierDataTxDetail" class="hidden" style="margin-top:14px"></div>`;
    el('cashierDataFilter').value = state.filter;
    el('cashierDataFilter').addEventListener('change', event => {
      state.filter = event.target.value;
      loadTransactions({ reset: true });
    });
    el('cashierDataTxMore')?.addEventListener('click', () => loadTransactions({ reset: false }));
    host.querySelectorAll('[data-cashier-tx-detail-id]').forEach(button => button.addEventListener('click', () =>
      openTransactionDetail(button.dataset.cashierTxDetailKind, button.dataset.cashierTxDetailId)));
  }

  function approvalStatusLabel(detail) {
    if (detail.approvalStatus === 'rejected') return `Ditolak${detail.decisionNote ? ` · ${detail.decisionNote}` : ''}`;
    if (detail.approvalStatus === 'approved' && detail.postingStatus === 'posted') return 'Disetujui & diposting';
    if (detail.approvalStatus === 'pending_approval') return 'Menunggu persetujuan';
    return `${detail.approvalStatus || '-'} / ${detail.postingStatus || '-'}`;
  }

  function renderSaleDetailBody(detail) {
    const items = detail.items || [];
    return `
      <div class="admin-tip"><b>Customer</b><div>${escapeHtml(detail.customerName || 'Walk-in')}</div></div>
      <div class="master-list" style="margin-top:10px">${items.length ? items.map(item => `
        <div class="master-row"><div class="master-main">
          <strong>${item.quantity}× ${escapeHtml(item.productName)} · ${rupiah(item.lineTotal)}</strong>
          <div class="master-meta">Harga satuan ${rupiah(item.unitPrice)}</div>
        </div></div>`).join('') : '<div class="empty">Tidak ada item.</div>'}</div>
      <div class="admin-tip" style="margin-top:10px"><b>Total</b><div>${rupiah(detail.total)}</div></div>
      <div class="admin-tip"><b>Metode Bayar</b><div>${escapeHtml(detail.paymentMethod || '-')}</div></div>
      ${detail.note ? `<div class="admin-tip"><b>Catatan</b><div>${escapeHtml(detail.note)}</div></div>` : ''}
      <div class="admin-tip"><b>Kasir</b><div>${escapeHtml(detail.cashierName || '-')}</div></div>`;
  }

  function renderSimpleDetailBody(detail) {
    return `
      <div class="admin-tip"><b>Deskripsi</b><div>${escapeHtml(detail.description || '-')}</div></div>
      <div class="admin-tip"><b>Nominal</b><div>${rupiah(detail.amount)}</div></div>
      ${detail.supplierName ? `<div class="admin-tip"><b>Supplier</b><div>${escapeHtml(detail.supplierName)}</div></div>` : ''}
      ${detail.quantity ? `<div class="admin-tip"><b>Qty</b><div>${escapeHtml(detail.quantity)}</div></div>` : ''}
      <div class="admin-tip"><b>Metode Bayar</b><div>${escapeHtml(detail.paymentMethod || '-')}</div></div>
      ${detail.note ? `<div class="admin-tip"><b>Catatan</b><div>${escapeHtml(detail.note)}</div></div>` : ''}
      <div class="admin-tip"><b>Kasir</b><div>${escapeHtml(detail.cashierName || '-')}</div></div>`;
  }

  function renderApprovalDetailBody(kind, detail) {
    const payload = detail.payload || {};
    let fields;
    if (kind === 'GOODS_FLOW' && payload.purpose === 'STOCK_ADJUSTMENT') {
      fields = `
        <div class="admin-tip"><b>Barang</b><div>${escapeHtml(payload.productName || '-')}</div></div>
        <div class="admin-tip"><b>Noted &rarr; Real</b><div>${payload.currentQuantitySnapshot} &rarr; ${payload.targetQuantity} ${escapeHtml(payload.unitSymbol || '')}</div></div>
        <div class="admin-tip"><b>Perubahan</b><div>${payload.direction === 'IN' ? 'Tambah' : 'Kurang'} ${payload.quantity} ${escapeHtml(payload.unitSymbol || '')}</div></div>
        ${payload.reason ? `<div class="admin-tip"><b>Alasan</b><div>${escapeHtml(payload.reason)}</div></div>` : ''}`;
    } else if (kind === 'GOODS_FLOW') {
      fields = `
        <div class="admin-tip"><b>Barang</b><div>${escapeHtml(payload.productName || '-')}</div></div>
        <div class="admin-tip"><b>Arah</b><div>${payload.direction === 'IN' ? 'Masuk' : 'Keluar'} ${payload.quantity} ${escapeHtml(payload.unitSymbol || '')}</div></div>`;
    } else {
      fields = `
        <div class="admin-tip"><b>Deskripsi</b><div>${escapeHtml(payload.description || '-')}</div></div>
        <div class="admin-tip"><b>Nominal</b><div>${rupiah(payload.amount)}</div></div>`;
    }
    return `
      ${fields}
      ${payload.note ? `<div class="admin-tip"><b>Catatan</b><div>${escapeHtml(payload.note)}</div></div>` : ''}
      <div class="admin-tip"><b>Status</b><div>${escapeHtml(approvalStatusLabel(detail))}</div></div>
      <div class="admin-tip"><b>Kasir</b><div>${escapeHtml(detail.cashierName || '-')}</div></div>`;
  }

  function renderDetailBody(kind, detail) {
    if (kind === 'SALE') return renderSaleDetailBody(detail);
    if (['PURCHASE', 'EXPENSE', 'OTHER_INCOME'].includes(kind)) return renderSimpleDetailBody(detail);
    if (['CASH_FLOW', 'GOODS_FLOW', 'ASSET'].includes(kind)) return renderApprovalDetailBody(kind, detail);
    return '<div class="empty">Detail tidak tersedia untuk jenis transaksi ini.</div>';
  }

  function renderTransactionDetail(kind, detail) {
    const box = el('cashierDataTxDetail');
    if (!box) return;
    const row = { kind, operationalPayload: detail.payload };
    box.innerHTML = `
      <div class="list-head"><div><h3>${escapeHtml(transactionKindLabel(row))}</h3><div class="muted">ID ${escapeHtml(String(detail.id))} · ${formatDateTime(detail.occurredAt)}</div></div><button id="cashierDataTxDetailClose" class="mini-btn" type="button">Tutup</button></div>
      <div style="margin-top:10px">${renderDetailBody(kind, detail)}</div>`;
    el('cashierDataTxDetailClose')?.addEventListener('click', () => box.classList.add('hidden'));
  }

  async function openTransactionDetail(kind, id) {
    const box = el('cashierDataTxDetail');
    if (!box) return;
    box.classList.remove('hidden');
    box.innerHTML = '<div class="muted">Memuat detail transaksi...</div>';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const payload = await api(`/api/cashier/data/transactions/detail/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
      renderTransactionDetail(kind, payload.detail);
    } catch (error) {
      box.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
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
    if (!query) {
      list.innerHTML = '<div class="muted">Ketik nama barang untuk mencari saldo stok.</div>';
      return;
    }
    const visible = state.stocks.filter(item => (item.productName || '').toLocaleLowerCase('id-ID').includes(query));
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
