// Menu berkelompok untuk Workspace Gerai dan panel Pemilik (Entity Admin) --
// Bos Cyo, 2026-10-02: "ditempat admin itu kebanyakan tombol2 ... laporan
// gerai, laporan rugi laba dsb bisa kamu masukkan ke satu tombol laporan,
// terus di dalamnya ada sub tombolnya ... jangan sampe calon customer
// ketakutan dulu karna melihat tombol2 kebanyakan."
//
// Skin D (Bos Cyo 2026-10-03: "tenant punya karyawan cs, tapi admin masih
// dikerjakan oleh owner, buang2 yang bikin owner tambah bingung") memakai
// susunan sendiri (SKIN_GROUPS.d): halaman depan "Hari ini" (dirender
// public/warung-admin.js), lalu hanya 4 tujuan yang dipakai pemilik warung
// tiap hari; selebihnya masuk "Lainnya". Lihat DESAIN-SKIN-D-WARUNG.md §4c.
//
// Hanya aktif saat skin A/B/C/D/E (public/ui-skin.js, kebijakan tenant ui_skin);
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
        { id: 'money', icon: '💰', label: 'Keuangan', items: ['setoran-cs', 'accountingWorkspaceTab', 'accountingSettingsTab', 'sharedaccounts', 'hutangpiutang', 'beaops'] },
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
        { id: 'money', icon: '💰', label: 'Keuangan', items: ['ledger', 'sharedaccounts', 'setorancs'] },
        { id: 'customers', icon: '💬', label: 'Pelanggan', items: ['customers'] }
      ]
    }
  };

  // Susunan khusus per skin -- menimpa `groups` halaman di atas. `home: true`
  // = tujuan tanpa tab asli ("Hari ini"): menyalakan kelas
  // body.maxi-home-active, yang isinya diurus public/warung-admin.js.
  const SKIN_GROUPS = {
    d: {
      'branch-admin': [
        { id: 'today', icon: '🏠', label: 'Hari ini', home: true },
        { id: 'decide', icon: '✅', label: 'Persetujuan', items: ['approvals', 'setoran-cs'] },
        { id: 'sales', icon: '🧾', label: 'Penjualan', items: ['transactions', 'drawers', 'labarugi', 'beaops'] },
        { id: 'goods', icon: '📦', label: 'Barang', items: ['products', 'stock', 'categories', 'suppliers'] },
        { id: 'team', icon: '👥', label: 'Tim', items: ['employees', 'cashiers', 'attendance-report'] },
        // Lainnya = daftar berkelompok seperti menu Pengaturan, bukan 17 tombol
        // bertumpuk. Tab baru dari sesi lain otomatis masuk "Fitur lain".
        { id: 'others', icon: '⋯', label: 'Lainnya', menu: [
          { title: 'Toko & pelanggan', items: ['store', 'customers', 'customer-feedback', 'vouchers'] },
          { title: 'Tim', items: ['manual-book', 'announcement', 'daily-task', 'cashier-raport', 'permit-report'] },
          { title: 'Uang & pembukuan', items: ['hutangpiutang', 'costmasters', 'sharedaccounts', 'accountingWorkspaceTab', 'accountingSettingsTab'] },
          { title: 'Lanjutan — jarang dipakai', items: ['manufacturing', 'warehouseSettingsTab', 'hpp-recalc'] }
        ] }
      ],
      'entity-admin': [
        { id: 'stores', icon: '🏪', label: 'Gerai', items: ['stores', 'drawerstatus'] },
        { id: 'reports', icon: '📈', label: 'Laporan', items: ['reports', 'storereport'] },
        { id: 'team', icon: '👥', label: 'Karyawan', items: ['employees'] }
      ]
    }
  };
  // Skin F (Racik Parfum): "Bahan & Aroma" (public/racik-admin.js) jadi pintu
  // pertama grup Barang -- satu layar pengganti Data Barang + Resep & Satuan.
  SKIN_GROUPS.f = {
    'branch-admin': PAGES['branch-admin'].groups.map(group => (group.id === 'goods'
      ? { ...group, items: ['racikbahan', ...group.items] }
      : group))
  };
  // Skin G (Percetakan, ADR-055): "Layar Cetak" (tombol dari public/percetakan-admin-entry.js)
  // jadi pintu pertama grup Toko -- chat WA, antrian per mesin, dan pengaturan mesin/produk ada di sana.
  SKIN_GROUPS.g = {
    'branch-admin': PAGES['branch-admin'].groups.map(group => (group.id === 'home'
      ? { ...group, items: ['cetak', ...group.items] }
      : group))
  };
  // Keterangan satu baris di daftar "Lainnya" (skin D) -- supaya pemilik tahu
  // isinya sebelum membuka.
  const SKIN_HINTS = {
    d: {
      store: 'Nama, logo, titik lokasi absen', customers: 'Data pembeli langganan', 'customer-feedback': 'Masukan dari pembeli',
      vouchers: 'Potongan harga', 'manual-book': 'Panduan kerja untuk kasir', announcement: 'Pesan untuk semua karyawan',
      'daily-task': 'Daftar tugas kasir tiap hari', 'cashier-raport': 'Nilai kerja tiap kasir', 'permit-report': 'Riwayat izin & koreksi',
      hutangpiutang: 'Utang ke supplier & pembayarannya', costmasters: 'Jenis biaya: listrik, sewa, dll.', sharedaccounts: 'Rekening bank & e-wallet toko',
      accountingWorkspaceTab: 'Buku besar (untuk akuntan)', accountingSettingsTab: 'Pengaturan akun pembukuan',
      manufacturing: 'Barang racikan dari bahan', warehouseSettingsTab: 'Pengaturan gudang', 'hpp-recalc': 'Hitung ulang modal barang'
    }
  };
  const SKIN_LABELS = {
    d: { drawers: 'Laci Kasir', beaops: 'Biaya Toko', labarugi: 'Untung Rugi', 'attendance-report': 'Absen', cashiers: 'Akun Kasir', store: 'Profil Toko' }
  };
  const currentSkin = () => window.MaxiSkin?.skin?.() || 'classic';
  const groupsFor = () => SKIN_GROUPS[currentSkin()]?.[pageKey()] || page.groups;

  // Nama tombol dalam bahasa pemilik usaha (tombol asli tidak diubah).
  const LABELS = {
    store: 'Profil Toko', transactions: 'Riwayat Transaksi', drawers: 'Laci Kasir', approvals: 'Persetujuan',
    products: 'Daftar Barang', categories: 'Kategori', suppliers: 'Supplier', stock: 'Stok', costmasters: 'Jenis Biaya',
    manufacturing: 'Resep & Satuan', 'hpp-recalc': 'Hitung Ulang HPP', warehouseSettingsTab: 'Gudang',
    employees: 'Karyawan', cashiers: 'Akun Kasir', 'manual-book': 'Buku Panduan', announcement: 'Pengumuman', 'daily-task': 'Tugas Harian',
    reports: 'Laporan', labarugi: 'Untung Rugi', 'attendance-report': 'Presensi', 'permit-report': 'Izin & Koreksi', 'cashier-raport': 'Raport Kasir',
    accountingWorkspaceTab: 'Pembukuan', accountingSettingsTab: 'Pengaturan Pembukuan', sharedaccounts: 'Rekening Bersama',
    hutangpiutang: 'Hutang & Pembayaran', beaops: 'Biaya Operasional', 'setoran-cs': 'Setoran CS',
    customers: 'Pelanggan', 'customer-feedback': 'Kotak Saran', vouchers: 'Voucher',
    storereport: 'Laporan per Gerai', drawerstatus: 'Status Laci', productmasters: 'Daftar Barang', entityrecipes: 'Resep', entitystock: 'Stok Gerai',
    ledger: 'Buku Usaha', racikbahan: 'Bahan & Aroma', cetak: 'Layar Cetak'
  };
  const ENTITY_LABELS = { stores: 'Gerai', reports: 'Laporan Usaha', employees: 'Karyawan', customers: 'Pelanggan', sharedaccounts: 'Rekening Bersama', setorancs: 'Setoran CS' };

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
  let homeActive = null; // null = belum diputuskan; diisi saat render pertama
  let menuOpen = false;  // daftar "Lainnya" (grup bertanda `menu`) sedang terbuka

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
      body.maxi-more-active .admin-section,body.maxi-more-active #maxiTodayHome{display:none!important}
      .nav-menu{display:grid;gap:16px}
      .nav-menu h3{margin:0 0 6px 4px;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
      .nav-menu-list{background:var(--surface,#fff);border:1px solid var(--line);border-radius:var(--skin-r-lg,16px);overflow:hidden}
      .nav-menu-item{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:13px 16px;border:0;border-top:1px solid var(--line);background:transparent;color:var(--ink);font:inherit;text-align:left;cursor:pointer}
      .nav-menu-item:first-child{border-top:0}
      .nav-menu-item b{display:block;font-size:16px}
      .nav-menu-item small{display:block;color:var(--muted);font-size:13.5px;margin-top:2px}
      .nav-menu-item i{font-style:normal;font-size:22px;color:var(--muted)}
      .nav-crumb{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      .nav-crumb b{font-size:18px}
      @media (min-width:760px){.nav-groups-main{grid-template-columns:repeat(auto-fill,minmax(110px,1fr))}}
    `;
    document.head.appendChild(style);
  }

  const source = () => document.querySelector(page.source);
  const cleanLabel = text => String(text || '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s*\d+\s*$/, '').trim();
  const countOf = text => { const match = String(text || '').match(/(\d+)\s*$/); return match ? Number(match[1]) : 0; };
  const labelFor = (key, button) => SKIN_LABELS[currentSkin()]?.[key] || (pageKey() === 'entity-admin' && ENTITY_LABELS[key]) || LABELS[key] || cleanLabel(button.textContent) || key;

  function collect() {
    const container = source();
    if (!container) return null;
    const items = new Map();
    container.querySelectorAll('button').forEach(button => {
      const key = page.keyOf(button);
      if (!key || page.ignore.includes(key) || button.hidden || button.classList.contains('hidden')) return;
      items.set(key, button);
    });
    const layout = groupsFor();
    const keysOf = group => group.items || (group.menu || []).flatMap(section => section.items);
    const known = new Set(layout.flatMap(keysOf));
    const entryOf = key => ({ key, button: items.get(key) });
    const groups = layout
      .map(group => ({
        ...group,
        entries: keysOf(group).filter(key => items.has(key)).map(entryOf),
        sections: group.menu ? group.menu.map(section => ({ title: section.title, entries: section.items.filter(key => items.has(key)).map(entryOf) })).filter(section => section.entries.length) : null
      }))
      .filter(group => group.home || group.entries.length || group.menu);
    const others = [...items.keys()].filter(key => !known.has(key)).map(entryOf);
    const menuGroup = groups.find(group => group.menu);
    if (others.length && menuGroup) {
      menuGroup.entries.push(...others);
      menuGroup.sections.push({ title: 'Fitur lain', entries: others });
    } else if (others.length) {
      groups.push({ id: 'others', icon: '➕', label: 'Lainnya', entries: others });
    }
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
    const homeGroup = groups.find(group => group.home);
    if (homeActive === null) homeActive = Boolean(homeGroup);
    if (!homeGroup) homeActive = false;
    const menuGroup = groups.find(group => group.menu);
    if (!menuGroup) menuOpen = false;
    document.body.classList.toggle('maxi-home-active', homeActive);
    document.body.classList.toggle('maxi-more-active', menuOpen);
    const current = homeActive || menuOpen ? null : activeKey(groups);
    const currentGroup = homeActive ? homeGroup : menuOpen ? menuGroup : (groups.find(group => group.entries.some(entry => entry.key === current)) || groups.find(group => !group.home) || groups[0]);
    const esc = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
    const main = groups.map(group => {
      const pending = group.entries.reduce((sum, entry) => sum + countOf(entry.button.textContent), 0);
      return `<button type="button" class="nav-group-btn" data-nav-group="${esc(group.id)}" aria-current="${group === currentGroup}">
        <span class="nav-group-icon" aria-hidden="true">${group.icon}</span><span>${esc(group.label)}</span>
        ${pending ? `<span class="nav-group-badge">${pending}</span>` : ''}</button>`;
    }).join('');
    const hints = SKIN_HINTS[currentSkin()] || {};
    const menuList = () => `<div class="nav-menu">${currentGroup.sections.map(section => `<div><h3>${esc(section.title)}</h3><div class="nav-menu-list">${section.entries.map(entry =>
      `<button type="button" class="nav-menu-item" data-nav-item="${esc(entry.key)}"><span><b>${esc(labelFor(entry.key, entry.button))}</b>${hints[entry.key] ? `<small>${esc(hints[entry.key])}</small>` : ''}</span><i aria-hidden="true">›</i></button>`).join('')}</div></div>`).join('')}</div>`;
    const crumb = () => {
      const entry = currentGroup.entries.find(item => item.key === current);
      return `<div class="nav-crumb"><button type="button" class="secondary-btn" data-nav-group="${esc(currentGroup.id)}">‹ ${esc(currentGroup.label)}</button>${entry ? `<b>${esc(labelFor(entry.key, entry.button))}</b>` : ''}</div>`;
    };
    const sub = currentGroup.menu
      ? (menuOpen ? menuList() : crumb())
      : !currentGroup.home && currentGroup.entries.length > 1
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
    homeActive = false;
    menuOpen = false;
    entry.button.click();
    schedule();
  }

  function goHome() {
    homeActive = true;
    menuOpen = false;
    window.scrollTo(0, 0);
    schedule();
    window.dispatchEvent(new CustomEvent('maxi-nav-home'));
  }

  // Dipakai halaman "Hari ini" (warung-admin.js) untuk melompat ke tab asli.
  window.MaxiNav = {
    open: key => { press(key); window.scrollTo(0, 0); },
    home: goHome,
    isHome: () => Boolean(homeActive)
  };

  function onClick(event) {
    const item = event.target.closest('[data-nav-item]');
    if (item) {
      const fromMenu = Boolean(item.closest('.nav-menu'));
      press(item.dataset.navItem);
      if (fromMenu) window.scrollTo(0, 0);
      return;
    }
    const groupButton = event.target.closest('[data-nav-group]');
    if (!groupButton) return;
    const group = (collect() || []).find(candidate => candidate.id === groupButton.dataset.navGroup);
    if (!group) return;
    if (group.home) return goHome();
    if (group.menu) {
      homeActive = false;
      menuOpen = true;
      window.scrollTo(0, 0);
      return schedule();
    }
    // Grup yang sedang terbuka tidak berpindah halaman; grup lain membuka isi pertamanya.
    if (groupButton.getAttribute('aria-current') === 'true' && group.entries.length > 1) return;
    press(group.entries[0].key);
  }

  function unmount() {
    document.body.classList.remove('maxi-home-active', 'maxi-more-active');
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
