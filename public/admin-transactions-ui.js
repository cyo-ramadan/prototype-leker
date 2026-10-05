(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const money = value => value == null ? '-' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const decimalMoney = value => value == null ? '-' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 4 }).format(Number(value) || 0);
  const dateTime = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '-';
  const state = { filter: 'ALL', transactions: [], nextCursor: null, hasMore: false };

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: { ...(options.headers || {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
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
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === 'transactions'));
    document.getElementById('adminMasterMenuToggle')?.classList.remove('active');
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-transactions'));
    loadTransactions({ reset: true });
  }

  function mount() {
    const tabs = document.querySelector('.admin-tabs');
    const toastNode = document.getElementById('adminToast');
    if (!tabs || !toastNode || document.getElementById('tab-transactions')) return;

    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.dataset.tab = 'transactions';
    button.type = 'button';
    button.textContent = '📊 Transaksi';
    tabs.appendChild(button);

    toastNode.insertAdjacentHTML('beforebegin', `
      <section id="tab-transactions" class="admin-section">
        <div class="admin-card">
          <div class="list-head">
            <div><div class="admin-eyebrow">Operational Data Explorer</div><h2>Tracking Transaksi Gerai</h2><div class="muted">Klik Detail untuk mengambil snapshot transaksi, item penjualan, poin, dan jejak produksi hanya saat diperlukan. Jurnal tetap domain Accounting.</div></div>
            <button id="adminTransactionsRefresh" class="admin-tx-btn admin-tx-btn-grey" type="button">↻ Refresh</button>
          </div>
          <div id="adminTransactionFilters" class="admin-tx-toolbar">
            <button class="admin-tx-btn" data-transaction-filter="ALL" type="button">📋 Semua</button>
            <button class="admin-tx-btn" data-transaction-filter="SALES" type="button">🛒 Penjualan</button>
            <button class="admin-tx-btn" data-transaction-filter="PURCHASES" type="button">🧺 Pembelian</button>
            <button class="admin-tx-btn" data-transaction-filter="OPERATIONS" type="button">💸 Operasional</button>
            <button class="admin-tx-btn" data-transaction-filter="GOODS_FLOW" type="button">📦 Arus Barang</button>
            <button class="admin-tx-btn" data-transaction-filter="PRODUCTION" type="button">🏭 Produksi</button>
            <button class="admin-tx-btn" data-transaction-filter="ASSETS" type="button">🏷️ Aset</button>
          </div>
          <div class="admin-grid two compact" style="margin-top:12px">
            <label class="admin-field">Dari<input id="adminTransactionsFrom" type="datetime-local" /></label>
            <label class="admin-field">Sampai<input id="adminTransactionsTo" type="datetime-local" /></label>
          </div>
          <div id="adminTransactionsList" class="master-list" style="margin-top:12px"></div>
          <div style="display:flex;justify-content:center;margin-top:12px"><button id="adminTransactionsMore" class="secondary-btn hidden" type="button">Muat lagi</button></div>
        </div>
      </section>`);

    button.addEventListener('click', activate);
    document.getElementById('adminTransactionsRefresh')?.addEventListener('click', () => loadTransactions({ reset: true }));
    document.getElementById('adminTransactionsMore')?.addEventListener('click', () => loadTransactions({ reset: false }));
    document.getElementById('adminTransactionsFrom')?.addEventListener('change', () => loadTransactions({ reset: true }));
    document.getElementById('adminTransactionsTo')?.addEventListener('change', () => loadTransactions({ reset: true }));
    document.querySelectorAll('[data-transaction-filter]').forEach(filterButton => filterButton.addEventListener('click', () => {
      state.filter = filterButton.dataset.transactionFilter;
      renderFilterState();
      loadTransactions({ reset: true });
    }));

    renderFilterState();
  }

  function localInputToIso(id) {
    const value = document.getElementById(id)?.value;
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  function buildUrl({ reset }) {
    const url = new URL('/api/admin/transactions', location.origin);
    url.searchParams.set('filter', state.filter);
    url.searchParams.set('limit', '50');
    const from = localInputToIso('adminTransactionsFrom');
    const to = localInputToIso('adminTransactionsTo');
    if (from) url.searchParams.set('from', from);
    if (to) url.searchParams.set('to', to);
    if (!reset && state.nextCursor) url.searchParams.set('before', state.nextCursor);
    return `${url.pathname}${url.search}`;
  }

  async function loadTransactions({ reset }) {
    const section = document.getElementById('tab-transactions');
    if (!section?.classList.contains('active')) return;
    const target = document.getElementById('adminTransactionsList');
    if (reset) target.innerHTML = '<div class="muted">Memuat transaksi...</div>';
    try {
      const payload = await api(buildUrl({ reset }));
      state.transactions = reset ? (payload.transactions || []) : [...state.transactions, ...(payload.transactions || [])];
      state.nextCursor = payload.nextCursor || null;
      state.hasMore = Boolean(payload.hasMore);
      renderTransactions();
    } catch (error) {
      if (reset) target.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
      else toast(error.message);
    }
  }

  function renderFilterState() {
    document.querySelectorAll('[data-transaction-filter]').forEach(button => {
      const active = button.dataset.transactionFilter === state.filter;
      button.classList.toggle('admin-tx-btn-primary', active);
      button.classList.toggle('active', active);
      button.classList.toggle('admin-tx-btn-grey', !active);
    });
  }

  function statusLabel(transaction) {
    const raw = String(transaction.status || '');
    if (raw === 'posted') return 'Posted';
    if (raw === 'voided') return 'Dihapus (read only)';
    if (raw === 'pending_approval/unposted') return 'Pending ACC';
    if (raw === 'approved/posted') return 'ACC + Posted';
    if (raw.startsWith('rejected/')) return 'Rejected';
    return raw || '-';
  }

  function accountingLabel(transaction) {
    const ref = transaction.accounting || {};
    if (!ref.eligible) return 'Belum eligible jurnal';
    if (ref.journalReference) return `Jurnal ${ref.journalReference}`;
    return ref.syncStatus === 'NOT_CONNECTED' ? 'Menunggu koneksi Accounting' : (ref.syncStatus || '-');
  }

  // Qty pembelian di kartu (Bos Cyo, 2026-10-05): "Gula 1.000 g", maksimal 3 barang lalu "+N barang".
  function purchaseItemsLine(transaction) {
    const items = Array.isArray(transaction.purchaseItems) ? transaction.purchaseItems : [];
    if (!items.length) return '';
    const shown = items.slice(0, 3).map(item => `${esc(item.productName)} ${new Intl.NumberFormat('id-ID').format(Number(item.quantity) || 0)} ${esc(item.unitSymbol)}`.trim());
    const more = items.length > 3 ? ` · +${items.length - 3} barang` : '';
    return `<div class="master-meta"><b>Dibeli:</b> ${shown.join(' · ')}${more}</div>`;
  }

  function renderTransactions() {
    const target = document.getElementById('adminTransactionsList');
    target.innerHTML = state.transactions.length ? state.transactions.map(transaction => `
      <article class="master-row" style="align-items:flex-start">
        <div class="master-main">
          <div class="master-meta">${esc(transaction.kind)} · ${dateTime(transaction.occurredAt)} · ${esc(statusLabel(transaction))}</div>
          <strong>${esc(transaction.description || transaction.kind)}</strong>
          ${purchaseItemsLine(transaction)}
          <div class="master-prices"><span>${transaction.cashierName ? `PIC ${esc(transaction.cashierName)}` : 'System'}</span><span>${money(transaction.amount)}</span></div>
          <div class="master-meta">Ref ${esc(transaction.sourceReference?.type || '')}:${esc(transaction.sourceReference?.id || '')}${transaction.paymentMethod ? ` · ${esc(transaction.paymentMethod)}` : ''}</div>
          <div class="master-meta">Accounting · ${esc(accountingLabel(transaction))}</div>
        </div>
        <div class="master-actions"><button class="admin-tx-btn admin-tx-btn-primary" type="button" data-transaction-detail-kind="${esc(transaction.kind)}" data-transaction-detail-id="${esc(transaction.id)}">🔍 Detail</button></div>
      </article>`).join('') : '<div class="empty">Belum ada transaksi pada filter ini.</div>';
    target.querySelectorAll('[data-transaction-detail-id]').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.transactionDetailKind, button.dataset.transactionDetailId)));
    document.getElementById('adminTransactionsMore')?.classList.toggle('hidden', !state.hasMore);
  }

  async function openDetail(kind, id) {
    window.openAdminDetailModal({
      head: '<div class="admin-eyebrow">Transaction Detail</div><h2>Memuat...</h2>',
      body: '<div class="muted">Memuat detail transaksi...</div>'
    });
    try {
      const payload = await api(`/api/admin/transactions/detail/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
      renderDetail(payload.detail);
    } catch (error) {
      window.openAdminDetailModal({
        head: '<div class="admin-eyebrow">Transaction Detail</div><h2>Gagal memuat</h2>',
        body: `<div class="empty">${esc(error.message)}</div>`
      });
    }
  }

  function accountingDetail(detail) {
    const ref = detail.accounting || {};
    return ref.journalReference ? `Jurnal ${ref.journalReference}` : (ref.syncStatus || (ref.eligible ? 'Pending connector' : 'Belum eligible'));
  }

  function renderSaleDetail(detail) {
    const items = detail.items || [];
    const runs = detail.productionRuns || [];
    return `
      <div class="admin-grid two compact">
        <div class="admin-tip"><b>Customer</b><div>${esc(detail.customerName || 'Walk-in')}${detail.customerId ? ` · ${esc(detail.customerId)}` : ''}</div></div>
        <div class="admin-tip"><b>Tracking</b><div>${esc(detail.orderNo || detail.orderId || '-')} · ${esc(detail.paymentMethod || '-')}</div></div>
      </div>
      <div class="master-list" style="margin-top:12px">${items.map(item => `
        <div class="master-row">
          <div class="master-main">
            <strong>${item.quantity}× ${esc(item.productName)} · ${money(item.lineTotal)}</strong>
            <div class="master-meta">Harga ${money(item.unitPrice)} · Poin ${item.pointsPerUnit}/unit · Earn ${item.linePoints}</div>
            <div class="master-meta">${item.recipeId ? `Recipe ${esc(item.recipeId)} v${item.recipeRevision || '-'}${item.productionRunId ? ` · Production ${esc(item.productionRunId)}` : ''}` : 'Tanpa auto-production recipe'}</div>
          </div>
        </div>`).join('')}</div>
      <div class="admin-tip" style="margin-top:12px"><b>Total</b> ${money(detail.total)} · <b>Poin customer</b> ${detail.totalPoints || 0}</div>
      ${runs.length ? `<div style="margin-top:16px"><h3>Production Snapshot</h3>${runs.map(run => `
        <details class="admin-tip" style="margin-top:8px"><summary><b>${esc(run.outputProductName)}</b> · Recipe v${run.recipeRevision} · ${run.batches} batch</summary>
          <div style="margin-top:8px">Hasil ${run.totalOutputQuantity} ${esc(run.unitSymbol)} · kebutuhan sale ${run.requestedSaleQuantity || '-'} · HPP/unit ${decimalMoney(run.hppPerUnit)}</div>
          <ul>${(run.components || []).map(component => `<li>${esc(component.productName)}: ${component.totalQuantity} ${esc(component.unitSymbol)} · cost snapshot ${decimalMoney(component.totalCostSnapshot)}</li>`).join('')}</ul>
        </details>`).join('')}</div>` : ''}`;
  }

  function renderProductionDetail(detail) {
    return `
      <div class="admin-grid two compact">
        <div class="admin-tip"><b>Hasil</b><div>${esc(detail.outputProductName)} · ${detail.totalOutputQuantity} ${esc(detail.unitSymbol || '')}</div></div>
        <div class="admin-tip"><b>Recipe Snapshot</b><div>${esc(detail.recipeId)} · v${detail.recipeRevision} · ${detail.batches} batch</div></div>
      </div>
      <div class="admin-tip" style="margin-top:12px">Mode ${esc(detail.mode)}${detail.saleId ? ` · Sale ${esc(detail.saleId)}` : ''}${detail.orderId ? ` · Order ${esc(detail.orderId)}` : ''}</div>
      <div class="master-list" style="margin-top:12px">${(detail.components || []).map(component => `
        <div class="master-row"><div class="master-main">
          <strong>${esc(component.productName)} · ${component.totalQuantity} ${esc(component.unitSymbol || '')}</strong>
          <div class="master-meta">Per batch ${component.quantityPerBatch} · Unit cost snapshot ${decimalMoney(component.unitCostSnapshot)} · Total cost ${decimalMoney(component.totalCostSnapshot)}</div>
        </div></div>`).join('') || '<div class="empty">Tidak ada komponen snapshot.</div>'}</div>
      <div class="admin-tip" style="margin-top:12px"><b>HPP total</b> ${decimalMoney(detail.hppTotal)} · <b>HPP/unit</b> ${decimalMoney(detail.hppPerUnit)}</div>`;
  }

  // Koreksi Nilai SO (Bos Cyo, 2026-10-05): SO yang dinilai dengan HPP yang sedang rusak dibetulkan
  // lewat jalur resmi -- catatan koreksi baru + jurnal pembalik selisih. SO aslinya tidak diubah.
  const SKALA = 1000000n;
  function rupiahSkala(scaled) {
    if (scaled == null || scaled === '') return '-';
    const n = BigInt(scaled);
    const pecahan = (n % SKALA).toString().padStart(6, '0').replace(/0+$/, '');
    return `Rp${(n / SKALA).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${pecahan ? `,${pecahan}` : ''}`;
  }

  function stockAdjustmentItems(detail) {
    if (Array.isArray(detail.items)) return detail.items;
    if (detail.payload?.purpose !== 'STOCK_ADJUSTMENT') return null;
    const p = detail.payload;
    return [{
      approvalRequestId: detail.id, productName: p.productName, unitSymbol: p.unitSymbol, direction: p.direction,
      quantity: p.quantity, currentQuantitySnapshot: p.currentQuantitySnapshot, targetQuantity: p.targetQuantity,
      unitCostSnapshotScaled: p.unitCostSnapshotScaled, valueSnapshotScaled: p.totalCostSnapshotScaled, postingStatus: detail.postingStatus
    }];
  }

  function renderStockAdjustmentDetail(items) {
    return `<div class="master-list">${items.map(item => `
      <article class="master-row" style="align-items:flex-start">
        <div class="master-main">
          <strong>${esc(item.productName)} · ${item.direction === 'IN' ? 'SO+' : 'SO−'} ${esc(String(item.quantity ?? ''))} ${esc(item.unitSymbol || '')}</strong>
          <div class="master-meta">Stok ${esc(String(item.currentQuantitySnapshot ?? '-'))} → ${esc(String(item.targetQuantity ?? '-'))} ${esc(item.unitSymbol || '')}</div>
          <div class="master-meta">Nilai tercatat ${rupiahSkala(item.valueSnapshotScaled)} (HPP ${rupiahSkala(item.unitCostSnapshotScaled)}/${esc(item.unitSymbol || 'satuan')})</div>
        </div>
        ${item.postingStatus === 'posted' ? `<div class="master-actions"><button class="admin-tx-btn" type="button" data-so-correct="${esc(item.approvalRequestId)}" data-so-name="${esc(item.productName)}" data-so-unit="${esc(item.unitSymbol || '')}">Koreksi nilai</button></div>` : ''}
      </article>`).join('')}</div>`;
  }

  async function correctStockAdjustmentValue(button) {
    const id = button.dataset.soCorrect;
    const unitCost = window.prompt(`Harga per ${button.dataset.soUnit || 'satuan'} yang BENAR untuk ${button.dataset.soName} (koma untuk desimal, mis. 18 atau 0,4375):`);
    if (unitCost == null || !unitCost.trim()) return;
    const body = { unitCost: unitCost.trim().replace(/\./g, '').replace(',', '.') };
    try {
      const { preview } = await api(`/api/admin/stock-adjustments/${encodeURIComponent(id)}/value-correction/preview`, { method: 'POST', body: JSON.stringify(body) });
      const reason = window.prompt(`${preview.label} ${preview.productName} ${preview.quantity} ${preview.unitSymbol} (${preview.businessDate})\nNilai tercatat ${preview.originalValue} → nilai benar ${preview.correctedValue}\nSelisih ${preview.delta} akan dibukukan sebagai jurnal pembalik. SO aslinya tidak diubah.\n\nTulis alasan koreksi (minimal 5 huruf):`);
      if (reason == null) return;
      const result = await api(`/api/admin/stock-adjustments/${encodeURIComponent(id)}/value-correction`, { method: 'POST', body: JSON.stringify({ ...body, reason }) });
      window.alert(`Koreksi tersimpan. Jurnal: ${result.journal?.status || '-'}${result.journal?.error ? ` (${result.journal.error})` : ''}`);
      button.disabled = true;
      button.textContent = 'Sudah dikoreksi';
    } catch (error) {
      window.alert(error.message);
    }
  }

  function renderDetail(detail) {
    const soItems = detail.kind === 'GOODS_FLOW' ? stockAdjustmentItems(detail) : null;
    const content = detail.kind === 'SALE'
      ? renderSaleDetail(detail)
      : detail.kind === 'PRODUCTION'
        ? renderProductionDetail(detail)
        : soItems
          ? renderStockAdjustmentDetail(soItems)
        : `<div class="admin-tip"><pre style="white-space:pre-wrap;margin:0;font-size:12px">${esc(JSON.stringify(detail.payload || {
            description: detail.description,
            amount: detail.amount,
            supplierName: detail.supplierName,
            paymentMethod: detail.paymentMethod,
            approvalStatus: detail.approvalStatus,
            postingStatus: detail.postingStatus,
            decisionNote: detail.decisionNote
          }, null, 2))}</pre></div>`;
    window.openAdminDetailModal({
      head: `<div><div class="admin-eyebrow">Transaction Detail</div><h2>${esc(detail.kind)} · ${esc(detail.id)}</h2><div class="muted">${dateTime(detail.occurredAt)} · Accounting: ${esc(accountingDetail(detail))}</div></div>`,
      body: content
    });
    document.querySelectorAll('[data-so-correct]').forEach(button => button.addEventListener('click', () => correctStockAdjustmentValue(button)));
  }

  mount();
})();
