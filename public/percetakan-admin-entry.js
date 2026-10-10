// Tombol "Layar Cetak" di Workspace Gerai -- hanya skin G (Percetakan, ADR-055).
// Bos Cyo, 2026-10-10: fitur percetakan "dijadikan on/off skin ... tenant lainnya ga ngerasa karna
// engga on". Tenant tanpa skin G tidak pernah melihat tombol ini; servernya juga menolak
// /api/percetakan/* untuk mereka (src/percetakan.js percetakanAktif).
//
// Bukan tab berisi layar baru: tombolnya membuka /s/<kode>/cetak (public/percetakan.html), tempat
// chat WA, antrian per mesin, dan pengaturan mesin/produk/otomatisasi. Didaftarkan di
// public/nav-groups.js (SKIN_GROUPS.g, grup Toko).
(() => {
  if (window.LEKER_PAGE_CONTEXT !== 'admin') return;
  const isOn = () => window.MaxiSkin?.skin?.() === 'g';
  const target = () => (window.lekerStorePath ? window.lekerStorePath('cetak') : '/percetakan');

  function mount() {
    if (document.querySelector('.admin-tab[data-tab="cetak"]')) return;
    const tabs = document.querySelector('.admin-tabs');
    if (!tabs) return;
    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.type = 'button';
    button.dataset.tab = 'cetak';
    button.textContent = '🖨 Layar Cetak';
    button.addEventListener('click', () => { location.href = target(); });
    tabs.insertBefore(button, tabs.firstChild);
  }

  function sync() {
    if (!isOn()) {
      document.querySelector('.admin-tab[data-tab="cetak"]')?.remove();
      return;
    }
    mount();
  }
  const start = () => Promise.resolve(window.MaxiSkin?.ready).then(sync, sync);
  window.addEventListener('maxi-skin-change', sync);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
