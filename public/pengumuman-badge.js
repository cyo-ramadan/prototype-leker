// Angka merah Portal Staf: pengumuman + inbox belum dibaca per akun CS.
// Inbox memakai snapshot/event notifikasi yang sudah ada; tidak ada polling tambahan.
(() => {
  const link = document.getElementById('portalStafLink');
  if (!link) return;
  let pengumuman = 0;
  let notifikasi = 0;
  const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  function paint() {
    link.querySelector('.staff-badge-merah')?.remove();
    const total = pengumuman + notifikasi;
    if (total > 0) link.insertAdjacentHTML('beforeend', ` <span class="staff-badge-merah" title="Pengumuman dan notifikasi belum dibaca" aria-label="${total} item Portal Staf belum dibaca" style="display:inline-block;min-width:18px;padding:1px 6px;border-radius:999px;background:#e0245e;color:#fff;font-size:12px;font-weight:800;line-height:16px;text-align:center">${total > 99 ? '99+' : total}</span>`);
  }
  function inbox(payload) {
    if (!localStorage.getItem('lekerCashierToken') || payload?.actor?.role !== 'CASHIER') return;
    notifikasi = count(payload.unreadCount);
    paint();
  }
  async function segarkan() {
    const token = localStorage.getItem('lekerCashierToken') || '';
    if (!token) { pengumuman = 0; notifikasi = 0; paint(); return; }
    try {
      const response = await fetch('/api/staff/announcements', { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok || localStorage.getItem('lekerCashierToken') !== token) return;
      pengumuman = count((await response.json()).unread);
      paint();
    } catch {}
  }
  document.addEventListener('maxi-notifications-changed', event => inbox(event.detail));
  window.addEventListener('focus', segarkan);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) segarkan(); });
  inbox(window.MaxiNotifications?.snapshot);
  segarkan();
})();
