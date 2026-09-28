(() => {
  // Bos Cyo, 2026-09-28: "kalo aku mau pindah workspace step nya harus
  // kembali ke entity admin dulu" -- tombol melayang ini membuka daftar
  // gerai TANPA pindah halaman, klik satu gerai langsung ke workspace-nya.
  // Hanya untuk Owner dan Entity Admin (mereka yang memang berwenang lintas
  // gerai) -- Admin Gerai biasa dipin ke satu gerai (invariant #5, isolasi
  // store_id server-side), jadi tombolnya tidak dimunculkan sama sekali
  // untuknya, bukan cuma disembunyikan lewat CSS.
  const ownerToken = localStorage.getItem('lekerOwnerToken') || '';
  const entityAdminToken = localStorage.getItem('lekerEntityAdminToken') || '';
  const isOwner = Boolean(ownerToken);
  const isEntityAdmin = !isOwner && Boolean(entityAdminToken);
  if (!isOwner && !isEntityAdmin) return;

  const currentStoreCode = String(window.LEKER_STORE_CODE || '').toUpperCase();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));

  let stores = null;
  let open = false;

  function injectStyles() {
    if (document.getElementById('workspaceSwitcherStyle')) return;
    const style = document.createElement('style');
    style.id = 'workspaceSwitcherStyle';
    style.textContent = `
      #workspaceSwitcherBtn{position:fixed;right:18px;bottom:18px;z-index:400;width:52px;height:52px;border-radius:50%;border:none;background:#1a1a1a;color:#fff;font-size:22px;box-shadow:0 8px 24px rgba(0,0,0,.28);cursor:pointer;display:flex;align-items:center;justify-content:center}
      #workspaceSwitcherBtn:hover{background:#2c2c2c}
      #workspaceSwitcherPanel{position:fixed;right:18px;bottom:78px;z-index:400;width:min(280px,calc(100vw - 36px));max-height:min(420px,calc(100vh - 120px));overflow-y:auto;background:#fff;border:1px solid var(--line,#e5e1d8);border-radius:16px;box-shadow:0 16px 44px rgba(0,0,0,.24);padding:8px;display:none}
      #workspaceSwitcherPanel.open{display:block}
      #workspaceSwitcherPanel .ws-switch-title{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#8a8378);padding:6px 8px}
      #workspaceSwitcherPanel button.ws-switch-item{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;text-align:left;border:none;background:transparent;padding:10px 8px;border-radius:10px;cursor:pointer;font:inherit}
      #workspaceSwitcherPanel button.ws-switch-item:hover{background:#f4f1ea}
      #workspaceSwitcherPanel button.ws-switch-item.current{background:#eef0e6;cursor:default}
      #workspaceSwitcherPanel .ws-switch-code{font-weight:900}
      #workspaceSwitcherPanel .ws-switch-name{color:var(--muted,#8a8378);font-size:12px}
      #workspaceSwitcherPanel .ws-switch-empty{padding:10px;color:var(--muted,#8a8378);font-size:13px}
    `;
    document.head.appendChild(style);
  }

  async function fetchStores() {
    if (stores) return stores;
    const path = isOwner ? '/api/owner/stores' : '/api/entity-admin/stores';
    const token = isOwner ? ownerToken : entityAdminToken;
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Gagal memuat daftar gerai.');
    stores = (payload.stores || []).filter(store => store.isActive).sort((a, b) => a.code.localeCompare(b.code));
    return stores;
  }

  function renderPanel(list, error) {
    const panel = document.getElementById('workspaceSwitcherPanel');
    if (!panel) return;
    if (error) { panel.innerHTML = `<div class="ws-switch-empty">${esc(error)}</div>`; return; }
    if (!list.length) { panel.innerHTML = '<div class="ws-switch-empty">Belum ada gerai.</div>'; return; }
    panel.innerHTML = `<div class="ws-switch-title">Pindah Gerai</div>${list.map(store => {
      const isCurrent = store.code.toUpperCase() === currentStoreCode;
      return `<button type="button" class="ws-switch-item${isCurrent ? ' current' : ''}" ${isCurrent ? 'disabled' : `data-ws-code="${esc(store.code)}"`}>
        <span><span class="ws-switch-code">${esc(store.code)}</span><br><span class="ws-switch-name">${esc(store.storeName)}</span></span>
        ${isCurrent ? '<span>●</span>' : ''}
      </button>`;
    }).join('')}`;
    panel.querySelectorAll('[data-ws-code]').forEach(button => {
      button.addEventListener('click', () => { location.href = `/s/${encodeURIComponent(button.dataset.wsCode)}/admin`; });
    });
  }

  async function togglePanel() {
    const panel = document.getElementById('workspaceSwitcherPanel');
    open = !open;
    panel.classList.toggle('open', open);
    if (!open) return;
    if (!stores) panel.innerHTML = '<div class="ws-switch-empty">Memuat…</div>';
    try {
      const list = await fetchStores();
      if (open) renderPanel(list);
    } catch (error) {
      if (open) renderPanel([], error.message);
    }
  }

  function mount() {
    if (document.getElementById('workspaceSwitcherBtn')) return true;
    if (!document.body) return false;
    injectStyles();
    const button = document.createElement('button');
    button.id = 'workspaceSwitcherBtn';
    button.type = 'button';
    button.title = 'Ganti Gerai';
    button.setAttribute('aria-label', 'Ganti Gerai');
    button.textContent = '⇄';
    const panel = document.createElement('div');
    panel.id = 'workspaceSwitcherPanel';
    document.body.appendChild(panel);
    document.body.appendChild(button);
    button.addEventListener('click', event => { event.stopPropagation(); togglePanel(); });
    document.addEventListener('click', event => {
      if (!open) return;
      if (event.target === button || panel.contains(event.target)) return;
      open = false;
      panel.classList.remove('open');
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && open) { open = false; panel.classList.remove('open'); }
    });
    return true;
  }

  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (mount() || tries > 40) clearInterval(timer);
  }, 100);
})();
