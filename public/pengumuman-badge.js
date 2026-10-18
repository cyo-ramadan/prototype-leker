// Angka merah di tombol "Portal Staf" kasir bila ada pengumuman baru (Bos Cyo, 2026-10-18: "kaya di facebook
// ada notif, nongol angka warna merah"). Sumbernya sama dengan tab Pengumuman Portal Staf
// (GET /api/staff/announcements -> unread, per akun). Dimuat saat halaman dibuka dan saat jendela kembali
// fokus -- tanpa polling. Hilang sesudah CS membuka tab Pengumuman.
(() => {
  const link = document.getElementById('portalStafLink');
  if (!link) return;

  async function segarkan() {
    const token = localStorage.getItem('lekerCashierToken') || '';
    if (!token) return;
    try {
      const response = await fetch('/api/staff/announcements', { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      const { unread = 0 } = await response.json();
      link.querySelector('.staff-badge-merah')?.remove();
      if (unread > 0) {
        link.insertAdjacentHTML('beforeend', ` <span class="staff-badge-merah" title="Pengumuman baru" style="display:inline-block;min-width:18px;padding:1px 6px;border-radius:999px;background:#e0245e;color:#fff;font-size:12px;font-weight:800;line-height:16px;text-align:center">${unread > 9 ? '9+' : unread}</span>`);
      }
    } catch {}
  }

  window.addEventListener('focus', segarkan);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) segarkan(); });
  segarkan();
})();
