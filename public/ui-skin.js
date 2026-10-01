// Merek + skin tampilan per tenant -- Bos Cyo, 2026-10-01 (HANDOFF-UIUX-SIAP-JUAL.md).
//
// Merek (judul tab, [data-skin-brand]) berlaku untuk SEMUA tenant. Skin
// "siap-jual" (desain jualan) hanya untuk tenant yang saklarnya ON.
//
// Tenant yang saklar "Tampilan baru" (kebijakan tenant ui_skin_siap_jual)-nya
// ON melihat tampilan "Siap Jual"; tenant lain tetap tampilan sekarang.
// Server yang memutuskan (GET /api/ui-profile, src/ui-profile.js); file ini
// hanya menerapkan:
//   - <html data-skin="siap-jual"> sebagai pegangan CSS,
//   - [data-skin-hide]        -> disembunyikan saat skin ON,
//   - [data-skin-only]        -> hanya tampil saat skin ON,
//   - [data-skin-text="..."]  -> teks diganti saat skin ON,
//   - [data-skin-placeholder] -> placeholder diganti saat skin ON,
//   - [data-skin-brand]       -> diisi nama merek dari server (semua tenant),
//   - judul tab: "MAXI Leker" diganti nama merek tenant (semua tenant).
// Teks yang dirender JS memakai window.MaxiSkin.pick(teksLama, teksBaru).
//
// Hasil terakhir disimpan per gerai/entity di localStorage supaya halaman
// berikutnya langsung tampil benar tanpa kedip; server tetap dicek tiap
// halaman dimuat (bukan polling -- invariant #6).
(() => {
  const SKIN_ON = 'siap-jual';
  const CACHE_PREFIX = 'maxiUiSkin:';
  const ENTITY_KEY = 'maxiUiSkinEntity';
  const root = document.documentElement;
  const originalTitle = document.title;
  let state = { skin: 'classic', brandName: null };

  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

  // Halaman tanpa gerai di URL menandai dirinya lewat window.MAXI_SKIN_PAGE
  // ('owner' | 'entity-admin' | 'staff') sebelum memuat file ini.
  function context() {
    const page = window.MAXI_SKIN_PAGE || '';
    // Owner Console milik pemilik platform, lintas tenant -- tidak ikut skin.
    if (page === 'owner') return null;
    if (page === 'entity-admin') {
      const entityId = read(ENTITY_KEY);
      return entityId ? { key: `entity:${entityId}`, query: `entity=${encodeURIComponent(entityId)}` } : null;
    }
    let storeCode = String(window.LEKER_STORE_CODE || '').trim();
    if (!storeCode && page === 'staff') {
      try { storeCode = String(JSON.parse(read('lekerStaffSessionMeta') || 'null')?.storeCode || '').trim(); } catch {}
    }
    return storeCode ? { key: `store:${storeCode.toUpperCase()}`, query: `store=${encodeURIComponent(storeCode)}` } : null;
  }

  const isOn = () => state.skin === SKIN_ON;

  function injectStyle() {
    if (document.getElementById('maxiUiSkinStyle')) return;
    const style = document.createElement('style');
    style.id = 'maxiUiSkinStyle';
    style.textContent = 'html[data-skin="siap-jual"] [data-skin-hide]{display:none!important}'
      + 'html:not([data-skin="siap-jual"]) [data-skin-only]{display:none!important}';
    (document.head || root).appendChild(style);
  }

  function swap(node, attr, prop, originalKey) {
    if (!(originalKey in node.dataset)) node.dataset[originalKey] = node[prop];
    node[prop] = isOn() ? node.getAttribute(attr) : node.dataset[originalKey];
  }

  function applyDom(scope = document) {
    if (!scope.querySelectorAll) return;
    scope.querySelectorAll('[data-skin-text]').forEach(node => swap(node, 'data-skin-text', 'textContent', 'skinOriginalText'));
    scope.querySelectorAll('[data-skin-placeholder]').forEach(node => swap(node, 'data-skin-placeholder', 'placeholder', 'skinOriginalPlaceholder'));
    scope.querySelectorAll('[data-skin-brand]').forEach(node => {
      if (!('skinOriginalBrand' in node.dataset)) node.dataset.skinOriginalBrand = node.textContent;
      node.textContent = state.brandName
        ? (node.dataset.skinBrand === 'upper' ? state.brandName.toUpperCase() : state.brandName)
        : node.dataset.skinOriginalBrand;
    });
  }

  function apply() {
    injectStyle();
    if (isOn()) root.dataset.skin = SKIN_ON;
    else delete root.dataset.skin;
    // Merek berlaku untuk semua tenant (bukan bagian saklar skin).
    document.title = state.brandName
      ? originalTitle.replace(/MAXI\s+Leker/i, state.brandName)
      : originalTitle;
    applyDom();
  }

  function setState(next, ctx) {
    const changed = next.skin !== state.skin || next.brandName !== state.brandName;
    state = { skin: next.skin === SKIN_ON ? SKIN_ON : 'classic', brandName: next.brandName || null };
    if (ctx) write(CACHE_PREFIX + ctx.key, JSON.stringify(state));
    apply();
    if (changed) window.dispatchEvent(new CustomEvent('maxi-skin-change', { detail: { ...state } }));
  }

  async function refresh() {
    const ctx = context();
    if (!ctx) { setState({ skin: 'classic' }, null); return state; }
    try {
      const response = await fetch(`/api/ui-profile?${ctx.query}`, { cache: 'no-store' });
      if (response.ok) setState(await response.json(), ctx);
    } catch {}
    return state;
  }

  // Terapkan cache SEKARANG (sinkron) supaya tidak berkedip.
  const initialCtx = context();
  if (initialCtx) {
    try {
      const cached = JSON.parse(read(CACHE_PREFIX + initialCtx.key) || 'null');
      if (cached) state = { skin: cached.skin === SKIN_ON ? SKIN_ON : 'classic', brandName: cached.brandName || null };
    } catch {}
  }
  if (isOn()) root.dataset.skin = SKIN_ON;

  window.MaxiSkin = {
    isOn,
    brand: () => state.brandName,
    pick: (classicValue, skinValue) => (isOn() ? skinValue : classicValue),
    apply: scope => applyDom(scope || document),
    // Halaman Entity Admin baru tahu entity-nya setelah login.
    useEntity(entityId) {
      if (entityId) write(ENTITY_KEY, entityId);
      return refresh();
    },
    refresh,
    ready: null
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
  window.MaxiSkin.ready = refresh();
})();
