// Halaman depan "Hari ini" Workspace Gerai -- skin D (DESAIN-SKIN-D-WARUNG.md §4c).
// Bos Cyo, 2026-10-03: "tenant punya karyawan cs, tapi admin masih dikerjakan
// oleh owner, buang2 yang bikin owner tambah bingung ... ala2 steve jobs."
//
// Pemilik membuka Workspace Gerai bukan untuk mengisi formulir identitas toko,
// tapi untuk tiga pertanyaan: hari ini untung berapa, ada yang menunggu
// keputusan saya, siapa yang pegang laci dan uangnya berapa. Halaman ini
// menjawab ketiganya, lalu menu (public/nav-groups.js) membawa ke tab asli.
// Hanya baca, lewat endpoint yang sama dengan tab-tab asli:
//   GET /api/admin/reports/net-profit             (untung bersih hari ini & kemarin)
//   GET /api/management/approval-requests          (pengajuan kasir menunggu)
//   GET /api/management/transaction-void-permits   (izin hapus transaksi menunggu)
//   GET /api/admin/drawer/close-permits            (izin tutup laci menunggu)
//   GET /api/admin/drawers, /api/admin/drawers/:id (laci buka + uang seharusnya)
// Diperbarui saat dibuka, tombol "Perbarui", dan saat tab kembali dilihat --
// tanpa polling (invariant #6).
(() => {
  if (window.LEKER_PAGE_CONTEXT !== 'admin') return;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  // Minus tetap minus (invariant #8).
  const rupiah = value => { const number = Math.round(Number(value) || 0); return `${number < 0 ? '−' : ''}Rp${Math.abs(number).toLocaleString('id-ID')}`; };
  const storeCode = () => String(window.LEKER_STORE_CODE || '').trim();
  const isOn = () => window.MaxiSkin?.skin?.() === 'd';
  let loading = false;

  function jakartaDate(offsetDays = 0) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(Date.now() + offsetDays * 86400000));
    const get = type => parts.find(part => part.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  function greeting() {
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false }).format(new Date()));
    if (hour < 11) return 'Selamat pagi';
    if (hour < 15) return 'Selamat siang';
    if (hour < 18) return 'Selamat sore';
    return 'Selamat malam';
  }

  async function get(path) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(`${path}${separator}store=${encodeURIComponent(storeCode())}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Gagal memuat.');
    return payload;
  }

  function injectStyle() {
    if ($('todayHomeStyle')) return;
    const style = document.createElement('style');
    style.id = 'todayHomeStyle';
    style.textContent = `
      body:not(.maxi-home-active) #maxiTodayHome{display:none}
      body.maxi-home-active #adminApp .admin-section{display:none!important}
      #maxiTodayHome{display:grid;gap:12px;margin:0 0 18px}
      .th-greet small{display:block;color:var(--muted);font-weight:700;font-size:15px}
      .th-greet h1{margin:2px 0 0;font-size:28px;letter-spacing:-.02em}
      .th-profit{background:var(--ink);color:#fff;border-radius:var(--skin-r-lg,20px);padding:18px 20px;display:grid;gap:4px}
      .th-profit small{font-size:14px;font-weight:700;opacity:.8}
      .th-profit b{font-size:clamp(36px,11vw,52px);line-height:1.05;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
      .th-profit b.neg{color:#ff9b9b}
      .th-profit p{margin:4px 0 0;font-size:15px;opacity:.9}
      .th-row{display:flex;justify-content:space-between;align-items:center;gap:10px}
      .th-refresh{border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff;border-radius:999px;padding:7px 14px;font:inherit;font-weight:800;font-size:13px;cursor:pointer}
      .th-card h2{margin:0 0 4px;font-size:18px}
      .th-need{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px;border-radius:var(--skin-r,14px);background:var(--skin-warn-soft,#fef3c7);margin-top:8px}
      .th-need span{font-weight:700;min-width:0}
      .th-need button{flex:0 0 auto}
      .th-ok{color:var(--green);font-weight:800;margin-top:6px}
      .th-line{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--line)}
      .th-line:first-of-type{border-top:0}
      .th-line b{font-variant-numeric:tabular-nums;white-space:nowrap}
      .th-quick{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
      .th-quick button{min-height:64px;display:grid;justify-items:center;align-content:center;gap:4px;font-size:13.5px}
      .th-quick span{font-size:20px;line-height:1}
    `;
    document.head.appendChild(style);
  }

  function mount() {
    let section = $('maxiTodayHome');
    if (section) return section;
    const anchor = document.querySelector('#adminApp .admin-tabs');
    if (!anchor) return null;
    section = document.createElement('section');
    section.id = 'maxiTodayHome';
    section.setAttribute('aria-label', 'Hari ini');
    anchor.insertAdjacentElement('afterend', section);
    section.addEventListener('click', event => {
      const target = event.target.closest('[data-th-open]');
      if (target) return window.MaxiNav?.open(target.dataset.thOpen);
      if (event.target.closest('[data-th-refresh]')) load();
    });
    return section;
  }

  function unmount() { $('maxiTodayHome')?.remove(); }

  async function load() {
    if (!isOn()) return unmount();
    if (loading || !storeCode() || document.getElementById('adminApp')?.classList.contains('hidden')) return;
    const section = mount();
    if (!section) return;
    injectStyle();
    loading = true;
    if (!section.innerHTML) section.innerHTML = '<div class="th-profit"><small>Untung bersih hari ini</small><b>…</b><p>Menghitung…</p></div>';
    const today = jakartaDate(0);
    const yesterday = jakartaDate(-1);
    const code = encodeURIComponent(storeCode());
    try {
      const [profit, approvals, voids, closes, drawers] = await Promise.all([
        get(`/api/admin/reports/net-profit?from=${yesterday}&to=${today}&stores=${code}`).catch(() => null),
        get('/api/management/approval-requests?status=pending_approval').then(payload => (payload.requests || []).length).catch(() => 0),
        get('/api/management/transaction-void-permits?status=all').then(payload => Number(payload.summary?.pending || 0)).catch(() => 0),
        get('/api/admin/drawer/close-permits').then(payload => (payload.permits || []).length).catch(() => 0),
        get('/api/admin/drawers').then(payload => payload.drawers || []).catch(() => [])
      ]);
      const open = drawers.find(drawer => drawer.status === 'OPEN') || null;
      const report = open ? await get(`/api/admin/drawers/${encodeURIComponent(open.id)}`).then(payload => payload.report).catch(() => null) : null;
      render(section, { profit, approvals, voids, closes, open, report, today, yesterday });
    } catch (error) {
      section.innerHTML = `<div class="admin-card th-card"><h2>Hari ini</h2><div class="muted">${esc(error.message)}</div></div>`;
    } finally {
      loading = false;
    }
  }

  function render(section, { profit, approvals, voids, closes, open, report, today, yesterday }) {
    const rows = profit?.rows || [];
    const day = date => rows.find(row => row.businessDate === date) || null;
    const todayRow = day(today);
    const total = Number(todayRow?.total) || 0;
    const prev = Number(day(yesterday)?.total) || 0;
    const sales = Number(todayRow?.breakdown?.revenue || 0) + Number(todayRow?.breakdown?.otherIncome || 0);
    const name = $('storeName')?.value || 'Toko Anda';

    const needs = [
      [approvals, 'pengajuan kasir (barang/kas) menunggu', 'approvals'],
      [voids, 'permintaan hapus transaksi', 'approvals'],
      [closes, 'permintaan tutup laci', 'drawers']
    ].filter(([count]) => count > 0);
    const needCount = needs.reduce((sum, [count]) => sum + count, 0);
    const needHtml = needs.length
      ? needs.map(([count, text, key]) => `<div class="th-need"><span>${count} ${esc(text)}</span><button type="button" class="primary-btn" data-th-open="${key}">Putuskan</button></div>`).join('')
      : '<div class="th-ok">✓ Tidak ada yang menunggu keputusan Anda.</div>';

    const time = value => (value ? new Date(value).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '');
    const expected = report?.totals?.expectedCash;
    const drawerHtml = open
      ? `<div class="th-line"><span>Dijaga</span><b>${esc(open.cashierName || 'kasir')}${open.openedAt ? ` · sejak ${time(open.openedAt)}` : ''}</b></div>
         ${expected !== undefined && expected !== null ? `<div class="th-line"><span>Seharusnya ada di laci</span><b>${rupiah(expected)}</b></div>` : ''}
         <button type="button" class="secondary-btn" data-th-open="drawers" style="margin-top:8px">Lihat laci</button>`
      : '<div class="muted">Laci sedang tutup — belum ada yang jaga.</div>';

    section.innerHTML = `
      <div class="th-greet"><small>${greeting()}</small><h1>${esc(name)}</h1></div>
      <div class="th-profit">
        <div class="th-row"><small>Untung bersih hari ini</small><button type="button" class="th-refresh" data-th-refresh>Perbarui</button></div>
        <b class="${total < 0 ? 'neg' : ''}">${profit ? rupiah(total) : '—'}</b>
        <p>${profit ? `Penjualan ${rupiah(sales)} · kemarin untung ${rupiah(prev)}` : 'Laporan untung belum bisa dimuat.'}</p>
      </div>
      <div class="admin-card th-card"><h2>Butuh keputusan Anda${needCount ? ` · ${needCount}` : ''}</h2>${needHtml}</div>
      <div class="admin-card th-card"><h2>Laci kasir</h2>${drawerHtml}</div>
      <div class="th-quick">
        <button type="button" class="secondary-btn" data-th-open="products"><span aria-hidden="true">➕</span>Tambah barang</button>
        <button type="button" class="secondary-btn" data-th-open="stock"><span aria-hidden="true">📦</span>Cek stok</button>
        <button type="button" class="secondary-btn" data-th-open="labarugi"><span aria-hidden="true">📈</span>Untung rugi</button>
      </div>`;
  }

  // ---- Bahasa pemilik (skin D saja) -----------------------------------------
  // Tab asli ditulis untuk admin/akuntan ("Approval Queue", "ACC + POSTING",
  // "posting snapshot secara atomic", "ID drawer_..."). Di skin D teks yang
  // TAMPIL diganti -- hanya node teks yang cocok persis (atau pola di bawah),
  // tidak menyentuh isian, atribut, maupun data yang dikirim ke server.
  const OWNER_WORDS = new Map([
    ['Logout Admin', 'Keluar'],
    ['Lihat Kasir (Read-only)', 'Lihat layar kasir'],
    ['Workspace Gerai ·', 'Gerai'],
    ['Auto Permit', 'Setujui otomatis'],
    ['Kalau nyala, pengajuan baru gerai ini (Arus Kas, Arus Barang, Penyesuaian Stok, Aset) langsung di-ACC otomatis tanpa direview manual.',
      'Kalau nyala, pengajuan kasir langsung disetujui tanpa menunggu Anda. Nyalakan hanya kalau Anda percaya penuh pada kasir.'],
    ['Nyalakan Auto Permit', 'Nyalakan'],
    ['Matikan Auto Permit', 'Matikan'],
    ['Approval Queue', 'Pengajuan kasir'],
    ['Arus Kas, Arus Barang, Penyesuaian Stok, dan Aset dari kasir. ACC mengeksekusi posting snapshot secara atomic sesuai contract aktif.',
      'Kasir minta izin mencatat uang atau barang keluar-masuk. Periksa, lalu Setujui atau Tolak.'],
    ['Tidak ada pengajuan pending.', 'Tidak ada pengajuan yang menunggu.'],
    ['Belum ada permit hapus transaksi.', 'Tidak ada permintaan hapus transaksi.'],
    ['Permit Hapus Transaksi', 'Permintaan hapus transaksi'],
    ['Notification, ACC/Reject, execution status, dan jurnal pembalik berada di Approval Queue yang sama.',
      'Kasir minta transaksi dibatalkan. Kalau Anda setujui, transaksinya dibatalkan dan tetap tercatat.'],
    ['ACC PERMIT', 'Setujui'],
    ['ACC', 'Setujui'],
    ['Reject', 'Tolak'],
    ['↻ Refresh', '↻ Perbarui'],
    ['Pengajuan Tutup Laci Sebelumnya', 'Permintaan tutup laci'],
    ['Kasir gantian jaga mengajukan tutup paksa laci kasir sebelumnya yang masih terbuka -- ACC di sini yang benar-benar menutup lacinya. Tidak diputuskan dalam 24 jam sejak diajukan akan otomatis Tolak.',
      'Kasir yang gantian jaga minta laci kasir sebelumnya ditutup. Kalau Anda setujui, laci itu ditutup. Tidak diputuskan 24 jam = otomatis ditolak.'],
    ['Detail Laci Gerai', 'Laci kasir'],
    ['Semua laci di gerai ini, termasuk penanggung jawab pembuka laci.', 'Siapa yang jaga dan berapa uangnya, per giliran.']
  ]);
  const OWNER_PATTERNS = [
    [/^ID drawer_[0-9a-f-]+(?: · Shift )?/, ''],
    [/ · Pulang -$/, ' · masih jaga'],
    [/^Modal Rp/, 'Uang awal Rp'],
    [/ · OPEN$/, ' · Buka'],
    [/ · CLOSED$/, ' · Tutup']
  ];
  const SKIP = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SCRIPT', 'STYLE']);

  function ownerWords(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node => (SKIP.has(node.parentElement?.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const raw = node.nodeValue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      let next = OWNER_WORDS.has(trimmed) ? raw.replace(trimmed, OWNER_WORDS.get(trimmed)) : raw;
      for (const [pattern, replacement] of OWNER_PATTERNS) next = next.replace(pattern, replacement);
      if (next !== raw) node.nodeValue = next;
    }
  }

  let sweepScheduled = false;
  function sweep() {
    sweepScheduled = false;
    if (!isOn()) return;
    ownerWords(document.querySelector('.admin-topbar'));
    document.querySelectorAll('#adminApp .admin-section.active').forEach(ownerWords);
    // Kartu permintaan tutup laci hanya muncul kalau memang ada yang menunggu.
    const closeCount = $('adminClosePermitCount');
    const closeCard = closeCount?.closest('.admin-card');
    if (closeCard) closeCard.hidden = closeCount.textContent.trim() === '0';
  }
  function scheduleSweep() {
    if (sweepScheduled) return;
    sweepScheduled = true;
    requestAnimationFrame(sweep);
  }

  function relabel() { scheduleSweep(); }

  function start() {
    const app = $('adminApp');
    if (app) {
      new MutationObserver(() => { if (!app.classList.contains('hidden')) load(); }).observe(app, { attributes: true, attributeFilter: ['class'] });
      new MutationObserver(() => { if (isOn()) scheduleSweep(); }).observe(app, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    }
    const top = document.querySelector('.admin-topbar');
    if (top) new MutationObserver(() => { if (isOn()) scheduleSweep(); }).observe(top, { subtree: true, childList: true, characterData: true });
    window.addEventListener('maxi-nav-home', load);
    window.addEventListener('maxi-skin-change', () => { relabel(); load(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && window.MaxiNav?.isHome?.()) load(); });
    Promise.resolve(window.MaxiSkin?.ready).then(() => { relabel(); load(); }, load);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
