// Menu berkelompok untuk Workspace Gerai dan panel Pemilik (Entity Admin) --
// Bos Cyo, 2026-10-02: "ditempat admin itu kebanyakan tombol2 ... laporan
// gerai, laporan rugi laba dsb bisa kamu masukkan ke satu tombol laporan,
// terus di dalamnya ada sub tombolnya ... jangan sampe calon customer
// ketakutan dulu karna melihat tombol2 kebanyakan."
//
// Hanya aktif saat skin A/B/C (public/ui-skin.js, kebijakan tenant ui_skin);
// skin 0 tetap memakai deretan tombol lama. Tombol asli TIDAK dipindah atau
// dihapus: deretannya disembunyikan, lalu menu ini menekan tombol asli itu
// (button.click()) -- jadi semua perilaku tab yang sudah ada tetap jalan, dan
// tab baru yang ditambah sesi lain otomatis masuk grup "Lainnya" sampai
// didaftarkan di GROUPS di bawah.
(() => {
  const PAGES = {
    'branch-admin': {
      source: '.admin-tabs',
      keyOf: button => button.dataset.tab || button.id,
      ignore: ['adminMasterMenu', 'contacts', 'adminMasterMenuToggle'],
      groups: [
        { id: 'home', icon: '🏪', label: 'Toko', items: ['store'] },
        { id: 'sales', icon: '🧾', label: 'Transaksi', items: ['transactions', 'drawers', 'approvals'] },
        { id: 'goods', icon: '📦', label: 'Barang', items: ['products', 'categories', 'suppliers', 'stock', 'costmasters', 'manufacturing', 'hpp-recalc', 'warehouseSettingsTab'] },
        { id: 'team', icon: '👥', label: 'Tim', items: ['employees', 'cashiers', 'manual-book', 'announcement', 'daily-task'] },
        { id: 'reports', icon: '📈', label: 'Laporan', items: ['labarugi', 'attendance-report', 'permit-report', 'cashier-raport', 'reports'] },
        { id: 'money', icon: '💰', label: 'Keuangan', items: ['accountingWorkspaceTab', 'accountingSettingsTab', 'sharedaccounts', 'hutangpiutang', 'beaops'] },
        { id: 'customers', icon: '💬', label: 'Pelanggan', items: ['customers', 'customer-feedback', 'vouchers'] }
      ]
    },
    'entity-admin': {
      source: 'nav.admin-tabs',
      keyOf: button => button.dataset.entityTab,
      ignore: [],
      groups: [
        { id: 'stores', icon: '🏪', label: 'Gerai', items: ['stores', 'drawerstatus'] },
        { id: 'reports', icon: '📈', label: 'Laporan', items: ['reports', 'storereport'] },
        { id: 'goods', icon: '📦', label: 'Barang', items: ['productmasters', 'entityrecipes', 'entitystock'] },
        { id: 'team', icon: '👥', label: 'Karyawan', items: ['employees'] },
        { id: 'money', icon: '💰', label: 'Keuangan', items: ['ledger', 'sharedaccounts'] },
        { id: 'customers', icon: '💬', label: 'Pelanggan', items: ['customers'] }
      ]
    }
  };

  // Nama tombol dalam bahasa pemilik usaha (tombol asli tidak diubah).
  const LABELS = {
    store: 'Profil Toko', transactions: 'Riwayat Transaksi', drawers: 'Laci Kasir', approvals: 'Persetujuan',
    products: 'Daftar Barang', categories: 'Kategori', suppliers: 'Supplier', stock: 'Stok', costmasters: 'Jenis Biaya',
    manufacturing: 'Resep & Satuan', 'hpp-recalc': 'Hitung Ulang HPP', warehouseSettingsTab: 'Gudang',
    employees: 'Karyawan', cashiers: 'Akun Kasir', 'manual-book': 'Buku Panduan', announcement: 'Pengumuman', 'daily-task': 'Tugas Harian',
    reports: 'Laporan', labarugi: 'Untung Rugi', 'attendance-report': 'Presensi', 'permit-report': 'Izin & Koreksi', 'cashier-raport': 'Raport Kasir',
    accountingWorkspaceTab: 'Pembukuan', accountingSettingsTab: 'Pengaturan Pembukuan', sharedaccounts: 'Rekening Bersama',
    hutangpiutang: 'Hutang & Pembayaran', beaops: 'Biaya Operasional',
    customers: 'Pelanggan', 'customer-feedback': 'Kotak Saran', vouchers: 'Voucher',
    storereport: 'Laporan per Gerai', drawerstatus: 'Status Laci', productmasters: 'Daftar Barang', entityrecipes: 'Resep', entitystock: 'Stok Gerai',
    ledger: 'Buku Usaha'
  };
  const ENTITY_LABELS = { stores: 'Gerai', reports: 'Laporan Usaha', employees: 'Karyawan', customers: 'Pelanggan', sharedaccounts: 'Rekening Bersama' };

  function pageKey() {
    if (window.MAXI_SKIN_PAGE === 'entity-admin') return 'entity-admin';
    if (window.LEKER_PAGE_CONTEXT === 'admin') return 'branch-admin';
    return null;
  }

  const page = PAGES[pageKey()];
  if (!page) return;
  let nav = null;
  let observer = null;
  let lastClickedKey = null;
  let scheduled = false;

  function injectStyle() {
    if (document.getElementById('navGroupsStyle')) return;
    const style = document.createElement('style');
    style.id = 'navGroupsStyle';
    style.textContent = `
      html[data-skin] .nav-grouped-source{display:none!important}
      .nav-groups{display:grid;gap:10px;margin:0 0 18px}
      .nav-groups-main{display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));gap:8px}
      .nav-group-btn{position:relative;display:grid;justify-items:center;gap:4px;padding:11px 4px 9px;border:1px solid var(--line);background:var(--surface,#fff);color:var(--ink);border-radius:var(--skin-r,14px);font:inherit;font-weight:800;font-size:12.5px;line-height:1.2;cursor:pointer;transition:transform .12s ease,background .15s ease}
      .nav-group-btn:active{transform:scale(.97)}
      .nav-group-btn:focus-visible,.nav-sub-btn:focus-visible{outline:3px solid var(--brand);outline-offset:2px}
      .nav-group-icon{font-size:22px;line-height:1}
      .nav-group-btn[aria-current="true"]{background:var(--skin-active-bg,var(--ink));color:var(--skin-active-ink,#fff);border-color:transparent}
      .nav-group-badge{position:absolute;top:6px;right:8px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#e5484d;color:#fff;font-size:10.5px;font-weight:900;display:grid;place-items:center}
      .nav-groups-sub{display:flex;flex-wrap:wrap;gap:6px;padding:6px;border-radius:var(--skin-r,14px);background:var(--skin-chip-bg,#f1eee4)}
      .nav-sub-btn{border:0;background:transparent;color:var(--ink);opacity:.75;padding:8px 12px;border-radius:999px;font:inherit;font-weight:800;font-size:13px;cursor:pointer}
      .nav-sub-btn[aria-current="true"]{opacity:1;background:var(--surface,#fff);box-shadow:0 1px 3px rgba(0,0,0,.10)}
      .nav-sub-count{display:inline-grid;place-items:center;min-width:18px;height:18px;margin-left:6px;padding:0 5px;border-radius:999px;background:#e5484d;color:#fff;font-size:10.5px}
      @media (min-width:760px){.nav-groups-main{grid-template-columns:repeat(auto-fill,minmax(110px,1fr))}}
    `;
    document.head.appendChild(style);
  }

  const source = () => document.querySelector(page.source);
  const cleanLabel = text => String(text || '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s*\d+\s*$/, '').trim();
  const countOf = text => { const match = String(text || '').match(/(\d+)\s*$/); return match ? Number(match[1]) : 0; };
  const labelFor = (key, button) => (pageKey() === 'entity-admin' && ENTITY_LABELS[key]) || LABELS[key] || cleanLabel(button.textContent) || key;

  function collect() {
    const container = source();
    if (!container) return null;
    const items = new Map();
    container.querySelectorAll('button').forEach(button => {
      const key = page.keyOf(button);
      if (!key || page.ignore.includes(key) || button.hidden || button.classList.contains('hidden')) return;
      items.set(key, button);
    });
    const known = new Set(page.groups.flatMap(group => group.items));
    const groups = page.groups
      .map(group => ({ ...group, entries: group.items.filter(key => items.has(key)).map(key => ({ key, button: items.get(key) })) }))
      .filter(group => group.entries.length);
    const others = [...items.keys()].filter(key => !known.has(key)).map(key => ({ key, button: items.get(key) }));
    if (others.length) groups.push({ id: 'others', icon: '➕', label: 'Lainnya', entries: others });
    return groups;
  }

  function activeKey(groups) {
    for (const group of groups) {
      for (const entry of group.entries) if (entry.button.classList.contains('active')) return entry.key;
    }
    return lastClickedKey;
  }

  function render() {
    scheduled = false;
    if (!window.MaxiSkin?.isOn()) return unmount();
    const container = source();
    const groups = collect();
    if (!container || !groups?.length) return;
    container.classList.add('nav-grouped-source');
    if (!nav) {
      nav = document.createElement('div');
      nav.className = 'nav-groups';
      nav.setAttribute('role', 'navigation');
      nav.setAttribute('aria-label', 'Menu');
      container.insertAdjacentElement('beforebegin', nav);
      nav.addEventListener('click', onClick);
    }
    const current = activeKey(groups);
    const currentGroup = groups.find(group => group.entries.some(entry => entry.key === current)) || groups[0];
    const esc = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
    const main = groups.map(group => {
      const pending = group.entries.reduce((sum, entry) => sum + countOf(entry.button.textContent), 0);
      return `<button type="button" class="nav-group-btn" data-nav-group="${esc(group.id)}" aria-current="${group === currentGroup}">
        <span class="nav-group-icon" aria-hidden="true">${group.icon}</span><span>${esc(group.label)}</span>
        ${pending ? `<span class="nav-group-badge">${pending}</span>` : ''}</button>`;
    }).join('');
    const sub = currentGroup.entries.length > 1
      ? `<div class="nav-groups-sub">${currentGroup.entries.map(entry => {
        const count = countOf(entry.button.textContent);
        return `<button type="button" class="nav-sub-btn" data-nav-item="${esc(entry.key)}" aria-current="${entry.key === current}">${esc(labelFor(entry.key, entry.button))}${count ? `<span class="nav-sub-count">${count}</span>` : ''}</button>`;
      }).join('')}</div>`
      : '';
    const html = `<div class="nav-groups-main">${main}</div>${sub}`;
    if (nav.innerHTML !== html) nav.innerHTML = html;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(render);
  }

  function press(key) {
    const groups = collect() || [];
    const entry = groups.flatMap(group => group.entries).find(item => item.key === key);
    if (!entry) return;
    lastClickedKey = key;
    entry.button.click();
    schedule();
  }

  function onClick(event) {
    const item = event.target.closest('[data-nav-item]');
    if (item) return press(item.dataset.navItem);
    const groupButton = event.target.closest('[data-nav-group]');
    if (!groupButton) return;
    const group = (collect() || []).find(candidate => candidate.id === groupButton.dataset.navGroup);
    if (!group) return;
    // Grup yang sedang terbuka tidak berpindah halaman; grup lain membuka isi pertamanya.
    if (groupButton.getAttribute('aria-current') === 'true' && group.entries.length > 1) return;
    press(group.entries[0].key);
  }

  function unmount() {
    nav?.remove();
    nav = null;
    source()?.classList.remove('nav-grouped-source');
  }

  function start() {
    injectStyle();
    const container = source();
    if (!container) return;
    observer?.disconnect();
    observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'], characterData: true });
    schedule();
  }

  window.addEventListener('maxi-skin-change', schedule);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
