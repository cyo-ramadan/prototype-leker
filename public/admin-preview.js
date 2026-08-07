(() => {
  const el = id => document.getElementById(id);
  const app = el('adminApp');
  const gate = el('authGate');
  const message = el('authMessage');
  if (!app || !gate) return;

  const banner = document.createElement('div');
  banner.id = 'adminLockedBanner';
  banner.className = 'admin-locked-banner';
  banner.innerHTML = '<span>🔒 Master data terlihat sebagai preview. Login dulu untuk membaca atau menyimpan data D1.</span><strong>PIN Admin</strong>';
  app.prepend(banner);

  const quickActions = document.createElement('div');
  quickActions.className = 'admin-quick-actions';
  quickActions.innerHTML = `
    <button class="admin-quick-action" type="button" data-master-shortcut="store">🏪 Toko & Logo</button>
    <button class="admin-quick-action primary" type="button" data-master-shortcut="products">＋ Tambah Barang</button>
    <button class="admin-quick-action" type="button" data-master-shortcut="categories">＋ Tambah Kategori</button>
    <button class="admin-quick-action" type="button" data-master-shortcut="contacts">＋ Tambah Customer</button>`;
  banner.insertAdjacentElement('afterend', quickActions);

  const previewLists = [
    ['productList', 'Login untuk memuat master barang dari D1.'],
    ['categoryList', 'Login untuk memuat master kategori dari D1.'],
    ['contactList', 'Login untuk memuat master customer/contact dari D1.']
  ];

  function isLocked() {
    return !gate.classList.contains('hidden');
  }

  function setMasterControlsLocked(locked) {
    document.querySelectorAll('.admin-section input, .admin-section select, .admin-section textarea, .admin-section button')
      .forEach(control => { control.disabled = locked; });
  }

  function syncLockedState() {
    const locked = isLocked();
    app.classList.remove('hidden');
    app.classList.toggle('admin-locked', locked);
    banner.classList.toggle('hidden', !locked);
    setMasterControlsLocked(locked);

    if (locked) {
      if (!el('adminSummary').textContent.trim()) el('adminSummary').innerHTML = '<span>Login untuk memuat data</span>';
      for (const [id, copy] of previewLists) {
        const node = el(id);
        if (node && !node.textContent.trim()) node.innerHTML = `<div class="admin-preview-empty">${copy}</div>`;
      }
    }
  }

  function normalizeApiMessage() {
    if (!message) return;
    const current = message.textContent.trim();
    if (/Request gagal \(429\)/i.test(current)) {
      message.textContent = 'API admin sedang kena quota Cloudflare hari ini. Dashboard tetap bisa dilihat sebagai preview, tetapi login dan simpan ke D1 baru aktif setelah quota reset sekitar 07:00 WIB.';
    } else if (/Failed to fetch|NetworkError|Load failed/i.test(current)) {
      message.textContent = 'Koneksi ke API admin belum tersedia. Dashboard tetap terlihat sebagai preview; data belum bisa dibaca atau disimpan.';
    }
  }

  document.querySelectorAll('[data-master-shortcut]').forEach(button => {
    button.addEventListener('click', () => {
      if (isLocked()) {
        gate.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => el('adminPin')?.focus(), 250);
        return;
      }
      const tab = button.dataset.masterShortcut;
      document.querySelector(`.admin-tab[data-tab="${tab}"]`)?.click();
      const targetId = tab === 'store' ? 'storeForm' : tab === 'products' ? 'productForm' : tab === 'categories' ? 'categoryForm' : 'contactForm';
      setTimeout(() => el(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
    });
  });

  new MutationObserver(() => syncLockedState()).observe(gate, { attributes: true, attributeFilter: ['class'] });
  if (message) new MutationObserver(normalizeApiMessage).observe(message, { childList: true, characterData: true, subtree: true });

  syncLockedState();
  normalizeApiMessage();
})();
