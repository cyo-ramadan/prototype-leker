(() => {
  const MASTER_TABS = ['products', 'categories', 'suppliers', 'customers', 'cashiers', 'costmasters', 'manufacturing', 'stock-adjustment-forms'];
  const stockAdjustmentState = { forms: [], products: [], editingId: null };
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));

  async function stockAdjustmentApi(path, init = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function stockAdjustmentToast(message) {
    const node = document.getElementById('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(stockAdjustmentToast.timer);
    stockAdjustmentToast.timer = setTimeout(() => node.classList.remove('show'), 2200);
  }

  function renderStockAdjustmentFormEditor() {
    const target = document.getElementById('stockAdjustmentFormProducts');
    if (!target) return;
    const current = stockAdjustmentState.forms.find(form => form.id === stockAdjustmentState.editingId) || null;
    const selected = new Set(current?.productIds || []);
    const name = document.getElementById('stockAdjustmentFormName');
    const active = document.getElementById('stockAdjustmentFormActive');
    const title = document.getElementById('stockAdjustmentFormEditorTitle');
    if (name) name.value = current?.name || '';
    if (active) active.checked = current ? current.isActive : true;
    if (title) title.textContent = current ? 'Edit Form Penyesuaian' : 'Buat Form Penyesuaian';
    target.innerHTML = stockAdjustmentState.products.length ? stockAdjustmentState.products.map(product => `
      <label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:10px">
        <input type="checkbox" value="${Number(product.productId)}" data-stock-adjustment-form-product ${selected.has(Number(product.productId)) ? 'checked' : ''} />
        <span><b>${esc(product.productName)}</b><small class="muted" style="display:block">${esc(product.unitSymbol || '')}</small></span>
      </label>`).join('') : '<div class="empty">Belum ada barang aktif dengan stock tracking.</div>';
    document.getElementById('stockAdjustmentFormCancel')?.classList.toggle('hidden', !current);
  }

  function renderStockAdjustmentForms() {
    const target = document.getElementById('stockAdjustmentFormsList');
    if (!target) return;
    const productById = new Map(stockAdjustmentState.products.map(product => [Number(product.productId), product]));
    target.innerHTML = stockAdjustmentState.forms.length ? stockAdjustmentState.forms.map(form => {
      const names = (form.productIds || []).map(id => productById.get(Number(id))?.productName).filter(Boolean);
      return `<article class="master-row">
        <div class="master-main"><strong>${esc(form.name)}</strong><div class="master-meta">${form.isActive ? 'Aktif' : 'Nonaktif'} · ${names.length} barang</div><div class="master-meta">${esc(names.join(', ') || 'Belum ada barang')}</div></div>
        <div class="master-actions"><button class="mini-btn" type="button" data-stock-adjustment-form-edit="${esc(form.id)}">Edit</button></div>
      </article>`;
    }).join('') : '<div class="empty">Belum ada Form Penyesuaian.</div>';
    target.querySelectorAll('[data-stock-adjustment-form-edit]').forEach(button => button.addEventListener('click', () => {
      stockAdjustmentState.editingId = button.dataset.stockAdjustmentFormEdit;
      renderStockAdjustmentFormEditor();
      document.getElementById('stockAdjustmentFormName')?.focus();
    }));
  }

  async function loadStockAdjustmentForms() {
    try {
      const payload = await stockAdjustmentApi('/api/management/stock-adjustment-forms');
      stockAdjustmentState.forms = payload.forms || [];
      stockAdjustmentState.products = payload.products || [];
      if (stockAdjustmentState.editingId && !stockAdjustmentState.forms.some(form => form.id === stockAdjustmentState.editingId)) stockAdjustmentState.editingId = null;
      renderStockAdjustmentForms();
      renderStockAdjustmentFormEditor();
    } catch (error) { stockAdjustmentToast(error.message); }
  }

  async function saveStockAdjustmentForm(event) {
    event.preventDefault();
    const name = String(document.getElementById('stockAdjustmentFormName')?.value || '').trim();
    const productIds = [...document.querySelectorAll('[data-stock-adjustment-form-product]:checked')].map(input => Number(input.value));
    if (!name || !productIds.length) return stockAdjustmentToast('Nama dan minimal satu barang wajib dipilih.');
    const editing = stockAdjustmentState.forms.find(form => form.id === stockAdjustmentState.editingId) || null;
    try {
      await stockAdjustmentApi(
        editing ? `/api/management/stock-adjustment-forms/${encodeURIComponent(editing.id)}` : '/api/management/stock-adjustment-forms',
        {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify({
            name,
            productIds,
            isActive: document.getElementById('stockAdjustmentFormActive')?.checked !== false
          })
        }
      );
      stockAdjustmentState.editingId = null;
      await loadStockAdjustmentForms();
      stockAdjustmentToast(editing ? 'Form Penyesuaian diperbarui.' : 'Form Penyesuaian dibuat.');
    } catch (error) { stockAdjustmentToast(error.message); }
  }

  function activateStockAdjustmentForms() {
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === 'stock-adjustment-forms'));
    document.getElementById('adminMasterMenuToggle')?.classList.add('active');
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-stock-adjustment-forms'));
    loadStockAdjustmentForms();
  }

  function mountStockAdjustmentForms(tabs) {
    const toastNode = document.getElementById('adminToast');
    if (!toastNode || document.getElementById('tab-stock-adjustment-forms')) return;
    const hiddenTab = document.createElement('button');
    hiddenTab.className = 'admin-tab';
    hiddenTab.type = 'button';
    hiddenTab.dataset.tab = 'stock-adjustment-forms';
    hiddenTab.textContent = 'Form Penyesuaian';
    hiddenTab.style.display = 'none';
    tabs.appendChild(hiddenTab);
    hiddenTab.addEventListener('click', activateStockAdjustmentForms);
    toastNode.insertAdjacentHTML('beforebegin', `
      <section id="tab-stock-adjustment-forms" class="admin-section">
        <div class="admin-card">
          <div class="list-head"><div><div class="admin-eyebrow">Master Inventory</div><h2>Form Penyesuaian</h2><div class="muted">Checklist barang siap pakai untuk stock opname. Form hanya mengisi daftar; kasir tetap memasukkan Qty Sebenarnya dan mengikuti Approval Queue.</div></div><button id="stockAdjustmentFormsRefresh" class="secondary-btn" type="button">↻ Refresh</button></div>
          <div id="stockAdjustmentFormsList" class="master-list" style="margin-top:12px"></div>
        </div>
        <form id="stockAdjustmentFormEditor" class="admin-card" style="margin-top:14px">
          <div class="list-head"><div><div class="admin-eyebrow">Checklist Gerai</div><h2 id="stockAdjustmentFormEditorTitle">Buat Form Penyesuaian</h2></div></div>
          <label class="admin-field" style="margin-top:12px">Nama Form<input id="stockAdjustmentFormName" maxlength="120" placeholder="Contoh: SO Standard" required /></label>
          <label style="display:flex;align-items:center;gap:8px;margin:12px 0"><input id="stockAdjustmentFormActive" type="checkbox" checked /> Form aktif dan terlihat oleh kasir</label>
          <div class="muted" style="margin-bottom:8px">Pilih minimal satu barang stock-tracked.</div>
          <div id="stockAdjustmentFormProducts" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button id="stockAdjustmentFormCancel" class="secondary-btn hidden" type="button">Batal Edit</button><button class="primary-btn" type="submit">Simpan Form</button></div>
        </form>
      </section>`);
    document.getElementById('stockAdjustmentFormsRefresh')?.addEventListener('click', loadStockAdjustmentForms);
    document.getElementById('stockAdjustmentFormEditor')?.addEventListener('submit', saveStockAdjustmentForm);
    document.getElementById('stockAdjustmentFormCancel')?.addEventListener('click', () => {
      stockAdjustmentState.editingId = null;
      renderStockAdjustmentFormEditor();
    });
  }

  function injectStyle() {
    if (document.getElementById('adminMasterMenuStyle')) return;
    const style = document.createElement('style');
    style.id = 'adminMasterMenuStyle';
    style.textContent = `
      .admin-master-menu{position:relative;display:inline-flex;flex:0 0 auto}
      .admin-master-menu-toggle{white-space:nowrap}
      .admin-master-menu-panel{position:fixed;z-index:120;width:min(280px,calc(100vw - 24px));max-height:60vh;overflow:auto;background:#fff;border:1px solid var(--line);border-radius:16px;padding:8px;box-shadow:0 18px 44px rgba(0,0,0,.13);display:none}
      .admin-master-menu-panel.open{display:grid;gap:4px}
      .admin-master-menu-panel button{width:100%;text-align:left;border:0;background:transparent;border-radius:10px;padding:10px 11px;font-weight:800;cursor:pointer;color:var(--ink)}
      .admin-master-menu-panel button:hover,.admin-master-menu-panel button:focus-visible{background:#f7f1ea;outline:none}
      .admin-master-menu-separator{height:1px;background:var(--line);margin:4px 2px}
    `;
    document.head.appendChild(style);
  }

  function enforceIntegerMasterUi() {
    const decimalSelect = document.getElementById('unitDecimalScale');
    if (decimalSelect) {
      decimalSelect.value = '0';
      const label = decimalSelect.closest('label');
      if (label) label.style.display = 'none';
    }
    const outputQty = document.getElementById('recipeOutputQty');
    if (outputQty) {
      outputQty.min = '1';
      outputQty.step = '1';
      if (!Number.isInteger(Number(outputQty.value)) || Number(outputQty.value) < 1) outputQty.value = '1';
    }
    document.querySelectorAll('[data-component-qty]').forEach(input => {
      input.min = '1';
      input.step = '1';
      if (!Number.isInteger(Number(input.value)) || Number(input.value) < 1) input.value = '1';
    });
    const manufacturing = document.getElementById('tab-manufacturing');
    if (manufacturing) {
      const eyebrow = manufacturing.querySelector('.admin-eyebrow');
      if (eyebrow) eyebrow.textContent = 'Master Teknis';
      const heading = manufacturing.querySelector('.list-head h2');
      if (heading && heading.textContent.includes('Barang, Satuan')) heading.textContent = 'Peran Barang, Klasifikasi Accounting, Satuan & Resep';
      const muted = manufacturing.querySelector('.list-head .muted');
      if (muted) muted.textContent = 'Master reusable untuk tipe operasional, jenis/accounting classification, satuan terkecil, dan recipe/BOM. Konfigurasi per barang dilakukan dari Master Barang.';
    }
  }

  function mount() {
    injectStyle();
    const tabs = document.querySelector('.admin-tabs');
    if (!tabs || document.getElementById('adminMasterMenu')) return;

    const storeTab = tabs.querySelector('[data-tab="store"]');
    const wrapper = document.createElement('div');
    wrapper.id = 'adminMasterMenu';
    wrapper.className = 'admin-master-menu';
    wrapper.innerHTML = `
      <button id="adminMasterMenuToggle" class="admin-tab admin-master-menu-toggle" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="adminMasterMenuPanel"><span id="adminMasterMenuLabel">Master</span> ▾</button>`;
    if (storeTab?.nextSibling) tabs.insertBefore(wrapper, storeTab.nextSibling);
    else tabs.appendChild(wrapper);

    const panel = document.createElement('div');
    panel.id = 'adminMasterMenuPanel';
    panel.className = 'admin-master-menu-panel';
    panel.setAttribute('role', 'menu');
    panel.innerHTML = `
      <button type="button" role="menuitem" data-master-open="products">Master Barang</button>
      <button type="button" role="menuitem" data-master-open="categories">Kategori</button>
      <button type="button" role="menuitem" data-master-open="suppliers">Supplier</button>
      <button type="button" role="menuitem" data-master-open="customers">Pelanggan</button>
      <button type="button" role="menuitem" data-master-open="cashiers">Kasir / Staf</button>
      <button type="button" role="menuitem" data-master-open="costmasters">Biaya</button>
      <button type="button" role="menuitem" data-master-open="stock-adjustment-forms">Form Penyesuaian</button>
      <div class="admin-master-menu-separator"></div>
      <button type="button" role="menuitem" data-master-open="manufacturing" data-master-target="itemTypeForm">Peran Barang</button>
      <button type="button" role="menuitem" data-master-open="manufacturing" data-master-target="productKindMasterCard">Klasifikasi Accounting</button>
      <button type="button" role="menuitem" data-master-open="manufacturing" data-master-target="unitForm">Satuan</button>
      <button type="button" role="menuitem" data-master-open="manufacturing" data-master-target="recipeForm">Resep / BOM</button>`;
    document.body.appendChild(panel);
    mountStockAdjustmentForms(tabs);

    for (const tab of MASTER_TABS) {
      const button = tabs.querySelector(`[data-tab="${tab}"]`);
      if (button) button.style.display = 'none';
    }
    const legacyContacts = tabs.querySelector('[data-tab="contacts"]');
    if (legacyContacts) legacyContacts.style.display = 'none';

    const toggle = document.getElementById('adminMasterMenuToggle');

    function positionPanel() {
      if (!panel.classList.contains('open') || !toggle) return;
      const rect = toggle.getBoundingClientRect();
      const gap = 8;
      const viewportPadding = 12;
      const panelWidth = Math.min(280, Math.max(0, window.innerWidth - (viewportPadding * 2)));
      const left = Math.min(
        Math.max(viewportPadding, rect.left),
        Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding)
      );
      const below = Math.max(0, window.innerHeight - rect.bottom - viewportPadding - gap);
      const above = Math.max(0, rect.top - viewportPadding - gap);
      const openBelow = below >= 220 || below >= above;

      panel.style.left = `${left}px`;
      panel.style.right = 'auto';
      if (openBelow) {
        panel.style.top = `${rect.bottom + gap}px`;
        panel.style.bottom = 'auto';
        panel.style.maxHeight = `${Math.max(120, below)}px`;
      } else {
        panel.style.top = 'auto';
        panel.style.bottom = `${window.innerHeight - rect.top + gap}px`;
        panel.style.maxHeight = `${Math.max(120, above)}px`;
      }
    }

    function closeMenu() {
      panel.classList.remove('open');
      toggle?.setAttribute('aria-expanded', 'false');
    }

    function openMenu() {
      panel.classList.add('open');
      toggle?.setAttribute('aria-expanded', 'true');
      positionPanel();
    }

    function openTab(tab, targetId = '') {
      if (tab === 'stock-adjustment-forms') {
        activateStockAdjustmentForms();
        closeMenu();
        const label = document.getElementById('adminMasterMenuLabel');
        if (label) label.textContent = 'Master · Form Penyesuaian';
        return;
      }
      const button = tabs.querySelector(`[data-tab="${tab}"]`);
      if (!button) return;
      button.click();
      closeMenu();
      const label = document.getElementById('adminMasterMenuLabel');
      const names = {
        products: 'Barang', categories: 'Kategori', suppliers: 'Supplier', customers: 'Pelanggan', cashiers: 'Kasir', costmasters: 'Biaya', manufacturing: 'Master Teknis', 'stock-adjustment-forms': 'Form Penyesuaian'
      };
      if (label) label.textContent = `Master · ${names[tab] || tab}`;
      if (targetId) setTimeout(() => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
    }

    toggle?.addEventListener('click', event => {
      event.stopPropagation();
      if (panel.classList.contains('open')) closeMenu();
      else openMenu();
    });

    panel.querySelectorAll('[data-master-open]').forEach(button => button.addEventListener('click', () => {
      openTab(button.dataset.masterOpen, button.dataset.masterTarget || '');
    }));

    document.addEventListener('click', event => {
      if (!wrapper.contains(event.target) && !panel.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMenu();
    });
    window.addEventListener('resize', positionPanel, { passive: true });
    window.addEventListener('scroll', positionPanel, { passive: true, capture: true });

    for (const tab of MASTER_TABS) {
      tabs.querySelector(`[data-tab="${tab}"]`)?.addEventListener('click', () => {
        toggle?.classList.add('active');
      });
    }
    tabs.querySelectorAll('.admin-tab:not([style*="display: none"])').forEach(button => {
      if (button.id === 'adminMasterMenuToggle') return;
      button.addEventListener('click', () => {
        toggle?.classList.remove('active');
        closeMenu();
      });
    });

    enforceIntegerMasterUi();
    const components = document.getElementById('recipeComponents');
    if (components) new MutationObserver(enforceIntegerMasterUi).observe(components, { childList: true, subtree: true });
  }

  mount();
})();
