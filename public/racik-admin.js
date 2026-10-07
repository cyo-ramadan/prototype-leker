// Tab "Bahan & Aroma" di Workspace Gerai -- hanya skin F (Racik Parfum,
// DESAIN-SKIN-F-RACIK-PARFUM.md). Bos Cyo, 2026-10-06: "entry2 barangnya jangan
// dibuat ribet, sedikitin yang wajib, yang opsi kasi default langsung aja tanpa
// ngisi".
//
// Satu layar menggantikan tiga langkah lama (Data Barang -> Peran Barang &
// Satuan -> Resep). Yang wajib diisi pemilik:
//   - Bahan : nama. (satuan default ml, harga beli boleh kosong = 0)
//   - Aroma : nama, harga jual, dan takaran resep standarnya.
// Sisanya diisi otomatis: kategori "Bahan"/"Parfum", peran barang Bahan/Barang
// Jadi, satuan aroma pcs (1 botol), qty hasil resep 1.
// Tidak ada endpoint baru -- memanggil endpoint yang sama dengan tab aslinya:
//   POST  /api/admin/products                      (barang baru)
//   PATCH /api/admin/manufacturing/products/:id    (peran barang + satuan)
//   POST  /api/admin/manufacturing/recipes         (resep standar / revisi baru)
//   GET   /api/admin/bootstrap, /api/admin/manufacturing/bootstrap, /api/admin/manufacturing/recipes
// Modal dan stok bahan terisi saat belanja bahan dicatat (Kasir lengkap -> Belanja).
(() => {
  if (window.LEKER_PAGE_CONTEXT !== 'admin') return;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const rupiah = value => `Rp${Math.round(Number(value) || 0).toLocaleString('id-ID')}`;
  const digits = value => { const only = String(value ?? '').replace(/\D/g, ''); return only ? Number(only) : null; };
  const isOn = () => window.MaxiSkin?.skin?.() === 'f';
  const UNITS = [['ML', 'ml'], ['GRAM', 'gram'], ['PCS', 'pcs']];
  const state = { products: [], prices: new Map(), types: [], units: [], recipes: [], unit: 'ML', editing: null, busy: false };

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: { ...(options.headers || {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Gagal (${response.status})`);
    return payload;
  }

  function toast(message) {
    const node = $('adminToast') || document.querySelector('.admin-toast');
    if (!node) return alert(message);
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 2800);
  }

  const typeByCode = code => state.types.find(type => type.code === code && type.isActive !== false);
  const rawType = () => typeByCode('RAW_MATERIAL') || state.types.find(type => type.canConsume && !type.canSell);
  const finishedType = () => typeByCode('FINISHED_GOOD') || state.types.find(type => type.canSell && type.canProduce);
  const unitByCode = code => state.units.find(unit => unit.code === code && unit.isActive !== false);
  const materials = () => state.products.filter(product => product.itemTypeId && product.itemTypeId === rawType()?.id);
  const aromas = () => state.products.filter(product => product.itemTypeId && product.itemTypeId === finishedType()?.id);
  const activeRecipeOf = productId => state.recipes.find(recipe => recipe.outputProductId === Number(productId) && recipe.status === 'ACTIVE');

  function mount() {
    if ($('tab-racikbahan')) return true;
    const tabs = document.querySelector('.admin-tabs');
    const app = $('adminApp');
    if (!tabs || !app) return false;
    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.type = 'button';
    button.dataset.tab = 'racikbahan';
    button.textContent = '🧪 Bahan & Aroma';
    tabs.insertBefore(button, tabs.firstChild?.nextSibling || null);
    button.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(item => item.classList.toggle('active', item === button));
      document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-racikbahan'));
      load();
    });
    const section = document.createElement('section');
    section.id = 'tab-racikbahan';
    section.className = 'admin-section';
    section.innerHTML = `
      <div class="admin-card">
        <h2>Bahan &amp; Aroma</h2>
        <p class="muted">Dua hal yang perlu diisi supaya kasir bisa meracik. Yang lain diisi otomatis.</p>
      </div>
      <div class="admin-grid two">
        <form id="rbMaterialForm" class="admin-card">
          <h2>Tambah bahan</h2>
          <label class="admin-field">Nama bahan<input id="rbMaterialName" class="text-input" maxlength="100" placeholder="mis. Bibit Bubble Gum, Alkohol, Botol 50 ml" required /></label>
          <div class="admin-field">Satuan<div id="rbUnits" class="rb-chips"></div></div>
          <label class="admin-field">Harga beli per satuan <span class="field-note">boleh kosong</span><input id="rbMaterialCost" class="text-input" inputmode="numeric" autocomplete="off" placeholder="0" /></label>
          <button id="rbMaterialSave" class="primary-btn" type="submit">Tambah bahan</button>
          <p class="field-note">Modal dan stok bahan terisi otomatis saat belanja bahan dicatat di Kasir lengkap.</p>
          <div id="rbMaterialList" class="rb-list"></div>
        </form>
        <form id="rbAromaForm" class="admin-card">
          <div class="form-title-row"><h2 id="rbAromaTitle">Tambah aroma</h2><button id="rbAromaCancel" class="text-btn hidden" type="button">Batal ubah</button></div>
          <label class="admin-field">Nama aroma &amp; ukuran<input id="rbAromaName" class="text-input" maxlength="100" placeholder="mis. Bubble Gum 50 ml" required /></label>
          <label class="admin-field">Harga jual<input id="rbAromaPrice" class="text-input" inputmode="numeric" autocomplete="off" placeholder="mis. 120.000" required /></label>
          <div class="admin-field">Resep standar (takaran untuk 1 botol)<div id="rbRecipeRows" class="rb-rows"></div></div>
          <button id="rbAddRow" class="secondary-btn" type="button">+ Bahan</button>
          <button id="rbAromaSave" class="primary-btn" type="submit">Simpan aroma</button>
          <p class="field-note">Takaran bilangan bulat. Kasir tetap bisa mengubah takaran per pembeli di layar Racik.</p>
          <div id="rbAromaList" class="rb-list"></div>
        </form>
      </div>`;
    app.appendChild(section);
    injectStyle();
    bind();
    return true;
  }

  function injectStyle() {
    if ($('racikAdminStyle')) return;
    const style = document.createElement('style');
    style.id = 'racikAdminStyle';
    style.textContent = `
      .rb-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
      .rb-chips button{min-height:42px;padding:0 16px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;font-weight:800;cursor:pointer}
      .rb-chips button[aria-pressed="true"]{background:var(--brand);border-color:var(--brand);color:#fff}
      .rb-rows{display:grid;gap:8px;margin-top:6px}
      .rb-row{display:grid;grid-template-columns:minmax(0,1fr) 84px 40px;gap:8px;align-items:center}
      .rb-row select,.rb-row input{min-height:44px}
      .rb-list{display:grid;gap:8px;margin-top:14px}
      .rb-pills{display:flex;flex-wrap:wrap;gap:6px}
      .rb-pills .status-chip{display:inline-block;padding:6px 10px;border-radius:999px;background:var(--skin-chip-bg,#eee);color:var(--ink);font-weight:700;font-size:13px}
      .rb-list .master-row{display:flex;justify-content:space-between;align-items:center;gap:10px}
      .rb-list small{display:block;color:var(--muted)}
      #rbAromaForm .secondary-btn{margin:8px 0 12px}`;
    document.head.appendChild(style);
  }

  function renderUnits() {
    $('rbUnits').innerHTML = UNITS.filter(([code]) => unitByCode(code))
      .map(([code, label]) => `<button type="button" data-unit="${code}" aria-pressed="${state.unit === code}">${label}</button>`).join('');
  }

  function materialOptions(selected) {
    return `<option value="">Pilih bahan</option>${materials().map(item => `<option value="${item.id}" ${Number(selected) === item.id ? 'selected' : ''}>${esc(item.name)} (${esc(item.unitSymbol)})</option>`).join('')}`;
  }

  function addRow(productId = '', quantity = '') {
    const row = document.createElement('div');
    row.className = 'rb-row';
    row.innerHTML = `<select class="text-input" data-rb-product>${materialOptions(productId)}</select>
      <input class="text-input" data-rb-qty inputmode="numeric" autocomplete="off" placeholder="qty" value="${esc(quantity)}" aria-label="Takaran" />
      <button class="mini-btn danger" type="button" data-rb-remove aria-label="Buang">×</button>`;
    $('rbRecipeRows').appendChild(row);
  }

  function resetAroma() {
    state.editing = null;
    $('rbAromaForm').reset();
    $('rbAromaTitle').textContent = 'Tambah aroma';
    $('rbAromaCancel').classList.add('hidden');
    $('rbAromaName').disabled = false;
    $('rbAromaPrice').disabled = false;
    $('rbRecipeRows').innerHTML = '';
    for (let i = 0; i < 3; i += 1) addRow();
  }

  function render() {
    renderUnits();
    const mats = materials();
    $('rbMaterialList').innerHTML = mats.length
      ? `<div class="rb-pills">${mats.map(item => `<span class="status-chip" title="${state.prices.get(item.id)?.purchasePrice ? `beli ${rupiah(state.prices.get(item.id).purchasePrice)} per ${esc(item.unitSymbol || '')}` : ''}">${esc(item.name)} · ${esc(item.unitSymbol || '-')}</span>`).join('')}</div>`
      : '<div class="empty">Belum ada bahan.</div>';
    const list = aromas();
    $('rbAromaList').innerHTML = list.length
      ? list.map(item => {
        const recipe = activeRecipeOf(item.id);
        const formula = recipe ? recipe.components.map(line => `${esc(line.productName)} ${line.quantity} ${esc(line.unitSymbol || '')}`).join(' · ') : 'belum ada resep -- belum muncul di layar Racik';
        return `<div class="master-row"><div><b>${esc(item.name)}</b><small>${rupiah(state.prices.get(item.id)?.price)} · ${formula}</small></div>
          <button class="mini-btn" type="button" data-rb-edit="${item.id}">Ubah resep</button></div>`;
      }).join('')
      : '<div class="empty">Belum ada aroma.</div>';
    if (!$('rbRecipeRows').children.length) resetAroma();
    else $('rbRecipeRows').querySelectorAll('[data-rb-product]').forEach(select => { const value = select.value; select.innerHTML = materialOptions(value); });
  }

  async function load() {
    try {
      const [admin, master, recipes] = await Promise.all([
        api('/api/admin/bootstrap'),
        api('/api/admin/manufacturing/bootstrap'),
        api('/api/admin/manufacturing/recipes')
      ]);
      state.prices = new Map((admin.products || []).map(product => [Number(product.id), product]));
      state.products = (master.products || []).map(product => ({ ...product, id: Number(product.id) }));
      state.types = master.itemTypes || [];
      state.units = master.units || [];
      state.recipes = Array.isArray(recipes) ? recipes : (recipes.recipes || []);
      render();
    } catch (error) { toast(error.message); }
  }

  // Barang baru = dua panggilan lama berurutan: buat barangnya, lalu tetapkan
  // peran barang & satuannya.
  async function createProduct({ name, purchasePrice, price, category, typeId, unitId }) {
    const created = await api('/api/admin/products', {
      method: 'POST',
      body: JSON.stringify({ name, purchasePrice, price, category, emoji: category === 'Parfum' ? '🧴' : '🧪', imageData: '', isActive: true })
    });
    await api(`/api/admin/manufacturing/products/${created.id}`, { method: 'PATCH', body: JSON.stringify({ itemTypeId: typeId, baseUnitId: unitId }) });
    return created.id;
  }

  async function saveMaterial(event) {
    event.preventDefault();
    if (state.busy) return;
    const name = $('rbMaterialName').value.trim();
    if (!name) return toast('Tulis nama bahannya dulu.');
    const type = rawType();
    const unit = unitByCode(state.unit);
    if (!type || !unit) return toast('Peran "Bahan" atau satuan belum ada di gerai ini. Hubungi tim kami.');
    state.busy = true;
    try {
      await createProduct({ name, purchasePrice: digits($('rbMaterialCost').value) ?? 0, price: 0, category: 'Bahan', typeId: type.id, unitId: unit.id });
      $('rbMaterialName').value = '';
      $('rbMaterialCost').value = '';
      toast(`${name} ditambahkan.`);
      await load();
      $('rbMaterialName').focus();
    } catch (error) { toast(error.message); } finally { state.busy = false; }
  }

  async function saveAroma(event) {
    event.preventDefault();
    if (state.busy) return;
    const components = [...$('rbRecipeRows').querySelectorAll('.rb-row')]
      .map(row => ({ productId: Number(row.querySelector('[data-rb-product]').value), quantity: digits(row.querySelector('[data-rb-qty]').value) }))
      .filter(line => line.productId);
    if (!components.length) return toast('Isi minimal satu bahan di resep standar.');
    if (components.some(line => !line.quantity)) return toast('Takaran tiap bahan wajib diisi (bilangan bulat).');
    if (new Set(components.map(line => line.productId)).size !== components.length) return toast('Ada bahan yang dipilih dua kali.');
    state.busy = true;
    try {
      let productId = state.editing;
      if (!productId) {
        const name = $('rbAromaName').value.trim();
        const price = digits($('rbAromaPrice').value);
        if (!name || price === null) { toast('Nama aroma dan harga jual wajib diisi.'); return; }
        const type = finishedType();
        const unit = unitByCode('PCS');
        if (!type || !unit) { toast('Peran "Barang Jadi" atau satuan pcs belum ada di gerai ini. Hubungi tim kami.'); return; }
        productId = await createProduct({ name, purchasePrice: 0, price, category: 'Parfum', typeId: type.id, unitId: unit.id });
      }
      await api('/api/admin/manufacturing/recipes', { method: 'POST', body: JSON.stringify({ outputProductId: productId, outputQuantity: 1, components, variantLabel: '', notes: 'Resep standar (Bahan & Aroma)' }) });
      toast(state.editing ? 'Resep standar diperbarui.' : 'Aroma siap diracik.');
      resetAroma();
      await load();
    } catch (error) { toast(error.message); } finally { state.busy = false; }
  }

  function editAroma(productId) {
    const product = aromas().find(item => item.id === Number(productId));
    if (!product) return;
    state.editing = product.id;
    $('rbAromaTitle').textContent = `Ubah resep ${product.name}`;
    $('rbAromaCancel').classList.remove('hidden');
    $('rbAromaName').value = product.name;
    $('rbAromaPrice').value = Math.round(state.prices.get(product.id)?.price || 0).toLocaleString('id-ID');
    // Nama & harga diubah di Daftar Barang; di sini hanya resepnya.
    $('rbAromaName').disabled = true;
    $('rbAromaPrice').disabled = true;
    $('rbRecipeRows').innerHTML = '';
    const recipe = activeRecipeOf(product.id);
    for (const line of recipe?.components || []) addRow(line.productId, line.quantity);
    if (!recipe) addRow();
    $('rbAromaForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function bind() {
    $('rbMaterialForm').addEventListener('submit', saveMaterial);
    $('rbAromaForm').addEventListener('submit', saveAroma);
    $('rbUnits').addEventListener('click', event => {
      const button = event.target.closest('[data-unit]');
      if (!button) return;
      state.unit = button.dataset.unit;
      renderUnits();
    });
    $('rbAddRow').addEventListener('click', () => addRow());
    $('rbAromaCancel').addEventListener('click', resetAroma);
    $('rbRecipeRows').addEventListener('click', event => {
      const remove = event.target.closest('[data-rb-remove]');
      if (!remove) return;
      remove.closest('.rb-row').remove();
      if (!$('rbRecipeRows').children.length) addRow();
    });
    for (const id of ['rbMaterialCost', 'rbAromaPrice']) {
      $(id).addEventListener('input', () => { const value = digits($(id).value); $(id).value = value === null ? '' : value.toLocaleString('id-ID'); });
    }
    $('rbAromaList').addEventListener('click', event => {
      const edit = event.target.closest('[data-rb-edit]');
      if (edit) editAroma(edit.dataset.rbEdit);
    });
  }

  function unmount() {
    $('tab-racikbahan')?.remove();
    document.querySelector('.admin-tab[data-tab="racikbahan"]')?.remove();
  }

  // Tab baru hanya untuk skin F; tombol tab asli tetap ada (pola nav-groups).
  function sync() {
    if (!isOn()) return unmount();
    mount();
  }
  const start = () => Promise.resolve(window.MaxiSkin?.ready).then(sync, sync);
  window.addEventListener('maxi-skin-change', sync);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
