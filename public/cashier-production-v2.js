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

  function materialOptions(selectedId, outputProductId) {
    return (optionState?.materials || [])
      .filter(material => Number(material.productId) !== Number(outputProductId))
      .map(material => `<option value="${Number(material.productId)}"${Number(material.productId) === Number(selectedId) ? ' selected' : ''}>${escapeHtml(material.productName)} · ${escapeHtml(material.unitSymbol || '')}</option>`)
      .join('');
  }

  function renderComponents() {
    const host = el('productionComponentRows');
    if (!host) return;
    const outputProductId = Number(el('productionOutputProduct')?.value || 0);
    host.innerHTML = componentDraft.map((component, index) => {
      const material = materialById(component.productId);
      return `
        <div class="production-component-row" data-production-component-index="${index}">
          <div class="field production-component-product">
            <label>${index === 0 ? 'Bahan baku' : 'Bahan'}</label>
            <select class="text-input" data-production-material required>
              ${materialOptions(component.productId, outputProductId)}
            </select>
          </div>
          <div class="field production-component-qty">
            <label>Qty ${escapeHtml(material?.unitSymbol || '')}</label>
            <input class="text-input" data-production-quantity type="number" min="1" step="1" value="${Number(component.quantity || 1)}" required />
          </div>
          <button class="secondary-btn production-remove-component" data-production-remove type="button" aria-label="Hapus bahan">×</button>
        </div>`;
    }).join('');

    host.querySelectorAll('[data-production-material]').forEach((select, index) => {
      select.addEventListener('change', () => {
        componentDraft[index].productId = Number(select.value);
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

  function applyRecipeTemplate() {
    const outputProduct = productById(el('productionOutputProduct')?.value);
    const recipe = recipeById(outputProduct, el('productionRecipe')?.value);
    if (!outputProduct || !recipe) return;
    const outputQty = el('productionOutputQuantity');
    if (outputQty) outputQty.value = String(recipe.outputQuantity);
    componentDraft = (recipe.components || []).map(component => ({
      productId: Number(component.productId),
      quantity: Number(component.quantity)
    }));
    renderComponents();
    const templateInfo = el('productionRecipeInfo');
    if (templateInfo) templateInfo.textContent = `Recipe v${recipe.recipeRevision} dimuat sebagai acuan. Edit qty, tambah, atau hapus bahan di bawah tidak mengubah Master Recipe.`;
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

      const outputOptions = products.map(product =>
        `<option value="${Number(product.productId)}">${escapeHtml(product.productName)} · ${escapeHtml(product.unitSymbol || '')}</option>`
      ).join('');

      openDialog({
        eyebrow: 'Laci · Warehouse Production',
        title: 'Produksi',
        body: `
          <section class="production-output-panel">
            <div class="production-section-title"><strong>Hasil produksi</strong><span class="muted">actual output</span></div>
            <div class="production-output-grid">
              <div class="field"><label>Barang hasil</label><select id="productionOutputProduct" class="text-input" required>${outputOptions}</select></div>
              <div class="field"><label>Qty hasil</label><input id="productionOutputQuantity" class="text-input" type="number" min="1" step="1" required /></div>
            </div>
            <div class="field"><label>Recipe / BOM acuan</label><select id="productionRecipe" class="text-input" required></select></div>
            <div id="productionRecipeInfo" class="cashier-lock-note"></div>
          </section>

          <section class="production-material-panel">
            <div class="production-section-title"><strong>Bahan baku aktual</strong><span id="productionComponentCount" class="muted"></span></div>
            <div id="productionComponentRows"></div>
            <button id="productionAddComponent" class="secondary-btn production-add-component" type="button">＋ Tambah bahan</button>
          </section>

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

      el('productionOutputProduct')?.addEventListener('change', () => renderRecipeOptions({ resetTemplate: true }));
      el('productionRecipe')?.addEventListener('change', applyRecipeTemplate);
      el('productionAddComponent')?.addEventListener('click', addComponent);
      renderRecipeOptions({ resetTemplate: true });
    } catch (error) {
      toast(error.message);
    }
  }

  productionButton.addEventListener('click', productionDialogV2);
})();
