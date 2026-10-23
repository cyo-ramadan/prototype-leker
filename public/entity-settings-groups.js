(() => {
  // Bos Cyo, 2026-10-24: "untuk sekarang pengaturan apapun harus scrol sampe kebawah, bikin aja
  // subtombol pengaturan berdasarkan apa yang diatur, misal tombol pengaturan chat agent, terus
  // dalemnya apa aja. pengaturan gerai dsb." -- Pengaturan Entity Admin dibagi per kelompok
  // (data-settings-group di entity-admin.html). Hanya menyembunyikan/menampilkan wadah; isi tiap
  // kartu tetap diurus modulnya masing-masing. Kelompok baru: tambah wadah + satu baris GROUPS.
  const GROUPS = [
    { id: 'notifikasi', label: '🔔 Notifikasi & Beranda', note: 'Alarm otomatis untuk admin dan isi Beranda Saya.' },
    { id: 'asisten', label: '💬 Asisten Chat', note: 'Nama dan saklar Una, Rika, Fina; suara dan obrolan live.' },
    { id: 'karyawan', label: '👥 Karyawan & HR', note: 'Dana Apresiasi & Denda, aturan HR Fina, surat, dan rekrutmen.' },
    { id: 'sambungan', label: '🔗 Sambungan & WA', note: 'Sambungan WA/email Fina dan kotak masuk WA.' },
    { id: 'gerai', label: '🏪 Pengaturan Gerai', note: 'Pengaturan yang berlaku per gerai: Tugas Harian & Buka Laci, profil toko.' }
  ];
  const KEY = 'lekerEntitySettingsGroup';
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const remembered = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  const remember = id => { try { localStorage.setItem(KEY, id); } catch {} };
  let current = '';

  function renderGerai() {
    const host = el('entitySettingsGerai');
    if (!host) return;
    const stores = (typeof entityAdminState !== 'undefined' && entityAdminState.stores) || [];
    host.innerHTML = `<h2>Pengaturan per gerai</h2>
      <p class="muted">Tiap gerai punya pengaturannya sendiri. Tombol di bawah membuka Workspace Gerai langsung di bagian yang diatur.</p>
      ${stores.length ? `<div class="master-list">${stores.map(store => `
        <div class="master-row ${store.isActive === false ? 'inactive' : ''}">
          <div class="master-main"><strong>${esc(store.code)} · ${esc(store.storeName || '')}</strong>${store.isActive === false ? '<div class="master-meta">Nonaktif</div>' : ''}</div>
          <div class="master-actions">
            <a class="mini-btn" href="/s/${encodeURIComponent(store.code)}/admin#tab=daily-task">⚙ Tugas Harian &amp; Buka Laci</a>
            <a class="mini-btn" href="/s/${encodeURIComponent(store.code)}/admin#tab=store">Profil Toko</a>
          </div>
        </div>`).join('')}</div>` : '<div class="empty">Belum ada gerai di entity ini.</div>'}`;
  }

  function show(id) {
    const group = GROUPS.find(item => item.id === id) || GROUPS[0];
    current = group.id;
    remember(group.id);
    document.querySelectorAll('[data-settings-group]').forEach(node => { node.hidden = node.dataset.settingsGroup !== group.id; });
    el('entitySettingsGroupNav')?.querySelectorAll('[data-settings-group-btn]').forEach(button => {
      const active = button.dataset.settingsGroupBtn === group.id;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const note = el('entitySettingsGroupNote');
    if (note) note.textContent = group.note;
    if (group.id === 'gerai') renderGerai();
  }

  function mount() {
    const nav = el('entitySettingsGroupNav');
    if (!nav || nav.dataset.mounted === '1') return;
    nav.dataset.mounted = '1';
    if (!el('entitySettingsGroupStyle')) {
      document.head.insertAdjacentHTML('beforeend', `<style id="entitySettingsGroupStyle">
        .entity-settings-groups{position:sticky;top:0;z-index:5;background:var(--paper,#fffaf4);padding:8px 0;margin-bottom:12px}
        .entity-settings-groups .secondary-btn.active{background:var(--brand);border-color:var(--brand);color:var(--paper,#fff)}
        @media(max-width:720px){.entity-settings-groups{flex-wrap:nowrap;overflow-x:auto}.entity-settings-groups .secondary-btn{flex:0 0 auto}}
      </style>`);
    }
    nav.innerHTML = GROUPS.map(group => `<button class="secondary-btn" type="button" data-settings-group-btn="${group.id}" aria-pressed="false">${esc(group.label)}</button>`).join('')
      + '<p id="entitySettingsGroupNote" class="muted" style="flex-basis:100%;margin:4px 0 0"></p>';
    nav.addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest('[data-settings-group-btn]') : null;
      if (button) show(button.dataset.settingsGroupBtn);
    });
    // Tombol "Atur Beranda" di Beranda membuka pane Beranda -- pastikan kelompoknya ikut tampil.
    el('entityHomeSettings')?.addEventListener('click', () => show('notifikasi'));
    show(remembered());
  }

  window.EntitySettingsGroups = { show };
  window.addEventListener('entity-admin-tab', event => { if (event.detail?.name === 'settings') { mount(); if (current === 'gerai') renderGerai(); } });
  window.addEventListener('entity-admin-ready', () => { mount(); if (current === 'gerai') renderGerai(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
