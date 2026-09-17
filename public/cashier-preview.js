(() => {
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const rupiah = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const dateTime = value => value ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-';

  function authToken() {
    return localStorage.getItem('lekerOwnerToken')
      || localStorage.getItem('lekerEntityAdminToken')
      || localStorage.getItem('lekerAdminToken')
      || '';
  }

  function renderDrawer(drawer) {
    const container = el('previewDrawer');
    if (!drawer) {
      container.innerHTML = '<div class="preview-drawer-card">Laci belum dibuka hari ini.</div>';
      return;
    }
    container.innerHTML = `
      <div class="preview-drawer-card open">
        <strong>Laci sedang dibuka</strong> oleh ${escapeHtml(drawer.cashierName)} (@${escapeHtml(drawer.cashierUsername)})
        <div>Sejak ${escapeHtml(dateTime(drawer.openedAt))} · Modal awal ${escapeHtml(rupiah(drawer.openingAmount))}</div>
        ${drawer.shiftLabel ? `<div>Shift ${escapeHtml(drawer.shiftLabel)}</div>` : ''}
      </div>`;
  }

  function renderMenu(products) {
    const container = el('previewMenu');
    if (!products.length) {
      container.innerHTML = '<p class="muted">Belum ada barang aktif di gerai ini.</p>';
      return;
    }
    const groups = new Map();
    for (const product of products) {
      const groupName = product.category_group_name || product.category || 'Lainnya';
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName).push(product);
    }
    container.innerHTML = [...groups.entries()].map(([groupName, items]) => `
      <div class="preview-menu-group">
        <h3>${escapeHtml(groupName)}</h3>
        <div class="preview-menu-grid">
          ${items.map(product => `
            <div class="preview-menu-item">
              <div class="name">${escapeHtml(product.emoji || '')} ${escapeHtml(product.name)}</div>
              <div class="price">${escapeHtml(rupiah(product.price))}</div>
            </div>`).join('')}
        </div>
      </div>`).join('');
  }

  async function load() {
    const token = authToken();
    const storeCode = window.LEKER_STORE_CODE || '';
    el('previewBackLink').href = storeCode ? `/s/${encodeURIComponent(storeCode)}/admin` : '/entity-admin';
    if (!token) {
      el('previewMessage').textContent = 'Login diperlukan.';
      el('previewMessage').classList.remove('hidden');
      return;
    }
    try {
      const response = await fetch('/api/admin/cashier-preview', { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Gagal memuat (${response.status})`);
      el('previewStoreName').textContent = `Kasir ${payload.store.storeName} · ${payload.store.code}`;
      renderDrawer(payload.drawer);
      renderMenu(payload.products || []);
    } catch (error) {
      el('previewMessage').textContent = error.message;
      el('previewMessage').classList.remove('hidden');
    }
  }

  load();
})();
