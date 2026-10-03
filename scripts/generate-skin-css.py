# Pembangkit public/skin-{a,b,c,d,e}.css dari satu kerangka selektor (HANDOFF-UIUX-SIAP-JUAL.md §8).
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
 'd': dict(title='D · Mode Warung', note='Untuk kelontong/UMKM kecil: huruf besar (Figtree), tombol jempol, biru warung + kuning penanda, kontras tinggi untuk teras yang terang. Cara pakai barunya ada di warung.html dan warung-pemilik.js.', tok={
  '--skin-font': '"Figtree", "Segoe UI", system-ui, sans-serif',
  '--bg': '#f5f6f8', '--skin-page-bg': '#f5f6f8', '--surface': '#ffffff', '--ink': '#111827', '--muted': '#4b5563', '--line': '#dfe3ea',
  '--brand': '#1446c8', '--brand-2': '#0f2f86', '--green': '#0f8a4b', '--green-soft': '#ddf5e7', '--amber': '#b45309',
  '--shadow': '0 6px 18px rgba(17,24,39,.08)', '--skin-card-shadow': '0 1px 2px rgba(17,24,39,.06)',
  '--skin-top-bg': '#1446c8', '--skin-top-ink': '#ffffff', '--skin-top-muted': '#c9d6ff', '--skin-top-line': '#1446c8',
  '--skin-mark-bg': '#ffc929', '--skin-mark-ink': '#111827',
  '--skin-hero-bg': '#1446c8', '--skin-hero-ink': '#ffffff', '--skin-hero-muted': '#d6e0ff',
  '--skin-primary': '#1446c8', '--skin-primary-ink': '#ffffff', '--skin-active-bg': '#111827', '--skin-active-ink': '#ffffff',
  '--skin-input-bg': '#ffffff', '--skin-chip-bg': '#fff3c4', '--skin-focus': 'rgba(20,70,200,.20)',
  '--skin-danger': '#c81e1e', '--skin-danger-soft': '#fde8e8', '--skin-danger-line': '#f5b5b5', '--skin-warn': '#92400e', '--skin-warn-soft': '#fef3c7',
  '--skin-r-sm': '12px', '--skin-r': '14px', '--skin-r-lg': '18px', '--skin-r-pill': '999px'}, extra=r"""
html[data-skin="d"] body { font-size: 16.5px; }
html[data-skin="d"] .brand { font-weight: 900; }
html[data-skin="d"] .admin-link, html[data-skin="d"] .topbar .pill, html[data-skin="d"] .topbar .secondary-btn, html[data-skin="d"] .topbar .mini-btn {
  background: rgba(255,255,255,.14); color: #ffffff; border-color: rgba(255,255,255,.3);
}
html[data-skin="d"] .primary-btn { min-height: 54px; font-size: 17px; }
html[data-skin="d"] .total-row strong, html[data-skin="d"] .cashier-draft-total strong { font-size: 28px; }
/* Mode Warung: angka untung (warung-pemilik.js) langsung di atas, tanpa kalimat teknis. */
html[data-skin="d"] #entityAdminApp .owner-heading .muted, html[data-skin="d"] #entityAdminApp .owner-heading .admin-eyebrow { display: none; }
html[data-skin="d"] #entityAdminApp .owner-heading h1 { font-size: 26px; margin: 0; }
"""),
 'e': dict(title='E · Jaga Sendiri', note='Untuk warung TANPA karyawan (pemilik = kasir = admin): pastel lembut untuk permukaan, teks/angka gelap (kontras >= 7:1), tombol hijau tua. Cara pakai barunya (Buka/Tutup warung, tab Untung) ada di warung.html; aturan servernya di isOwnerOperatedChoice (src/tenant-policy.js). DESAIN-SKIN-E-JAGA-SENDIRI.md.', tok={
  '--skin-font': '"Nunito", "Figtree", "Segoe UI", system-ui, sans-serif',
  '--bg': '#FFF8EF', '--skin-page-bg': '#FFF8EF', '--surface': '#ffffff', '--ink': '#1F2328', '--muted': '#57534E', '--line': '#F0E2D3',
  '--brand': '#0A5A48', '--brand-2': '#075A30', '--green': '#075A30', '--green-soft': '#D9F2E6', '--amber': '#6A4000',
  '--shadow': '0 6px 18px rgba(31,35,40,.06)', '--skin-card-shadow': 'none',
  '--skin-top-bg': '#FFD8C2', '--skin-top-ink': '#1F2328', '--skin-top-muted': '#3a3632', '--skin-top-line': '#F5C9AE',
  '--skin-mark-bg': '#0A5A48', '--skin-mark-ink': '#ffffff',
  '--skin-hero-bg': '#D9F2E6', '--skin-hero-ink': '#1F2328', '--skin-hero-muted': '#3a3632',
  '--skin-primary': '#0A5A48', '--skin-primary-ink': '#ffffff', '--skin-active-bg': '#0A5A48', '--skin-active-ink': '#ffffff',
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
}

import sys
out = sys.argv[1]
for s, d in SKINS.items():
    css = f"/* Skin {d['title']} -- pilihan tenant ui_skin = {s.upper()} (src/tenant-policy.js).\n   {d['note']}\n   Hanya berlaku saat <html data-skin=\"{s}\"> (dipasang public/ui-skin.js); tenant dengan pilihan 0 tidak memuat file ini.\n   Dibangkitkan dari satu kerangka yang sama untuk A/B/C supaya ketiganya menimpa komponen yang sama -- ubah tokennya, bukan selektornya. */\n"
    css += COMMON.format(s=s, tokens=tokens(d['tok'])) + d['extra']
    open(f"{out}/skin-{s}.css", "w").write(css)
print("ok")
