(() => {
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  let activeMode = 'sales';
  let orderSourceFilter = 'customer';
  let draftOriginOrderId = null;

  function normalizeSource(order) {
    return order?.source === 'cashier' ? 'cashier' : 'customer';
  }

  function belongsToActiveDrawer(order) {
    const drawerId = state.drawer?.id || null;
    if (normalizeSource(order) === 'customer' && order.status === 'NEW' && !order.drawerSessionId) return true;
    return Boolean(drawerId && order.drawerSessionId === drawerId);
  }

  function injectStyle() {
    if (byId('cashierSalesOrdersStyle')) return;
    const style = document.createElement('style');
    style.id = 'cashierSalesOrdersStyle';
    style.textContent = `
      .drawer-command-card{flex-wrap:wrap;align-items:flex-start}
      .cashier-drawer-workspace{flex:1 0 100%;min-width:0;padding-top:16px;margin-top:2px;border-top:1px solid #eadfd4}
      .cashier-workspace-nav{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 16px}
      .cashier-workspace-nav button{border:1px solid #ddd0c3;background:#fffaf4;border-radius:16px;padding:14px 12px;font-weight:900;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px}
      .cashier-workspace-nav button.active{background:#281f18;color:#fff;border-color:#281f18;box-shadow:0 10px 26px rgba(40,31,24,.14)}
      .cashier-workspace-count{min-width:22px;height:22px;padding:0 6px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:rgba(128,128,128,.16);font-size:11px}
      .cashier-workspace-nav button.active .cashier-workspace-count{background:rgba(255,255,255,.18)}
      .cashier-sales-only{grid-template-columns:minmax(0,1fr)!important}
      .cashier-sales-only .cashier-draft-panel{max-width:none}
      .cashier-product-search{border:1px solid #eadfd4;background:#fffaf5;border-radius:16px;padding:12px;margin-bottom:12px}
      .cashier-product-search label{display:block;font-weight:900;margin-bottom:7px}
      .cashier-search-results{display:grid;gap:7px;margin-top:8px;max-height:290px;overflow:auto}
      .cashier-search-results.hidden{display:none}
      .cashier-search-result{width:100%;border:1px solid #eadfd4;background:white;border-radius:12px;padding:10px 11px;display:flex;justify-content:space-between;gap:12px;align-items:center;text-align:left;cursor:pointer}
      .cashier-search-result:hover{border-color:#8b6d50;transform:translateY(-1px)}
      .cashier-search-result strong{display:block}.cashier-search-result small{display:block;color:#7b6c60;margin-top:2px}
      .cashier-search-add{font-weight:900;white-space:nowrap}
      .cashier-menu-continue{width:100%;margin:0 0 12px}
      .cashier-order-source-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}
      .cashier-order-source-tabs button{border:1px solid #ddd0c3;background:#fffaf4;border-radius:999px;padding:9px 13px;font-weight:900;cursor:pointer}
      .cashier-order-source-tabs button.active{background:#281f18;color:#fff;border-color:#281f18}
      .cashier-rejected-block{margin-top:16px;padding-top:14px;border-top:1px dashed #dfd0c2}
      .cashier-rejected-block h2{margin:0 0 10px}
      .cashier-rejected-row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #eee3d8}
      .cashier-order-status-label{font-weight:800}
      @media(max-width:720px){.cashier-workspace-nav{grid-template-columns:1fr}.cashier-workspace-nav button{justify-content:space-between}.cashier-search-result{align-items:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function bindTrackedSaleButton() {
    const button = byId('processSaleBtn');
    if (!button || button.dataset.trackedSaleBound === '1') return;
    const replacement = button.cloneNode(true);
    replacement.dataset.trackedSaleBound = '1';
    button.replaceWith(replacement);
    replacement.addEventListener('click', processTrackedSale);
  }

  function ensureNavigation() {
    injectStyle();
    const dashboard = byId('cashierDashboard');
    const drawerCard = document.querySelector('.drawer-command-card');
    const posLayout = document.querySelector('.cashier-pos-layout');
    const menuPanel = document.querySelector('.cashier-menu-panel');
    const draftPanel = document.querySelector('.cashier-draft-panel');
    const orderSection = document.querySelector('.cashier-order-section');
    if (!dashboard || !drawerCard || !posLayout || !menuPanel || !draftPanel || !orderSection) return;

    let workspace = byId('cashierDrawerWorkspace');
    if (!workspace) {
      workspace = document.createElement('section');
      workspace.id = 'cashierDrawerWorkspace';
      workspace.className = 'cashier-drawer-workspace';
      drawerCard.appendChild(workspace);
      workspace.appendChild(posLayout);
      workspace.appendChild(orderSection);
    }

    if (!byId('cashierWorkspaceNav')) {
      workspace.insertAdjacentHTML('afterbegin', `
        <nav id="cashierWorkspaceNav" class="cashier-workspace-nav" aria-label="Aktivitas laci aktif">
          <button type="button" data-cashier-workspace-mode="sales"><span>🧾 Penjualan</span><span id="cashierSalesCount" class="cashier-workspace-count">0</span></button>
          <button type="button" data-cashier-workspace-mode="menu"><span>📖 Menu</span><span id="cashierMenuDraftCount" class="cashier-workspace-count">0</span></button>
          <button type="button" data-cashier-workspace-mode="orders"><span>📥 Pesanan</span><span id="cashierOrdersCount" class="cashier-workspace-count">0</span></button>
        </nav>`);
      document.querySelectorAll('[data-cashier-workspace-mode]').forEach(button => {
        button.addEventListener('click', () => setMode(button.dataset.cashierWorkspaceMode));
      });
    }

    if (!byId('cashierProductSearch')) {
      const header = draftPanel.querySelector('.cashier-panel-head');
      header?.insertAdjacentHTML('afterend', `
        <section class="cashier-product-search">
          <label for="cashierProductSearch">Cari menu barang</label>
          <input id="cashierProductSearch" class="text-input" type="search" autocomplete="off" placeholder="Ketik: cokelat, keju, sosis..." />
          <div id="cashierSearchResults" class="cashier-search-results hidden"></div>
        </section>`);
      byId('cashierProductSearch')?.addEventListener('input', renderSearchResults);
    }

    const menuHeading = menuPanel.querySelector('h2');
    if (menuHeading) menuHeading.textContent = 'Buku Menu';
    const menuEyebrow = menuPanel.querySelector('.muted');
    if (menuEyebrow) menuEyebrow.textContent = 'Klik menu seperti halaman customer';
    if (!byId('menuToSaleBtn')) {
      const categoryRow = byId('cashierCategoryRow');
      categoryRow?.insertAdjacentHTML('beforebegin', '<button id="menuToSaleBtn" class="secondary-btn cashier-menu-continue" type="button">🧾 Lanjut ke Penjualan · 0 item</button>');
      byId('menuToSaleBtn')?.addEventListener('click', () => setMode('sales'));
    }

    if (!byId('cashierOrderSourceTabs')) {
      const header = orderSection.querySelector('.cashier-header');
      header?.insertAdjacentHTML('afterend', `
        <div id="cashierOrderSourceTabs" class="cashier-order-source-tabs" role="group" aria-label="Sumber pesanan">
          <button type="button" class="active" data-order-source="customer">Dari Customer</button>
          <button type="button" data-order-source="cashier">Dari Kasir</button>
        </div>`);
      document.querySelectorAll('[data-order-source]').forEach(button => {
        button.addEventListener('click', () => {
          orderSourceFilter = button.dataset.orderSource === 'cashier' ? 'cashier' : 'customer';
          document.querySelectorAll('[data-order-source]').forEach(item => item.classList.toggle('active', item.dataset.orderSource === orderSourceFilter));
          renderOrders();
        });
      });
    }

    const statLabels = orderSection.querySelectorAll('.stat .muted');
    if (statLabels[0]) statLabels[0].textContent = 'Dipesan';
    if (statLabels[1]) statLabels[1].textContent = 'Diterima';
    if (statLabels[2]) statLabels[2].textContent = 'Dibuat';
    const columnHeadings = orderSection.querySelectorAll('.column-title h2');
    if (columnHeadings[0]) columnHeadings[0].textContent = '🧾 Dipesan';
    if (columnHeadings[1]) columnHeadings[1].textContent = '🤝 Diterima';
    if (columnHeadings[2]) columnHeadings[2].textContent = '🥞 Dibuat';
    const doneHeading = orderSection.querySelector('.done-list h2');
    if (doneHeading) doneHeading.textContent = '✅ Sudah Jadi';
    const doneSection = orderSection.querySelector('.done-list');
    if (doneSection && !byId('rejectedList')) {
      doneSection.insertAdjacentHTML('afterend', '<section class="cashier-rejected-block"><h2>🚫 Ditolak</h2><div id="rejectedList"></div></section>');
    }

    bindTrackedSaleButton();
    setMode(activeMode);
    renderSearchResults();
    updateNavigationCounts();
  }

  function setMode(mode) {
    const posLayout = document.querySelector('.cashier-pos-layout');
    const menuPanel = document.querySelector('.cashier-menu-panel');
    const draftPanel = document.querySelector('.cashier-draft-panel');
    const orderSection = document.querySelector('.cashier-order-section');
    if (!posLayout || !menuPanel || !draftPanel || !orderSection) return;
    activeMode = ['sales', 'menu', 'orders'].includes(mode) ? mode : 'sales';

    posLayout.classList.toggle('hidden', activeMode === 'orders');
    orderSection.classList.toggle('hidden', activeMode !== 'orders');
    menuPanel.classList.toggle('hidden', activeMode === 'sales');
    draftPanel.classList.toggle('hidden', activeMode === 'orders');
    posLayout.classList.toggle('cashier-sales-only', activeMode === 'sales');

    document.querySelectorAll('[data-cashier-workspace-mode]').forEach(button => {
      button.classList.toggle('active', button.dataset.cashierWorkspaceMode === activeMode);
    });
    if (activeMode === 'sales') setTimeout(() => byId('cashierProductSearch')?.focus(), 30);
    if (activeMode === 'orders') renderOrders();
  }

  function renderSearchResults() {
    const input = byId('cashierProductSearch');
    const target = byId('cashierSearchResults');
    if (!input || !target) return;
    const query = input.value.trim().toLocaleLowerCase('id-ID');
    if (!query) {
      target.innerHTML = '';
      target.classList.add('hidden');
      return;
    }
    const matches = [];
    for (const product of state.products || []) {
      if (matches.length >= 10) break;
      if (product.isActive === false) continue;
      const haystack = `${product.name || ''} ${product.category || ''}`.toLocaleLowerCase('id-ID');
      if (haystack.includes(query)) matches.push(product);
    }
    target.innerHTML = matches.length ? matches.map(product => `
      <button class="cashier-search-result" type="button" data-search-product="${Number(product.id)}">
        <span><strong>${esc(product.name)}</strong><small>${esc(product.category || 'Tanpa kategori')} · ${money(product.price)}</small></span>
        <span class="cashier-search-add">＋ Tambah</span>
      </button>`).join('') : '<div class="empty">Barang tidak ditemukan.</div>';
    target.classList.remove('hidden');
    target.querySelectorAll('[data-search-product]').forEach(button => {
      button.addEventListener('click', () => {
        changeDraft(Number(button.dataset.searchProduct), 1);
        input.value = '';
        target.innerHTML = '';
        target.classList.add('hidden');
        input.focus();
      });
    });
  }

  function snapshotOrderToDraft(order) {
    draftOriginOrderId = order.id;
    state.draft.clear();
    for (const item of order.items || []) {
      const product = {
        id: Number(item.menuId),
        name: item.name,
        price: Number(item.price),
        category: ''
      };
      state.draft.set(product.id, { product, quantity: Number(item.qty) });
    }
    if (byId('saleCustomerName')) byId('saleCustomerName').value = order.customerName || '';
    if (byId('saleNote')) byId('saleNote').value = order.generalNote || '';
    renderDraft();
    setMode('sales');
  }

  function orderHistoryRows(orders, emptyText) {
    if (!orders.length) return `<div class="muted">${esc(emptyText)}</div>`;
    return orders.slice(0, 30).map(order => `
      <div class="cashier-rejected-row">
        <span><b>${esc(order.orderNo)}</b> · ${esc(order.customerName)} <span class="cashier-order-status-label">· ${order.status === 'COMPLETED' ? 'Sudah Jadi' : 'Ditolak'}</span></span>
        <span>${money(order.total)}</span>
      </div>`).join('');
  }

  const baseRenderMenu = renderMenu;
  renderMenu = function renderMenuWithSearch() {
    baseRenderMenu();
    renderSearchResults();
    updateNavigationCounts();
  };

  const baseRenderDraft = renderDraft;
  renderDraft = function renderDraftWithNavigation() {
    baseRenderDraft();
    updateNavigationCounts();
  };

  updateStatus = async function updateTrackedOrderStatus(id, status) {
    try {
      const data = await api(`/api/cashier/orders/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      const index = state.orders.findIndex(order => order.id === data.id);
      if (index >= 0) state.orders[index] = data;
      if (status === 'PREPARING' && normalizeSource(data) === 'customer') snapshotOrderToDraft(data);
      renderOrders();
    } catch (error) {
      toast(error.message);
      await loadDrawer().catch(() => {});
    }
  };

  async function processTrackedSale() {
    if (!state.canWrite || !state.draft.size) return;
    try {
      const payload = await api('/api/cashier/sales', {
        method: 'POST',
        body: JSON.stringify({
          customerName: byId('saleCustomerName').value,
          note: byId('saleNote').value,
          sourceOrderId: draftOriginOrderId,
          items: [...state.draft.values()].map(line => ({ productId: line.product.id, quantity: line.quantity }))
        })
      });
      if (payload.order) state.orders.unshift(payload.order);
      draftOriginOrderId = null;
      state.draft.clear();
      byId('saleCustomerName').value = '';
      byId('saleNote').value = '';
      renderDraft();
      renderOrders();
      toast(`Penjualan tersimpan · ${money(payload.sale.total)}`);
    } catch (error) {
      toast(error.message);
      await loadDrawer().catch(() => {});
    }
  }

  renderOrderGroup = function renderOrderLifecycleGroup(orders, status) {
    if (!orders.length) return '<div class="empty">Queue kosong.</div>';
    const disabled = state.canWrite ? '' : 'disabled title="Buka laci atau tunggu pemegang laci"';
    return orders.map(order => {
      const actions = status === 'NEW'
        ? `<button class="action-btn action-prep" ${disabled} data-id="${esc(order.id)}" data-status="PREPARING">Terima Pesanan</button><button class="action-btn action-cancel" ${disabled} data-id="${esc(order.id)}" data-status="CANCELLED">Tolak</button>`
        : status === 'PREPARING'
          ? `<button class="action-btn action-ready" ${disabled} data-id="${esc(order.id)}" data-status="READY">Mulai Buat</button>`
          : `<button class="action-btn action-done" ${disabled} data-id="${esc(order.id)}" data-status="COMPLETED">Sudah Jadi</button>`;
      return `<article class="order-card ${status === 'READY' ? 'ready' : ''}">
        <div class="order-top"><div><h3>${esc(order.orderNo)}</h3><div class="customer-meta">${esc(order.customerName)} · ${normalizeSource(order) === 'cashier' ? 'Kasir' : 'Customer'}</div></div><div class="time">${formatTime(order.createdAt)}</div></div>
        <ul class="order-items">${(order.items || []).map(item => `<li><b>${item.qty}×</b> ${esc(item.name)} <span style="float:right">${money(item.price * item.qty)}</span>${item.note ? `<div class="item-note">↳ ${esc(item.note)}</div>` : ''}</li>`).join('')}</ul>
        ${order.generalNote ? `<div class="general-note"><b>Catatan umum:</b> ${esc(order.generalNote)}</div>` : ''}
        <div class="order-total"><span>Total</span><span>${money(order.total)}</span></div>
        <div class="actions">${actions}</div>
      </article>`;
    }).join('');
  };

  renderOrders = function renderRequestedOrderLifecycle() {
    if (!byId('statNew')) return;
    const groups = { NEW: [], PREPARING: [], READY: [], COMPLETED: [], CANCELLED: [] };
    for (const order of state.orders || []) {
      if (normalizeSource(order) !== orderSourceFilter || !belongsToActiveDrawer(order)) continue;
      if (groups[order.status]) groups[order.status].push(order);
    }
    byId('statNew').textContent = groups.NEW.length;
    byId('statPrep').textContent = groups.PREPARING.length;
    byId('statReady').textContent = groups.READY.length;
    byId('badgeNew').textContent = groups.NEW.length;
    byId('badgePrep').textContent = groups.PREPARING.length;
    byId('badgeReady').textContent = groups.READY.length;
    byId('colNew').innerHTML = renderOrderGroup(groups.NEW, 'NEW');
    byId('colPrep').innerHTML = renderOrderGroup(groups.PREPARING, 'PREPARING');
    byId('colReady').innerHTML = renderOrderGroup(groups.READY, 'READY');
    byId('doneList').innerHTML = orderHistoryRows(groups.COMPLETED, 'Belum ada pesanan yang sudah jadi.');
    if (byId('rejectedList')) byId('rejectedList').innerHTML = orderHistoryRows(groups.CANCELLED, 'Belum ada pesanan ditolak.');
    document.querySelectorAll('[data-status]').forEach(button => {
      button.onclick = () => updateStatus(button.dataset.id, button.dataset.status);
    });
    updateNavigationCounts();
  };

  function updateNavigationCounts() {
    let draftCount = 0;
    for (const line of state.draft.values()) draftCount += Number(line.quantity || 0);
    let pendingOrders = 0;
    for (const order of state.orders || []) {
      if (!belongsToActiveDrawer(order)) continue;
      if (order.status === 'NEW' || order.status === 'PREPARING' || order.status === 'READY') pendingOrders += 1;
    }
    if (byId('cashierSalesCount')) byId('cashierSalesCount').textContent = draftCount;
    if (byId('cashierMenuDraftCount')) byId('cashierMenuDraftCount').textContent = draftCount;
    if (byId('cashierOrdersCount')) byId('cashierOrdersCount').textContent = pendingOrders;
    if (byId('menuToSaleBtn')) byId('menuToSaleBtn').textContent = `🧾 Lanjut ke Penjualan · ${draftCount} item`;
  }

  ensureNavigation();
})();
