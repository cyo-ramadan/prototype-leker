(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const state = { products: [] };

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
    toast.timer = setTimeout(() => node.classList.remove('show'), 2200);
  }

  function mount() {
    const section = el('tab-products');
    if (!section || el('productPolicyCard')) return;
    section.insertAdjacentHTML('beforeend', `
      <div id="productPolicyCard" class="admin-card" style="margin-top:14px">
        <div class="list-head">
          <div><div class="admin-eyebrow">Policy Barang</div><h2>Poin, Stok & Resep Penjualan</h2><div class="muted">Qty fisik selalu bilangan bulat. Jika butuh pecahan, gunakan satuan dasar yang lebih kecil.</div></div>
          <button id="productPolicyRefresh" class="secondary-btn" type="button">↻ Refresh</button>
        </div>
        <div class="admin-grid two" style="margin-top:14px;align-items:start">
          <div>
            <label class="admin-field">Barang<select id="productPolicyProduct"></select></label>
            <div id="productPolicySummary" class="admin-tip"></div>
          </div>
          <form id="productPolicyForm">
            <label class="admin-field">Poin per 1 barang<input id="productPointsPerUnit" type="number" min="0" step="1" value="0" required /></label>
            <label class="admin-check"><input id="productStockTracking" type="checkbox" /> Track & enforce stok</label>
            <label class="admin-field">Mode pemenuhan<select id="productProductionMode"><option value="STOCK">STOCK · jual dari stok tersedia</option><option value="DADAKAN">DADAKAN · produksi dulu lalu jual</option></select></label>
            <label class="admin-check"><input id="productRecipeLink" type="checkbox" /> Link ke resep aktif barang ini</label>
            <div id="productRecipePolicyNote" class="muted" style="margin:8px 0 12px"></div>
            <button class="primary-btn" type="submit">Simpan policy barang</button>
          </form>
        </div>
      </div>`);
    el('productPolicyRefresh')?.addEventListener('click', load);
    el('productPolicyProduct')?.addEventListener('change', renderSelected);
    el('productProductionMode')?.addEventListener('change', renderRecipeNote);
    el('productRecipeLink')?.addEventListener('change', renderRecipeNote);
    el('productPolicyForm')?.addEventListener('submit', save);
  }

  async function load() {
    try {
      const payload = await api('/api/admin/master/products/policies');
      state.products = payload.products || [];
      renderOptions();
      enhanceProductRows();
    } catch (error) { toast(error.message); }
  }

  function renderOptions() {
    const select = el('productPolicyProduct');
    if (!select) return;
    const current = select.value;
    select.innerHTML = state.products.map(product => `<option value="${product.productId}">${esc(product.name)}</option>`).join('');
    if (state.products.some(product => String(product.productId) === current)) select.value = current;
    renderSelected();
  }

  function selected() {
    return state.products.find(product => String(product.productId) === String(el('productPolicyProduct')?.value));
  }

  function renderSelected() {
    const product = selected();
    if (!product) {
      if (el('productPolicySummary')) el('productPolicySummary').textContent = 'Belum ada barang.';
      return;
    }
    el('productPointsPerUnit').value = String(product.pointsPerUnit || 0);
    el('productStockTracking').checked = Boolean(product.stockTrackingEnabled);
    el('productProductionMode').value = product.productionMode || 'STOCK';
    el('productRecipeLink').checked = Boolean(product.recipeLinkEnabled);
    const stock = product.stockQuantity == null ? 'belum diinisialisasi' : `${product.stockQuantity} ${product.unitSymbol || ''}`;
    const recipe = product.activeRecipe ? `Resep v${product.activeRecipe.revision} · hasil ${product.activeRecipe.outputQuantity} ${product.unitSymbol || ''}` : 'Belum ada resep aktif';
    el('productPolicySummary').innerHTML = `<b>${esc(product.name)}</b><div style="margin-top:5px">${esc(product.itemTypeName || 'Tanpa tipe')} · Stok ${esc(stock)} · ${esc(recipe)}</div>`;
    renderRecipeNote();
  }

  function renderRecipeNote() {
    const product = selected();
    if (!product) return;
    const dadakan = el('productProductionMode')?.value === 'DADAKAN';
    const linked = Boolean(el('productRecipeLink')?.checked);
    const note = dadakan
      ? (linked && product.activeRecipe
        ? `Saat dijual, sistem memakai resep aktif v${product.activeRecipe.revision}, memproduksi batch minimum, lalu melakukan stock-out penjualan.`
        : 'Mode DADAKAN baru bisa disimpan jika Link Resep aktif dan barang sudah punya resep aktif.')
      : (linked ? 'Resep tetap terhubung sebagai master, tapi mode STOCK tidak menjalankan auto-produksi saat penjualan.' : 'Penjualan memakai stok yang tersedia tanpa auto-produksi.');
    el('productRecipePolicyNote').textContent = note;
  }

  async function save(event) {
    event.preventDefault();
    const product = selected();
    if (!product) return;
    try {
      const payload = await api(`/api/admin/master/products/${product.productId}/policy`, {
        method: 'PATCH',
        body: JSON.stringify({
          pointsPerUnit: Number(el('productPointsPerUnit').value),
          stockTrackingEnabled: el('productStockTracking').checked,
          productionMode: el('productProductionMode').value,
          recipeLinkEnabled: el('productRecipeLink').checked
        })
      });
      const index = state.products.findIndex(item => item.productId === product.productId);
      if (index >= 0) state.products[index] = payload.product;
      renderSelected();
      enhanceProductRows();
      toast('Policy barang tersimpan');
    } catch (error) { toast(error.message); }
  }

  function enhanceProductRows() {
    const list = el('productList');
    if (!list) return;
    list.querySelectorAll('[data-edit-product]').forEach(button => {
      const productId = Number(button.dataset.editProduct);
      const product = state.products.find(item => item.productId === productId);
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
      meta.textContent = `Poin ${product.pointsPerUnit} · ${stock} · ${product.productionMode}${product.recipeLinkEnabled ? ' · resep linked' : ''}`;
      if (button.dataset.productPolicyBound !== '1') {
        button.dataset.productPolicyBound = '1';
        button.addEventListener('click', () => {
          setTimeout(() => {
            if (state.products.some(item => item.productId === productId)) {
              el('productPolicyProduct').value = String(productId);
              renderSelected();
            }
          }, 0);
        });
      }
    });
  }

  mount();
  const productTab = document.querySelector('[data-tab="products"]');
  productTab?.addEventListener('click', () => setTimeout(load, 0));
  const list = el('productList');
  if (list) new MutationObserver(() => enhanceProductRows()).observe(list, { childList: true });
  const gate = el('authGate');
  if (gate) new MutationObserver(() => { if (gate.classList.contains('hidden')) load(); }).observe(gate, { attributes: true, attributeFilter: ['class'] });
  if (gate?.classList.contains('hidden')) load();
})();
