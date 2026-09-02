(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const dateTime = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '-';
  const hpp = scaled => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 6 }).format(Number(scaled || 0) / 1_000_000);
  const state = { stocks: [], selectedProductId: null, selectedProduct: null, movements: [], nextCursor: null, hasMore: false, costHistory: [], costFrom: '', costTo: '' };

  async function api(path) {
    const response = await fetch(path, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function toast(message) {
    const node = document.getElementById('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 2200);
  }

  function activate() {
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === 'stock'));
    document.getElementById('adminMasterMenuToggle')?.classList.remove('active');
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-stock'));
    loadStocks();
  }

  function mount() {
    const tabs = document.querySelector('.admin-tabs');
    const toastNode = document.getElementById('adminToast');
    if (!tabs || !toastNode || document.getElementById('tab-stock')) return;
    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.dataset.tab = 'stock';
    button.type = 'button';
    button.textContent = 'Stok';
    const transactionTab = tabs.querySelector('[data-tab="transactions"]');
    if (transactionTab) tabs.insertBefore(button, transactionTab);
    else tabs.appendChild(button);

    toastNode.insertAdjacentHTML('beforebegin', `
      <section id="tab-stock" class="admin-section">
        <div class="admin-card">
          <div class="list-head">
            <div><div class="admin-eyebrow">Inventory Read Model</div><h2>Tracking Stok Barang</h2><div class="muted">Saldo stok dan histori mutasi dari arus barang, produksi, dan penjualan. Qty fisik selalu integer pada satuan dasar barang.</div></div>
            <button id="adminStockRefresh" class="secondary-btn" type="button">↻ Refresh</button>
          </div>
          <label class="admin-field" style="margin-top:12px">Cari barang<input id="adminStockSearch" type="search" placeholder="Nama / tipe barang" /></label>
          <div id="adminStockList" class="master-list" style="margin-top:12px"></div>
        </div>
        <div id="adminStockDetail" class="admin-card hidden" style="margin-top:14px"></div>
      </section>`);

    button.addEventListener('click', activate);
    document.getElementById('adminStockRefresh')?.addEventListener('click', loadStocks);
    document.getElementById('adminStockSearch')?.addEventListener('input', renderStocks);
  }

  async function loadStocks() {
    try {
      const payload = await api('/api/admin/stock');
      state.stocks = payload.stocks || [];
      renderStocks();
      if (state.selectedProductId && state.stocks.some(item => item.productId === state.selectedProductId)) {
        await loadMovements(state.selectedProductId, { reset: true });
      }
    } catch (error) { toast(error.message); }
  }

  function renderStocks() {
    const target = document.getElementById('adminStockList');
    if (!target) return;
    const query = String(document.getElementById('adminStockSearch')?.value || '').trim().toLocaleLowerCase('id-ID');
    const visible = [];
    for (const item of state.stocks) {
      if (query) {
        const haystack = `${item.productName || ''} ${item.itemTypeName || ''}`.toLocaleLowerCase('id-ID');
        if (!haystack.includes(query)) continue;
      }
      visible.push(item);
    }
    target.innerHTML = visible.length ? visible.map(item => {
      const qty = item.quantity == null ? 'Belum diinisialisasi' : `${item.quantity} ${esc(item.unitSymbol || '')}`;
      const tracking = item.stockTrackingEnabled ? 'Tracked' : 'Legacy / tracking off';
      const production = item.productionMode === 'DADAKAN' ? `DADAKAN${item.recipeLinkEnabled ? ' · resep linked' : ''}` : 'STOCK';
      return `<article class="master-row" style="align-items:center">
        <div class="master-main">
          <strong>${esc(item.productName)}</strong>
          <div class="master-meta">${esc(item.itemTypeName || 'Tanpa tipe')} · ${esc(tracking)} · ${esc(production)}</div>
          <div class="master-prices"><span>Saldo</span><span><b>${qty}</b></span></div>
        </div>
        <div class="master-actions"><button class="mini-btn" type="button" data-stock-detail="${item.productId}">Lihat Mutasi & HPP</button></div>
      </article>`;
    }).join('') : '<div class="empty">Barang tidak ditemukan.</div>';
    target.querySelectorAll('[data-stock-detail]').forEach(button => button.addEventListener('click', () => loadMovements(Number(button.dataset.stockDetail), { reset: true })));
  }

  async function loadMovements(productId, { reset }) {
    const detail = document.getElementById('adminStockDetail');
    if (!detail) return;
    if (reset) {
      state.selectedProductId = productId;
      state.movements = [];
      state.nextCursor = null;
      detail.classList.remove('hidden');
      detail.innerHTML = '<div class="muted">Memuat mutasi stok...</div>';
    }
    try {
      const url = new URL(`/api/admin/stock/${productId}/movements`, location.origin);
      url.searchParams.set('limit', '50');
      if (!reset && state.nextCursor) url.searchParams.set('before', state.nextCursor);
      const payload = await api(`${url.pathname}${url.search}`);
      state.movements = reset ? (payload.movements || []) : [...state.movements, ...(payload.movements || [])];
      state.nextCursor = payload.nextCursor || null;
      state.hasMore = Boolean(payload.hasMore);
      state.selectedProduct = payload.product;
      if (reset) await loadCostHistory(productId);
      renderDetail(payload.product);
    } catch (error) {
      if (reset) detail.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
      else toast(error.message);
    }
  }

  async function loadCostHistory(productId) {
    const url = new URL(`/api/admin/stock/${productId}/cost-history`, location.origin);
    url.searchParams.set('limit', '5');
    const from = state.costFrom;
    const to = state.costTo;
    if (from) url.searchParams.set('from', from);
    if (to) url.searchParams.set('to', to);
    const payload = await api(`${url.pathname}${url.search}`);
    state.costHistory = payload.history || [];
  }

  function sourceLabel(sourceType) {
    const labels = {
      SALE: 'Penjualan', GOODS_FLOW: 'Arus Barang', PRODUCTION_INPUT: 'Produksi · bahan keluar',
      PRODUCTION_OUTPUT: 'Produksi · hasil masuk', STOCK_ADJUSTMENT: 'Penyesuaian stok', PURCHASE: 'Pembelian'
    };
    return labels[sourceType] || sourceType;
  }

  function renderDetail(product) {
    const target = document.getElementById('adminStockDetail');
    if (!target) return;
    const qty = product.quantity == null ? 'Belum diinisialisasi' : `${product.quantity} ${esc(product.unitSymbol || '')}`;
    target.innerHTML = `
      <div class="list-head"><div><div class="admin-eyebrow">Stock Detail</div><h2>${esc(product.productName)}</h2><div class="muted">Saldo saat ini: <b>${qty}</b></div></div><button id="adminStockCloseDetail" class="mini-btn" type="button">Tutup</button></div>
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)">
        <div class="list-head"><div><div class="admin-eyebrow">Costing Read Model</div><h3>Histori HPP</h3><div class="muted">HPP saat ini: <b>${hpp(product.averageCostScaled)}</b> · 5 perubahan terkini, tanpa rekonstruksi data lama.</div></div></div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(140px,220px));gap:8px;margin-top:10px">
          <label class="admin-field">Dari tanggal<input id="adminCostHistoryFrom" type="date" value="${esc(state.costFrom)}" /></label>
          <label class="admin-field">Sampai tanggal<input id="adminCostHistoryTo" type="date" value="${esc(state.costTo)}" /></label>
        </div>
        <div class="master-list" style="margin-top:10px">${state.costHistory.length ? state.costHistory.map(row => `
          <div class="master-row"><div class="master-main">
            <strong>${hpp(row.previousAverageCostScaled)} → ${hpp(row.newAverageCostScaled)}</strong>
            <div class="master-meta">${dateTime(row.createdAt)} · ${esc(row.changeReason)} · ${esc(row.referenceType)} ${esc(row.referenceId)}</div>
          </div></div>`).join('') : '<div class="empty">Belum ada perubahan HPP tercatat pada filter ini.</div>'}</div>
      </div>
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)"><div class="admin-eyebrow">Inventory Ledger</div><h3>Mutasi Stok</h3></div>
      <div class="master-list" style="margin-top:12px">${state.movements.length ? state.movements.map(row => `
        <div class="master-row">
          <div class="master-main">
            <strong>${row.direction === 'IN' ? '＋' : '−'} ${row.quantity} ${esc(product.unitSymbol || '')} · ${esc(sourceLabel(row.sourceType))}</strong>
            <div class="master-meta">${dateTime(row.occurredAt)} · Ref ${esc(row.sourceId)}</div>
            ${row.note ? `<div class="master-meta">${esc(row.note)}</div>` : ''}
          </div>
        </div>`).join('') : '<div class="empty">Belum ada mutasi stok tercatat.</div>'}</div>
      <div style="display:flex;justify-content:center;margin-top:12px"><button id="adminStockMore" class="secondary-btn ${state.hasMore ? '' : 'hidden'}" type="button">Muat lagi</button></div>`;
    document.getElementById('adminStockCloseDetail')?.addEventListener('click', () => target.classList.add('hidden'));
    document.getElementById('adminStockMore')?.addEventListener('click', () => loadMovements(product.productId, { reset: false }));
    const refreshCostHistory = async () => {
      try {
        state.costFrom = String(document.getElementById('adminCostHistoryFrom')?.value || '');
        state.costTo = String(document.getElementById('adminCostHistoryTo')?.value || '');
        await loadCostHistory(product.productId);
        renderDetail(state.selectedProduct || product);
      } catch (error) { toast(error.message); }
    };
    document.getElementById('adminCostHistoryFrom')?.addEventListener('change', refreshCostHistory);
    document.getElementById('adminCostHistoryTo')?.addEventListener('change', refreshCostHistory);
  }

  mount();
})();
