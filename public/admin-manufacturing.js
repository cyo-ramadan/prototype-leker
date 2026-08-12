(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const el = id => document.getElementById(id);
  const state = { bootstrap: null, recipes: [], componentSeq: 0 };

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { cache: 'no-store', ...options, headers });
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
    toast.timer = setTimeout(() => node.classList.remove('show'), 2200);
  }

  function activate() {
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === 'manufacturing'));
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-manufacturing'));
    loadAll();
  }

  function mount() {
    const tabs = document.querySelector('.admin-tabs');
    const app = el('adminApp');
    const toastNode = el('adminToast');
    if (!tabs || !app || !toastNode || el('tab-manufacturing')) return;

    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.dataset.tab = 'manufacturing';
    button.type = 'button';
    button.textContent = 'Manufaktur';
    const categoryButton = tabs.querySelector('[data-tab="categories"]');
    if (categoryButton) tabs.insertBefore(button, categoryButton);
    else tabs.appendChild(button);

    toastNode.insertAdjacentHTML('beforebegin', `
      <section id="tab-manufacturing" class="admin-section">
        <div class="admin-card">
          <div class="list-head">
            <div><div class="admin-eyebrow">Manufacturing Master v1</div><h2>Barang, Satuan & Resep</h2><div class="muted">Resep disimpan sebagai revision immutable untuk kebutuhan produksi dan costing/HPP berikutnya.</div></div>
            <button id="manufacturingRefresh" class="secondary-btn" type="button">↻ Refresh</button>
          </div>
        </div>

        <div class="admin-grid two" style="margin-top:14px">
          <form id="itemTypeForm" class="admin-card">
            <input id="itemTypeId" type="hidden" />
            <div class="form-title-row"><h2 id="itemTypeFormTitle">Tipe Barang</h2><button id="itemTypeCancel" class="text-btn hidden" type="button">Batal edit</button></div>
            <label class="admin-field">Kode<input id="itemTypeCode" maxlength="32" placeholder="RAW_MATERIAL" required /></label>
            <label class="admin-field">Nama<input id="itemTypeName" maxlength="80" placeholder="Bahan" required /></label>
            <div class="admin-grid two compact">
              <label class="admin-check"><input id="itemTypeCanSell" type="checkbox" checked /> Boleh dijual</label>
              <label class="admin-check"><input id="itemTypeCanPurchase" type="checkbox" checked /> Boleh dibeli</label>
              <label class="admin-check"><input id="itemTypeCanProduce" type="checkbox" /> Bisa menjadi hasil produksi</label>
              <label class="admin-check"><input id="itemTypeCanConsume" type="checkbox" checked /> Bisa jadi komponen</label>
              <label class="admin-check"><input id="itemTypeTrackStock" type="checkbox" checked /> Track stok</label>
              <label class="admin-check"><input id="itemTypeActive" type="checkbox" checked /> Aktif</label>
            </div>
            <button class="primary-btn" type="submit">Simpan tipe</button>
          </form>

          <form id="unitForm" class="admin-card">
            <input id="unitId" type="hidden" />
            <div class="form-title-row"><h2 id="unitFormTitle">Master Satuan</h2><button id="unitCancel" class="text-btn hidden" type="button">Batal edit</button></div>
            <label class="admin-field">Kode<input id="unitCode" maxlength="20" placeholder="GRAM" required /></label>
            <div class="admin-grid two compact">
              <label class="admin-field">Nama<input id="unitName" maxlength="60" placeholder="Gram" required /></label>
              <label class="admin-field">Simbol<input id="unitSymbol" maxlength="12" placeholder="g" required /></label>
            </div>
            <label class="admin-field">Presisi desimal<select id="unitDecimalScale"><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
            <label class="admin-check"><input id="unitActive" type="checkbox" checked /> Aktif</label>
            <button class="primary-btn" type="submit">Simpan satuan</button>
          </form>
        </div>

        <div class="admin-grid two" style="margin-top:14px">
          <div class="admin-card list-card"><div class="list-head"><h2>Daftar Tipe Barang</h2><span id="itemTypeCount" class="master-count">0</span></div><div id="itemTypeList" class="master-list"></div></div>
          <div class="admin-card list-card"><div class="list-head"><h2>Daftar Satuan</h2><span id="unitCount" class="master-count">0</span></div><div id="unitList" class="master-list"></div></div>
        </div>

        <div class="admin-card" style="margin-top:14px">
          <div class="list-head"><div><h2>Klasifikasi Barang</h2><div class="muted">Setiap barang punya tipe dan satuan dasar. Policy tipe dipakai oleh kasir/menu dan manufacturing.</div></div><span id="classificationCount" class="master-count">0</span></div>
          <div id="classificationList" class="master-list" style="margin-top:12px"></div>
        </div>

        <div class="admin-grid two" style="margin-top:14px;align-items:start">
          <form id="recipeForm" class="admin-card sticky-form">
            <div class="form-title-row"><h2 id="recipeFormTitle">Buat Resep / BOM</h2><button id="recipeReset" class="text-btn" type="button">Reset</button></div>
            <label class="admin-field">Hasil barang<select id="recipeOutputProduct" required></select></label>
            <label class="admin-field">Qty hasil<input id="recipeOutputQty" type="number" min="0.001" step="0.001" value="1" required /></label>
            <div class="list-head"><strong>Komponen pembentuk</strong><button id="addRecipeComponent" class="mini-btn" type="button">+ Komponen</button></div>
            <div id="recipeComponents" style="display:grid;gap:8px;margin:10px 0"></div>
            <label class="admin-field">Catatan<textarea id="recipeNotes" rows="2" maxlength="500"></textarea></label>
            <button class="primary-btn" type="submit">Simpan sebagai revision baru</button>
          </form>
          <div class="admin-card list-card">
            <div class="list-head"><div><h2>Resep Aktif</h2><div class="muted">Satu resep aktif per barang hasil. Update membuat revision baru.</div></div><span id="recipeCount" class="master-count">0</span></div>
            <div id="recipeList" class="master-list"></div>
          </div>
        </div>
      </section>`);

    button.addEventListener('click', activate);
    el('manufacturingRefresh').addEventListener('click', loadAll);
    el('itemTypeForm').addEventListener('submit', saveItemType);
    el('itemTypeCancel').addEventListener('click', resetItemTypeForm);
    el('unitForm').addEventListener('submit', saveUnit);
    el('unitCancel').addEventListener('click', resetUnitForm);
    el('recipeForm').addEventListener('submit', saveRecipe);
    el('recipeReset').addEventListener('click', resetRecipeForm);
    el('addRecipeComponent').addEventListener('click', () => addComponentRow());
  }

  async function loadAll() {
    if (!el('tab-manufacturing')?.classList.contains('active')) return;
    try {
      const [bootstrap, recipes] = await Promise.all([
        api('/api/admin/manufacturing/bootstrap'),
        api('/api/admin/manufacturing/recipes')
      ]);
      state.bootstrap = bootstrap;
      state.recipes = recipes.recipes || [];
      renderAll();
    } catch (error) { toast(error.message); }
  }

  function activeTypes() { return (state.bootstrap?.itemTypes || []).filter(item => item.isActive); }
  function activeUnits() { return (state.bootstrap?.units || []).filter(item => item.isActive); }
  function products() { return state.bootstrap?.products || []; }
  function typeById(id) { return (state.bootstrap?.itemTypes || []).find(item => item.id === id); }
  function unitById(id) { return (state.bootstrap?.units || []).find(item => item.id === id); }
  function productById(id) { return products().find(item => item.id === Number(id)); }

  function renderAll() {
    renderTypes();
    renderUnits();
    renderClassification();
    renderRecipeSelectors();
    renderRecipes();
  }

  function capabilityText(item) {
    return [
      item.canSell && 'jual', item.canPurchase && 'beli', item.canProduce && 'hasil produksi',
      item.canConsume && 'komponen', item.trackStock && 'stok'
    ].filter(Boolean).join(' · ') || 'tanpa capability';
  }

  function renderTypes() {
    const items = state.bootstrap?.itemTypes || [];
    el('itemTypeCount').textContent = items.length;
    el('itemTypeList').innerHTML = items.length ? items.map(item => `
      <div class="master-row contact-row ${item.isActive ? '' : 'inactive'}">
        <div class="master-main"><strong>${esc(item.name)}</strong><div class="master-meta">${esc(item.code)} · ${esc(capabilityText(item))}</div></div>
        <div class="master-actions"><button class="mini-btn" data-edit-type="${esc(item.id)}" type="button">Edit</button></div>
      </div>`).join('') : '<div class="empty">Belum ada tipe barang.</div>';
    document.querySelectorAll('[data-edit-type]').forEach(button => button.addEventListener('click', () => editType(button.dataset.editType)));
  }

  function editType(id) {
    const item = (state.bootstrap?.itemTypes || []).find(row => row.id === id);
    if (!item) return;
    el('itemTypeId').value = item.id;
    el('itemTypeCode').value = item.code;
    el('itemTypeCode').disabled = true;
    el('itemTypeName').value = item.name;
    el('itemTypeCanSell').checked = item.canSell;
    el('itemTypeCanPurchase').checked = item.canPurchase;
    el('itemTypeCanProduce').checked = item.canProduce;
    el('itemTypeCanConsume').checked = item.canConsume;
    el('itemTypeTrackStock').checked = item.trackStock;
    el('itemTypeActive').checked = item.isActive;
    el('itemTypeFormTitle').textContent = 'Edit Tipe Barang';
    el('itemTypeCancel').classList.remove('hidden');
  }

  async function saveItemType(event) {
    event.preventDefault();
    const id = el('itemTypeId').value;
    const payload = {
      code: el('itemTypeCode').value,
      name: el('itemTypeName').value,
      canSell: el('itemTypeCanSell').checked,
      canPurchase: el('itemTypeCanPurchase').checked,
      canProduce: el('itemTypeCanProduce').checked,
      canConsume: el('itemTypeCanConsume').checked,
      trackStock: el('itemTypeTrackStock').checked,
      isActive: el('itemTypeActive').checked
    };
    try {
      await api(id ? `/api/admin/manufacturing/item-types/${encodeURIComponent(id)}` : '/api/admin/manufacturing/item-types', {
        method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload)
      });
      resetItemTypeForm();
      await loadAll();
      toast(id ? 'Tipe barang diperbarui' : 'Tipe barang ditambahkan');
    } catch (error) { toast(error.message); }
  }

  function resetItemTypeForm() {
    el('itemTypeForm').reset();
    el('itemTypeId').value = '';
    el('itemTypeCode').disabled = false;
    el('itemTypeCanSell').checked = true;
    el('itemTypeCanPurchase').checked = true;
    el('itemTypeCanProduce').checked = false;
    el('itemTypeCanConsume').checked = true;
    el('itemTypeTrackStock').checked = true;
    el('itemTypeActive').checked = true;
    el('itemTypeFormTitle').textContent = 'Tipe Barang';
    el('itemTypeCancel').classList.add('hidden');
  }

  function renderUnits() {
    const items = state.bootstrap?.units || [];
    el('unitCount').textContent = items.length;
    el('unitList').innerHTML = items.length ? items.map(item => `
      <div class="master-row contact-row ${item.isActive ? '' : 'inactive'}">
        <div class="master-main"><strong>${esc(item.name)} (${esc(item.symbol)})</strong><div class="master-meta">${esc(item.code)} · ${item.decimalScale} desimal</div></div>
        <div class="master-actions"><button class="mini-btn" data-edit-unit="${esc(item.id)}" type="button">Edit</button></div>
      </div>`).join('') : '<div class="empty">Belum ada satuan.</div>';
    document.querySelectorAll('[data-edit-unit]').forEach(button => button.addEventListener('click', () => editUnit(button.dataset.editUnit)));
  }

  function editUnit(id) {
    const item = (state.bootstrap?.units || []).find(row => row.id === id);
    if (!item) return;
    el('unitId').value = item.id;
    el('unitCode').value = item.code;
    el('unitCode').disabled = true;
    el('unitName').value = item.name;
    el('unitSymbol').value = item.symbol;
    el('unitDecimalScale').value = String(item.decimalScale);
    el('unitActive').checked = item.isActive;
    el('unitFormTitle').textContent = 'Edit Satuan';
    el('unitCancel').classList.remove('hidden');
  }

  async function saveUnit(event) {
    event.preventDefault();
    const id = el('unitId').value;
    const payload = {
      code: el('unitCode').value,
      name: el('unitName').value,
      symbol: el('unitSymbol').value,
      decimalScale: Number(el('unitDecimalScale').value),
      isActive: el('unitActive').checked
    };
    try {
      await api(id ? `/api/admin/manufacturing/units/${encodeURIComponent(id)}` : '/api/admin/manufacturing/units', {
        method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload)
      });
      resetUnitForm();
      await loadAll();
      toast(id ? 'Satuan diperbarui' : 'Satuan ditambahkan');
    } catch (error) { toast(error.message); }
  }

  function resetUnitForm() {
    el('unitForm').reset();
    el('unitId').value = '';
    el('unitCode').disabled = false;
    el('unitActive').checked = true;
    el('unitFormTitle').textContent = 'Master Satuan';
    el('unitCancel').classList.add('hidden');
  }

  function options(items, current, label) {
    return items.map(item => `<option value="${esc(item.id)}" ${item.id === current ? 'selected' : ''}>${esc(label(item))}</option>`).join('');
  }

  function renderClassification() {
    const items = products();
    const types = activeTypes();
    const units = activeUnits();
    el('classificationCount').textContent = items.length;
    el('classificationList').innerHTML = items.length ? items.map(product => `
      <div class="master-row" style="align-items:end">
        <div class="master-main"><strong>${esc(product.name)}</strong><div class="master-meta">${esc(product.itemTypeName || 'Belum diklasifikasi')} · ${esc(product.unitSymbol || '-')}</div></div>
        <label class="admin-field" style="margin:0;min-width:170px">Tipe<select data-product-type="${product.id}">${options(types, product.itemTypeId, item => item.name)}</select></label>
        <label class="admin-field" style="margin:0;min-width:130px">Satuan<select data-product-unit="${product.id}">${options(units, product.baseUnitId, item => `${item.name} (${item.symbol})`)}</select></label>
        <div class="master-actions"><button class="mini-btn" data-save-classification="${product.id}" type="button">Simpan</button></div>
      </div>`).join('') : '<div class="empty">Belum ada barang.</div>';
    document.querySelectorAll('[data-save-classification]').forEach(button => button.addEventListener('click', () => saveClassification(Number(button.dataset.saveClassification))));
  }

  async function saveClassification(productId) {
    try {
      const itemTypeId = document.querySelector(`[data-product-type="${productId}"]`)?.value;
      const baseUnitId = document.querySelector(`[data-product-unit="${productId}"]`)?.value;
      await api(`/api/admin/manufacturing/products/${productId}`, {
        method: 'PATCH', body: JSON.stringify({ itemTypeId, baseUnitId })
      });
      await loadAll();
      toast('Klasifikasi barang tersimpan');
    } catch (error) { toast(error.message); }
  }

  function producibleProducts() {
    return products().filter(product => typeById(product.itemTypeId)?.canProduce);
  }

  function consumableProducts() {
    return products().filter(product => typeById(product.itemTypeId)?.canConsume);
  }

  function renderRecipeSelectors() {
    const output = el('recipeOutputProduct');
    if (!output) return;
    const selected = output.value;
    const outputs = producibleProducts();
    output.innerHTML = outputs.map(product => `<option value="${product.id}">${esc(product.name)} · ${esc(product.unitSymbol || '-')}</option>`).join('');
    if (outputs.some(product => String(product.id) === selected)) output.value = selected;
    if (!el('recipeComponents').children.length) addComponentRow();
    else refreshComponentSelects();
  }

  function componentOptions(selectedId = '') {
    return consumableProducts().map(product => `<option value="${product.id}" ${String(product.id) === String(selectedId) ? 'selected' : ''}>${esc(product.name)} · ${esc(product.unitSymbol || '-')}</option>`).join('');
  }

  function addComponentRow(component = null) {
    const target = el('recipeComponents');
    if (!target) return;
    const key = ++state.componentSeq;
    target.insertAdjacentHTML('beforeend', `
      <div data-component-row="${key}" style="display:grid;grid-template-columns:minmax(0,1fr) 110px auto;gap:8px;align-items:end">
        <label class="admin-field" style="margin:0">Barang<select data-component-product>${componentOptions(component?.productId)}</select></label>
        <label class="admin-field" style="margin:0">Qty<input data-component-qty type="number" min="0.001" step="0.001" value="${esc(component?.quantity ?? 1)}" /></label>
        <button class="mini-btn danger" type="button" data-remove-component="${key}">×</button>
      </div>`);
    target.querySelector(`[data-remove-component="${key}"]`)?.addEventListener('click', () => {
      target.querySelector(`[data-component-row="${key}"]`)?.remove();
      if (!target.children.length) addComponentRow();
    });
  }

  function refreshComponentSelects() {
    el('recipeComponents')?.querySelectorAll('[data-component-product]').forEach(select => {
      const selected = select.value;
      select.innerHTML = componentOptions(selected);
      if ([...select.options].some(option => option.value === selected)) select.value = selected;
    });
  }

  function recipePayload() {
    const components = [...el('recipeComponents').querySelectorAll('[data-component-row]')].map(row => ({
      productId: Number(row.querySelector('[data-component-product]').value),
      quantity: Number(row.querySelector('[data-component-qty]').value)
    }));
    return {
      outputProductId: Number(el('recipeOutputProduct').value),
      outputQuantity: Number(el('recipeOutputQty').value),
      components,
      notes: el('recipeNotes').value
    };
  }

  async function saveRecipe(event) {
    event.preventDefault();
    try {
      await api('/api/admin/manufacturing/recipes', { method: 'POST', body: JSON.stringify(recipePayload()) });
      resetRecipeForm();
      await loadAll();
      toast('Revision resep baru aktif');
    } catch (error) { toast(error.message); }
  }

  function resetRecipeForm() {
    el('recipeForm').reset();
    el('recipeOutputQty').value = '1';
    el('recipeNotes').value = '';
    el('recipeComponents').innerHTML = '';
    el('recipeFormTitle').textContent = 'Buat Resep / BOM';
    addComponentRow();
  }

  function editRecipe(id) {
    const recipe = state.recipes.find(item => item.id === id);
    if (!recipe) return;
    el('recipeOutputProduct').value = String(recipe.outputProductId);
    el('recipeOutputQty').value = String(recipe.outputQuantity);
    el('recipeNotes').value = recipe.notes || '';
    el('recipeComponents').innerHTML = '';
    recipe.components.forEach(component => addComponentRow(component));
    el('recipeFormTitle').textContent = `Buat Revisi dari v${recipe.revision}`;
    el('recipeForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function archiveRecipe(id) {
    if (!confirm('Archive resep aktif ini? Histori revision tetap tersimpan.')) return;
    try {
      await api(`/api/admin/manufacturing/recipes/${encodeURIComponent(id)}/archive`, { method: 'POST' });
      await loadAll();
      toast('Resep diarsipkan');
    } catch (error) { toast(error.message); }
  }

  function renderRecipes() {
    el('recipeCount').textContent = state.recipes.length;
    el('recipeList').innerHTML = state.recipes.length ? state.recipes.map(recipe => `
      <article class="master-row" style="align-items:flex-start">
        <div class="master-main">
          <strong>${esc(recipe.outputProductName)} · ${recipe.outputQuantity} ${esc(recipe.outputUnitSymbol)}</strong>
          <div class="master-meta">Revision ${recipe.revision} · ${esc(recipe.status)}</div>
          <div class="master-meta" style="margin-top:6px">${recipe.components.map(component => `${esc(component.productName)} ${component.quantity} ${esc(component.unitSymbol)}`).join(' + ')}</div>
          ${recipe.notes ? `<div class="master-meta">${esc(recipe.notes)}</div>` : ''}
        </div>
        <div class="master-actions"><button class="mini-btn" data-revise-recipe="${esc(recipe.id)}" type="button">Buat Revisi</button><button class="mini-btn danger" data-archive-recipe="${esc(recipe.id)}" type="button">Archive</button></div>
      </article>`).join('') : '<div class="empty">Belum ada resep aktif.</div>';
    document.querySelectorAll('[data-revise-recipe]').forEach(button => button.addEventListener('click', () => editRecipe(button.dataset.reviseRecipe)));
    document.querySelectorAll('[data-archive-recipe]').forEach(button => button.addEventListener('click', () => archiveRecipe(button.dataset.archiveRecipe)));
  }

  mount();
})();
