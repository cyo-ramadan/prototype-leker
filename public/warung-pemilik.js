// Layar Pemilik "Hari ini" -- skin D / Mode Warung (DESAIN-SKIN-D-WARUNG.md §4b).
// Hanya muncul kalau tenant memilih skin D. Satu angka besar (untung bersih
// hari ini semua gerai), lalu yang butuh keputusan, lalu daftar gerai.
// Semua data dari endpoint yang sudah ada, hanya baca:
//   GET /api/admin/reports/net-profit  (untung bersih per gerai per hari)
//   GET /api/management/approval-requests (pengajuan menunggu per gerai)
//   GET /api/admin/drawers             (laci buka/tutup per gerai)
// Diperbarui saat dibuka, saat tombol "Perbarui" ditekan, dan saat tab kembali
// dilihat -- tanpa polling (invariant #6).
(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const rupiah = value => {
    const number = Math.round(Number(value) || 0);
    return `${number < 0 ? '−' : ''}Rp${Math.abs(number).toLocaleString('id-ID')}`;
  };
  let loading = false;
  let lastStoresKey = '';

  function jakartaDate(offsetDays = 0) {
    const date = new Date(Date.now() + offsetDays * 86400000);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  async function get(path) {
    const token = localStorage.getItem('lekerEntityAdminToken') || '';
    const response = await fetch(path, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Gagal memuat.');
    return payload;
  }

  function stores() {
    try { return (entityAdminState?.stores || []).filter(store => store.isActive !== false); } catch { return []; }
  }

  function injectStyle() {
    if ($('hariIniStyle')) return;
    const style = document.createElement('style');
    style.id = 'hariIniStyle';
    style.textContent = `
      .hi{display:grid;gap:12px;margin:0 0 18px}
      .hi-profit{background:#111827;color:#fff;border-radius:22px;padding:20px 20px 18px;display:grid;gap:4px}
      .hi-profit small{font-size:14px;font-weight:700;opacity:.75;letter-spacing:.02em}
      .hi-profit b{font-size:clamp(38px,11vw,54px);line-height:1.05;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
      .hi-profit b.neg{color:#ff9b9b}
      .hi-profit p{margin:4px 0 0;font-size:14.5px;opacity:.85}
      .hi-profit p em{font-style:normal;font-weight:800;color:#ffc929}
      .hi-row{display:flex;justify-content:space-between;align-items:center;gap:10px}
      .hi-refresh{border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);color:#fff;border-radius:999px;padding:7px 14px;font:inherit;font-weight:700;font-size:13px;cursor:pointer}
      .hi-card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:14px 16px;display:grid;gap:8px}
      .hi-card h2{margin:0;font-size:17px}
      .hi-ok{color:#0f8a4b;font-weight:800}
      .hi-need{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:#fef3c7}
      .hi-need a{background:#1446c8;color:#fff;text-decoration:none;font-weight:800;border-radius:999px;padding:9px 14px;font-size:14px;white-space:nowrap}
      .hi-store{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;padding:10px 0;border-top:1px solid var(--line)}
      .hi-store:first-of-type{border-top:0}
      .hi-store strong{flex:1 1 140px;min-width:0;font-size:16px}
      .hi-store .num{font-weight:800;font-variant-numeric:tabular-nums}
      .hi-store .num.neg{color:#c81e1e}
      .hi-muted{color:var(--muted);font-size:13.5px}
    `;
    document.head.appendChild(style);
  }

  function mount() {
    let section = $('hariIni');
    if (!section) {
      const heading = document.querySelector('#entityAdminApp .owner-heading');
      if (!heading) return null;
      section = document.createElement('section');
      section.id = 'hariIni';
      section.className = 'hi';
      section.setAttribute('aria-label', 'Hari ini');
      heading.insertAdjacentElement('afterend', section);
    }
    return section;
  }

  function unmount() { $('hariIni')?.remove(); }

  async function load() {
    if (window.MaxiSkin?.skin?.() !== 'd') return unmount();
    const list = stores();
    if (!list.length || loading) return;
    const section = mount();
    if (!section) return;
    injectStyle();
    loading = true;
    if (!section.innerHTML) section.innerHTML = '<div class="hi-profit"><small>Untung bersih hari ini</small><b>…</b><p>Menghitung…</p></div>';
    const today = jakartaDate(0);
    const yesterday = jakartaDate(-1);
    const codes = list.map(store => store.code);
    try {
      const [profit, approvals, drawers] = await Promise.all([
        get(`/api/admin/reports/net-profit?store=${encodeURIComponent(codes[0])}&from=${yesterday}&to=${today}&stores=${encodeURIComponent(codes.join(','))}`).catch(() => null),
        Promise.all(codes.map(code => get(`/api/management/approval-requests?store=${encodeURIComponent(code)}`).then(payload => [code, (payload.requests || []).length]).catch(() => [code, 0]))),
        Promise.all(codes.map(code => get(`/api/admin/drawers?store=${encodeURIComponent(code)}`).then(payload => [code, (payload.drawers || []).find(drawer => drawer.status === 'OPEN') || null]).catch(() => [code, null])))
      ]);
      render(section, list, profit, new Map(approvals), new Map(drawers), today, yesterday);
    } catch (error) {
      section.innerHTML = `<div class="hi-card"><h2>Hari ini</h2><div class="hi-muted">${esc(error.message)}</div></div>`;
    } finally {
      loading = false;
    }
  }

  function render(section, list, profit, approvals, drawers, today, yesterday) {
    const rows = profit?.rows || [];
    const dayRow = date => rows.find(row => row.businessDate === date) || { byStore: {}, total: 0 };
    const todayRow = dayRow(today);
    const yesterdayRow = dayRow(yesterday);
    const total = Number(todayRow.total) || 0;
    const prev = Number(yesterdayRow.total) || 0;
    const pendingTotal = [...approvals.values()].reduce((sum, count) => sum + count, 0);
    const openCount = [...drawers.values()].filter(Boolean).length;

    const needs = pendingTotal
      ? [...approvals].filter(([, count]) => count > 0).map(([code, count]) => {
        const store = list.find(item => item.code === code);
        return `<div class="hi-need"><span><b>${esc(store?.storeName || code)}</b> · ${count} pengajuan menunggu</span><a href="/s/${encodeURIComponent(code)}/admin">Putuskan</a></div>`;
      }).join('')
      : '<div class="hi-ok">✓ Tidak ada yang menunggu keputusan Anda.</div>';

    const storeRows = list.map(store => {
      const drawer = drawers.get(store.code);
      const value = Number(todayRow.byStore?.[store.code]) || 0;
      return `<div class="hi-store"><strong>${esc(store.storeName)}</strong>
        <span class="status-chip ${drawer ? 'ok' : 'off'}">${drawer ? `Buka · ${esc(drawer.cashierName || 'kasir')}` : 'Tutup'}</span>
        <span class="num ${value < 0 ? 'neg' : ''}">${rupiah(value)}</span></div>`;
    }).join('');

    section.innerHTML = `
      <div class="hi-profit">
        <div class="hi-row"><small>Untung bersih hari ini</small><button type="button" class="hi-refresh" data-hi-refresh>Perbarui</button></div>
        <b class="${total < 0 ? 'neg' : ''}">${profit ? rupiah(total) : '—'}</b>
        <p>${profit ? `Kemarin <em>${rupiah(prev)}</em> · ${openCount} dari ${list.length} gerai sedang buka` : 'Laporan untung belum bisa dimuat.'}</p>
      </div>
      <div class="hi-card"><h2>Butuh keputusan Anda${pendingTotal ? ` · ${pendingTotal}` : ''}</h2>${needs}</div>
      <div class="hi-card"><h2>Gerai hari ini</h2>${storeRows}
        <div class="hi-muted">Untung bersih = penjualan dikurangi modal barang yang terjual dan biaya. Angka minus ditampilkan apa adanya.</div></div>`;
  }

  function maybeLoad() {
    const app = $('entityAdminApp');
    if (!app || app.classList.contains('hidden')) return;
    const key = stores().map(store => store.code).join(',');
    if (key && key !== lastStoresKey) { lastStoresKey = key; load(); }
  }

  document.addEventListener('click', event => { if (event.target.closest('[data-hi-refresh]')) load(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
  window.addEventListener('maxi-skin-change', () => { lastStoresKey = ''; maybeLoad(); if (window.MaxiSkin?.skin?.() !== 'd') unmount(); });

  function start() {
    const app = $('entityAdminApp');
    const list = $('entityAdminStoreList');
    const observer = new MutationObserver(maybeLoad);
    if (app) observer.observe(app, { attributes: true, attributeFilter: ['class'] });
    if (list) observer.observe(list, { childList: true });
    Promise.resolve(window.MaxiSkin?.ready).then(maybeLoad, maybeLoad);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
