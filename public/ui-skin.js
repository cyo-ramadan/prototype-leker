// Merek + skin tampilan per tenant -- Bos Cyo, 2026-10-01 (HANDOFF-UIUX-SIAP-JUAL.md).
//
// Merek (judul tab, [data-skin-brand]) berlaku untuk SEMUA tenant. Skin
// (desain jualan) mengikuti pilihan Owner per tenant: 0 = tampilan sekarang,
// A/B/C = calon desain (kebijakan tenant ui_skin). Server yang memutuskan
// (GET /api/ui-profile, src/ui-profile.js); file ini hanya menerapkan:
//   - <html data-skin="a|b|c"> + memuat /skin-<kode>.css dan hurufnya,
//   - [data-skin-hide]        -> disembunyikan saat skin A/B/C,
//   - [data-skin-only]        -> hanya tampil saat skin A/B/C,
//   - [data-skin-text="..."]  -> teks diganti saat skin A/B/C,
//   - [data-skin-placeholder] -> placeholder diganti saat skin A/B/C,
//   - [data-skin-brand]       -> diisi nama merek dari server (semua tenant),
//   - judul tab: kata "MAXI" diganti nama merek dari server (semua tenant).
// Teks yang dirender JS memakai window.MaxiSkin.pick(teksLama, teksBaru).
//
// Hasil terakhir disimpan per gerai/entity di localStorage supaya halaman
// berikutnya langsung tampil benar tanpa kedip; server tetap dicek tiap
// halaman dimuat (bukan polling -- invariant #6).
(() => {
  const SKIN_ASSET_VERSION = '20261002-skin-e-v1';
  const SKIN_FONTS = {
    a: 'family=Plus+Jakarta+Sans:wght@400;600;700;800',
    b: 'family=Archivo:wdth,wght@62..125,400..900',
    c: 'family=Nunito:wght@400;600;700;800;900',
    d: 'family=Figtree:wght@400;500;600;700;800;900',
    e: 'family=Nunito:wght@600;700;800;900'
  };
  const normalizeSkin = value => (Object.prototype.hasOwnProperty.call(SKIN_FONTS, value) ? value : 'classic');
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

  const isOn = () => state.skin !== 'classic';

  // Satu <link> gaya + satu <link> huruf, diganti saat skin berubah.
  function loadSkinAssets() {
    const head = document.head || root;
    for (const id of ['maxiSkinCss', 'maxiSkinFont']) {
      const old = document.getElementById(id);
      if (old && old.dataset.skin !== state.skin) old.remove();
    }
    if (!isOn() || document.getElementById('maxiSkinCss')) return;
    const font = document.createElement('link');
    font.id = 'maxiSkinFont';
    font.rel = 'stylesheet';
    font.dataset.skin = state.skin;
    font.href = `https://fonts.googleapis.com/css2?${SKIN_FONTS[state.skin]}&display=swap`;
    const css = document.createElement('link');
    css.id = 'maxiSkinCss';
    css.rel = 'stylesheet';
    css.dataset.skin = state.skin;
    css.href = `/skin-${state.skin}.css?v=${SKIN_ASSET_VERSION}`;
    head.appendChild(font);
    head.appendChild(css);
  }

  function setRootSkin() {
    if (isOn()) root.dataset.skin = state.skin;
    else delete root.dataset.skin;
    loadSkinAssets();
  }

  function injectStyle() {
    if (document.getElementById('maxiUiSkinStyle')) return;
    const style = document.createElement('style');
    style.id = 'maxiUiSkinStyle';
    style.textContent = 'html[data-skin] [data-skin-hide]{display:none!important}'
      + 'html:not([data-skin]) [data-skin-only]{display:none!important}';
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
    setRootSkin();
    // Merek berlaku untuk semua tenant (bukan bagian saklar skin).
    document.title = state.brandName
      ? originalTitle.replace(/\bMAXI\b/, state.brandName)
      : originalTitle;
    applyDom();
  }

  function setState(next, ctx) {
    const changed = next.skin !== state.skin || next.brandName !== state.brandName;
    state = { skin: normalizeSkin(next.skin), brandName: next.brandName || null };
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
      if (cached) state = { skin: normalizeSkin(cached.skin), brandName: cached.brandName || null };
    } catch {}
  }
  setRootSkin();

  window.MaxiSkin = {
    isOn,
    skin: () => state.skin,
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
