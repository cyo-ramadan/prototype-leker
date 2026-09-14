(() => {
  const state = {
    tab: 'transactions',
    filter: 'ALL',
    limit: 50,
    q: '',
    sortKey: 'occurredAt',
    sortDir: 'desc',
    transactions: [],
    txCursor: null,
    txHasMore: false,
    voidPermits: new Map(),
    stocks: [],
    selectedProductId: null,
    movements: [],
    stockCursor: null,
    stockHasMore: false
  };

  const VOID_SUBJECT_TYPES = new Set(['SALE', 'PURCHASE', 'EXPENSE']);

  const FILTERS = [
    ['ALL', 'Semua'], ['SALES', 'Penjualan'], ['PURCHASES', 'Pembelian'],
    ['OPERATIONS', 'Operasional'], ['STOCK_ADJUSTMENTS', 'Penyesuaian Stok'],
    ['INVENTORY', 'Arus Barang & Produksi'], ['ASSETS', 'Aset']
  ];
  const PAGE_SIZES = [5, 20, 50, 100];
  const SORT_OPTIONS = [
    ['occurredAt:desc', 'Tanggal terbaru'], ['occurredAt:asc', 'Tanggal terlama'],
    ['cashierName:asc', 'Kasir A-Z'], ['cashierName:desc', 'Kasir Z-A']
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
        <style>
          .cashier-tx-tabs{display:flex;gap:8px;margin:10px 0}
          .cashier-tx-btn{border:0;border-radius:10px;padding:9px 16px;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap}
          .cashier-tx-btn-primary{background:var(--brand);color:#fff}
          .cashier-tx-btn-primary.active{box-shadow:inset 0 0 0 2px rgba(0,0,0,.22)}
          .cashier-tx-btn-grey{background:#6b7280;color:#fff}
          .cashier-tx-toolbar{background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:12px;margin-bottom:12px}
          .cashier-tx-toolbar-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
          .cashier-tx-toolbar .field{margin:0}
          .cashier-tx-toolbar label{display:block;font-size:11px;font-weight:800;color:#4b5563;margin-bottom:3px}
          .cashier-tx-search-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
          .cashier-tx-search-row input{flex:1;min-width:150px}
          .cashier-tx-table-wrap{overflow-x:auto;border:1px solid #e1e5eb;border-radius:12px}
          .cashier-tx-table{width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap}
          .cashier-tx-table th{background:#111827;color:#fff;padding:8px 10px;text-align:left;cursor:pointer;user-select:none}
          .cashier-tx-table th:not([data-sort-key]){cursor:default}
          .cashier-tx-table th[data-sort-key]:hover{background:#1f2937}
          .cashier-tx-table td{padding:8px 10px;border-top:1px solid #edf0f4;white-space:normal;vertical-align:top}
          .cashier-tx-table tbody tr:hover{background:#f9fafb}
          .cashier-tx-id{font-family:monospace;font-size:10px;color:#6b7280;word-break:break-all;white-space:normal;max-width:180px}
          .cashier-tx-actions{display:flex;gap:6px;flex-wrap:wrap;white-space:normal}
          .cashier-tx-readonly-note{display:block;margin-top:4px;font-size:10px;color:#b45309}
          @media(max-width:640px){
            /* Kasir/CS mostly hold a phone -- a 9-column table would force
               horizontal scroll before even Nominal/Status are visible, not
               just the "look up later" columns like ID Laci. Reflow into
               stacked label:value rows instead of hiding any data. */
            .cashier-tx-table-wrap{overflow-x:visible;border:0}
            .cashier-tx-table{white-space:normal}
            .cashier-tx-table thead{display:none}
            .cashier-tx-table, .cashier-tx-table tbody, .cashier-tx-table tr, .cashier-tx-table td{display:block;width:100%}
            .cashier-tx-table tr{border:1px solid #e1e5eb;border-radius:10px;margin-bottom:10px;padding:8px 10px}
            .cashier-tx-table td{border-top:0;padding:4px 0}
            .cashier-tx-table td.cashier-tx-id{max-width:none}
            .cashier-tx-table td::before{content:attr(data-label);display:block;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase}
            .cashier-tx-table td.cashier-tx-actions::before{content:none}
          }
        </style>
        <div class="cashier-dialog-head">
          <div><div class="muted">Data gerai · read-only</div><h2>Data Transaksi &amp; Stok</h2></div>
          <button id="cashierDataClose" class="cart-close-btn" type="button">×</button>
        </div>
        <div class="cashier-tx-tabs">
          <button id="cashierDataTabTransactions" class="cashier-tx-btn cashier-tx-btn-primary" type="button">Transaksi</button>
          <button id="cashierDataTabStock" class="cashier-tx-btn cashier-tx-btn-primary" type="button">Stok</button>
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

  function renderToolbar() {
    return `
      <div class="cashier-tx-toolbar">
        <div class="cashier-tx-toolbar-grid">
          <div class="field"><label>Filter</label><select id="cashierDataFilter" class="text-input">${FILTERS.map(([value, label]) => `<option value="${value}" ${value === state.filter ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></div>
          <div class="field"><label>Tampilkan</label><select id="cashierDataLimit" class="text-input">${PAGE_SIZES.map(size => `<option value="${size}" ${size === state.limit ? 'selected' : ''}>${size}</option>`).join('')}</select></div>
          <div class="field"><label>Urutkan</label><select id="cashierDataSort" class="text-input">${SORT_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === `${state.sortKey}:${state.sortDir}` ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></div>
        </div>
        <div class="cashier-tx-search-row">
          <div class="field" style="flex:1;min-width:150px">
            <label>Cari</label>
            <input id="cashierDataSearch" class="text-input" type="search" value="${escapeHtml(state.q)}" placeholder="Tanggal, kasir, nama, deskripsi, dsb" />
          </div>
          <button id="cashierDataSearchBtn" class="cashier-tx-btn cashier-tx-btn-primary" type="button" style="align-self:flex-end">Cari</button>
          <button id="cashierDataSearchAdvancedBtn" class="mini-btn" type="button" style="align-self:flex-end">🔍 Cari Lanjutan</button>
        </div>
      </div>`;
  }

  function wireToolbar() {
    el('cashierDataFilter').addEventListener('change', event => {
      state.filter = event.target.value;
      loadTransactions({ reset: true });
    });
    el('cashierDataLimit').addEventListener('change', event => {
      state.limit = Number(event.target.value) || 50;
      loadTransactions({ reset: true });
    });
    el('cashierDataSort').addEventListener('change', event => {
      const [key, dir] = event.target.value.split(':');
      state.sortKey = key;
      state.sortDir = dir;
      renderTransactionsPanel();
    });
    const runSearch = () => {
      state.q = el('cashierDataSearch').value.trim();
      loadTransactions({ reset: true });
    };
    el('cashierDataSearchBtn').addEventListener('click', runSearch);
    el('cashierDataSearch').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); runSearch(); }
    });
    // Placeholder entry point only -- the actual per-field AND/OR search
    // builder is a separate, not-yet-designed feature. Just the button for now.
    el('cashierDataSearchAdvancedBtn').addEventListener('click', () => toast('Cari Lanjutan segera hadir.'));
  }

  function sortIndicator(key) {
    if (state.sortKey !== key) return '';
    return state.sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  function sortedTransactions() {
    const rows = [...state.transactions];
    const dir = state.sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const left = state.sortKey === 'cashierName' ? String(a.cashierName || '') : String(a.occurredAt || '');
      const right = state.sortKey === 'cashierName' ? String(b.cashierName || '') : String(b.occurredAt || '');
      return dir * left.localeCompare(right);
    });
    return rows;
  }

  function voidButtonHtml(row) {
    if (!VOID_SUBJECT_TYPES.has(row.kind) || row.status === 'voided') return '';
    const permit = state.voidPermits.get(`${row.kind}:${row.id}`);
    if (permit?.approvalStatus === 'pending_approval') {
      return `<button class="cashier-tx-btn cashier-tx-btn-grey" type="button" data-cashier-tx-cancel-permit="${escapeHtml(permit.id)}">Batal Hapus</button>`;
    }
    if (permit?.approvalStatus === 'approved' && permit.executionStatus !== 'EXECUTED') {
      return '';
    }
    return `<button class="cashier-tx-btn cashier-tx-btn-grey" type="button" data-cashier-tx-void-kind="${escapeHtml(row.kind)}" data-cashier-tx-void-id="${escapeHtml(String(row.id))}">Hapus</button>`;
  }

  function voidNoteHtml(row) {
    if (!VOID_SUBJECT_TYPES.has(row.kind)) return '';
    const permit = state.voidPermits.get(`${row.kind}:${row.id}`);
    if (permit?.approvalStatus === 'pending_approval') return '<span class="cashier-tx-readonly-note"><b>Read only (request delete)</b> · menunggu Admin</span>';
    if (permit?.approvalStatus === 'approved' && permit.executionStatus !== 'EXECUTED') return '<span class="cashier-tx-readonly-note"><b>Read only</b> · sudah di-ACC Admin, sedang diproses</span>';
    return '';
  }

  function renderTransactionRow(row) {
    return `
      <tr>
        <td data-label="Tanggal">${formatDateTime(row.occurredAt)}</td>
        <td data-label="Jenis">${escapeHtml(transactionKindLabel(row))}</td>
        <td data-label="Deskripsi">${escapeHtml(row.description || '')}${voidNoteHtml(row)}</td>
        <td data-label="Nominal">${row.amount == null ? '-' : rupiah(row.amount)}</td>
        <td data-label="Status">${escapeHtml(row.status || '')}</td>
        <td data-label="Kasir">${escapeHtml(row.cashierName || '-')}</td>
        <td class="cashier-tx-id" data-label="ID">${escapeHtml(String(row.id))}</td>
        <td class="cashier-tx-id" data-label="ID Laci">${escapeHtml(row.drawerSessionId || '-')}</td>
        <td class="cashier-tx-actions">
          <button class="cashier-tx-btn cashier-tx-btn-primary" type="button" data-cashier-tx-detail-kind="${escapeHtml(row.kind)}" data-cashier-tx-detail-id="${escapeHtml(String(row.id))}">Detail</button>
          ${voidButtonHtml(row)}
        </td>
      </tr>`;
  }

  function renderTransactionRows() {
    if (!state.transactions.length) return '<div class="empty">Belum ada transaksi.</div>';
    return `
      <div class="cashier-tx-table-wrap">
        <table class="cashier-tx-table">
          <thead><tr>
            <th data-sort-key="occurredAt">Tanggal${sortIndicator('occurredAt')}</th>
            <th>Jenis</th>
            <th>Deskripsi</th>
            <th>Nominal</th>
            <th>Status</th>
            <th data-sort-key="cashierName">Kasir${sortIndicator('cashierName')}</th>
            <th>ID</th>
            <th>ID Laci</th>
            <th>Aksi</th>
          </tr></thead>
          <tbody>${sortedTransactions().map(renderTransactionRow).join('')}</tbody>
        </table>
      </div>`;
  }

  async function loadTransactions({ reset }) {
    const host = el('cashierDataTransactions');
    if (reset) {
      state.transactions = [];
      state.txCursor = null;
      host.innerHTML = `${renderToolbar()}<div class="muted">Memuat transaksi...</div>`;
      wireToolbar();
    }
    try {
      const url = new URL('/api/cashier/data/transactions', location.origin);
      url.searchParams.set('filter', state.filter);
      url.searchParams.set('limit', String(state.limit));
      if (state.q) url.searchParams.set('q', state.q);
      if (!reset && state.txCursor) url.searchParams.set('before', state.txCursor);
      const [payload, permitsPayload] = await Promise.all([
        api(`${url.pathname}${url.search}`),
        api('/api/cashier/transaction-void/permits').catch(() => ({ permits: [] }))
      ]);
      state.transactions = reset ? (payload.transactions || []) : [...state.transactions, ...(payload.transactions || [])];
      state.txCursor = payload.nextCursor || null;
      state.txHasMore = Boolean(payload.nextCursor);
      state.voidPermits = new Map();
      for (const permit of permitsPayload.permits || []) {
        const key = `${permit.subjectType}:${permit.subjectId}`;
        if (!state.voidPermits.has(key)) state.voidPermits.set(key, permit);
      }
      renderTransactionsPanel();
    } catch (error) {
      if (reset) { host.innerHTML = `${renderToolbar()}<div class="empty">${escapeHtml(error.message)}</div>`; wireToolbar(); }
      else toast(error.message);
    }
  }

  function renderTransactionsPanel() {
    const host = el('cashierDataTransactions');
    host.innerHTML = `${renderToolbar()}${renderTransactionRows()}<div style="display:flex;justify-content:center;margin-top:10px"><button id="cashierDataTxMore" class="secondary-btn ${state.txHasMore ? '' : 'hidden'}" type="button">Muat lagi</button></div>`;
    wireToolbar();
    el('cashierDataTxMore')?.addEventListener('click', () => loadTransactions({ reset: false }));
    host.querySelectorAll('[data-sort-key]').forEach(th => th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.sortDir = 'asc'; }
      renderTransactionsPanel();
    }));
    host.querySelectorAll('[data-cashier-tx-detail-id]').forEach(button => button.addEventListener('click', () =>
      openTransactionDetail(button.dataset.cashierTxDetailKind, button.dataset.cashierTxDetailId)));
    host.querySelectorAll('[data-cashier-tx-void-id]').forEach(button => button.addEventListener('click', () =>
      requestVoidPermit(button.dataset.cashierTxVoidKind, button.dataset.cashierTxVoidId)));
    host.querySelectorAll('[data-cashier-tx-cancel-permit]').forEach(button => button.addEventListener('click', () =>
      cancelVoidPermit(button.dataset.cashierTxCancelPermit)));
  }

  async function requestVoidPermit(kind, id) {
    if (el('cashierDialog')?.open) el('cashierDialog').close();
    openDialog({
      eyebrow: 'Laci · Permit Admin',
      title: `Minta Izin Admin Hapus ${KIND_LABEL[kind] || kind}`,
      body: `<div class="field"><label>Alasan hapus / koreksi</label><textarea id="voidPermitReason" rows="4" maxlength="500" required placeholder="Jelaskan kenapa transaksi ini perlu dihapus"></textarea></div><p class="muted">Request ini tidak langsung menghapus transaksi. Admin harus ACC/Reject dulu. History transaksi tetap ada untuk audit; kalau di-ACC, prosesnya lewat pembalik/koreksi, bukan hapus paksa.</p>`,
      submitText: 'AJUKAN HAPUS',
      onSubmit: async () => {
        const reason = el('voidPermitReason').value.trim();
        if (!reason) throw new Error('Alasan hapus wajib diisi.');
        await api('/api/cashier/transaction-void/permits', { method: 'POST', body: JSON.stringify({ subjectType: kind, subjectId: id, reason }) });
        toast('Permintaan hapus masuk ke Admin · pending approval');
        await loadTransactions({ reset: true });
        return true;
      }
    });
  }

  async function cancelVoidPermit(permitId) {
    try {
      await api(`/api/cashier/transaction-void/permits/${encodeURIComponent(permitId)}`, { method: 'DELETE' });
      toast('Permintaan hapus dibatalkan.');
      await loadTransactions({ reset: true });
    } catch (error) { toast(error.message); }
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

  function renderStockAdjustmentSessionBody(detail) {
    const items = detail.items || [];
    return `
      <div class="cashier-tx-table-wrap">
        <table class="cashier-tx-table" style="white-space:normal">
          <thead><tr><th>Barang</th><th>Noted</th><th>Real</th><th>Selisih</th><th>Status</th></tr></thead>
          <tbody>${items.map(item => `
            <tr>
              <td data-label="Barang">${escapeHtml(item.productName || '-')}${item.unitSymbol ? ` (${escapeHtml(item.unitSymbol)})` : ''}</td>
              <td data-label="Noted">${item.currentQuantitySnapshot}</td>
              <td data-label="Real">${item.targetQuantity}</td>
              <td data-label="Selisih">${item.difference > 0 ? `+${item.difference}` : item.difference}</td>
              <td data-label="Status">${escapeHtml(approvalStatusLabel(item))}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="admin-tip" style="margin-top:10px"><b>Kasir</b><div>${escapeHtml(detail.cashierName || '-')}</div></div>`;
  }

  function renderDetailBody(kind, detail) {
    if (kind === 'SALE') return renderSaleDetailBody(detail);
    if (['PURCHASE', 'EXPENSE', 'OTHER_INCOME'].includes(kind)) return renderSimpleDetailBody(detail);
    if (kind === 'GOODS_FLOW' && detail.items) return renderStockAdjustmentSessionBody(detail);
    if (['CASH_FLOW', 'GOODS_FLOW', 'ASSET'].includes(kind)) return renderApprovalDetailBody(kind, detail);
    return '<div class="empty">Detail tidak tersedia untuk jenis transaksi ini.</div>';
  }

  async function openTransactionDetail(kind, id) {
    if (el('cashierDialog')?.open) el('cashierDialog').close();
    openDialog({
      eyebrow: 'Data gerai · read-only',
      title: `${KIND_LABEL[kind] || kind} · ID ${id}`,
      readOnly: true,
      body: '<div class="muted">Memuat detail transaksi...</div>'
    });
    try {
      const payload = await api(`/api/cashier/data/transactions/detail/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
      const detail = payload.detail;
      const row = { kind, operationalPayload: detail.items ? { purpose: 'STOCK_ADJUSTMENT' } : detail.payload };
      el('cashierDialogTitle').textContent = `${transactionKindLabel(row)} · ID ${detail.id}`;
      el('cashierDialogBody').innerHTML = `
        <div class="muted" style="margin-bottom:10px">${formatDateTime(detail.occurredAt)}</div>
        ${renderDetailBody(kind, detail)}`;
    } catch (error) {
      el('cashierDialogBody').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
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
