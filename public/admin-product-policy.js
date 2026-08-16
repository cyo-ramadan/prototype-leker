(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const cost = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 4 }).format(Number(value) || 0);
  const state = {
    editor: null,
    accounting: null,
    activeProductId: 0,
    editingProductKindId: '',
    loadingEditor: null,
    loadingAccounting: null
  };

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

  function optionRows(items, selectedId, label) {
    return items.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(selectedId || '') ? 'selected' : ''}>${esc(label(item))}</option>`).join('');
  }

  function mountPurchaseCostFields() {
    const input = el('productPurchasePrice');
    if (!input) return;
    input.readOnly = false;
    input.required = true;
    input.step = '1';
    input.title = 'Harga beli default dari Master Barang; tetap dapat diedit saat pembelian';
    const label = input.closest('label');
    if (label?.firstChild) label.firstChild.textContent = 'Harga Beli';
    const priceGrid = label?.parentElement;
    if (priceGrid && !el('productLastPurchasePrice')) {
      priceGrid.insertAdjacentHTML('afterend', `
        <div class="admin-grid two compact">
          <label class="admin-field">Harga Beli Terakhir
            <input id="productLastPurchasePrice" type="number" min="0" step="any" value="0" readonly title="Otomatis dari transaksi pembelian terakhir" />
            <span class="field-note">otomatis · read only</span>
          </label>
          <label class="admin-field">Average Cost · HPP berjalan
            <input id="productAverageCost" type="number" min="0" step="any" value="0" readonly title="Otomatis dari moving average inventory cost" />
            <span class="field-note">otomatis · read only · acuan HPP</span>
          </label>
        </div>`);
    }
  }

  function mountProductFields() {
    const form = el('productForm');
    const category = el('productCategory')?.closest('label');
    if (!form || !category || el('productMasterFields')) return;
    mountPurchaseCostFields();
    category.insertAdjacentHTML('afterend', `
      <div id="productMasterFields">
        <details id="productOperationalDetails" class="admin-card" style="padding:12px;margin:0 0 12px">
          <summary style="cursor:pointer;font-weight:900">Stok & pengaturan lanjutan</summary>
          <div class="muted" style="margin:8px 0 12px">Default barang baru: Barang Jadi + pcs. Buka bagian ini hanya saat barang punya kebutuhan stok, produksi, atau Accounting khusus.</div>
        <div class="admin-grid two compact">
          <label class="admin-field">Peran Barang<select id="productItemType"></select><span class="field-note">menentukan boleh dijual, dibeli, diproduksi, dan track stok</span></label>
          <label class="admin-field">Klasifikasi Accounting<select id="productKind"><option value="">Belum ditentukan</option></select><span class="field-note">optional · untuk linkage Accounting</span></label>
        </div>
        <div class="admin-grid two compact">
          <label class="admin-field">Satuan Dasar<select id="productBaseUnit"></select></label>
          <label class="admin-field">Poin per 1 barang<input id="productPointsPerUnit" type="number" min="0" step="1" value="0" required /></label>
        </div>
        <label class="admin-check"><input id="productStockTracking" type="checkbox" checked /> Track & enforce stok</label>
        <label class="admin-field">Recipe Linked<select id="productLinkedRecipe"><option value="">Tidak terhubung</option></select></label>
        <div id="productRecipeNote" class="muted" style="margin:-5px 0 12px"></div>
        </details>
      </div>`);
    el('productLinkedRecipe')?.addEventListener('change', renderRecipeNote);
    form.addEventListener('submit', saveProductMaster, true);
    el('productCancelEdit')?.addEventListener('click', () => setTimeout(resetExtendedForm, 0));
  }

  function mountProductKindMaster() {
    const manufacturing = el('tab-manufacturing');
    if (!manufacturing || el('productKindMasterCard')) return;
    const firstCard = manufacturing.querySelector('.admin-card');
    const html = `
      <div id="productKindMasterCard" class="admin-grid two" style="margin-top:14px;align-items:start">
        <form id="productKindForm" class="admin-card">
          <input id="productKindId" type="hidden" />
          <div class="form-title-row"><h2 id="productKindFormTitle">Klasifikasi Accounting</h2><button id="productKindCancel" class="text-btn hidden" type="button">Batal edit</button></div>
          <div class="muted" style="margin-bottom:10px">Klasifikasi optional untuk menghubungkan barang ke rule Accounting. Kosongkan jika belum diperlukan.</div>
          <label class="admin-field">Kode<input id="productKindCode" maxlength="32" placeholder="Contoh: BAHAN_DAPUR" required /></label>
          <label class="admin-field">Nama<input id="productKindName" maxlength="80" placeholder="Contoh: Bahan Dapur" required /></label>
          <label class="admin-check"><input id="productKindActive" type="checkbox" checked /> Aktif</label>
          <button class="primary-btn" type="submit">Simpan Klasifikasi</button>
        </form>
        <div class="admin-card list-card">
          <div class="list-head"><div><h2>Master Klasifikasi Accounting</h2><div class="muted">Kode stabil untuk integration reference.</div></div><span id="productKindCount" class="master-count">0</span></div>
          <div id="productKindList" class="master-list"></div>
        </div>
      </div>`;
    if (firstCard) firstCard.insertAdjacentHTML('afterend', html);
    else manufacturing.insertAdjacentHTML('afterbegin', html);
    el('productKindForm')?.addEventListener('submit', saveProductKind);
    el('productKindCancel')?.addEventListener('click', resetProductKindForm);
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
              <h2>Portal Link Akuntansi</h2>
              <div class="muted">Atur hubungan business transaction → akun debit/kredit. Panel ini tidak membuat jurnal; modul Accounting tetap melakukan journal interpretation dan posting.</div>
            </div>
            <button id="accountingReferenceRefresh" class="secondary-btn" type="button">↻ Refresh</button>
          </div>
          <div id="accountingReferenceStatus" class="admin-tip" style="margin-top:12px"></div>
        </div>

        <div class="admin-grid two" style="margin-top:14px;align-items:start">
          <form id="accountingMappingForm" class="admin-card">
            <h2>Link Transaksi</h2>
            <label class="admin-field">Jenis transaksi<select id="accountingBusinessEvent"></select></label>
            <label class="admin-field">Cara bayar<select id="accountingPaymentMethod"></select></label>
            <label class="admin-field">Debit<select id="accountingDebitAccount"></select></label>
            <label class="admin-field">Kredit<select id="accountingCreditAccount"></select></label>
            <div id="accountingMappingHint" class="muted" style="margin-bottom:12px"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="primary-btn" type="submit">Simpan Link</button>
              <button id="accountingMappingClear" class="secondary-btn" type="button">Kosongkan Link</button>
            </div>
          </form>

          <div class="admin-card list-card">
            <div class="list-head"><div><h2>Mapping Transaksi</h2><div class="muted">Rule aktif akan di-snapshot saat transaction fact dibuat.</div></div><span id="accountingMappingCount" class="master-count">0</span></div>
            <div id="accountingMappingList" class="master-list"></div>
          </div>
        </div>

        <div class="admin-card" style="margin-top:14px">
          <div class="list-head"><div><h2>Akun Referensi Dasar</h2><div class="muted">Status PROVISIONAL sampai terhubung ke akun canonical dari modul Accounting.</div></div><span id="accountingAccountCount" class="master-count">0</span></div>
          <div id="accountingReferenceList" class="master-list" style="margin-top:12px"></div>
        </div>
      </section>`);

    button.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(tab => tab.classList.toggle('active', tab === button));
      document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-accounting-reference'));
      loadAccountingPortal().catch(error => toast(error.message));
    });
    el('accountingReferenceRefresh')?.addEventListener('click', () => loadAccountingPortal(true).catch(error => toast(error.message)));
    el('accountingBusinessEvent')?.addEventListener('change', renderAccountingHint);
    el('accountingPaymentMethod')?.addEventListener('change', renderAccountingHint);
    el('accountingMappingForm')?.addEventListener('submit', saveAccountingMapping);
    el('accountingMappingClear')?.addEventListener('click', clearAccountingMapping);
  }

  function removeDuplicateClassificationPanel() {
    const classificationCard = el('classificationList')?.closest('.admin-card');
    if (classificationCard) classificationCard.style.display = 'none';
    const manufacturing = el('tab-manufacturing');
    if (manufacturing) {
      const eyebrow = manufacturing.querySelector('.admin-eyebrow');
      if (eyebrow) eyebrow.textContent = 'Master Teknis';
      const heading = manufacturing.querySelector('.list-head h2');
      if (heading) heading.textContent = 'Peran Barang, Klasifikasi Accounting, Satuan & Resep';
    }
  }

  function productById(id) {
    return (state.editor?.products || []).find(product => product.id === Number(id));
  }

  function recipesForProduct(productId) {
    if (!productId) return [];
    return (state.editor?.recipes || []).filter(recipe => recipe.outputProductId === Number(productId));
  }

  function renderEditorFields(product = null) {
    if (!state.editor || !el('productItemType')) return;
    const types = (state.editor.itemTypes || []).filter(item => item.isActive || item.id === product?.itemTypeId);
    const units = (state.editor.units || []).filter(item => item.isActive || item.id === product?.baseUnitId);
    const kinds = (state.editor.productKinds || []).filter(item => item.isActive || item.id === product?.productKindId);
    const defaultTypeId = product?.itemTypeId || types.find(item => item.code === 'FINISHED_GOOD')?.id || types[0]?.id;
    const defaultUnitId = product?.baseUnitId || units.find(item => item.code === 'PCS')?.id || units[0]?.id;
    el('productItemType').innerHTML = optionRows(types, defaultTypeId, item => item.name);
    el('productKind').innerHTML = `<option value="">Belum ditentukan</option>${optionRows(kinds, product?.productKindId, item => `${item.name} · ${item.code}`)}`;
    el('productBaseUnit').innerHTML = optionRows(units, defaultUnitId, item => `${item.name} (${item.symbol})`);
    el('productPointsPerUnit').value = String(product?.pointsPerUnit || 0);
    el('productStockTracking').checked = product ? Boolean(product.stockTrackingEnabled) : true;
    if (el('productPurchasePrice')) el('productPurchasePrice').value = String(product?.purchasePrice || 0);
    if (el('productLastPurchasePrice')) {
      el('productLastPurchasePrice').value = String(product?.lastPurchaseAt ? product.lastPurchasePrice : (product?.purchasePrice || 0));
      el('productLastPurchasePrice').title = product?.lastPurchaseAt
        ? 'Otomatis dari transaksi pembelian terakhir'
        : 'Belum ada transaksi pembelian; sementara mengikuti Harga Beli master';
    }
    if (el('productAverageCost')) el('productAverageCost').value = String(product?.averageCost || 0);

    const recipes = recipesForProduct(product?.id || 0);
    el('productLinkedRecipe').innerHTML = `<option value="">Tidak terhubung</option>${optionRows(recipes, product?.linkedRecipeId, recipe => `${recipe.outputProductName} · v${recipe.revision} · hasil ${recipe.outputQuantity} ${recipe.outputUnitSymbol}`)}`;
    el('productLinkedRecipe').disabled = !product?.id;
    renderRecipeNote();
    renderProductKinds();
  }

  function renderRecipeNote() {
    const productId = Number(el('productId')?.value || 0);
    const recipeId = el('productLinkedRecipe')?.value || '';
    const note = el('productRecipeNote');
    if (!note) return;
    if (!productId) {
      note.textContent = 'Barang baru disimpan dulu. Setelah resep untuk barang ini dibuat di Master Resep, edit barang lalu pilih Recipe Linked.';
      return;
    }
    note.textContent = recipeId
      ? 'Resep ini menjadi linkage eksplisit barang. Mode pemenuhan tidak disimpan di Master Barang; nanti ditentukan di transaksi Penjualan.'
      : 'Belum ada resep yang dilink. Resep tetap dikelola dari Master Resep.';
  }

  function renderProductKinds() {
    const items = state.editor?.productKinds || [];
    if (el('productKindCount')) el('productKindCount').textContent = String(items.length);
    const list = el('productKindList');
    if (!list) return;
    list.innerHTML = items.length ? items.map(item => `
      <div class="master-row contact-row ${item.isActive ? '' : 'inactive'}">
        <div class="master-main"><strong>${esc(item.name)}</strong><div class="master-meta">${esc(item.code)} · ${item.isActive ? 'aktif' : 'nonaktif'}</div></div>
        <div class="master-actions"><button class="mini-btn" type="button" data-edit-product-kind="${esc(item.id)}">Edit</button></div>
      </div>`).join('') : '<div class="empty">Belum ada Klasifikasi Accounting. Field ini optional.</div>';
    list.querySelectorAll('[data-edit-product-kind]').forEach(button => button.addEventListener('click', () => editProductKind(button.dataset.editProductKind)));
  }

  function editProductKind(id) {
    const item = (state.editor?.productKinds || []).find(row => row.id === id);
    if (!item) return;
    state.editingProductKindId = item.id;
    el('productKindId').value = item.id;
    el('productKindCode').value = item.code;
    el('productKindCode').disabled = true;
    el('productKindName').value = item.name;
    el('productKindActive').checked = item.isActive;
    el('productKindFormTitle').textContent = 'Edit Klasifikasi Accounting';
    el('productKindCancel').classList.remove('hidden');
  }

  function resetProductKindForm() {
    state.editingProductKindId = '';
    el('productKindForm')?.reset();
    if (el('productKindId')) el('productKindId').value = '';
    if (el('productKindCode')) el('productKindCode').disabled = false;
    if (el('productKindActive')) el('productKindActive').checked = true;
    if (el('productKindFormTitle')) el('productKindFormTitle').textContent = 'Klasifikasi Accounting';
    el('productKindCancel')?.classList.add('hidden');
  }

  async function saveProductKind(event) {
    event.preventDefault();
    const id = state.editingProductKindId;
    try {
      await api(id ? `/api/admin/master/product-kinds/${encodeURIComponent(id)}` : '/api/admin/master/product-kinds', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          code: el('productKindCode').value,
          name: el('productKindName').value,
          isActive: el('productKindActive').checked
        })
      });
      resetProductKindForm();
      await loadEditor(true);
      toast(id ? 'Klasifikasi diperbarui' : 'Klasifikasi ditambahkan');
    } catch (error) { toast(error.message); }
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
      const kind = product.productKindName || 'jenis belum ditentukan';
      const latestPurchase = product.lastPurchaseAt ? product.lastPurchasePrice : product.purchasePrice;
      meta.textContent = `${product.itemTypeName || 'Tanpa tipe'} · ${kind} · ${product.unitSymbol || '-'} · Poin ${product.pointsPerUnit} · ${stock} · Harga beli ${cost(product.purchasePrice)} · HPP ${cost(product.averageCost)} · Beli terakhir ${cost(latestPurchase)} · ${recipe}`;
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
    if (state.loadingEditor && !force) return state.loadingEditor;
    state.loadingEditor = api('/api/admin/master/products/editor')
      .then(payload => {
        state.editor = payload;
        const productId = Number(el('productId')?.value || state.activeProductId || 0);
        renderEditorFields(productById(productId) || null);
        enhanceProductRows();
        renderProductKinds();
        return payload;
      })
      .finally(() => { state.loadingEditor = null; });
    return state.loadingEditor;
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
        productKindId: el('productKind').value || null,
        baseUnitId: el('productBaseUnit').value,
        pointsPerUnit: Number(el('productPointsPerUnit').value),
        stockTrackingEnabled: el('productStockTracking').checked,
        linkedRecipeId: el('productLinkedRecipe').value || null
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
      renderProductKinds();
      toast(productId ? 'Master Barang diperbarui' : 'Barang ditambahkan. Cost otomatis mulai bergerak saat ada pembelian/produksi.');
    } catch (error) {
      toast(error.message);
    }
  }

  function accountOptions(selectedId = '') {
    const accounts = (state.accounting?.accounts || []).filter(account => account.isActive && account.isPostable);
    return `<option value="">Belum dipilih</option>${optionRows(accounts, selectedId, account => `${account.code} · ${account.name} · ${account.accountType}`)}`;
  }

  function renderAccountingSelectors() {
    if (!state.accounting) return;
    const event = el('accountingBusinessEvent');
    const method = el('accountingPaymentMethod');
    const currentEvent = event?.value || '';
    const currentMethod = method?.value || '';
    if (event) {
      event.innerHTML = (state.accounting.businessEvents || []).map(item => `<option value="${esc(item.code)}">${esc(item.label)}</option>`).join('');
      if ([...event.options].some(option => option.value === currentEvent)) event.value = currentEvent;
    }
    if (method) {
      method.innerHTML = (state.accounting.paymentMethods || []).map(item => `<option value="${esc(item.code)}">${esc(item.label)}</option>`).join('');
      if ([...method.options].some(option => option.value === currentMethod)) method.value = currentMethod;
    }
    loadSelectedMappingIntoForm();
  }

  function selectedAccountingMapping() {
    const event = el('accountingBusinessEvent')?.value || '';
    const method = el('accountingPaymentMethod')?.value || '';
    return (state.accounting?.mappings || []).find(mapping => mapping.businessEvent === event && mapping.paymentMethod === method) || null;
  }

  function loadSelectedMappingIntoForm() {
    const mapping = selectedAccountingMapping();
    if (el('accountingDebitAccount')) el('accountingDebitAccount').innerHTML = accountOptions(mapping?.debitAccountRefId || '');
    if (el('accountingCreditAccount')) el('accountingCreditAccount').innerHTML = accountOptions(mapping?.creditAccountRefId || '');
    renderAccountingHint();
  }

  function renderAccountingHint() {
    if (!state.accounting) return;
    const event = el('accountingBusinessEvent')?.value || '';
    const method = el('accountingPaymentMethod')?.value || '';
    const hint = el('accountingMappingHint');
    if (!hint) return;
    if (event === 'PURCHASE_MATERIAL') {
      hint.textContent = method === 'PAYABLE'
        ? 'Contoh sesuai flow bos: Debit Persediaan Bahan · Kredit Utang Usaha.'
        : method === 'BANK'
          ? 'Contoh: Debit Persediaan Bahan · Kredit Bank.'
          : method === 'CASH'
            ? 'Contoh: Debit Persediaan Bahan · Kredit Kas.'
            : 'Debit mengikuti klasifikasi barang; kredit mengikuti cara bayar.';
      return;
    }
    if (event === 'SALE_REVENUE') {
      hint.textContent = 'Revenue mapping menangani sisi penjualan. Snapshot HPP transaksi berasal dari average_cost barang; rule jurnal HPP tetap dilink terpisah ke modul Accounting.';
      return;
    }
    hint.textContent = 'Pilih akun debit dan kredit secara explicit. Tidak ada auto-mapping.';
  }

  function renderAccountingPortal() {
    if (!state.accounting) return;
    const accounts = state.accounting.accounts || [];
    const mappings = state.accounting.mappings || [];
    if (el('accountingReferenceStatus')) {
      el('accountingReferenceStatus').innerHTML = `<b>${esc(state.accounting.contract)}</b> · ${accounts.length} akun referensi · journal engine tetap <b>ACCOUNTING_MODULE</b>. Mapping baru berlaku sebagai connector reference dan di-snapshot saat transaksi dibuat.`;
    }
    if (el('accountingAccountCount')) el('accountingAccountCount').textContent = String(accounts.length);
    if (el('accountingMappingCount')) el('accountingMappingCount').textContent = String(mappings.length);

    const groups = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
    if (el('accountingReferenceList')) {
      el('accountingReferenceList').innerHTML = groups.map(type => {
        const items = accounts.filter(account => account.accountType === type);
        if (!items.length) return '';
        return `<div class="admin-card" style="box-shadow:none"><strong>${esc(type)}</strong><div class="master-list">${items.map(account => `
          <div class="master-row contact-row"><div class="master-main"><strong>${esc(account.code)} · ${esc(account.name)}</strong><div class="master-meta">${esc(account.syncStatus)}${account.externalAccountId ? ` · external ${esc(account.externalAccountId)}` : ' · belum terhubung ke modul Accounting'}</div></div></div>`).join('')}</div></div>`;
      }).join('');
    }

    const eventLabels = new Map((state.accounting.businessEvents || []).map(item => [item.code, item.label]));
    const methodLabels = new Map((state.accounting.paymentMethods || []).map(item => [item.code, item.label]));
    if (el('accountingMappingList')) {
      el('accountingMappingList').innerHTML = mappings.length ? mappings.map(mapping => `
        <div class="master-row contact-row">
          <div class="master-main">
            <strong>${esc(eventLabels.get(mapping.businessEvent) || mapping.businessEvent)} · ${esc(methodLabels.get(mapping.paymentMethod) || mapping.paymentMethod)}</strong>
            <div class="master-meta">${mapping.status === 'ACTIVE'
              ? `Dr ${esc(mapping.debitAccount?.code || '')} ${esc(mapping.debitAccount?.name || '')} · Cr ${esc(mapping.creditAccount?.code || '')} ${esc(mapping.creditAccount?.name || '')}`
              : 'Belum dilink'}</div>
          </div>
          <div class="master-actions"><button class="mini-btn" type="button" data-edit-accounting-mapping="${esc(mapping.id)}">Atur</button></div>
        </div>`).join('') : '<div class="empty">Belum ada slot mapping transaksi.</div>';
      document.querySelectorAll('[data-edit-accounting-mapping]').forEach(button => button.addEventListener('click', () => editAccountingMapping(button.dataset.editAccountingMapping)));
    }
    renderAccountingSelectors();
  }

  function editAccountingMapping(id) {
    const mapping = (state.accounting?.mappings || []).find(item => item.id === id);
    if (!mapping) return;
    el('accountingBusinessEvent').value = mapping.businessEvent;
    el('accountingPaymentMethod').value = mapping.paymentMethod;
    loadSelectedMappingIntoForm();
    el('accountingMappingForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function loadAccountingPortal(force = false) {
    if (state.loadingAccounting && !force) return state.loadingAccounting;
    state.loadingAccounting = api('/api/admin/accounting/reference')
      .then(payload => {
        state.accounting = payload;
        renderAccountingPortal();
        return payload;
      })
      .finally(() => { state.loadingAccounting = null; });
    return state.loadingAccounting;
  }

  async function saveAccountingMapping(event) {
    event.preventDefault();
    try {
      const payload = await api('/api/admin/accounting/reference/mappings', {
        method: 'PUT',
        body: JSON.stringify({
          businessEvent: el('accountingBusinessEvent').value,
          paymentMethod: el('accountingPaymentMethod').value,
          debitAccountRefId: el('accountingDebitAccount').value || null,
          creditAccountRefId: el('accountingCreditAccount').value || null
        })
      });
      state.accounting = payload.portal;
      renderAccountingPortal();
      toast('Link transaksi Accounting tersimpan');
    } catch (error) { toast(error.message); }
  }

  async function clearAccountingMapping() {
    try {
      const payload = await api('/api/admin/accounting/reference/mappings', {
        method: 'PUT',
        body: JSON.stringify({
          businessEvent: el('accountingBusinessEvent').value,
          paymentMethod: el('accountingPaymentMethod').value,
          debitAccountRefId: null,
          creditAccountRefId: null
        })
      });
      state.accounting = payload.portal;
      renderAccountingPortal();
      toast('Link transaksi dikosongkan');
    } catch (error) { toast(error.message); }
  }

  function mount() {
    mountProductFields();
    mountProductKindMaster();
    mountAccountingPortal();
    removeDuplicateClassificationPanel();
    const productTab = document.querySelector('[data-tab="products"]');
    productTab?.addEventListener('click', () => setTimeout(() => loadEditor(true).catch(error => toast(error.message)), 0));
    window.addEventListener('product-master-reference-updated', () => loadEditor(true).catch(error => toast(error.message)));
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
