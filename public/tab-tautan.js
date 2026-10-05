(() => {
  // Tab di Workspace Gerai / panel Entity punya alamat sendiri (Bos Cyo, 2026-10-05: "kenapa
  // tombolnya itu engga bisa dibuat buka new tab ya?"). Tab-tab itu tombol biasa, bukan tautan,
  // jadi dulu tidak bisa dibuka di tab baru dan hilang saat halaman dimuat ulang.
  //   - Pindah tab menulis #tab=<nama> di alamat (tanpa menambah riwayat Back).
  //   - Ctrl/Cmd/Shift + klik, klik tengah, atau tekan lama (HP) -> buka di tab baru.
  //   - Alamat dengan #tab=<nama> langsung membuka tab itu.
  // Sesi karyawan tersimpan bersama di browser, jadi tab baru tetap masuk dengan akun yang sama.
  const ATTRS = ['data-tab', 'data-entity-tab'];
  const HASH = '#tab=';
  const selector = ATTRS.map(attr => `.admin-tab[${attr}]`).join(',');
  const tabName = button => ATTRS.map(attr => button.getAttribute(attr)).find(Boolean) || '';
  const urlFor = name => `${location.pathname}${location.search}${HASH}${encodeURIComponent(name)}`;

  function openNew(name) {
    window.open(urlFor(name), '_blank', 'noopener');
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.(selector);
    if (!button) return;
    const name = tabName(button);
    if (!name) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openNew(name);
      return;
    }
    // Setelah tab sendiri berpindah: catat di alamat, pertahankan state riwayat (penjaga Back).
    setTimeout(() => {
      try { history.replaceState(history.state, '', urlFor(name)); } catch {}
    }, 0);
  }, true);

  document.addEventListener('auxclick', event => {
    if (event.button !== 1) return;
    const button = event.target.closest?.(selector);
    if (!button || !tabName(button)) return;
    event.preventDefault();
    openNew(tabName(button));
  }, true);

  // Tekan lama di HP: tombol tidak punya menu "buka di tab baru", jadi disediakan sendiri.
  let pressTimer = null;
  let menu = null;
  const closeMenu = () => { menu?.remove(); menu = null; };
  document.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse') return;
    const button = event.target.closest?.(selector);
    if (!button || !tabName(button)) return;
    clearTimeout(pressTimer);
    const name = tabName(button);
    pressTimer = setTimeout(() => {
      closeMenu();
      const rect = button.getBoundingClientRect();
      menu = document.createElement('div');
      menu.setAttribute('role', 'menu');
      menu.style.cssText = `position:fixed;z-index:2147482000;left:${Math.max(8, Math.min(rect.left, innerWidth - 220))}px;top:${Math.min(rect.bottom + 6, innerHeight - 110)}px;background:#fff;border:1px solid #ddd5cc;border-radius:12px;box-shadow:0 12px 28px rgba(0,0,0,.18);padding:6px;min-width:200px;font:600 14px system-ui,sans-serif`;
      menu.innerHTML = '<button type="button" data-tab-new style="display:block;width:100%;text-align:left;padding:10px 12px;border:0;background:none;font:inherit;border-radius:8px;cursor:pointer">Buka di tab baru</button><button type="button" data-tab-copy style="display:block;width:100%;text-align:left;padding:10px 12px;border:0;background:none;font:inherit;border-radius:8px;cursor:pointer">Salin tautan</button>';
      document.body.appendChild(menu);
      menu.querySelector('[data-tab-new]').addEventListener('click', () => { closeMenu(); openNew(name); });
      menu.querySelector('[data-tab-copy]').addEventListener('click', async () => {
        closeMenu();
        try { await navigator.clipboard.writeText(new URL(urlFor(name), location.origin).href); } catch {}
      });
      button.dataset.tabLongPress = '1';
    }, 550);
  }, true);
  const cancelPress = () => clearTimeout(pressTimer);
  document.addEventListener('pointerup', cancelPress, true);
  document.addEventListener('pointercancel', cancelPress, true);
  document.addEventListener('pointermove', event => { if (Math.abs(event.movementX) + Math.abs(event.movementY) > 6) cancelPress(); }, true);
  // Klik yang menyusul tekan-lama tidak ikut memindah tab; ketukan di luar menu menutupnya.
  document.addEventListener('click', event => {
    const button = event.target.closest?.(selector);
    if (button?.dataset.tabLongPress) {
      delete button.dataset.tabLongPress;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (menu && !menu.contains(event.target)) closeMenu();
  }, true);
  document.addEventListener('contextmenu', event => { if (event.target.closest?.(selector) && event.pointerType !== 'mouse') event.preventDefault(); }, true);

  // Buka tab dari alamat (#tab=...). Tab dipasang skrip lain saat halaman dimuat; ditunggu sebentar.
  function openFromHash(retries = 30) {
    if (!location.hash.startsWith(HASH)) return;
    const name = decodeURIComponent(location.hash.slice(HASH.length));
    if (!/^[\w-]{1,60}$/.test(name)) return;
    const button = [...document.querySelectorAll(selector)].find(node => tabName(node) === name);
    if (button && !button.closest('.hidden')) { button.click(); return; }
    if (retries > 0) setTimeout(() => openFromHash(retries - 1), 200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => openFromHash(), { once: true });
  else openFromHash();
})();
