// Panel Pemilik (Entity Admin) dan Workspace Gerai (Admin Gerai) skin F
// (Racik Parfum) -- tombol kerja harian.
// Bos Cyo, 2026-10-06: "di skin itu admin/owner/kasir untuk saat ini samakan,
// boleh langsung jual dan buka laci. di entity kasih tombol jual barang dan beli
// bahan juga operasionalnya".
//
// Per gerai: Jual (layar Racik), Beli bahan, Biaya operasional. Ketiganya jalur
// kasir yang sudah ada; pemilik masuk sebagai akun kasir "Pemilik" miliknya
// sendiri lewat POST /api/management/racik/kasir-pemilik (src/racik-kasir-pemilik.js),
// lalu dibawa ke /s/<kode>/racik atau Kasir lengkap (?aksi=beli|biaya,
// ditekan otomatis oleh public/warung-entry.js). Tanpa polling.
(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const isOn = () => window.MaxiSkin?.skin?.() === 'f';
  const onBranchAdmin = () => window.LEKER_PAGE_CONTEXT === 'admin';
  const managementToken = () => (onBranchAdmin()
    ? localStorage.getItem('lekerOwnerToken') || localStorage.getItem('lekerEntityAdminToken') || localStorage.getItem('lekerAdminToken')
    : localStorage.getItem('lekerEntityAdminToken')) || '';
  let lastKey = '';
  let busy = false;

  function stores() {
    if (onBranchAdmin()) {
      const code = String(window.LEKER_STORE_CODE || '').trim();
      return code ? [{ code, storeName: '' }] : [];
    }
    try { return (entityAdminState?.stores || []).filter(store => store.isActive !== false); } catch { return []; }
  }
  const appEl = () => (onBranchAdmin() ? $('adminApp') : $('entityAdminApp'));

  function injectStyle() {
    if ($('racikPemilikStyle')) return;
    const style = document.createElement('style');
    style.id = 'racikPemilikStyle';
    style.textContent = `
      .rp{display:grid;gap:10px;margin:0 0 18px}
      .rp-store{display:grid;gap:10px;padding:16px;border:1px solid var(--line);border-radius:var(--skin-r-lg,18px);background:var(--surface,#fff)}
      .rp-store h2{margin:0;font-size:18px}
      .rp-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
      .rp-actions button{display:grid;justify-items:center;gap:4px;min-height:76px;padding:10px 6px;border-radius:var(--skin-r,14px);border:1px solid var(--line);background:var(--surface,#fff);color:var(--ink);font:inherit;font-weight:800;font-size:14px;cursor:pointer}
      .rp-actions button span{font-size:22px}
      .rp-actions button[data-rp-go="jual"]{background:var(--skin-primary,var(--brand));border-color:var(--skin-primary,var(--brand));color:var(--skin-primary-ink,#fff)}
      .rp-actions button:disabled{opacity:.6}
      .rp-note{margin:0;color:var(--muted);font-size:13px}`;
    document.head.appendChild(style);
  }

  function mount() {
    let section = $('racikPemilik');
    if (!section) {
      const anchor = onBranchAdmin() ? document.querySelector('#adminApp .admin-tabs') : document.querySelector('#entityAdminApp .owner-heading');
      if (!anchor) return null;
      section = document.createElement('section');
      section.id = 'racikPemilik';
      section.className = 'rp';
      section.setAttribute('aria-label', 'Kerja hari ini');
      anchor.insertAdjacentElement(onBranchAdmin() ? 'beforebegin' : 'afterend', section);
    }
    return section;
  }

  function unmount() { $('racikPemilik')?.remove(); lastKey = ''; }

  function render() {
    if (!isOn()) return unmount();
    const list = stores();
    if (!list.length) return;
    const section = mount();
    if (!section) return;
    injectStyle();
    section.innerHTML = list.map(store => `
      <div class="rp-store">
        ${store.storeName || !onBranchAdmin() ? `<h2>${esc(store.storeName || store.code)}</h2>` : ''}
        <div class="rp-actions">
          <button type="button" data-rp-go="jual" data-rp-store="${esc(store.code)}"><span aria-hidden="true">🧴</span>Jual</button>
          <button type="button" data-rp-go="beli" data-rp-store="${esc(store.code)}"><span aria-hidden="true">🧺</span>Beli bahan</button>
          <button type="button" data-rp-go="biaya" data-rp-store="${esc(store.code)}"><span aria-hidden="true">💸</span>Biaya operasional</button>
        </div>
      </div>`).join('') + '<p class="rp-note">Langsung dari sini, tanpa absen. Laci dibuka di layar Jual kalau belum terbuka.</p>';
  }

  async function go(action, code) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('[data-rp-go]').forEach(button => { button.disabled = true; });
    try {
      const token = managementToken();
      const response = await fetch(`/api/management/racik/kasir-pemilik?store=${encodeURIComponent(code)}`, {
        method: 'POST',
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.token) throw new Error(payload.error || 'Belum bisa membuka kasir.');
      localStorage.setItem('lekerCashierToken', payload.token);
      localStorage.setItem('maxiRacikPemilik', String(payload.storeCode || code).toUpperCase());
      // Selesai jualan = kembali ke halaman asal (Panel Pemilik / Workspace Gerai).
      localStorage.setItem('maxiRacikPemilikKembali', location.pathname + location.search);
      const base = `/s/${encodeURIComponent(payload.storeCode || code)}`;
      location.href = action === 'jual' ? `${base}/racik` : `${base}/cashier?lengkap=1&aksi=${action}`;
    } catch (error) {
      alert(error.message);
      document.querySelectorAll('[data-rp-go]').forEach(button => { button.disabled = false; });
    } finally {
      busy = false;
    }
  }

  function maybeRender() {
    const app = appEl();
    if (!app || app.classList.contains('hidden')) return;
    const key = `${window.MaxiSkin?.skin?.()}|${stores().map(store => store.code).join(',')}`;
    if (key !== lastKey) { lastKey = key; render(); }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-rp-go]');
    if (button) go(button.dataset.rpGo, button.dataset.rpStore);
  });
  window.addEventListener('maxi-skin-change', () => { lastKey = ''; maybeRender(); });

  function start() {
    const app = appEl();
    const list = onBranchAdmin() ? null : $('entityAdminStoreList');
    const observer = new MutationObserver(maybeRender);
    if (app) observer.observe(app, { attributes: true, attributeFilter: ['class'] });
    if (list) observer.observe(list, { childList: true });
    Promise.resolve(window.MaxiSkin?.ready).then(maybeRender, maybeRender);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
