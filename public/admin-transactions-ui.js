(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const money = value => value == null ? '-' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const dateTime = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '-';
  const state = { filter: 'ALL', transactions: [], nextCursor: null, hasMore: false };

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
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === 'transactions'));
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
    button.textContent = 'Transaksi';
    const accountingButton = tabs.querySelector('[data-tab="accounting"]');
    if (accountingButton) tabs.insertBefore(button, accountingButton);
    else tabs.appendChild(button);

    toastNode.insertAdjacentHTML('beforebegin', `
      <section id="tab-transactions" class="admin-section">
        <div class="admin-card">
          <div class="list-head">
            <div><div class="admin-eyebrow">Operational Data Explorer</div><h2>Tracking Transaksi Gerai</h2><div class="muted">Business facts untuk penjualan, pembelian, operasional, inventory, dan aset. Detail jurnal tetap menjadi domain Accounting.</div></div>
            <button id="adminTransactionsRefresh" class="secondary-btn" type="button">↻ Refresh</button>
          </div>
          <div id="adminTransactionFilters" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
            <button class="mini-btn" data-transaction-filter="ALL" type="button">Semua</button>
            <button class="mini-btn" data-transaction-filter="SALES" type="button">Penjualan</button>
            <button class="mini-btn" data-transaction-filter="PURCHASES" type="button">Pembelian</button>
            <button class="mini-btn" data-transaction-filter="OPERATIONS" type="button">Operasional</button>
            <button class="mini-btn" data-transaction-filter="INVENTORY" type="button">Arus Barang</button>
            <button class="mini-btn" data-transaction-filter="ASSETS" type="button">Aset</button>
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

    const accountingTab = tabs.querySelector('[data-tab="accounting"]');
    if (accountingTab) accountingTab.textContent = 'Koneksi Akuntansi';
    const accountingSection = document.getElementById('tab-accounting');
    if (accountingSection) accountingSection.innerHTML = `
      <div class="admin-card admin-placeholder">
        <div class="admin-placeholder-inner">
          <div class="admin-eyebrow">Accounting Bridge</div>
          <h2>Accounting module tetap terpisah</h2>
          <p class="muted">Prototype Leker mengirim business facts dan source reference. Journal entry, COA, buku besar, neraca, laba rugi, closing, dan interpretasi debit-kredit tetap dimiliki program Accounting.</p>
          <div class="master-meta">Contract seam: MAXI_ACCOUNTING_BUSINESS_FACT_V1 · Status: NOT_CONNECTED</div>
        </div>
      </div>`;

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
      button.classList.toggle('primary-btn', active);
      button.classList.toggle('mini-btn', !active);
    });
  }

  function statusLabel(transaction) {
    const raw = String(transaction.status || '');
    if (raw === 'posted') return 'Posted';
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

  function renderTransactions() {
    const target = document.getElementById('adminTransactionsList');
    target.innerHTML = state.transactions.length ? state.transactions.map(transaction => `
      <article class="master-row" style="align-items:flex-start">
        <div class="master-main">
          <div class="master-meta">${esc(transaction.kind)} · ${dateTime(transaction.occurredAt)} · ${esc(statusLabel(transaction))}</div>
          <strong>${esc(transaction.description || transaction.kind)}</strong>
          <div class="master-prices"><span>${transaction.cashierName ? `PIC ${esc(transaction.cashierName)}` : 'System'}</span><span>${money(transaction.amount)}</span></div>
          <div class="master-meta">Ref ${esc(transaction.sourceReference?.type || '')}:${esc(transaction.sourceReference?.id || '')}${transaction.paymentMethod ? ` · ${esc(transaction.paymentMethod)}` : ''}</div>
          <div class="master-meta">Accounting · ${esc(accountingLabel(transaction))}</div>
          ${transaction.operationalPayload ? `<details style="margin-top:6px"><summary class="text-btn">Snapshot operasional</summary><pre style="white-space:pre-wrap;font-size:12px">${esc(JSON.stringify(transaction.operationalPayload, null, 2))}</pre></details>` : ''}
        </div>
      </article>`).join('') : '<div class="empty">Belum ada transaksi pada filter ini.</div>';
    document.getElementById('adminTransactionsMore')?.classList.toggle('hidden', !state.hasMore);
  }

  mount();
})();
