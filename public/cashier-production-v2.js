(() => {
  const currentButton = document.getElementById('productionBtn');
  if (!currentButton) return;

  // cashier-approval-actions.js owns the legacy listener. Replacing the node keeps
  // its current disabled state while removing the recipe-locked V1 click handler.
  const productionButton = currentButton.cloneNode(true);
  currentButton.replaceWith(productionButton);

  let optionState = null;
  let componentDraft = [];

  async function loadOptions() {
    optionState = await api('/api/cashier/production/options');
    return optionState;
  }

  function productById(productId) {
    return (optionState?.products || []).find(product => Number(product.productId) === Number(productId)) || null;
  }

  function recipeById(product, recipeId) {
    return (product?.recipes || []).find(recipe => String(recipe.recipeId) === String(recipeId)) || null;
  }

  function materialById(productId) {
    return (optionState?.materials || []).find(material => Number(material.productId) === Number(productId)) || null;
  }

  // Nama barang di hasil pencarian tidak perlu diikuti satuan lagi -- satuannya
  // sudah kelihatan di label "Qty <satuan>" persis di sampingnya.
  function searchResultsHtml(items, keyword) {
    const key = keyword.trim().toLowerCase();
    const found = items.filter(item => !key || item.productName.toLowerCase().includes(key)).slice(0, 8);
    return found.length
      ? found.map(item => `<button type="button" data-result="${Number(item.productId)}">${escapeHtml(item.productName)}</button>`).join('')
      : '<div class="pimasatu-empty">Tidak ditemukan.</div>';
  }

  function materialChoices(outputProductId) {
    return (optionState?.materials || []).filter(material => Number(material.productId) !== Number(outputProductId));
  }

  function setOutputProduct(productId) {
    el('productionOutputProduct').value = String(productId);
    const product = productById(productId);
    el('productionOutputSearch').value = product?.productName || '';
    renderRecipeOptions({ resetTemplate: true });
  }

  function renderComponents() {
    const host = el('productionComponentRows');
    if (!host) return;
    const outputProductId = Number(el('productionOutputProduct')?.value || 0);
    host.innerHTML = componentDraft.map((component, index) => {
      const material = materialById(component.productId);
      return `
        <div class="production-component-row" data-production-component-index="${index}">
          <div class="field production-component-product pimasatu-search-wrap">
            <label>${index === 0 ? 'Bahan baku' : 'Bahan'}</label>
            <input class="text-input" data-production-material-search autocomplete="off" placeholder="Cari bahan" value="${escapeHtml(material?.productName || '')}" required />
            <div class="pimasatu-results hidden" data-production-material-results></div>
          </div>
          <div class="field production-component-qty">
            <label>Qty ${escapeHtml(material?.unitSymbol || '')}</label>
            <input class="text-input" data-production-quantity type="number" min="1" step="1" value="${Number(component.quantity || 1)}" required />
          </div>
          <button class="secondary-btn production-remove-component" data-production-remove type="button" aria-label="Hapus bahan">×</button>
        </div>`;
    }).join('');

    host.querySelectorAll('[data-production-component-index]').forEach((row, index) => {
      const search = row.querySelector('[data-production-material-search]');
      const results = row.querySelector('[data-production-material-results]');
      const choices = materialChoices(outputProductId);
      const renderResults = () => {
        results.innerHTML = searchResultsHtml(choices, search.value);
        results.classList.remove('hidden');
      };
      search.addEventListener('focus', renderResults);
      search.addEventListener('input', renderResults);
      search.addEventListener('blur', () => setTimeout(() => results.classList.add('hidden'), 150));
      results.addEventListener('click', event => {
        const button = event.target.closest('[data-result]');
        if (!button) return;
        componentDraft[index].productId = Number(button.dataset.result);
        renderComponents();
      });
    });
    host.querySelectorAll('[data-production-quantity]').forEach((input, index) => {
      input.addEventListener('input', () => {
        componentDraft[index].quantity = Number(input.value || 0);
      });
    });
    host.querySelectorAll('[data-production-remove]').forEach((button, index) => {
      button.addEventListener('click', () => {
        componentDraft.splice(index, 1);
        renderComponents();
      });
    });
    const count = el('productionComponentCount');
    if (count) count.textContent = `${componentDraft.length} bahan`;
  }

  function currentMultiplier() {
    const raw = Math.floor(Number(el('productionMultiplier')?.value || 1));
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  }

  function applyRecipeTemplate() {
    const outputProduct = productById(el('productionOutputProduct')?.value);
    const recipe = recipeById(outputProduct, el('productionRecipe')?.value);
    if (!outputProduct || !recipe) return;
    const multiplier = currentMultiplier();
    const outputQty = el('productionOutputQuantity');
    if (outputQty) outputQty.value = String(Number(recipe.outputQuantity) * multiplier);
    const outputName = el('productionOutputName');
    if (outputName) outputName.textContent = outputProduct.productName;
    const outputQtyLabel = el('productionOutputQtyLabel');
    if (outputQtyLabel) outputQtyLabel.textContent = `Qty ${outputProduct.unitSymbol || ''}`.trim();
    componentDraft = (recipe.components || []).map(component => ({
      productId: Number(component.productId),
      quantity: Number(component.quantity) * multiplier
    }));
    renderComponents();
    const templateInfo = el('productionRecipeInfo');
    if (templateInfo) templateInfo.textContent = `Recipe v${recipe.recipeRevision} dimuat sebagai acuan · qty × kelipatan ${multiplier}. Edit qty, tambah, atau hapus bahan di bawah tidak mengubah Master Recipe.`;
  }

  function renderRecipeOptions({ resetTemplate = true } = {}) {
    const outputProduct = productById(el('productionOutputProduct')?.value);
    const recipeSelect = el('productionRecipe');
    if (!outputProduct || !recipeSelect) return;
    recipeSelect.innerHTML = (outputProduct.recipes || []).map(recipe =>
      `<option value="${escapeHtml(recipe.recipeId)}">Recipe v${Number(recipe.recipeRevision)} · acuan ${Number(recipe.outputQuantity)} ${escapeHtml(outputProduct.unitSymbol || '')}</option>`
    ).join('');
    if (resetTemplate) applyRecipeTemplate();
  }

  function addComponent() {
    const outputProductId = Number(el('productionOutputProduct')?.value || 0);
    const used = new Set(componentDraft.map(component => Number(component.productId)));
    const material = (optionState?.materials || []).find(item => Number(item.productId) !== outputProductId && !used.has(Number(item.productId)));
    if (!material) {
      toast('Tidak ada bahan lain yang bisa ditambahkan.');
      return;
    }
    componentDraft.push({ productId: Number(material.productId), quantity: 1 });
    renderComponents();
  }

  async function productionDialogV2() {
    try {
      const payload = await loadOptions();
      const products = payload.products || [];
      if (!products.length) {
        openDialog({
          eyebrow: 'Laci · Produksi',
          title: 'Produksi',
          readOnly: true,
          body: '<p class="muted">Belum ada barang hasil yang memiliki Recipe/BOM aktif, stock tracking, dan izin produksi.</p>'
        });
        return;
      }
      if (!(payload.materials || []).length) {
        openDialog({
          eyebrow: 'Laci · Produksi',
          title: 'Produksi',
          readOnly: true,
          body: '<p class="muted">Belum ada barang yang diizinkan sebagai bahan produksi dengan stock tracking aktif.</p>'
        });
        return;
      }

      openDialog({
        eyebrow: 'Laci · Warehouse Production',
        title: 'Produksi',
        body: `
          <section class="production-output-panel">
            <div class="production-section-title"><strong>Plan Produksi</strong><span class="muted">barang jadi &amp; kelipatan</span></div>
            <div class="production-output-grid">
              <div class="field pimasatu-search-wrap">
                <label>Barang jadi</label>
                <input id="productionOutputSearch" class="text-input" autocomplete="off" placeholder="Cari barang jadi" required />
                <input type="hidden" id="productionOutputProduct" />
                <div id="productionOutputResults" class="pimasatu-results hidden"></div>
              </div>
              <div class="field"><label>Kelipatan</label><input id="productionMultiplier" class="text-input" type="number" min="1" step="1" value="1" required /></div>
            </div>
            <div class="field"><label>Recipe / BOM acuan</label><select id="productionRecipe" class="text-input" required></select></div>
            <div id="productionRecipeInfo" class="cashier-lock-note"></div>
          </section>

          <div class="pimasatu-detail-head"><strong>Detail Produksi</strong><span id="productionComponentCount" class="muted"></span></div>
          <div class="production-detail-body">
            <div class="production-detail-result">
              <div class="field production-detail-result-name"><label>Hasil</label><div><strong id="productionOutputName">-</strong></div></div>
              <div class="field production-detail-result-qty"><label id="productionOutputQtyLabel">Qty hasil</label><input id="productionOutputQuantity" class="text-input" type="number" min="1" step="1" required /></div>
              <div class="production-detail-result-spacer" aria-hidden="true"></div>
            </div>
            <div id="productionComponentRows"></div>
            <button id="productionAddComponent" class="secondary-btn production-add-component" type="button">＋ Tambah bahan</button>
          </div>

          <p class="muted production-footnote">Warehouse menghitung mutasi stok dan HPP dari qty aktual di form ini. Accounting menerima business fact setelah stock commit. Recipe Master hanya menjadi template dan tidak ikut berubah.</p>`,
        submitText: 'PRODUKSI SEKARANG',
        onSubmit: async () => {
          const outputProductId = Number(el('productionOutputProduct').value);
          const outputQuantity = Number(el('productionOutputQuantity').value);
          const recipeId = el('productionRecipe').value;
          const components = componentDraft.map(component => ({
            productId: Number(component.productId),
            quantity: Number(component.quantity)
          }));
          if (!Number.isInteger(outputProductId) || !Number.isInteger(outputQuantity) || outputQuantity < 1) {
            throw new Error('Barang hasil dan qty hasil wajib valid.');
          }
          if (!recipeId || !components.length || components.some(component => !Number.isInteger(component.productId) || !Number.isInteger(component.quantity) || component.quantity < 1)) {
            throw new Error('Recipe acuan dan seluruh bahan baku wajib valid.');
          }
          if (new Set(components.map(component => component.productId)).size !== components.length) {
            throw new Error('Bahan baku tidak boleh duplikat.');
          }
          const result = await api('/api/cashier/production', {
            method: 'POST',
            body: JSON.stringify({ outputProductId, outputQuantity, recipeId, components })
          });
          const accountingText = result.accounting?.accountingChange === 'NONE_SAME_INVENTORY_ACCOUNT'
            ? ' · akun persediaan sama, no journal movement'
            : result.accounting?.journalNumber
              ? ` · jurnal ${result.accounting.journalNumber}`
              : result.accounting?.bridgeStatus === 'NEEDS_CONFIGURATION'
                ? ' · Accounting perlu konfigurasi'
                : '';
          toast(`Produksi tersimpan · ${result.production.totalOutputQuantity} ${result.production.unitSymbol} ${result.production.outputProductName}${accountingText}`);
          return true;
        }
      });

      const outputSearch = el('productionOutputSearch');
      const outputResults = el('productionOutputResults');
      const renderOutputResults = () => {
        outputResults.innerHTML = searchResultsHtml(products, outputSearch.value);
        outputResults.classList.remove('hidden');
      };
      outputSearch.addEventListener('focus', renderOutputResults);
      outputSearch.addEventListener('input', renderOutputResults);
      outputSearch.addEventListener('blur', () => setTimeout(() => outputResults.classList.add('hidden'), 150));
      outputResults.addEventListener('click', event => {
        const button = event.target.closest('[data-result]');
        if (!button) return;
        outputResults.classList.add('hidden');
        setOutputProduct(Number(button.dataset.result));
      });

      el('productionRecipe')?.addEventListener('change', applyRecipeTemplate);
      el('productionMultiplier')?.addEventListener('change', applyRecipeTemplate);
      el('productionAddComponent')?.addEventListener('click', addComponent);
    } catch (error) {
      toast(error.message);
    }
  }

  productionButton.addEventListener('click', productionDialogV2);
})();
