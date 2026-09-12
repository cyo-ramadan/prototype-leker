(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
  }[char]));

  function cleanStoreCode(value) {
    return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
  }

  function entityTokenFromPath(pathname = location.pathname) {
    const match = String(pathname).match(/^\/e\/([^/]+)\/customer\/?$/);
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch { return ''; }
  }

  function storeHref(value) {
    const code = cleanStoreCode(value);
    return code ? `/s/${encodeURIComponent(code)}/customer` : '';
  }

  function selectStore(value) {
    const code = cleanStoreCode(value);
    const href = storeHref(code);
    if (!href) return '';
    try { localStorage.setItem('lekerCustomerStoreCode', code); } catch {}
    location.assign(href);
    return href;
  }

  window.LEKER_ENTITY_CUSTOMER_PORTAL = Object.freeze({
    entityTokenFromPath,
    storeHref,
    selectStore
  });

  function renderError(root, message) {
    root.classList.add('entity-customer-error');
    root.innerHTML = `<h2>Portal gerai belum tersedia</h2><p>${escapeHtml(message)}</p>`;
  }

  async function init() {
    const root = document.getElementById('entityCustomerPortal');
    if (!root) return;
    const token = entityTokenFromPath();
    if (!token) {
      renderError(root, 'Alamat Entity tidak valid. Gunakan link resmi dari MAXI Leker.');
      return;
    }

    try {
      const response = await fetch(`/api/entity-customer/${encodeURIComponent(token)}/stores`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Daftar gerai gagal dimuat.');

      const stores = Array.isArray(payload.stores) ? payload.stores : [];
      const name = payload.entity?.name || token;
      document.title = `${name} · Pilih Gerai`;
      const title = document.getElementById('entityCustomerTitle');
      if (title) title.textContent = `Mau pesan dari gerai ${name} yang mana?`;

      root.classList.remove('entity-customer-error');
      root.innerHTML = stores.length
        ? `<h2>${escapeHtml(name)}</h2><p>Pilih gerai untuk melihat menu dan bermain di panel customer.</p><div class="entity-customer-grid">${stores.map(store => `
            <a class="entity-customer-store" href="${escapeHtml(storeHref(store.code))}" data-entity-store-code="${escapeHtml(store.code)}">
              <span><strong>${escapeHtml(store.storeName)}</strong><small>${escapeHtml(store.address || `Kode gerai ${store.code}`)}</small></span>
              <span class="entity-customer-arrow" aria-hidden="true">→</span>
            </a>`).join('')}</div>`
        : '<h2>Belum ada gerai aktif</h2><p>Entity ini belum memiliki gerai yang bisa menerima order customer.</p>';

      root.querySelectorAll('[data-entity-store-code]').forEach(link => {
        link.addEventListener('click', event => {
          event.preventDefault();
          selectStore(link.dataset.entityStoreCode);
        });
      });
    } catch (error) {
      renderError(root, error.message || 'Daftar gerai gagal dimuat.');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
