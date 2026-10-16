// Tombol "ℹ️ Info Gerai" di panel kasir (Bos Cyo, 2026-10-16). Tampilan & aturan ada di
// info-gerai.js / src/info-gerai.js; di sini hanya memasang tombol + angka laporan terbuka.
// Angka diperbarui saat dashboard dibuka, saat jendela kembali fokus, dan setelah dialog ditutup
// -- tidak ada polling.
(() => {
  const button = el('infoGeraiBtn');
  if (!button || !window.InfoGerai) return;

  const storeCode = () => String(state.cashier?.store?.code || '').trim().toUpperCase();

  async function refresh() {
    if (!state.cashier || !storeCode()) return;
    const summary = await window.InfoGerai.ringkasan(api, storeCode());
    button.classList.toggle('hidden', !summary.enabled);
    const open = (summary.stores || []).find(item => item.storeCode === storeCode())?.open || 0;
    button.innerHTML = `ℹ️ Info Gerai${open ? ` <span class="info-gerai-badge">${open}</span>` : ''}`;
  }

  button.addEventListener('click', () => {
    if (!storeCode()) return toast('Gerai kasir belum terbaca. Login ulang lalu coba lagi.');
    window.InfoGerai.open({ api, storeCode: storeCode(), onClose: refresh });
  });

  const original = window.openDashboard;
  if (typeof original === 'function') {
    window.openDashboard = async function (...args) {
      const result = await original.apply(this, args);
      refresh();
      return result;
    };
  }
  window.addEventListener('focus', refresh);
  refresh();
})();
