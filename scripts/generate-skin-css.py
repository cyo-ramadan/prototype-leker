# Pembangkit public/skin-{a,b,c,d,e,f,g}.css dari satu kerangka selektor (HANDOFF-UIUX-SIAP-JUAL.md §8).
# Pakai: python3 scripts/generate-skin-css.py public  -- ubah token di SKINS, jangan sunting CSS hasilnya.
COMMON = r"""
html[data-skin="{s}"] {{
{tokens}
}}
html[data-skin="{s}"] body {{ background: var(--skin-page-bg); color: var(--ink); font-family: var(--skin-font); }}
html[data-skin="{s}"] button, html[data-skin="{s}"] input, html[data-skin="{s}"] select, html[data-skin="{s}"] textarea {{ font-family: inherit; }}
html[data-skin="{s}"] .topbar {{ background: var(--skin-top-bg); color: var(--skin-top-ink); border-bottom-color: var(--skin-top-line); backdrop-filter: none; }}
html[data-skin="{s}"] .brand small {{ color: var(--skin-top-muted); }}
html[data-skin="{s}"] .brand-mark {{ background: var(--skin-mark-bg); color: var(--skin-mark-ink); border-radius: var(--skin-r-sm); box-shadow: none; }}
html[data-skin="{s}"] .pill, html[data-skin="{s}"] .admin-link, html[data-skin="{s}"] .cashier-user-chip span {{ background: var(--surface); color: var(--ink); border-color: var(--line); border-radius: var(--skin-r-pill); }}
html[data-skin="{s}"] .hero {{ background: var(--skin-hero-bg); color: var(--skin-hero-ink); border-radius: var(--skin-r-lg); }}
html[data-skin="{s}"] .hero p {{ color: var(--skin-hero-muted); }}
html[data-skin="{s}"] .hero::after {{ content: none; }}
html[data-skin="{s}"] .primary-btn {{ background: var(--skin-primary); color: var(--skin-primary-ink); border-radius: var(--skin-r); box-shadow: none; }}
html[data-skin="{s}"] .ready-action, html[data-skin="{s}"] .action-ready {{ background: var(--green); }}
html[data-skin="{s}"] .secondary-btn, html[data-skin="{s}"] .mini-btn, html[data-skin="{s}"] .drawer-action-btn {{ background: var(--surface); color: var(--ink); border-color: var(--line); border-radius: var(--skin-r-sm); }}
html[data-skin="{s}"] .mini-btn.danger, html[data-skin="{s}"] .danger-btn {{ background: var(--skin-danger-soft); color: var(--skin-danger); border-color: var(--skin-danger-line); }}
html[data-skin="{s}"] .admin-tab, html[data-skin="{s}"] .category-btn {{ background: var(--surface); color: var(--muted); border-color: var(--line); border-radius: var(--skin-r-pill); }}
html[data-skin="{s}"] .admin-tab.active, html[data-skin="{s}"] .category-btn.active {{ background: var(--skin-active-bg); color: var(--skin-active-ink); border-color: var(--skin-active-bg); }}
html[data-skin="{s}"] .category-group-btn {{ border-color: var(--brand); color: var(--brand); }}
html[data-skin="{s}"] .category-group-btn.active {{ background: var(--brand); color: var(--skin-primary-ink); }}
html[data-skin="{s}"] .admin-card, html[data-skin="{s}"] .admin-auth-card, html[data-skin="{s}"] .menu-card, html[data-skin="{s}"] .cashier-menu-panel,
html[data-skin="{s}"] .cashier-draft-panel, html[data-skin="{s}"] .drawer-command-card, html[data-skin="{s}"] .order-card, html[data-skin="{s}"] .status-card,
html[data-skin="{s}"] .stat, html[data-skin="{s}"] .cart-panel, html[data-skin="{s}"] .column, html[data-skin="{s}"] .admin-summary span {{
  background: var(--surface); border-color: var(--line); border-radius: var(--skin-r-lg); box-shadow: var(--skin-card-shadow);
}}
html[data-skin="{s}"] .cart-drawer {{ border-radius: var(--skin-r-lg) 0 0 var(--skin-r-lg); }}
html[data-skin="{s}"] .cashier-menu-card, html[data-skin="{s}"] .cashier-draft-row, html[data-skin="{s}"] .master-row, html[data-skin="{s}"] .cart-item,
html[data-skin="{s}"] .purchase-composer, html[data-skin="{s}"] .cashier-dialog-summary div {{ background: var(--surface); border-color: var(--line); border-radius: var(--skin-r); }}
html[data-skin="{s}"] .cashier-dialog {{ border-radius: var(--skin-r-lg); }}
html[data-skin="{s}"] .note-input, html[data-skin="{s}"] .text-input, html[data-skin="{s}"] textarea,
html[data-skin="{s}"] .admin-field input, html[data-skin="{s}"] .admin-field select, html[data-skin="{s}"] .admin-field textarea {{
  background: var(--skin-input-bg); border-color: var(--line); border-radius: var(--skin-r-sm); color: var(--ink);
}}
html[data-skin="{s}"] .note-input:focus, html[data-skin="{s}"] .text-input:focus, html[data-skin="{s}"] textarea:focus,
html[data-skin="{s}"] .admin-field input:focus, html[data-skin="{s}"] .admin-field select:focus, html[data-skin="{s}"] .admin-field textarea:focus {{
  border-color: var(--brand); box-shadow: 0 0 0 3px var(--skin-focus);
}}
html[data-skin="{s}"] .cashier-add-btn, html[data-skin="{s}"] .add-btn, html[data-skin="{s}"] .menu-stepper-plus {{ background: var(--skin-primary); color: var(--skin-primary-ink); border-radius: var(--skin-r-sm); }}
html[data-skin="{s}"] .menu-stepper, html[data-skin="{s}"] .qty-btn, html[data-skin="{s}"] .cart-close-btn {{ background: var(--skin-input-bg); border-color: var(--line); }}
html[data-skin="{s}"] .menu-card.selected {{ border-color: var(--brand); box-shadow: 0 0 0 2px var(--skin-focus); }}
html[data-skin="{s}"] .selected-badge, html[data-skin="{s}"] .menu-card .category {{ background: var(--skin-chip-bg); color: var(--brand-2); }}
html[data-skin="{s}"] .price, html[data-skin="{s}"] .order-items b, html[data-skin="{s}"] .order-no {{ color: var(--brand-2); }}
html[data-skin="{s}"] .admin-eyebrow, html[data-skin="{s}"] .cart-kicker, html[data-skin="{s}"] .text-btn {{ color: var(--brand); }}
html[data-skin="{s}"] .badge, html[data-skin="{s}"] .master-count, html[data-skin="{s}"] .admin-toast,
html[data-skin="{s}"] .purchase-detail-subtotal, html[data-skin="{s}"] .progress-step.active, html[data-skin="{s}"] .cart-handle-count {{ background: var(--skin-active-bg); color: var(--skin-active-ink); }}
html[data-skin="{s}"] .cart-handle.has-items {{ background: var(--skin-primary); border-color: var(--skin-primary); }}
html[data-skin="{s}"] .drawer-mode-badge.write, html[data-skin="{s}"] .cashier-lock-note.write {{ background: var(--green-soft); color: var(--green); }}
html[data-skin="{s}"] .cashier-lock-note, html[data-skin="{s}"] .drawer-mode-badge.occupied {{ background: var(--skin-warn-soft); color: var(--skin-warn); }}
html[data-skin="{s}"] .image-preview-wrap, html[data-skin="{s}"] .master-thumb, html[data-skin="{s}"] .cashier-menu-image {{ background: var(--skin-chip-bg); }}
html[data-skin="{s}"] .admin-top-actions > a, html[data-skin="{s}"] .admin-top-actions > button {{ padding: 7px 12px; font-size: 12.5px; border-radius: var(--skin-r-pill); line-height: 1.2; }}
@media (max-width: 620px) {{
  html[data-skin="{s}"] .admin-topbar {{ flex-wrap: wrap; row-gap: 10px; }}
  html[data-skin="{s}"] .admin-top-actions {{ width: 100%; justify-content: flex-start; gap: 6px; }}
}}
"""

def tokens(d):
    return "\n".join(f"  {k}: {v};" for k, v in d.items())

SKINS = {
 'a': dict(title='A · Tenang', note='Hijau tenang, kartu rapi, huruf Plus Jakarta Sans. Melanjutkan warna landing page /produk/.', tok={
  '--skin-font': '"Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif',
  '--bg': '#f7f6f1', '--skin-page-bg': '#f7f6f1', '--surface': '#ffffff', '--ink': '#1e2a24', '--muted': '#5f6d66', '--line': '#e3e0d6',
  '--brand': '#1f6f4a', '--brand-2': '#1a5c3e', '--green': '#1f6f4a', '--green-soft': '#e3f1e8', '--amber': '#b7791f',
  '--shadow': '0 8px 24px rgba(31,42,36,.07)', '--skin-card-shadow': '0 1px 2px rgba(31,42,36,.05)',
  '--skin-top-bg': '#ffffff', '--skin-top-ink': '#1e2a24', '--skin-top-muted': '#5f6d66', '--skin-top-line': '#e3e0d6',
  '--skin-mark-bg': '#1f6f4a', '--skin-mark-ink': '#ffffff',
  '--skin-hero-bg': '#1f6f4a', '--skin-hero-ink': '#ffffff', '--skin-hero-muted': '#d7ebe0',
  '--skin-primary': '#1f6f4a', '--skin-primary-ink': '#ffffff', '--skin-active-bg': '#1e2a24', '--skin-active-ink': '#ffffff',
  '--skin-input-bg': '#fbfaf6', '--skin-chip-bg': '#e3f1e8', '--skin-focus': 'rgba(31,111,74,.16)',
  '--skin-danger': '#b3362e', '--skin-danger-soft': '#fbe9e7', '--skin-danger-line': '#f1c7c2', '--skin-warn': '#8a5a12', '--skin-warn-soft': '#fdf1df',
  '--skin-r-sm': '10px', '--skin-r': '12px', '--skin-r-lg': '16px', '--skin-r-pill': '999px'}, extra=r"""
html[data-skin="a"] h1, html[data-skin="a"] h2, html[data-skin="a"] h3 { letter-spacing: -.02em; }
html[data-skin="a"] .brand { font-weight: 800; }
"""),
 'b': dict(title='B · Papan Siaga', note='Papan kontrol: atas grafit, sudut tegas, angka besar huruf rapat (Archivo), status menyala.', tok={
  '--skin-font': '"Archivo", "Arial Narrow", "Segoe UI", system-ui, sans-serif',
  '--bg': '#e9ecea', '--skin-page-bg': '#e9ecea', '--surface': '#ffffff', '--ink': '#111614', '--muted': '#55605a', '--line': '#cfd5d1',
  '--brand': '#0c8f4a', '--brand-2': '#111614', '--green': '#0c8f4a', '--green-soft': '#dcf5e7', '--amber': '#c77700',
  '--shadow': 'none', '--skin-card-shadow': 'none',
  '--skin-top-bg': '#111614', '--skin-top-ink': '#eef3ef', '--skin-top-muted': '#9fb0a6', '--skin-top-line': '#111614',
  '--skin-mark-bg': '#3ddc84', '--skin-mark-ink': '#111614',
  '--skin-hero-bg': '#111614', '--skin-hero-ink': '#eef3ef', '--skin-hero-muted': '#9fb0a6',
  '--skin-primary': '#111614', '--skin-primary-ink': '#3ddc84', '--skin-active-bg': '#111614', '--skin-active-ink': '#ffffff',
  '--skin-input-bg': '#f6f8f7', '--skin-chip-bg': '#e3e8e5', '--skin-focus': 'rgba(12,143,74,.22)',
  '--skin-danger': '#c4261b', '--skin-danger-soft': '#fde7e4', '--skin-danger-line': '#f3b8b1', '--skin-warn': '#8a5200', '--skin-warn-soft': '#fff0d6',
  '--skin-r-sm': '6px', '--skin-r': '8px', '--skin-r-lg': '10px', '--skin-r-pill': '6px'}, extra=r"""
html[data-skin="b"] body { font-stretch: 92%; }
html[data-skin="b"] h1, html[data-skin="b"] h2, html[data-skin="b"] .cashier-panel-head h2 { font-stretch: 75%; font-weight: 800; text-transform: uppercase; letter-spacing: .01em; }
html[data-skin="b"] .brand { font-stretch: 75%; font-weight: 800; letter-spacing: .02em; }
html[data-skin="b"] .total-row strong, html[data-skin="b"] .cashier-draft-total strong, html[data-skin="b"] .stat b,
html[data-skin="b"] .order-no, html[data-skin="b"] .purchase-detail-subtotal strong, html[data-skin="b"] .cashier-menu-price {
  font-stretch: 75%; font-weight: 800; font-variant-numeric: tabular-nums;
}
html[data-skin="b"] .total-row strong, html[data-skin="b"] .cashier-draft-total strong { font-size: 30px; }
html[data-skin="b"] .admin-card, html[data-skin="b"] .drawer-command-card, html[data-skin="b"] .cashier-menu-panel, html[data-skin="b"] .cashier-draft-panel, html[data-skin="b"] .order-card {
  border-width: 1px; border-top: 4px solid #111614;
}
html[data-skin="b"] .admin-tab, html[data-skin="b"] .category-btn { text-transform: uppercase; font-stretch: 85%; letter-spacing: .03em; }
html[data-skin="b"] .primary-btn { text-transform: uppercase; letter-spacing: .04em; }
html[data-skin="b"] .admin-link, html[data-skin="b"] .topbar .pill, html[data-skin="b"] .topbar .secondary-btn, html[data-skin="b"] .topbar .mini-btn {
  background: #1d2622; color: #eef3ef; border-color: #2d3833;
}
"""),
 'c': dict(title='C · Kabar Gerai', note='Akrab seperti WhatsApp: atas hijau toska, latar krem chat, kartu berbentuk gelembung, huruf Nunito.', tok={
  '--skin-font': '"Nunito", "Segoe UI", system-ui, sans-serif',
  '--bg': '#ece5dd', '--skin-page-bg': '#ece5dd', '--surface': '#ffffff', '--ink': '#1b1f1d', '--muted': '#5f6662', '--line': '#ddd5cb',
  '--brand': '#0b6e5f', '--brand-2': '#0b6e5f', '--green': '#128c4a', '--green-soft': '#dcf8c6', '--amber': '#b9770e',
  '--shadow': '0 1px 2px rgba(0,0,0,.10)', '--skin-card-shadow': '0 1px 1.5px rgba(0,0,0,.10)',
  '--skin-top-bg': '#0b6e5f', '--skin-top-ink': '#ffffff', '--skin-top-muted': '#c9ebe4', '--skin-top-line': '#0b6e5f',
  '--skin-mark-bg': '#ffffff', '--skin-mark-ink': '#0b6e5f',
  '--skin-hero-bg': '#0b6e5f', '--skin-hero-ink': '#ffffff', '--skin-hero-muted': '#c9ebe4',
  '--skin-primary': '#0b6e5f', '--skin-primary-ink': '#ffffff', '--skin-active-bg': '#0b6e5f', '--skin-active-ink': '#ffffff',
  '--skin-input-bg': '#ffffff', '--skin-chip-bg': '#dcf8c6', '--skin-focus': 'rgba(11,110,95,.18)',
  '--skin-danger': '#c0392b', '--skin-danger-soft': '#fdecea', '--skin-danger-line': '#f2c4be', '--skin-warn': '#8a5a0a', '--skin-warn-soft': '#fff3d6',
  '--skin-r-sm': '18px', '--skin-r': '4px 16px 16px 16px', '--skin-r-lg': '4px 18px 18px 18px', '--skin-r-pill': '999px'}, extra=r"""
html[data-skin="c"] .brand-mark { border-radius: 50%; }
html[data-skin="c"] .admin-link, html[data-skin="c"] .topbar .pill, html[data-skin="c"] .topbar .secondary-btn, html[data-skin="c"] .topbar .mini-btn {
  background: rgba(255,255,255,.14); color: #ffffff; border-color: rgba(255,255,255,.28);
}
html[data-skin="c"] .primary-btn, html[data-skin="c"] .secondary-btn, html[data-skin="c"] .mini-btn, html[data-skin="c"] .drawer-action-btn { border-radius: 999px; }
html[data-skin="c"] .cashier-menu-card.selected, html[data-skin="c"] .master-row:hover { background: #dcf8c6; }
html[data-skin="c"] .admin-heading h1, html[data-skin="c"] .cashier-header h1 { color: #0b3f37; }
html[data-skin="c"] .hero { border-radius: 4px 22px 22px 22px; }
"""),
 'd': dict(title='D · Mode Warung', note='Arah "Plang Seng": papan nama seng berenamel biru (huruf krem, bingkai garis ganda, paku keling) untuk bilah atas dan angka untung; Barlow + Barlow Condensed; kuning = uang yang harus dilihat. Cara pakai barunya ada di warung.html, warung-admin.js, warung-pemilik.js. DESAIN-SKIN-D-WARUNG.md §3b.', tok={
  '--skin-font': '"Barlow", "Figtree", "Segoe UI", system-ui, sans-serif',
  '--bg': '#EDF0F5', '--skin-page-bg': '#EDF0F5', '--surface': '#ffffff', '--ink': '#14213D', '--muted': '#3D4A63', '--line': '#D5DBE6',
  '--brand': '#1C3F94', '--brand-2': '#1C3F94', '--green': '#0F6640', '--green-soft': '#D8F0E3', '--amber': '#7A4A00',
  '--shadow': 'none', '--skin-card-shadow': 'none',
  '--skin-top-bg': '#1C3F94', '--skin-top-ink': '#FFF5DC', '--skin-top-muted': '#FFF5DC', '--skin-top-line': '#1C3F94',
  '--skin-mark-bg': '#FFC72C', '--skin-mark-ink': '#14213D',
  '--skin-hero-bg': '#1C3F94', '--skin-hero-ink': '#FFF5DC', '--skin-hero-muted': '#FFF5DC',
  '--skin-primary': '#1C3F94', '--skin-primary-ink': '#ffffff', '--skin-active-bg': '#1C3F94', '--skin-active-ink': '#FFF5DC',
  '--skin-input-bg': '#ffffff', '--skin-chip-bg': '#FFF3CC', '--skin-focus': 'rgba(28,63,148,.22)',
  '--skin-danger': '#A61B1B', '--skin-danger-soft': '#FBE3E1', '--skin-danger-line': '#F0B4AE', '--skin-warn': '#6A4000', '--skin-warn-soft': '#FFF3CC',
  '--skin-r-sm': '10px', '--skin-r': '12px', '--skin-r-lg': '14px', '--skin-r-pill': '999px'}, extra=r"""
html[data-skin="d"] {
  --plate: "Barlow Condensed", "Barlow", system-ui, sans-serif; --cream: #FFF5DC; --plang: #1C3F94;
  --plang-frame: inset 0 0 0 5px var(--plang), inset 0 0 0 7px var(--cream);
  --plang-rivets:
    radial-gradient(circle at 14px 14px, var(--cream) 0 3px, rgba(0,0,0,.25) 3.5px, transparent 4.5px),
    radial-gradient(circle at calc(100% - 14px) 14px, var(--cream) 0 3px, rgba(0,0,0,.25) 3.5px, transparent 4.5px),
    radial-gradient(circle at 14px calc(100% - 14px), var(--cream) 0 3px, rgba(0,0,0,.25) 3.5px, transparent 4.5px),
    radial-gradient(circle at calc(100% - 14px) calc(100% - 14px), var(--cream) 0 3px, rgba(0,0,0,.25) 3.5px, transparent 4.5px);
}
html[data-skin="d"] body { font-size: 16.5px; font-weight: 500; }
/* Bilah atas = plang seng: bingkai garis ganda + paku keling, nama dengan huruf plang. */
html[data-skin="d"] .topbar { margin: 8px 10px 0; border-radius: 14px; padding: 16px 22px; background: var(--plang-rivets), var(--plang); box-shadow: var(--plang-frame), 0 4px 0 rgba(20,33,61,.18); position: relative; }
html[data-skin="d"] .brand { font-family: var(--plate); font-weight: 800; letter-spacing: .04em; font-size: 22px; }
html[data-skin="d"] .brand small { font-family: var(--skin-font); letter-spacing: 0; font-size: 13px; font-weight: 600; }
html[data-skin="d"] .admin-link, html[data-skin="d"] .topbar .pill, html[data-skin="d"] .topbar .secondary-btn, html[data-skin="d"] .topbar .mini-btn {
  background: var(--cream); color: var(--plang); border-color: transparent;
}
html[data-skin="d"] h1, html[data-skin="d"] .th-greet h1 { font-family: var(--plate); font-weight: 800; letter-spacing: .01em; }
html[data-skin="d"] .primary-btn { min-height: 54px; font-size: 17px; }
html[data-skin="d"] .total-row strong, html[data-skin="d"] .cashier-draft-total strong { font-size: 28px; font-family: var(--plate); }
html[data-skin="d"] .admin-card, html[data-skin="d"] .master-row { border-width: 2px; }
/* Angka untung (Hari ini gerai & Panel Pemilik) = plang kedua; angkanya kuning. */
html[data-skin="d"] .th-profit, html[data-skin="d"] .hi-profit { background: var(--plang-rivets), var(--plang); box-shadow: var(--plang-frame); color: var(--cream); border-radius: 14px; padding: 22px 26px; }
html[data-skin="d"] .th-profit b, html[data-skin="d"] .hi-profit b { font-family: var(--plate); font-weight: 800; color: #FFC72C; letter-spacing: .01em; }
html[data-skin="d"] .th-profit b.neg, html[data-skin="d"] .hi-profit b.neg { color: #FFC2B8; }
html[data-skin="d"] .th-profit small, html[data-skin="d"] .hi-profit small, html[data-skin="d"] .th-profit p, html[data-skin="d"] .hi-profit p { opacity: 1; }
html[data-skin="d"] .hi-profit p em { color: #FFC72C; }
html[data-skin="d"] .th-refresh, html[data-skin="d"] .hi-refresh { background: var(--cream); color: var(--plang); border: 0; }
html[data-skin="d"] .nav-group-btn { border-width: 2px; }
html[data-skin="d"] .nav-group-btn span:not(.nav-group-icon):not(.nav-group-badge) { font-size: 14px; }
/* Mode Warung: angka untung (warung-pemilik.js) langsung di atas, tanpa kalimat teknis. */
html[data-skin="d"] #entityAdminApp .owner-heading .muted, html[data-skin="d"] #entityAdminApp .owner-heading .admin-eyebrow { display: none; }
html[data-skin="d"] #entityAdminApp .owner-heading h1 { font-size: 28px; margin: 0; }
/* Workspace Gerai untuk pemilik yang mengurus admin sendiri (DESAIN-SKIN-D-WARUNG.md §4c):
   buang yang bikin bingung -- link teknis di bilah atas (Owner/Customer/Kasir Login), judul
   "Workspace Gerai" + kalimat scope, hitungan barang/kategori, kartu "Scope gerai".
   Yang tersisa: "Lihat layar kasir" dan tombol keluar. Halaman depan = "Hari ini" (warung-admin.js). */
html[data-skin="d"] .admin-top-actions > a:not(#cashierReadOnlyLink) { display: none; }
html[data-skin="d"] #adminApp .admin-heading { display: none; }
html[data-skin="d"] #tab-store .admin-tip { display: none; }
/* Persetujuan: yang menunggu dulu, saklar "Setujui otomatis" ke paling bawah. */
html[data-skin="d"] #tab-approvals.active { display: flex; flex-direction: column; }
html[data-skin="d"] #tab-approvals > .admin-card:first-child { order: 9; margin-top: 14px; }
html[data-skin="d"] #tab-drawers small:empty { display: none; }
/* Menu pemilik: 6 tombol rata 3 x 2. */
html[data-skin="d"] .nav-groups-main { grid-template-columns: repeat(3, minmax(0, 1fr)); }
"""),
 'e': dict(title='E · Jaga Sendiri', note='Untuk warung TANPA karyawan (pemilik = kasir = admin): tenda warung hijau-putih, latar sage pucat, huruf Baloo 2, pastel untuk permukaan, teks/angka gelap (kontras >= 7:1), tombol hijau tua. Cara pakai barunya (Buka/Tutup warung, tab Untung) ada di warung.html; aturan servernya di isOwnerOperatedChoice (src/tenant-policy.js). DESAIN-SKIN-E-JAGA-SENDIRI.md.', tok={
  '--skin-font': '"Baloo 2", "Figtree", "Segoe UI", system-ui, sans-serif',
  '--bg': '#EAF2EE', '--skin-page-bg': '#EAF2EE', '--surface': '#ffffff', '--ink': '#1B2420', '--muted': '#3F4C47', '--line': '#DCE7E1',
  '--brand': '#0A5C43', '--brand-2': '#075A30', '--green': '#075A30', '--green-soft': '#D9F2E6', '--amber': '#6A4000',
  '--shadow': '0 6px 18px rgba(31,35,40,.06)', '--skin-card-shadow': 'none',
  '--skin-top-bg': '#C9EEDA', '--skin-top-ink': '#1B2420', '--skin-top-muted': '#3a3632', '--skin-top-line': '#B5E2CA',
  '--skin-mark-bg': '#0A5C43', '--skin-mark-ink': '#ffffff',
  '--skin-hero-bg': '#D9F2E6', '--skin-hero-ink': '#1B2420', '--skin-hero-muted': '#3a3632',
  '--skin-primary': '#0A5C43', '--skin-primary-ink': '#ffffff', '--skin-active-bg': '#0A5C43', '--skin-active-ink': '#ffffff',
  '--skin-input-bg': '#ffffff', '--skin-chip-bg': '#FFF1BF', '--skin-focus': 'rgba(10,90,72,.20)',
  '--skin-danger': '#921A11', '--skin-danger-soft': '#FDE4E1', '--skin-danger-line': '#F3B8B0', '--skin-warn': '#6A4000', '--skin-warn-soft': '#FFF1BF',
  '--skin-r-sm': '14px', '--skin-r': '18px', '--skin-r-lg': '22px', '--skin-r-pill': '999px'}, extra=r"""
html[data-skin="e"] body { font-size: 16.5px; font-weight: 600; }
html[data-skin="e"] .brand { font-weight: 900; }
html[data-skin="e"] .primary-btn { min-height: 54px; font-size: 17px; }
html[data-skin="e"] .total-row strong, html[data-skin="e"] .cashier-draft-total strong { font-size: 28px; }
html[data-skin="e"] .admin-card, html[data-skin="e"] .master-row { border-color: var(--line); }
html[data-skin="e"] #entityAdminApp .owner-heading .muted, html[data-skin="e"] #entityAdminApp .owner-heading .admin-eyebrow { display: none; }
html[data-skin="e"] #entityAdminApp .owner-heading h1 { font-size: 26px; margin: 0; }
"""),
 'f': dict(title='F · Racik Parfum', note='Untuk toko parfum racikan: kertas gading, tinta plum tua, aksen kuningan, huruf Fraunces (judul) + Manrope (teks/angka). Layar utamanya public/racik.html (Pesanan -> Racik -> Bayar -> Nota); file ini hanya mewarnai halaman lain (Kasir lengkap, Workspace Gerai, Panel Pemilik) supaya senada. Aturan servernya di isRacikChoice (src/tenant-policy.js). DESAIN-SKIN-F-RACIK-PARFUM.md.', tok={
  '--skin-font': '"Manrope", "Segoe UI", system-ui, sans-serif',
  '--bg': '#F6EFE6', '--skin-page-bg': '#F6EFE6', '--surface': '#FFFCF7', '--ink': '#2A1828', '--muted': '#5E4A5A', '--line': '#E6D8CC',
  '--brand': '#6B2D5C', '--brand-2': '#4A1A42', '--green': '#1E6B4E', '--green-soft': '#E1F2EA', '--amber': '#7A4A00',
  '--shadow': '0 10px 30px -18px rgba(74,26,66,.35)', '--skin-card-shadow': '0 1px 0 rgba(74,26,66,.05)',
  '--skin-top-bg': '#4A1A42', '--skin-top-ink': '#FBF3F8', '--skin-top-muted': '#E9D3E2', '--skin-top-line': '#4A1A42',
  '--skin-mark-bg': '#B8894F', '--skin-mark-ink': '#2A1828',
  '--skin-hero-bg': '#4A1A42', '--skin-hero-ink': '#FBF3F8', '--skin-hero-muted': '#E9D3E2',
  '--skin-primary': '#4A1A42', '--skin-primary-ink': '#ffffff', '--skin-active-bg': '#4A1A42', '--skin-active-ink': '#ffffff',
  '--skin-input-bg': '#FFFCF7', '--skin-chip-bg': '#F1E3EC', '--skin-focus': 'rgba(107,45,92,.16)',
  '--skin-danger': '#8E1B2C', '--skin-danger-soft': '#FBE3E6', '--skin-danger-line': '#F0B9C2', '--skin-warn': '#7A4A00', '--skin-warn-soft': '#FCEFD6',
  '--skin-r-sm': '12px', '--skin-r': '16px', '--skin-r-lg': '22px', '--skin-r-pill': '999px'}, extra=r"""
html[data-skin="f"] .brand, html[data-skin="f"] .admin-card h2, html[data-skin="f"] .owner-heading h1, html[data-skin="f"] .hero h1 { font-family: "Fraunces", Georgia, serif; font-style: italic; }
html[data-skin="f"] .primary-btn { min-height: 50px; }
"""),
 'g': dict(title='G · Percetakan', note='Untuk usaha percetakan: tinta biru tua di kertas putih, aksen cyan seperti tinta CMYK, huruf IBM Plex Sans. Layar utamanya public/percetakan.html (chat WA -> order otomatis -> antrian per mesin); file ini hanya mewarnai halaman lain (Kasir lengkap, Workspace Gerai, Panel Pemilik) supaya senada. Saklar fiturnya isPercetakanChoice (src/tenant-policy.js). ADR-055, HANDOFF-PERCETAKAN.md.', tok={
  '--skin-font': '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
  '--bg': '#F3F6F9', '--skin-page-bg': '#F3F6F9', '--surface': '#FFFFFF', '--ink': '#14212E', '--muted': '#4D5B69', '--line': '#D7E0E8',
  '--brand': '#0B6E8A', '--brand-2': '#123B5C', '--green': '#1E6B4E', '--green-soft': '#E1F2EA', '--amber': '#7A4A00',
  '--shadow': '0 10px 30px -18px rgba(18,59,92,.35)', '--skin-card-shadow': '0 1px 0 rgba(18,59,92,.05)',
  '--skin-top-bg': '#123B5C', '--skin-top-ink': '#F2F8FC', '--skin-top-muted': '#C9DCEA', '--skin-top-line': '#123B5C',
  '--skin-mark-bg': '#19B5D6', '--skin-mark-ink': '#0B2236',
  '--skin-hero-bg': '#123B5C', '--skin-hero-ink': '#F2F8FC', '--skin-hero-muted': '#C9DCEA',
  '--skin-primary': '#123B5C', '--skin-primary-ink': '#ffffff', '--skin-active-bg': '#0B6E8A', '--skin-active-ink': '#ffffff',
  '--skin-input-bg': '#FFFFFF', '--skin-chip-bg': '#E2F3F8', '--skin-focus': 'rgba(11,110,138,.18)',
  '--skin-danger': '#9B1C3C', '--skin-danger-soft': '#FCE4EA', '--skin-danger-line': '#F2B6C4', '--skin-warn': '#7A4A00', '--skin-warn-soft': '#FCEFD6',
  '--skin-r-sm': '8px', '--skin-r': '10px', '--skin-r-lg': '14px', '--skin-r-pill': '999px'}, extra=r"""
html[data-skin="g"] .brand, html[data-skin="g"] .admin-card h2, html[data-skin="g"] .owner-heading h1 { font-weight: 700; letter-spacing: -0.01em; }
html[data-skin="g"] .primary-btn { min-height: 48px; }
"""),
}


SKINS['h'] = dict(title='H · Owner Kelola Sendiri', note='Portal Admin Entity dan Kantor khusus H; pantai kuning-turquoise tanpa merek, panel buih biru, tombol laut dan pasir. DESAIN-SKIN-H-OWNER-ADMIN.md.', tok={
  '--h-ocean': '#006B99', '--h-surf': '#00B5DB', '--h-foam': '#E9F8FE', '--h-sand': '#FFD65A', '--h-sand-soft': '#FFF0B8',
  '--skin-font': '"Nunito Sans", "Segoe UI", system-ui, sans-serif',
  '--bg': '#FFE7A1', '--skin-page-bg': '#FFE7A1', '--surface': '#FFFFFF', '--ink': '#153E54', '--muted': '#4A6878', '--line': '#BEDDEB',
  '--brand': '#006B99', '--brand-2': '#006B99', '--green': '#276846', '--green-soft': '#E5F3DD', '--amber': '#7A4A00',
  '--shadow': '0 10px 30px -18px rgba(0,107,153,.18)', '--skin-card-shadow': 'none',
  '--skin-top-bg': '#FFD65A', '--skin-top-ink': '#153E54', '--skin-top-muted': '#4A6878', '--skin-top-line': '#00B5DB',
  '--skin-mark-bg': '#4F792A', '--skin-mark-ink': '#FFFFFF',
  '--skin-hero-bg': '#E9F8FE', '--skin-hero-ink': '#153E54', '--skin-hero-muted': '#4A6878',
  '--skin-primary': '#006B99', '--skin-primary-ink': '#FFFFFF', '--skin-active-bg': '#006B99', '--skin-active-ink': '#FFFFFF',
  '--skin-input-bg': '#FFFFFF', '--skin-chip-bg': '#FFF0B8', '--skin-focus': 'rgba(0,131,175,.20)',
  '--skin-danger': '#A12626', '--skin-danger-soft': '#FFF0F0', '--skin-danger-line': '#EDC5C5', '--skin-warn': '#7A4A00', '--skin-warn-soft': '#FCEFD6',
  '--skin-r-sm': '12px', '--skin-r': '16px', '--skin-r-lg': '24px', '--skin-r-pill': '999px'
}, extra=r"""
html[data-skin="h"] body { font-size:16px; line-height:1.5; background-color:#FFE7A1; background-image:url('/owner-beach-h-v1.png'); background-position:center bottom; background-size:cover; background-repeat:no-repeat; background-attachment:fixed; }
html[data-skin="h"] .topbar { background:var(--skin-top-bg); border-bottom:4px solid var(--h-surf); }
html[data-skin="h"] .primary-btn { background:#006B99; color:#FFFFFF; border-color:#006B99; }
html[data-skin="h"] .secondary-btn, html[data-skin="h"] .mini-btn { background:#FFF0B8; color:#153E54; border-color:#E8C659; }
html[data-skin="h"] .admin-card, html[data-skin="h"] .owner-store-card, html[data-skin="h"] .hero { background:#FFFFFF; }
html[data-skin="h"] .nav-group-btn { background:#FFF0B8; color:#153E54; }
html[data-skin="h"] .nav-group-btn[aria-current="true"] { background:#006B99; color:#FFFFFF; }
html[data-skin="h"] button:focus-visible, html[data-skin="h"] a:focus-visible, html[data-skin="h"] input:focus-visible, html[data-skin="h"] select:focus-visible { outline:3px solid #0083AF; outline-offset:3px; }
@media(prefers-reduced-motion:reduce) { html[data-skin="h"] body { background-attachment:scroll; } }
html[data-skin="h"] .admin-heading { display:none; }
html[data-skin="h"] #tab-approvals.active { display:flex; flex-direction:column; }
html[data-skin="h"] #tab-approvals > .admin-card:first-child { order:9; margin-top:14px; }
html[data-skin="h"] .admin-top-actions > a:not(#cashierReadOnlyLink) { display:none; }
html[data-skin="h"] .nav-groups-main { grid-template-columns:repeat(5,minmax(0,1fr)); gap:4px; }
html[data-skin="h"] .nav-group-btn { border:0; min-height:60px; font-weight:600; font-size:12px; }
html[data-skin="h"] .nav-group-icon { font-family:system-ui; font-size:24px; }
html[data-skin="h"] .primary-btn, html[data-skin="h"] .secondary-btn, html[data-skin="h"] .mini-btn,
html[data-skin="h"] input:not([type="checkbox"]):not([type="hidden"]):not([type="radio"]), html[data-skin="h"] select { min-height:44px; }
html[data-skin="h"] .admin-card h2 { font-size:21px; letter-spacing:-.025em; }
html[data-skin="h"] .th-profit, html[data-skin="h"] .hi-profit { background:#FFFFFF; color:#153E54; border:1px solid #BEDDEB; border-top:3px solid #006B99; border-radius:12px; }
html[data-skin="h"] .hi-profit p em { color:#006B99; }
html[data-skin="h"] .th-profit b.neg, html[data-skin="h"] .hi-profit b.neg { color:#A12626; }
html[data-skin="h"] .hi-refresh { background:#FFF0B8; color:#006B99; border-color:#BEDDEB; min-height:44px; }
html[data-skin="h"] .hi-store a { display:block; color:#006B99; text-decoration:none; padding:8px 0; }
html[data-skin="h"] .hi-store a:focus-visible { outline:3px solid #006B99; outline-offset:3px; }
html[data-skin="h"] #entityAdminApp .owner-heading .muted, html[data-skin="h"] #entityAdminApp .owner-heading .admin-eyebrow { display:none; }
html[data-skin="h"] .h-inline-recipe { border-top:1px solid #BEDDEB; padding-top:16px; margin:16px 0; }
html[data-skin="h"] .h-inline-recipe h3 { margin:0 0 4px; font-size:18px; }
html[data-skin="h"] .h-recipe-row { display:grid; grid-template-columns:minmax(0,1fr) 80px 44px; align-items:end; gap:8px; margin:12px 0; }
html[data-skin="h"] .h-recipe-row label { min-width:0; margin:0; }
html[data-skin="h"] .h-recipe-row select { width:100%; }
html[data-skin="h"] .h-recipe-row button { min-height:44px; padding:8px; }
html[data-skin="h"] .h-recipe-error { color:#A12626; background:#FFF0F0; padding:12px; border-radius:8px; }
html[data-skin="h"] .h-recipe-basic { margin:12px 0; }
html[data-skin="h"] #productRecipeNote { display:none; }
html[data-skin="h"] body:not(:has([data-entity-tab="home"].active)) #hariIni { display:none; }
html[data-skin="h"] #productOperationalDetails summary { cursor:pointer; padding:12px 0; color:#4A6878; }
@media(max-width:600px) {
  html[data-skin="h"] .admin-grid.two { grid-template-columns:minmax(0,1fr); }
  html[data-skin="h"] .admin-top-actions { gap:6px; }
  html[data-skin="h"] .admin-top-actions a, html[data-skin="h"] .admin-top-actions button { font-size:12px; }
  html[data-skin="h"] .nav-group-btn { padding:10px 1px; }
  html[data-skin="h"] .hi-need { flex-wrap:wrap; }
}
/* Ocean components. All overrides leave the page when data-skin changes. */
html[data-skin="h"] :is(h1,h2,h3,h4) { font-weight:800; letter-spacing:-.025em; line-height:1.2; }
html[data-skin="h"] :is(button,.primary-btn,.secondary-btn,.mini-btn,.admin-field,.brand) { font-weight:700; }
html[data-skin="h"] :is(.primary-btn,.secondary-btn,.mini-btn,.drawer-action-btn) { min-height:44px; padding:11px 16px; line-height:1.3; border-radius:var(--skin-r-sm); }
html[data-skin="h"] .primary-btn { border:1px solid var(--h-ocean); box-shadow:0 3px 0 #00567D; }
html[data-skin="h"] :is(.primary-btn,.cashier-add-btn,.add-btn):hover:not(:disabled) { background:#00567D; }
html[data-skin="h"] :is(.secondary-btn,.mini-btn):hover:not(:disabled) { background:#FFE48A; border-color:#CDAA32; }
html[data-skin="h"] :is(.mini-btn.danger,.danger-btn) { color:var(--skin-danger); background:var(--skin-danger-soft); border-color:var(--skin-danger-line); box-shadow:none; }
html[data-skin="h"] :is(.mini-btn.danger,.danger-btn):hover:not(:disabled) { background:#FCE0DE; color:var(--skin-danger); border-color:var(--skin-danger-line); }
html[data-skin="h"] button:disabled { opacity:.55; cursor:not-allowed; box-shadow:none; }
html[data-skin="h"] .topbar .brand { color:var(--ink); }
html[data-skin="h"] .topbar :is(.admin-link,.pill,.cashier-user-chip span) { background:var(--h-foam); color:var(--ink); border-color:transparent; }
html[data-skin="h"] :is(.admin-card,.owner-store-card,.cashier-menu-panel,.cashier-draft-panel,.order-card) { border:1px solid var(--line); border-radius:var(--skin-r-lg); box-shadow:0 4px 0 rgba(0,107,153,.08); }
html[data-skin="h"] :is(.admin-card,.cashier-menu-panel,.cashier-draft-panel) { background:var(--h-foam); }
html[data-skin="h"] :is(.admin-card h2,.cashier-panel-head h2,.owner-store-card h3) { color:var(--h-ocean); }
html[data-skin="h"] :is(.master-row,.cashier-menu-card,.cashier-draft-row,.purchase-composer,.cashier-dialog-summary div) { background:white; border:1px solid var(--line); }
html[data-skin="h"] :is(.master-row:hover,.cashier-menu-card.selected) { background:#F3FCFF; border-color:var(--h-surf); }
html[data-skin="h"] :is(.cashier-menu-name,.master-main strong,.owner-store-card strong) { font-weight:800; }
html[data-skin="h"] :is(.cashier-menu-price,.cashier-draft-total strong,.total-row strong,.stat b) { font-weight:800; font-variant-numeric:tabular-nums; color:var(--h-ocean); }
html[data-skin="h"] :is(.cashier-panel-head,.cashier-draft-total) { border-color:var(--line); }
html[data-skin="h"] :is(.cashier-draft-total,.purchase-detail-subtotal) { background:var(--h-sand-soft); color:var(--ink); border-radius:var(--skin-r-sm); padding:12px; }
html[data-skin="h"] :is(input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]),select,textarea) { background:white; color:var(--ink); border:1px solid #9EC9DB; border-radius:var(--skin-r-sm); padding:11px 12px; font-size:16px; min-width:0; max-width:100%; }
html[data-skin="h"] :is(input,select,textarea):focus { border-color:var(--h-ocean); }
html[data-skin="h"] :is(input[type="checkbox"],input[type="radio"]) { accent-color:var(--h-ocean); }
html[data-skin="h"] :is(.admin-tab,.category-btn,.nav-group-btn) { font-weight:700; }
html[data-skin="h"] .nav-group-btn { border-radius:16px; }
html[data-skin="h"] :is(.admin-tab.active,.category-btn.active,.nav-group-btn[aria-current="true"]) { background:var(--h-ocean); color:white; box-shadow:inset 0 -3px 0 #00567D; }
html[data-skin="h"] :is(.muted,.master-meta) { color:var(--muted); }
html[data-skin="h"] :is(.status-chip,.master-count) { border-radius:999px; font-weight:700; }
html[data-skin="h"] .status-chip.warn { background:var(--h-sand-soft); color:var(--skin-warn); }
html[data-skin="h"] :is(.office-taskbar,.cashier-mode-tabs) { background:var(--h-foam); padding:8px; border:1px solid var(--line); border-radius:18px; }
html[data-skin="h"] .office-taskbar button { min-height:48px; padding:10px 8px; }
html[data-skin="h"] .cashier-add-btn { min-height:44px; font-size:14px; font-weight:700; }
html[data-skin="h"] .cashier-draft-controls button { width:44px; height:44px; border-radius:12px; color:var(--h-ocean); }
html[data-skin="h"] .qty-btn { min-width:44px; min-height:44px; color:var(--h-ocean); border-radius:12px; }
html[data-skin="h"] :is(dialog,.cashier-dialog,#adminDetailModal) { background:#F7FCFF; color:var(--ink); border:2px solid var(--h-surf); border-radius:24px; box-shadow:0 24px 80px rgba(0,54,83,.30); }
html[data-skin="h"] dialog::backdrop { background:rgba(5,48,73,.60); backdrop-filter:blur(3px); }
html[data-skin="h"] #adminDetailModal .admin-detail-modal-head,
html[data-skin="h"] .cashier-dialog-head { background:var(--h-foam); color:var(--h-ocean); border-bottom:3px solid var(--h-sand); border-radius:22px 22px 0 0; }
html[data-skin="h"] :is(dialog h2,dialog h3) { color:var(--h-ocean); }
html[data-skin="h"] :is(.cashier-dialog-actions,.cashier-dialog-footer) { background:var(--h-foam); border-color:var(--line); }
html[data-skin="h"] #adminDetailModal .admin-detail-modal-body { background:#F7FCFF; }
html[data-skin="h"] :is(th,td) { border-color:var(--line); }
html[data-skin="h"] th { background:var(--h-foam); color:var(--ink); }
html[data-skin="h"] .caca-percakapan { background:var(--h-foam); }
html[data-skin="h"] .caca-gelembung.saya { background:var(--h-sand-soft); color:var(--ink); }
html[data-skin="h"] .caca-gelembung.caca { background:white; border:1px solid var(--line); }
html[data-skin="h"] :is(.caca-melayang,.caca-workspace) { border-color:var(--h-surf); border-radius:24px; }
html[data-skin="h"] .caca-saran button { min-height:44px; background:var(--h-sand-soft); color:var(--ink); }
html[data-skin="h"] .h-inline-recipe { background:var(--h-foam); border:1px solid var(--line); border-radius:16px; padding:16px; }
@media(max-width:600px) {
 html[data-skin="h"] :is(.admin-card,.cashier-menu-panel,.cashier-draft-panel) { padding:14px; border-radius:20px; }
 html[data-skin="h"] :is(.primary-btn,.secondary-btn,.mini-btn) { padding:11px 12px; }
 html[data-skin="h"] .office-taskbar button { font-size:13px; padding:10px 4px; }
}
""")

# I deliberately avoids COMMON: that template also changes typography,
# button spacing, hero decorations and responsive header layout.
PAINT_ONLY = r"""
html[data-skin="{s}"] {{
{tokens}
}}
"""
SKINS['i'] = dict(title='I - Pantai Klasik', note='Tema pantai H dengan layout, ukuran, font, menu dan aturan skin 0. DESAIN-SKIN-I-PANTAI-KLASIK.md.', base=PAINT_ONLY, tok={
 '--bg':'#FFE7A1', '--surface':'#FFFFFF', '--ink':'#153E54', '--muted':'#4A6878', '--line':'#BEDDEB',
 '--brand':'#006B99', '--brand-2':'#006B99', '--green':'#276846', '--green-soft':'#E5F3DD', '--amber':'#7A4A00',
 '--shadow':'0 14px 34px rgba(0,107,153,.10)',
 '--i-ocean':'#006B99', '--i-surf':'#00B5DB', '--i-foam':'#E9F8FE', '--i-sand':'#FFD65A', '--i-sand-soft':'#FFF0B8',
 '--i-danger':'#A12626', '--i-danger-soft':'#FFF0F0'
}, extra=r"""
html[data-skin="i"] body { background-color:var(--bg); background-image:url('/owner-beach-h-v1.png'); background-position:center bottom; background-size:cover; background-repeat:no-repeat; background-attachment:fixed; color:var(--ink); }
html[data-skin="i"] .topbar { background:var(--i-sand); color:var(--ink); border-color:var(--i-surf); box-shadow:inset 0 -3px 0 var(--i-surf); }
html[data-skin="i"] .brand { color:var(--ink); }
html[data-skin="i"] .brand small { color:var(--muted); }
html[data-skin="i"] .brand-mark { background:#4F792A; color:white; box-shadow:none; }
html[data-skin="i"] :is(.primary-btn,.cashier-add-btn,.add-btn,.menu-stepper-plus) { background:var(--i-ocean); color:white; border-color:var(--i-ocean); box-shadow:0 3px 0 #00567D; }
html[data-skin="i"] :is(.primary-btn,.secondary-btn,.mini-btn,.drawer-action-btn) { border-radius:12px; }
html[data-skin="i"] :is(.secondary-btn,.mini-btn,.drawer-action-btn,.hi-refresh) { background:var(--i-sand-soft); color:var(--ink); border-color:#E8C659; }
html[data-skin="i"] :is(.primary-btn,.cashier-add-btn,.add-btn):hover:not(:disabled) { background:#00567D; }
html[data-skin="i"] :is(.secondary-btn,.mini-btn):hover:not(:disabled) { background:#FFE48A; }
html[data-skin="i"] :is(.mini-btn.danger,.danger-btn) { background:var(--i-danger-soft); color:var(--i-danger); border-color:#EDC5C5; box-shadow:none; }
html[data-skin="i"] :is(.mini-btn.danger,.danger-btn):hover:not(:disabled) { background:#FCE0DE; color:var(--i-danger); }
html[data-skin="i"] :is(.admin-tab,.category-btn,.category-group-btn) { background:white; color:var(--i-ocean); border-color:var(--line); }
html[data-skin="i"] :is(.admin-tab.active,.category-btn.active,.category-group-btn.active) { background:var(--i-ocean); color:white; border-color:var(--i-ocean); }
html[data-skin="i"] :is(.admin-card,.admin-auth-card,.cashier-menu-panel,.cashier-draft-panel,.drawer-command-card,.hero,.cart-panel,.column,.status-card,.stat) { background:var(--i-foam); border-color:var(--line); box-shadow:0 4px 0 rgba(0,107,153,.08); }
html[data-skin="i"] .hero { color:var(--ink); }
html[data-skin="i"] .hero p { color:var(--muted); }
html[data-skin="i"] .hero::after { background:rgba(0,181,219,.12); }
html[data-skin="i"] :is(.owner-store-card,.order-card,.menu-card,.cashier-menu-card,.cashier-draft-row,.master-row,.cart-item,.purchase-composer,.cashier-dialog-summary div,.purchase-detail-list,.purchase-search-results) { background:white; border-color:var(--line); }
html[data-skin="i"] :is(.master-row:hover,.cashier-menu-card.selected,.menu-card.selected) { background:#F3FCFF; border-color:var(--i-surf); }
html[data-skin="i"] :is(.admin-card h2,.cashier-panel-head h2,.owner-store-card h3,.cashier-menu-price,.cashier-draft-total strong,.total-row strong,.price) { color:var(--i-ocean); }
html[data-skin="i"] :is(.note-input,.text-input,textarea,.admin-field input,.admin-field select,.admin-field textarea,.qty-btn,.menu-stepper,.menu-stepper-btn,.cart-close-btn) { background:white; color:var(--ink); border-color:#9EC9DB; }
html[data-skin="i"] :is(.note-input,.text-input,textarea,.admin-field input,.admin-field select):focus { border-color:var(--i-ocean); box-shadow:0 0 0 3px rgba(0,131,175,.20); }
html[data-skin="i"] :is(input[type="checkbox"],input[type="radio"]) { accent-color:var(--i-ocean); }
html[data-skin="i"] :is(.pill,.admin-link,.cashier-user-chip span,.selected-badge,.menu-card .category,.owner-store-code,.image-preview-wrap,.master-thumb,.cashier-menu-image) { background:var(--i-sand-soft); color:var(--ink); border-color:var(--line); }
html[data-skin="i"] :is(.badge,.master-count,.admin-toast,.cart-handle-count,.progress-step.active) { background:var(--i-ocean); color:white; }
html[data-skin="i"] :is(.cashier-draft-total,.purchase-detail-subtotal) { background:var(--i-sand-soft); color:var(--ink); border-color:var(--line); }
html[data-skin="i"] :is(dialog,.cashier-dialog,#adminDetailModal,.photo-modal-card) { background:#F7FCFF; color:var(--ink); border-color:var(--i-surf); box-shadow:inset 0 0 0 2px var(--i-surf),0 24px 80px rgba(0,54,83,.30); }
html[data-skin="i"] dialog::backdrop { background:rgba(5,48,73,.60); }
html[data-skin="i"] .photo-modal-backdrop { background:rgba(5,48,73,.60); }
html[data-skin="i"] #adminDetailModal .admin-detail-modal-head,
html[data-skin="i"] .cashier-dialog-head { background:var(--i-foam); color:var(--i-ocean); border-color:var(--i-sand); }
html[data-skin="i"] :is(dialog h2,dialog h3) { color:var(--i-ocean); }
html[data-skin="i"] :is(.cashier-dialog-actions,.cashier-dialog-footer) { background:var(--i-foam); border-color:var(--line); }
html[data-skin="i"] #adminDetailModal .admin-detail-modal-body { background:#F7FCFF; }
html[data-skin="i"] :is(th,td) { border-color:var(--line); }
html[data-skin="i"] th { background:var(--i-foam); color:var(--ink); }
html[data-skin="i"] .caca-percakapan { background:var(--i-foam); }
html[data-skin="i"] .caca-gelembung.saya { background:var(--i-sand-soft); color:var(--ink); }
html[data-skin="i"] .caca-gelembung.caca { background:white; border-color:var(--line); }
html[data-skin="i"] :is(.caca-melayang,.caca-workspace) { border-color:var(--i-surf); }
html[data-skin="i"] .caca-saran button { background:var(--i-sand-soft); color:var(--ink); }
""")

import sys
out = sys.argv[1]
for s, d in SKINS.items():
    if len(sys.argv) > 2 and s != sys.argv[2]: continue
    css = f"/* Skin {d['title']} -- pilihan tenant ui_skin = {s.upper()} (src/tenant-policy.js).\n   {d['note']}\n   Hanya berlaku saat <html data-skin=\"{s}\"> (dipasang public/ui-skin.js); tenant dengan pilihan 0 tidak memuat file ini.\n   Dibangkitkan dari satu kerangka yang sama untuk A/B/C supaya ketiganya menimpa komponen yang sama -- ubah tokennya, bukan selektornya. */\n"
    if s == 'i':
        css = css.replace('Dibangkitkan dari satu kerangka yang sama untuk A/B/C supaya ketiganya menimpa komponen yang sama -- ubah tokennya, bukan selektornya.', 'Dibangkitkan dari PAINT_ONLY; pertahankan ukuran, font, struktur dan perilaku halaman klasik.')
    css += d.get('base', COMMON).format(s=s, tokens=tokens(d['tok'])) + d['extra']
    open(f"{out}/skin-{s}.css", "w", encoding="utf-8").write(css)
print("ok")
