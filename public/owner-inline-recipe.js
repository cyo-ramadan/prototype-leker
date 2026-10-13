// Skin H: resep opsional langsung pada barang; stok/posting tetap lewat mesin lama.
(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const on = () => window.MaxiSkin?.skin?.() === 'h';
  let editor = null, product = null, recipe = null;
  const origins = new Map();

  function basics() {
    const host = $('productMasterFields');
    if (!host) return;
    let group = $('hProductBasics');
    if (on() && !group) {
      group = document.createElement('div');
      group.id = 'hProductBasics';
      group.className = 'h-recipe-basic admin-grid two';
      host.prepend(group);
    }
    for (const id of ['productItemType', 'productBaseUnit']) {
      const label = $(id)?.closest('label');
      if (!label) continue;
      if (on()) {
        if (!origins.has(id)) {
          const marker = document.createComment(id);
          label.before(marker);
          origins.set(id, marker);
        }
        group.append(label);
      } else if (origins.has(id)) {
        origins.get(id).after(label);
      }
    }
    if (!on()) group?.remove();
  }

  function ingredientRow(item = {}) {
    const typeById = new Map((editor?.itemTypes || []).map(t => [t.id, t]));
    const choices = (editor?.products || []).filter(p => p.isActive && p.id !== product?.id && typeById.get(p.itemTypeId)?.canConsume);
    return '<div class="h-recipe-row"><label class="admin-field">Bahan<select data-h-ingredient required><option value="">Pilih bahan</option>'
      + choices.map(p => '<option value="'+p.id+'" '+(p.id === Number(item.productId) ? 'selected' : '')+'>'+esc(p.name)+' · '+esc(p.baseUnitSymbol || p.unitSymbol || editor.units?.find(u => u.id === p.baseUnitId)?.symbol || '')+'</option>').join('')
      + '</select></label><label class="admin-field">Takaran<input data-h-quantity type="number" min="1" max="1000000000" step="1" required value="'+esc(item.quantity || 1)+'"></label><button type="button" class="secondary-btn" data-h-remove aria-label="Hapus bahan">×</button></div>';
  }

  function render(nextEditor, nextProduct) {
    editor = nextEditor; product = nextProduct || null;
    basics();
    const linkedLabel = $('productLinkedRecipe')?.closest('label');
    if (linkedLabel) {
      linkedLabel.dataset.hOriginalLabel ||= linkedLabel.firstChild.textContent;
      linkedLabel.firstChild.textContent = on() ? 'Resep yang dipakai (lanjutan)' : linkedLabel.dataset.hOriginalLabel;
    }
    $('hInlineRecipe')?.remove();
    if (!on() || !editor || !$('productMasterFields')) return;
    recipe = (editor.recipes || []).find(r => r.id === (product?.linkedRecipeId || $('productLinkedRecipe')?.value)) || null;
    const section = document.createElement('section');
    section.id = 'hInlineRecipe';
    section.className = 'h-inline-recipe';
    section.innerHTML = '<h3>Resep barang</h3><label class="admin-check"><input id="hRecipeEnabled" type="checkbox" '+(recipe ? 'checked disabled' : '')+'> Barang ini diracik dari bahan</label>'
      + '<p class="muted">Isi di sini, lalu simpan barang. Sambungan resep dibuat otomatis.</p>'
      + (recipe?.variantLabel ? '<p class="muted">Resep yang dipakai: <b>'+esc(recipe.variantLabel)+'</b>. Varian lain tetap tersedia.</p>' : '')
      + '<div id="hRecipeFields" '+(recipe ? '' : 'hidden')+'><label class="admin-field">Hasil resep (dalam satuan barang)<input id="hRecipeYield" type="number" min="1" max="1000000000" step="1" required value="'+esc(recipe?.outputQuantity || 1)+'"></label>'
      + '<p class="muted">Takaran memakai satuan di samping nama bahan. Gunakan satuan terkecil, misalnya gram atau ml.</p>'
      + '<div id="hRecipeIngredients">'+(recipe?.components?.length ? recipe.components : [{}]).map(ingredientRow).join('')+'</div>'
      + '<button type="button" class="secondary-btn" id="hRecipeAdd">+ Tambah bahan</button></div>'
      + '<p id="hRecipeError" class="h-recipe-error" role="alert" hidden></p>';
    $('productMasterFields').append(section);
    const toggle = () => {
      const enabled = $('hRecipeEnabled').checked;
      $('hRecipeFields').hidden = !enabled;
      $('hRecipeFields').querySelectorAll('input,select,button').forEach(node => { node.disabled = !enabled; });
    };
    $('hRecipeEnabled').addEventListener('change', toggle);
    $('hRecipeAdd').addEventListener('click', () => $('hRecipeIngredients').insertAdjacentHTML('beforeend', ingredientRow()));
    section.addEventListener('click', e => { if (e.target.closest('[data-h-remove]')) e.target.closest('.h-recipe-row').remove(); });
    toggle();
  }

  function draft() {
    if (!on() || !$('hRecipeEnabled')?.checked) return null;
    const type = editor.itemTypes?.find(item => item.id === $('productItemType')?.value);
    if (!type?.canProduce) throw new Error('Untuk memakai resep, pilih jenis barang yang bisa diracik, misalnya Barang Jadi atau Barang Setengah Jadi.');
    const outputQuantity = Number($('hRecipeYield').value);
    const components = [...$('hRecipeIngredients').querySelectorAll('.h-recipe-row')].map(row => ({
      productId: Number(row.querySelector('[data-h-ingredient]').value),
      quantity: Number(row.querySelector('[data-h-quantity]').value)
    }));
    const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 1000000000;
    if (!positive(outputQuantity) || !components.length || components.some(c => !positive(c.productId) || !positive(c.quantity))) throw new Error('Isi hasil resep dan minimal satu bahan dengan takaran bulat lebih dari nol.');
    if (new Set(components.map(c => c.productId)).size !== components.length) throw new Error('Bahan yang sama cukup ditulis sekali.');
    return { sourceRecipeId: recipe?.id || null, outputQuantity, components };
  }

  function error(message) {
    const node = $('hRecipeError');
    if (node) { node.textContent = message; node.hidden = !message; }
  }

  window.MaxiInlineRecipe = {
    render, draft, error,
    async save(id, value, api) {
      if (!value) return;
      const response = await api('/api/admin/manufacturing/products/'+id+'/recipe', { method:'POST', body:JSON.stringify(value) });
      // Retry di form yang tetap terbuka harus memakai sumber terbaru.
      recipe = { ...recipe, id: response.id };
      const link = $('productLinkedRecipe');
      if (link && ![...link.options].some(o => o.value === response.id)) link.add(new Option('Resep barang · v'+response.revision, response.id));
      if (link) link.value = response.id;
      return response;
    }
  };
  window.addEventListener('maxi-skin-change', () => render(editor, product));
})();
