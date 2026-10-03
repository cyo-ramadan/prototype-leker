// Status laci semua gerai di Admin Entity (Bos Cyo, 2026-10-03): gerai mana yang
// laci kasirnya sedang dibuka, sejak jam berapa, dan kasir siapa yang membukanya.
// Refresh manual lewat tombol (invariant #6: tanpa polling). Backend:
// src/entity-drawer-status.js.
(() => {
  const el = id => document.getElementById(id);
  const state = { payload: null };
  const WIB = 'Asia/Jakarta';
  const dayKey = date => new Intl.DateTimeFormat('en-CA', { timeZone: WIB }).format(date);
  const clock = date => new Intl.DateTimeFormat('id-ID', { timeZone: WIB, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date).replace('.', ':');
  const shortDate = date => new Intl.DateTimeFormat('id-ID', { timeZone: WIB, day: 'numeric', month: 'short' }).format(date);

  // "09:05" untuk hari ini, "2 Okt 21:30" untuk hari lain.
  function stamp(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return dayKey(date) === dayKey(new Date()) ? clock(date) : `${shortDate(date)} ${clock(date)}`;
  }

  function render() {
    const wrap = el('entityDrawerList');
    const payload = state.payload;
    if (!payload) return;
    const rows = payload.stores.map(store => {
      const open = store.status === 'OPEN';
      const never = store.status === 'NEVER';
      const badge = never ? '<span class="status-chip">Belum pernah dibuka</span>'
        : `<span class="status-chip drw-${open ? 'open' : 'closed'}">${open ? 'OPEN' : 'CLOSE'}</span>`;
      const detail = never ? 'Belum ada laci yang pernah dibuka.'
        : open ? `Dibuka <b>${entityAdminEscape(stamp(store.since))}</b> oleh <b>${entityAdminEscape(store.openedBy || '—')}</b>${store.shiftLabel ? ` · ${entityAdminEscape(store.shiftLabel)}` : ''}`
          : `Tutup sejak <b>${entityAdminEscape(stamp(store.since))}</b>${store.lastOpenedBy ? ` · terakhir dibuka ${entityAdminEscape(store.lastOpenedBy)}` : ''}`;
      return `<div class="master-row drw-row"><div class="master-main"><strong>${entityAdminEscape(store.code)}</strong> <span class="muted">${entityAdminEscape(store.storeName || '')}</span><div class="master-meta">${detail}</div></div>${badge}</div>`;
    }).join('');
    const asOf = new Date(payload.asOf);
    el('entityDrawerSummary').innerHTML = `<b>${payload.openCount}</b> dari ${payload.stores.length} gerai sedang buka · dicek pukul <b>${entityAdminEscape(clock(asOf))}</b> WIB`;
    wrap.innerHTML = rows || '<div class="empty">Tidak ada gerai.</div>';
  }

  async function load() {
    const caller = anyEntityStoreCode();
    const status = el('entityDrawerStatus');
    if (!caller) { status.textContent = 'Belum ada gerai di entity ini.'; return; }
    status.textContent = 'Memuat status laci…';
    try {
      state.payload = await entityAdminApi(`/api/admin/entity-drawer-status?store=${encodeURIComponent(caller)}`);
      status.textContent = '';
      render();
    } catch (error) { status.textContent = error.message; }
  }

  let mounted = false;
  // Dipanggil switchEntityTab saat tab dibuka.
  window.loadEntityDrawerStatus = () => {
    if (!mounted) { mounted = true; el('entityDrawerRefresh')?.addEventListener('click', load); }
    return load();
  };
})();
