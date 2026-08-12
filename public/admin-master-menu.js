(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const MASTER_TABS = ['products', 'categories', 'suppliers', 'customers', 'cashiers', 'manufacturing'];

  function injectStyle() {
    if (document.getElementById('adminMasterMenuStyle')) return;
    const style = document.createElement('style');
    style.id = 'adminMasterMenuStyle';
    style.textContent = `
      .admin-master-menu{position:relative;display:inline-flex}
      .admin-master-menu-toggle{white-space:nowrap}
      .admin-master-menu-panel{position:absolute;z-index:30;top:calc(100% + 8px);left:0;min-width:230px;background:#fff;border:1px solid var(--line);border-radius:16px;padding:8px;box-shadow:0 18px 44px rgba(0,0,0,.13);display:none}
      .admin-master-menu.open .admin-master-menu-panel{display:grid;gap:4px}
      .admin-master-menu-panel button{width:100%;text-align:left;border:0;background:transparent;border-radius:10px;padding:10px 11px;font-weight:800;cursor:pointer}
      .admin-master-menu-panel button:hover{background:#f7f1ea}
      .admin-master-menu-separator{height:1px;background:var(--line);margin:4px 2px}
    `;
    document.head.appendChild(style);
  }

  function openTab(tab, targetId = '') {
    const button = document.querySelector(`[data-tab="${tab}"]`);
    if (!button) return;
    button.click();
    document.getElementById('adminMasterMenu')?.classList.remove('open');
    const label = document.getElementById('adminMasterMenuLabel');
    const names = {
      products: 'Barang', categories: 'Kategori', suppliers: 'Supplier', customers: 'Pelanggan', cashiers: 'Kasir', manufacturing: 'Master Teknis'
    };
    if (label) label.textContent = `Master · ${names[tab] || tab}`;
    if (targetId) setTimeout(() => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
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
      if (eyebrow) eyebrow.textContent = 'Master Data';
      const heading = manufacturing.querySelector('.list-head h2');
      if (heading && heading.textContent.includes('Barang, Satuan')) heading.textContent = 'Tipe Barang, Satuan & Resep';
      const muted = manufacturing.querySelector('.list-head .muted');
      if (muted) muted.textContent = 'Master teknis untuk klasifikasi barang, satuan terkecil, recipe/BOM, produksi, dan costing/HPP.';
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
      <button id="adminMasterMenuToggle" class="admin-tab admin-master-menu-toggle" type="button"><span id="adminMasterMenuLabel">Master</span> ▾</button>
      <div class="admin-master-menu-panel" role="menu">
        <button type="button" data-master-open="products">Barang</button>
        <button type="button" data-master-open="categories">Kategori</button>
        <button type="button" data-master-open="suppliers">Supplier</button>
        <button type="button" data-master-open="customers">Pelanggan</button>
        <button type="button" data-master-open="cashiers">Kasir / Staf</button>
        <div class="admin-master-menu-separator"></div>
        <button type="button" data-master-open="manufacturing" data-master-target="itemTypeForm">Tipe Barang</button>
        <button type="button" data-master-open="manufacturing" data-master-target="unitForm">Satuan</button>
        <button type="button" data-master-open="manufacturing" data-master-target="recipeForm">Resep / BOM</button>
      </div>`;
    if (storeTab?.nextSibling) tabs.insertBefore(wrapper, storeTab.nextSibling);
    else tabs.appendChild(wrapper);

    for (const tab of MASTER_TABS) {
      const button = tabs.querySelector(`[data-tab="${tab}"]`);
      if (button) button.style.display = 'none';
    }
    const legacyContacts = tabs.querySelector('[data-tab="contacts"]');
    if (legacyContacts) legacyContacts.style.display = 'none';

    document.getElementById('adminMasterMenuToggle')?.addEventListener('click', event => {
      event.stopPropagation();
      wrapper.classList.toggle('open');
    });
    wrapper.querySelectorAll('[data-master-open]').forEach(button => button.addEventListener('click', () => {
      openTab(button.dataset.masterOpen, button.dataset.masterTarget || '');
    }));
    document.addEventListener('click', event => {
      if (!wrapper.contains(event.target)) wrapper.classList.remove('open');
    });

    for (const tab of MASTER_TABS) {
      tabs.querySelector(`[data-tab="${tab}"]`)?.addEventListener('click', () => {
        document.getElementById('adminMasterMenuToggle')?.classList.add('active');
      });
    }
    tabs.querySelectorAll('.admin-tab:not([style*="display: none"])').forEach(button => {
      if (button.id === 'adminMasterMenuToggle') return;
      button.addEventListener('click', () => document.getElementById('adminMasterMenuToggle')?.classList.remove('active'));
    });

    enforceIntegerMasterUi();
    const components = document.getElementById('recipeComponents');
    if (components) new MutationObserver(enforceIntegerMasterUi).observe(components, { childList: true, subtree: true });
  }

  mount();
})();
