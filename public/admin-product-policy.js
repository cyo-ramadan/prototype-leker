(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const state = { editor: null, activeProductId: 0, loading: null };

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function toast(message) {
    const node = el('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 2400);
  }

  function mountProductFields() {
    const form = el('productForm');
    const category = el('productCategory')?.closest('label');
    if (!form || !category || el('productMasterFields')) return;
    category.insertAdjacentHTML('afterend', `
      <div id="productMasterFields">
        <div class="admin-grid two compact">
          <label class="admin-field">Tipe Barang<select id="productItemType" required></select></label>
          <label class="admin-field">Satuan Dasar<select id="productBaseUnit" required></select></label>
        </div>
        <label class="admin-field">Poin per 1 barang<input id="productPointsPerUnit" type="number" min="0" step="1" value="0" required /></label>
        <label class="admin-check"><input id="productStockTracking" type="checkbox" checked /> Track & enforce stok</label>
        <label class="admin-field">Mode Pemenuhan<select id="productProductionMode"><option value="STOCK">STOCK · jual dari stok tersedia</option><option value="DADAKAN">DADAKAN · produksi dulu sesuai resep lalu jual</option></select></label>
        <label class="admin-field">Recipe Linked<select id="productLinkedRecipe"><option value="">Tidak terhubung</option></select></label>
        <div id="productRecipeNote" class="muted" style="margin:-5px 0 12px"></div>
        <details id="productAccountingPortal" class="admin-card" style="padding:12px;margin:4px 0 14px;box-shadow:none">
          <summary style="cursor:pointer;font-weight:900">Portal Akuntansi Barang</summary>
          <div class="muted" style="margin:8px 0 12px">Hanya account-reference bridge. Jurnal, buku besar, neraca, dan laporan keuangan tetap milik modul Accounting.</div>
          <label class="admin-field">Akun Penjualan<select id="productSalesAccount"></select></label>
          <label class="admin-field">Akun Persediaan<select id="productInventoryAccount"></select></label>
          <label class="admin-field">Akun HPP<select id="productCogsAccount"></select></label>
        </details>
      </div>`);
    el('productProductionMode')?.addEventListener('change', renderRecipeNote);
    el('productLinkedRecipe')?.addEventListener('change', renderRecipeNote);
    form.addEventListener('submit', saveProductMaster, true);
    el('productCancelEdit')?.addEventListener('click', () => setTimeout(resetExtendedForm, 0));
  }

  function mountAccountingPortal() {
    const tabs = document.querySelector('.admin-tabs');
    const toastNode = el('adminToast');
    if (!tabs || !toastNode || el('accountingReferenceTab')) return;
    const button = document.createElement('button');
    button.id = 'accountingReferenceTab';
    button.className = 'admin-tab';
    button.dataset.tab = 'accounting-reference';
    button.type = 'button';
    button.textContent = 'Akuntansi';
    tabs.appendChild(button);
    toastNode.insertAdjacentHTML('beforebegin', `
      <section id="tab-accounting-reference" class="admin-section">
        <div class="admin-card">
          <div class="list-head">
            <div>
              <div class="admin-eyebrow">Accounting Connector</div>
              <h2>Portal Referensi Akun</h2>
              <div class="muted">Akun di bawah adalah reference awal untuk mapping. Tidak ada jurnal yang dibuat dari panel ini.</div>
            </div>
            <button id="accountingReferenceRefresh" class="secondary-btn" type="button">↻ Refresh</button>
          </div>
          <div id="accountingReferenceStatus" class="admin-tip" style="margin-top:12px"></div>
          <div id="accountingReferenceList" class="master-list"></div>
        </div>
      </section>`);
    button.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(tab => tab.classList.toggle('active', tab === button));
      document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-accounting-reference'));
      loadEditor().catch(error => toast(error.message));
    });
    el('accountingReferenceRefresh')?.addEventListener('click', () => loadEditor(true).catch(error => toast(error.message)));
  }

  function removeDuplicateClassificationPanel() {
    const classificationCard = el('classificationList')?.closest('.admin-card');
    if (classificationCard) classificationCard.style.display = 'none';
    const manufacturing = el('tab-manufacturing');
    if (manufacturing) {
      const eyebrow = manufacturing.querySelector('.admin-eyebrow');
      if (eyebrow) eyebrow.textContent = 'Master Teknis';
      const heading = manufacturing.querySelector('.list-head h2');
      if (heading) heading.textContent = 'Tipe Barang, Satuan & Resep';
    }
  }

  function productById(id) {
    return (state.editor?.products || []).find(product => product.id === Number(id));
  }

  function optionRows(items, selectedId, label) {
    return items.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(selectedId || '') ? 'selected' : ''}>${esc(label(item))}</option>`).join('');
  }

  function accountOptions(type, selectedId) {
    const items = (state.editor?.accountingAccounts || []).filter(account => account.isActive && account.accountType === type);
    return `<option value="" ${selectedId ? '' : 'selected'}>Belum dipetakan</option>${optionRows(items, selectedId || '', account => `${account.code} · ${account.name}`)}`;
  }

  function recipesForProduct(productId) {
    if (!productId) return [];
    return (state.editor?.recipes || []).filter(recipe => recipe.outputProductId === Number(productId));
  }

  function renderEditorFields(product = null) {
    if (!state.editor || !el('productItemType')) return;
    const types = (state.editor.itemTypes || []).filter(item => item.isActive || item.id === product?.itemTypeId);
    const units = (state.editor.units || []).filter(item => item.isActive || item.id === product?.baseUnitId);
    el('productItemType').innerHTML = optionRows(types, product?.itemTypeId, item => item.name);
    el('productBaseUnit').innerHTML = optionRows(units, product?.baseUnitId, item => `${item.name} (${item.symbol})`);
    el('productPointsPerUnit').value = String(product?.pointsPerUnit || 0);
    el('productStockTracking').checked = product ? Boolean(product.stockTrackingEnabled) : true;
    el('productProductionMode').value = product?.productionMode || 'STOCK';

    const recipes = recipesForProduct(product?.id || 0);
    el('productLinkedRecipe').innerHTML = `<option value="">Tidak terhubung</option>${optionRows(recipes, product?.linkedRecipeId, recipe => `${recipe.outputProductName} · v${recipe.revision} · hasil ${recipe.outputQuantity} ${recipe.outputUnitSymbol}`)}`;
    el('productLinkedRecipe').disabled = !product?.id;

    el('productSalesAccount').innerHTML = accountOptions('REVENUE', product?.accounting?.salesAccountRefId);
    el('productInventoryAccount').innerHTML = accountOptions('ASSET', product?.accounting?.inventoryAccountRefId);
    el('productCogsAccount').innerHTML = accountOptions('EXPENSE', product?.accounting?.cogsAccountRefId);
    renderRecipeNote();
  }

  function renderRecipeNote() {
    const productId = Number(el('productId')?.value || 0);
    const mode = el('productProductionMode')?.value || 'STOCK';
    const recipeId = el('productLinkedRecipe')?.value || '';
    const note = el('productRecipeNote');
    if (!note) return;
    if (!productId) {
      note.textContent = 'Barang baru disimpan dulu. Setelah resep untuk barang ini dibuat di Master Resep, edit barang lalu pilih Recipe Linked.';
      return;
    }
    if (mode === 'DADAKAN' && !recipeId) {
      note.textContent = 'Mode DADAKAN wajib memilih Recipe Linked.';
      return;
    }
    if (mode === 'DADAKAN') {
      note.textContent = 'Saat penjualan, sistem produksi sesuai resep linked terlebih dulu, lalu melakukan stock-out penjualan dalam satu flow atomic.';
      return;
    }
    note.textContent = recipeId
      ? 'Resep tersimpan sebagai linkage barang, tetapi mode STOCK tidak auto-produksi saat dijual.'
      : 'Mode STOCK menjual dari stok yang tersedia tanpa auto-produksi.';
  }

  function renderAccountingPortal() {
    const accounts = state.editor?.accountingAccounts || [];
    const status = el('accountingReferenceStatus');
    const list = el('accountingReferenceList');
    if (!status || !list) return;
    status.innerHTML = `<b>MAXI_ACCOUNTING_REFERENCE_V1</b> · ${accounts.length} akun referensi dasar · status PROVISIONAL.<br>Next step: mapping per transaksi dapat ditambahkan tanpa memindahkan journal engine ke Admin.`;
    const groups = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
    list.innerHTML = groups.map(type => {
      const items = accounts.filter(account => account.accountType === type);
      if (!items.length) return '';
      return `<div class="admin-card" style="box-shadow:none"><strong>${esc(type)}</strong><div class="master-list">${items.map(account => `
        <div class="master-row contact-row">
          <div class="master-main"><strong>${esc(account.code)} · ${esc(account.name)}</strong><div class="master-meta">${esc(account.syncStatus)}${account.externalAccountId ? ` · external ${esc(account.externalAccountId)}` : ' · belum terhubung ke modul Accounting'}</div></div>
        </div>`).join('')}</div></div>`;
    }).join('');
  }

  function enhanceProductRows() {
    const list = el('productList');
    if (!list || !state.editor) return;
    list.querySelectorAll('[data-edit-product]').forEach(button => {
      const productId = Number(button.dataset.editProduct);
      const product = productById(productId);
      const row = button.closest('.master-row');
      const main = row?.querySelector('.master-main');
      if (!product || !main) return;
      let meta = main.querySelector('[data-product-policy-meta]');
      if (!meta) {
        meta = document.createElement('div');
        meta.className = 'master-meta';
        meta.dataset.productPolicyMeta = '1';
        main.appendChild(meta);
      }
      const stock = product.stockQuantity == null ? 'stok belum init' : `stok ${product.stockQuantity} ${product.unitSymbol || ''}`;
      const recipe = product.linkedRecipeId ? 'resep linked' : 'tanpa resep';
      meta.textContent = `${product.itemTypeName || 'Tanpa tipe'} · ${product.unitSymbol || '-'} · Poin ${product.pointsPerUnit} · ${stock} · ${product.productionMode} · ${recipe}`;
      if (button.dataset.productMasterBound !== '1') {
        button.dataset.productMasterBound = '1';
        button.addEventListener('click', () => setTimeout(() => selectProduct(productId), 0));
      }
    });
  }

  function selectProduct(productId) {
    state.activeProductId = Number(productId);
    renderEditorFields(productById(productId));
  }

  function resetExtendedForm() {
    state.activeProductId = 0;
    renderEditorFields(null);
  }

  async function loadEditor(force = false) {
    if (state.loading && !force) return state.loading;
    state.loading = api('/api/admin/master/products/editor')
      .then(payload => {
        state.editor = payload;
        const productId = Number(el('productId')?.value || state.activeProductId || 0);
        renderEditorFields(productById(productId) || null);
        renderAccountingPortal();
        enhanceProductRows();
        return payload;
      })
      .finally(() => { state.loading = null; });
    return state.loading;
  }

  function productImagePayload() {
    const src = el('productImagePreview')?.getAttribute('src') || '';
    return src.startsWith('data:image/') ? src : '';
  }

  async function saveProductMaster(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      if (!state.editor) await loadEditor();
      const productId = Number(el('productId')?.value || 0);
      const payload = {
        name: el('productName').value,
        purchasePrice: Number(el('productPurchasePrice').value),
        price: Number(el('productPrice').value),
        category: el('productCategory').value,
        emoji: '🥞',
        imageData: productImagePayload(),
        isActive: el('productActive').checked,
        itemTypeId: el('productItemType').value,
        baseUnitId: el('productBaseUnit').value,
        pointsPerUnit: Number(el('productPointsPerUnit').value),
        stockTrackingEnabled: el('productStockTracking').checked,
        productionMode: el('productProductionMode').value,
        linkedRecipeId: el('productLinkedRecipe').value || null,
        accounting: {
          salesAccountRefId: el('productSalesAccount').value || null,
          inventoryAccountRefId: el('productInventoryAccount').value || null,
          cogsAccountRefId: el('productCogsAccount').value || null
        }
      };
      const response = await api(productId ? `/api/admin/master/products/editor/${productId}` : '/api/admin/master/products/editor', {
        method: productId ? 'PATCH' : 'POST',
        body: JSON.stringify(payload)
      });
      state.editor = response.editor;
      if (typeof window.refreshData === 'function') await window.refreshData();
      if (typeof window.resetProductForm === 'function') window.resetProductForm();
      resetExtendedForm();
      enhanceProductRows();
      renderAccountingPortal();
      toast(productId ? 'Master Barang diperbarui' : 'Barang ditambahkan. Buat resep lalu edit barang untuk melakukan Recipe Linked.');
    } catch (error) {
      toast(error.message);
    }
  }

  function mount() {
    mountProductFields();
    mountAccountingPortal();
    removeDuplicateClassificationPanel();
    const productTab = document.querySelector('[data-tab="products"]');
    productTab?.addEventListener('click', () => setTimeout(() => loadEditor().catch(error => toast(error.message)), 0));
    const list = el('productList');
    if (list) new MutationObserver(() => enhanceProductRows()).observe(list, { childList: true });
    const gate = el('authGate');
    if (gate) new MutationObserver(() => {
      if (gate.classList.contains('hidden')) loadEditor(true).catch(error => toast(error.message));
    }).observe(gate, { attributes: true, attributeFilter: ['class'] });
    if (gate?.classList.contains('hidden')) loadEditor().catch(error => toast(error.message));
  }

  mount();
})();
