// Filter kategori dua-tingkat (Kategori Utama -> sub-kategori) dipakai
// bersama oleh Kasir (cashier.js) dan Customer (customer.js), supaya logic
// pengelompokan cuma ditulis sekali (Bos Cyo, 2026-09-15: "kalo tujuannya
// kasir vs customer ya biar engga kerja 2x"). Setiap item cukup punya
// `category` (nama sub-kategori, string) dan `categoryGroup` (nama kategori
// utama, atau null/undefined kalau belum dikelompokkan -- lihat
// listProducts() di src/db-multistore.js).
//
// Kalau belum ada satu pun barang yang dikelompokkan, baris kategori utama
// otomatis disembunyikan dan perilakunya identik dengan filter satu-tingkat
// yang sudah ada sebelumnya -- toko yang belum sempat pakai fitur ini tidak
// kelihatan bedanya sama sekali.
(() => {
  const UNGROUPED_LABEL = 'Lainnya';
  const ALL_LABEL = 'Semua';

  const normalizeGroup = group => group || UNGROUPED_LABEL;

  function distinctGroups(items) {
    const seen = new Set();
    const groups = [];
    for (const item of items) {
      const group = normalizeGroup(item.categoryGroup);
      if (seen.has(group)) continue;
      seen.add(group);
      groups.push(group);
    }
    return groups;
  }

  function distinctCategories(items, selectedGroup) {
    const seen = new Set();
    const categories = [];
    for (const item of items) {
      if (selectedGroup !== ALL_LABEL && normalizeGroup(item.categoryGroup) !== selectedGroup) continue;
      if (!item.category || seen.has(item.category)) continue;
      seen.add(item.category);
      categories.push(item.category);
    }
    return categories;
  }

  function matches(item, state) {
    if (state.group !== ALL_LABEL && normalizeGroup(item.categoryGroup) !== state.group) return false;
    if (state.category !== ALL_LABEL && item.category !== state.category) return false;
    return true;
  }

  function create({ groupRowEl, categoryRowEl, groupBtnClass, categoryBtnClass, escapeHtml }) {
    const esc = escapeHtml || (value => String(value ?? ''));
    const state = { group: ALL_LABEL, category: ALL_LABEL };
    const listeners = [];

    function notify() { listeners.forEach(fn => fn(state)); }

    function render(items) {
      const groups = distinctGroups(items);
      const showGroups = groups.length > 1;

      if (showGroups) {
        const groupOptions = [ALL_LABEL, ...groups];
        if (!groupOptions.includes(state.group)) state.group = ALL_LABEL;
        groupRowEl.hidden = false;
        groupRowEl.innerHTML = groupOptions.map(group => `<button class="${groupBtnClass} ${group === state.group ? 'active' : ''}" data-category-group="${esc(group)}" type="button">${esc(group)}</button>`).join('');
        groupRowEl.querySelectorAll('[data-category-group]').forEach(button => button.onclick = () => {
          state.group = button.dataset.categoryGroup;
          state.category = ALL_LABEL;
          render(items);
          notify();
        });
      } else {
        state.group = ALL_LABEL;
        groupRowEl.hidden = true;
        groupRowEl.innerHTML = '';
      }

      const categoryOptions = [ALL_LABEL, ...distinctCategories(items, state.group)];
      if (!categoryOptions.includes(state.category)) state.category = ALL_LABEL;
      categoryRowEl.innerHTML = categoryOptions.map(category => `<button class="${categoryBtnClass} ${category === state.category ? 'active' : ''}" data-category="${esc(category)}" type="button">${esc(category)}</button>`).join('');
      categoryRowEl.querySelectorAll('[data-category]').forEach(button => button.onclick = () => {
        state.category = button.dataset.category;
        render(items);
        notify();
      });
    }

    return {
      render,
      filtered: items => items.filter(item => matches(item, state)),
      onSelect: fn => listeners.push(fn)
    };
  }

  window.MAXICategoryFilter = { create };
})();
