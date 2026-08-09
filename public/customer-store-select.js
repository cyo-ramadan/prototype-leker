(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const topbar = document.querySelector('.topbar');
  if (!topbar || document.getElementById('customerStoreSelect')) return;

  const style = document.createElement('style');
  style.textContent = `
    .customer-store-picker{display:flex;align-items:center;gap:7px;margin-left:auto;margin-right:8px;padding:6px 8px;border:1px solid var(--line);border-radius:12px;background:#fff;font-size:11px;font-weight:900;color:var(--muted)}
    .customer-store-picker select{max-width:190px;border:0;background:transparent;color:var(--ink);font-weight:900;outline:none}
    @media(max-width:680px){.topbar{flex-wrap:wrap}.customer-store-picker{order:3;width:100%;margin:6px 0 0}.customer-store-picker select{max-width:none;flex:1}.topbar>.pill{margin-left:auto}}
  `;
  document.head.appendChild(style);

  const picker = document.createElement('label');
  picker.className = 'customer-store-picker';
  picker.innerHTML = 'Gerai <select id="customerStoreSelect" aria-label="Pilih gerai"></select>';
  const pill = topbar.querySelector('.pill');
  if (pill) topbar.insertBefore(picker, pill);
  else topbar.appendChild(picker);

  async function load() {
    try {
      const response = await fetch('/api/stores', { cache: 'no-store' });
      if (!response.ok) throw new Error('Gagal memuat gerai');
      const stores = await response.json();
      const select = document.getElementById('customerStoreSelect');
      const current = String(window.LEKER_STORE_CODE || 'G001').toUpperCase();
      select.innerHTML = stores.map(store => `<option value="${escapeHtml(store.code)}" ${store.code === current ? 'selected' : ''}>${escapeHtml(store.code)} · ${escapeHtml(store.storeName)}</option>`).join('');
      select.addEventListener('change', () => {
        const code = select.value;
        if (code && code !== current) location.href = `/s/${encodeURIComponent(code)}/customer`;
      });
    } catch {
      picker.title = 'Daftar gerai belum bisa dimuat';
    }
  }

  load();
})();
