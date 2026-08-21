(() => {
  const MASTER_TABS = ['products', 'categories', 'suppliers', 'customers', 'cashiers', 'costmasters', 'manufacturing'];

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

      .product-master-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0 2px}
      .product-master-search{position:relative;display:flex;align-items:center;flex:1 1 320px;min-width:220px}
      .product-master-search::before{content:'⌕';position:absolute;left:12px;font-size:20px;line-height:1;color:var(--muted);pointer-events:none}
      .product-master-search input{width:100%;min-width:0;border:1px solid var(--line);border-radius:12px;background:#fff;padding:10px 12px 10px 38px;font:inherit;color:var(--ink);outline:none}
      .product-master-search input:focus{border-color:#b98253;box-shadow:0 0 0 3px rgba(185,130,83,.14)}
      .product-master-search-meta{font-size:12px;font-weight:800;color:var(--muted);white-space:nowrap}
      .product-master-shortcut{border:1px solid var(--line);border-radius:11px;background:#fff;padding:9px 11px;font:inherit;font-size:12px;font-weight:900;color:var(--ink);cursor:pointer;white-space:nowrap}
      .product-master-shortcut:hover,.product-master-shortcut:focus-visible{background:#f7f1ea;outline:none}
      #productList .master-row[hidden]{display:none!important}

      @media (min-width:901px){
        #tab-products #productForm{box-sizing:border-box;max-height:calc(100vh - 112px);max-height:calc(100dvh - 112px);overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding-right:18px}
        #tab-products .list-card{box-sizing:border-box;position:sticky;top:92px;max-height:calc(100vh - 112px);max-height:calc(100dvh - 112px);display:flex;flex-direction:column;min-height:0}
        #tab-products .list-card #productList{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding-right:4px}
      }
      @media (max-width:900px){
        #tab-products #productForm,#tab-products .list-card{position:static;max-height:none;overflow:visible}
        #tab-products .list-card #productList{overflow:visible;max-height:none;padding-right:0}
        .product-master-search{flex-basis:100%;min-width:100%}
      }
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

  function mountProductMasterUx() {
    const productList = document.getElementById('productList');
    const listCard = productList?.closest('.list-card');
    if (!productList || !listCard || document.getElementById('productMasterTools')) return;

    const tools = document.createElement('div');
    tools.id = 'productMasterTools';
    tools.className = 'product-master-tools';
    tools.innerHTML = `
      <label class="product-master-search" for="productSearch">
        <span class="sr-only">Cari barang</span>
        <input id="productSearch" type="search" autocomplete="off" placeholder="Cari nama, kategori, peran barang..." aria-label="Cari barang di Master Barang" />
      </label>
      <span id="productSearchMeta" class="product-master-search-meta" aria-live="polite">0 barang</span>
      <button id="productSettingsShortcut" class="product-master-shortcut" type="button">⚙ Pengaturan</button>`;
    listCard.insertBefore(tools, productList);

    const search = document.getElementById('productSearch');
    const meta = document.getElementById('productSearchMeta');
    const settingsShortcut = document.getElementById('productSettingsShortcut');
    const normalize = value => String(value ?? '').trim().toLocaleLowerCase('id-ID');

    function applyProductFilter() {
      const query = normalize(search?.value);
      const rows = [...productList.querySelectorAll('.master-row')];
      let visible = 0;
      for (const row of rows) {
        const matches = !query || normalize(row.textContent).includes(query);
        row.hidden = !matches;
        if (matches) visible += 1;
      }
      if (!meta) return;
      if (!rows.length) meta.textContent = 'Belum ada barang';
      else if (!query) meta.textContent = `${rows.length} barang`;
      else if (!visible) meta.textContent = `0 dari ${rows.length} · tidak ada yang cocok`;
      else meta.textContent = `${visible} dari ${rows.length} barang`;
    }

    let filterScheduled = false;
    function scheduleFilter() {
      if (filterScheduled) return;
      filterScheduled = true;
      queueMicrotask(() => {
        filterScheduled = false;
        applyProductFilter();
      });
    }

    search?.addEventListener('input', applyProductFilter);
    search?.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !search.value) return;
      search.value = '';
      applyProductFilter();
    });

    settingsShortcut?.addEventListener('click', () => {
      const details = document.getElementById('productOperationalDetails');
      const form = document.getElementById('productForm');
      if (details) {
        details.open = true;
        details.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    productList.addEventListener('click', event => {
      if (!event.target.closest?.('[data-edit-product]')) return;
      if (!window.matchMedia('(min-width: 901px)').matches) return;
      requestAnimationFrame(() => document.getElementById('productForm')?.scrollTo({ top: 0, behavior: 'smooth' }));
    });

    new MutationObserver(scheduleFilter).observe(productList, { childList: true, subtree: true });
    applyProductFilter();
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
      <div class="admin-master-menu-separator"></div>
      <button type="button" role="menuitem" data-master-open="manufacturing" data-master-target="itemTypeForm">Peran Barang</button>
      <button type="button" role="menuitem" data-master-open="manufacturing" data-master-target="productKindMasterCard">Klasifikasi Accounting</button>
      <button type="button" role="menuitem" data-master-open="manufacturing" data-master-target="unitForm">Satuan</button>
      <button type="button" role="menuitem" data-master-open="manufacturing" data-master-target="recipeForm">Resep / BOM</button>`;
    document.body.appendChild(panel);

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
      const button = tabs.querySelector(`[data-tab="${tab}"]`);
      if (!button) return;
      button.click();
      closeMenu();
      const label = document.getElementById('adminMasterMenuLabel');
      const names = {
        products: 'Barang', categories: 'Kategori', suppliers: 'Supplier', customers: 'Pelanggan', cashiers: 'Kasir', costmasters: 'Biaya', manufacturing: 'Master Teknis'
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
    mountProductMasterUx();
    const components = document.getElementById('recipeComponents');
    if (components) new MutationObserver(enforceIntegerMasterUi).observe(components, { childList: true, subtree: true });
  }

  mount();
})();
