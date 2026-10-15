/* Entity rules are administrator-owned; home and sound preferences belong to each account. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const make = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  const pinTabs = { profit: 'reports', setoran: 'setorancs', drawerstatus: 'drawerstatus', stores: 'stores', customers: 'customers', ledger: 'ledger', sharedaccounts: 'sharedaccounts', productmasters: 'productmasters', entityrecipes: 'entityrecipes', entitystock: 'entitystock', storereport: 'storereport', employees: 'employees' };
  const pins = { profit: 'Laporan', setoran: 'Setoran CS', drawerstatus: 'Status Laci', stores: 'Gerai', customers: 'Pelanggan', ledger: 'Buku Entity', sharedaccounts: 'Rekening Bersama', productmasters: 'Master Barang', entityrecipes: 'Resep Produksi', entitystock: 'Stok Gerai', storereport: 'Laporan Gerai', employees: 'Karyawan' };
  const pages = { home: 'Beranda Saya (Rekomendasi Codex: langsung ke menu yang dipin)', stores: 'Gerai', customers: 'Pelanggan', ledger: 'Buku Entity', sharedaccounts: 'Rekening Bersama', setorancs: 'Setoran CS', izincs: 'Izin CS', productmasters: 'Master Barang', entityrecipes: 'Resep Produksi', entitystock: 'Stok Gerai', storereport: 'Laporan Gerai', drawerstatus: 'Status Laci', employees: 'Karyawan', reports: 'Laporan' };
  const state = { snapshot: null, loaded: false, rules: [], catalog: null, recipients: [], initialized: false, editing: null, moved: [], homeActive: false, homeLayoutKey: null };
  const api = (path, options) => entityAdminApi('/api/notifications' + path, options);
  const message = text => { $('entityManagementStatus').textContent = text; };
  const button = (text, handler, cls = 'mini-btn') => { const b = make('button', text, cls); b.type = 'button'; b.onclick = handler; return b; };
  function field(text, input) { const label = make('label', text, 'admin-field'); label.append(input); return label; }
  function input(type, value = '') { const n = make('input'); n.type = type; n.value = value; return n; }
  function select(options, value) { const n = make('select'); for (const [key, text] of options) { const opt = make('option', text); opt.value = key; n.append(opt); } n.value = value; return n; }
  function check(text, value, checked, name) { const label = make('label'); const n = input('checkbox', value); n.checked = checked; if (name) n.name = name; label.append(n, make('span', text)); return label; }
  function checked(form, name) { return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(n => n.value); }
  function choices(title, rows, selected, name) { const box = make('fieldset', null, 'management-select-list'); box.append(make('legend', title)); for (const row of rows) box.append(check(row.label, row.key, selected.includes(row.key), name)); if (!rows.length) box.append(make('p', 'Belum ada pilihan yang tersedia.', 'muted')); return box; }
  function selectedPins() { return [...new Set(state.snapshot?.preferences?.homePins || [])].filter(id => pinTabs[id] && $('entityTab-' + pinTabs[id])); }
  function restorePanels() {
    for (const entry of state.moved) {
      window.UnaMount.detach(entry.key, entry.host);
    }
    state.moved = []; state.homeLayoutKey = null;
  }
  function movePanel(tab, host) {
    const source = $('entityTab-' + tab); if (!source) return false;
    const key='entity:'+tab; state.moved.push({key,host});
    window.UnaMount.claim(key,host,'pin');
    return true;
  }
  function refreshPinnedViews() {
    if (!state.homeActive) return;
    for (const id of selectedPins()) {
      if(window.UnaMount.owner('entity:'+pinTabs[id])==='workspace')continue;
      Promise.resolve(window.loadEntityTabContent?.(pinTabs[id], { autoReport: id === 'profit' })).catch(error => entityAdminToast(error.message));
    }
  }
  async function savePrefs(patch) {
    try { await window.MaxiNotifications.setPreferences(patch); message('Pengaturan akun tersimpan.'); }
    catch (e) { message(e.message); }
  }
  function renderPreferences() {
    const host = $('entityHomePreferences'); host.replaceChildren();
    if (!state.snapshot) { host.append(make('p', 'Pengaturan akun belum tersedia. Muat ulang untuk mencoba lagi.', 'muted')); return; }
    host.append(make('p', 'Pin mengambil tampilan dari menu yang sudah ada, lengkap dengan tombol dan filter yang sama. Susunan dan halaman pertama disimpan khusus untuk akun Anda. Rekomendasi Codex: pin menu yang paling sering diperiksa agar langsung terbuka setelah login.', 'muted'));
    const start = select(Object.entries(pages), state.snapshot.preferences?.startTab || 'home');
    host.append(field('Halaman pertama setelah login', start), button('Simpan halaman pertama', () => savePrefs({ startTab: start.value }), 'secondary-btn'));
    host.append(make('h3', 'Tampilan yang dipin'));
    const list = selectedPins();
    for (const [index, id] of list.entries()) {
      const row = make('div', null, 'management-pin-row'); row.append(make('strong', pins[id]));
      const actions = make('div', null, 'management-actions');
      const up = button('Naik', () => { const next = [...list]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; void savePrefs({ homePins: next }); }); up.disabled = index === 0;
      const down = button('Turun', () => { const next = [...list]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; void savePrefs({ homePins: next }); }); down.disabled = index === list.length - 1;
      actions.append(up, down, button('Lepas pin', () => savePrefs({ homePins: list.filter(p => p !== id) }))); row.append(actions); host.append(row);
    }
    if (!list.length) host.append(make('p', 'Belum ada pin. Pilih tampilan di bawah.', 'muted'));
    const available = Object.entries(pins).filter(([id]) => !list.includes(id));
    if (available.length) { const pick = select(available, available[0][0]); host.append(field('Tambah tampilan', pick), button('Pin ke beranda', () => savePrefs({ homePins: [...list, pick.value] }), 'secondary-btn')); }
    host.append(make('h3', 'Bunyi dan notifikasi HP'), make('p', 'Aturan dan penerima alarm ditentukan Admin Entity. Akun Anda menentukan bunyi dan tampilan sendiri. Notifikasi di layar terkunci hanya menyebut ada pemberitahuan, tanpa nominal uang.', 'muted'));
    const actions = make('div', null, 'management-actions');
    actions.append(button('Atur bunyi di tombol Notifikasi', () => document.querySelector('.notifications-widget > button')?.click()), button('Aktifkan notifikasi HP (Rekomendasi Codex: tetap terima saat aplikasi ditutup)', () => window.MaxiNotifications.enablePush()), button('Matikan notifikasi HP', () => window.MaxiNotifications.disablePush())); host.append(actions);
    host.append(make('p', 'iPhone/iPad: tambahkan aplikasi ke Layar Utama dari Safari, lalu buka dari ikon aplikasi. Bunyi saat aplikasi ditutup mengikuti pengaturan HP.', 'muted'));
  }
  function renderHome() {
    if (!state.homeActive) return;
    restorePanels(); const host = $('entityHomePins'); if (!host) return;
    host.replaceChildren(); const list = selectedPins();
    state.homeLayoutKey = JSON.stringify(list);
    if (!state.snapshot) { host.append(make('div', 'Beranda belum dapat dimuat. Tekan Muat ulang untuk mencoba lagi.', 'admin-card management-home-empty')); return; }
    if (!list.length) {
      const empty = make('div', null, 'admin-card management-home-empty');
      empty.append(make('h2', 'Pin menu ke beranda'), make('p', 'Pilih menu yang sudah ada, misalnya Laporan atau Setoran CS. Beranda menampilkan panel yang sama beserta seluruh tombol dan filter aslinya.', 'muted'), button('Pilih menu (Rekomendasi Codex: pekerjaan rutin langsung terlihat)', () => { switchEntityTab('settings'); showSettingsPane('home'); }, 'primary-btn')); host.append(empty); return;
    }
    for (const id of list) {
      const section = make('section', null, 'management-wide'); section.setAttribute('aria-label', 'Pin dari menu ' + pins[id]);
      host.append(section); movePanel(pinTabs[id], section);
    }
    refreshPinnedViews();
  }
  function renderRules() {
    const list = $('entityAlarmRules'); list.replaceChildren();
    if (!state.rules.length) { list.append(make('div', 'Belum ada alarm khusus. Buat aturan sendiri; tidak ada alarm bawaan yang otomatis diaktifkan.', 'empty')); return; }
    for (const rule of state.rules) {
      const row = make('article', null, 'master-row management-rule-row'); const condition = state.catalog?.conditions?.find(c => c.id === rule.condition);
      row.append(make('strong', rule.title), make('p', `${condition?.label || rule.condition} · ${rule.time} WIB · ${rule.enabled ? 'Aktif' : 'Nonaktif'}`, 'muted'));
      const recipientLabels = (rule.recipients || []).map(key => state.recipients.find(r => r.key === key)?.label || key);
      row.append(make('p', 'Penerima: ' + recipientLabels.join(', '), 'muted'));
      const actions = make('div', null, 'management-actions'); actions.append(button('Edit aturan', () => ruleForm(rule)), button(rule.enabled ? 'Nonaktifkan' : 'Aktifkan', async () => { try { await api('/rules/' + encodeURIComponent(rule.id), { method: 'PATCH', body: JSON.stringify({ enabled: !rule.enabled }) }); await loadSettings(); } catch (e) { message(e.message); } })); row.append(actions); list.append(row);
    }
  }
  function ruleForm(rule = null) {
    state.editing = rule?.id || null; const host = $('entityAlarmEditor'); host.replaceChildren();
    if (!state.catalog?.conditions?.length) { host.append(make('p', 'Pilihan alarm belum tersedia dari server.', 'muted')); return; }
    const form = make('form', null, 'admin-card management-settings-form'); form.append(make('h3', rule ? 'Edit alarm khusus' : 'Buat alarm khusus'));
    const title = input('text', rule?.title || ''); title.required = true; title.maxLength = 120;
    const condition = select(state.catalog.conditions.map(c => [c.id, c.label]), rule?.condition || state.catalog.conditions[0].id);
    const description = make('p', '', 'muted'); const explain = () => { description.textContent = state.catalog.conditions.find(c => c.id === condition.value)?.description || ''; }; condition.onchange = explain; explain();
    const time = input('time', rule?.time || '09:30'); time.required = true;
    const repeat = select([['0', 'Sekali sehari (Rekomendasi Codex: menghindari alarm berulang)'], ['15', 'Ulang setiap 15 menit'], ['30', 'Ulang setiap 30 menit'], ['60', 'Ulang setiap 60 menit']], String(rule?.repeatMinutes || 0));
    const msg = make('textarea'); msg.value = rule?.message || ''; msg.maxLength = 500; msg.rows = 3;
    form.append(field('Nama alarm', title), field('Kondisi pemicu', condition), description, field('Jam pemeriksaan (WIB / Jakarta)', time), field('Pengulangan selama kondisi belum selesai', repeat));
    const days = make('fieldset', null, 'management-select-list'); days.append(make('legend', 'Hari aktif (minimal satu)'));
    ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'].forEach((day, i) => days.append(check(day, String(i), (rule?.days || [1, 2, 3, 4, 5, 6, 0]).includes(i), 'days'))); form.append(days);
    form.append(choices('Gerai yang diperiksa (pilih minimal satu untuk kondisi gerai)', entityAdminState.stores.map(s => ({ key: s.id, label: `${s.code} · ${s.storeName}` })), rule?.storeIds || [], 'storeIds'));
    form.append(choices('Penerima notifikasi (minimal satu)', state.recipients.map(r => ({ key: r.key, label: `${r.label} · ${r.role}` })), rule?.recipients || [], 'recipients'), field('Pesan pengingat', msg));
    const enabled = check('Alarm aktif', '1', rule ? !!rule.enabled : true); form.append(enabled);
    const submit = make('button', rule ? 'Simpan perubahan' : 'Buat alarm', 'primary-btn'); submit.type = 'submit'; const actions = make('div', null, 'management-actions'); actions.append(submit, button('Batal', () => { host.replaceChildren(); state.editing = null; })); form.append(actions);
    form.onsubmit = async event => {
      event.preventDefault();
      const values = { title: title.value.trim(), condition: condition.value, time: time.value, days: checked(form, 'days').map(Number), storeIds: checked(form, 'storeIds'), recipients: checked(form, 'recipients'), repeatMinutes: Number(repeat.value), enabled: enabled.querySelector('input').checked, message: msg.value.trim() };
      if (!values.days.length || !values.recipients.length) return message('Pilih minimal satu hari dan satu penerima.');
      if (values.condition !== 'REMINDER' && !values.storeIds.length) return message('Pilih gerai yang diperiksa.');
      submit.disabled = true;
      try { await api('/rules' + (rule ? '/' + encodeURIComponent(rule.id) : ''), { method: rule ? 'PATCH' : 'POST', body: JSON.stringify(values) }); host.replaceChildren(); state.editing = null; await loadSettings(); message('Aturan alarm tersimpan.'); }
      catch (e) { message(e.message); } finally { submit.disabled = false; }
    };
    host.append(form); title.focus();
  }
  async function loadSettings() {
    renderPreferences(); const allowed = state.snapshot?.capabilities?.canManageRules;
    $('entityAlarmAdmin').hidden = !allowed; $('entityAlarmDenied').hidden = !!allowed;
    if (!allowed) return;
    message('Memuat aturan alarm…');
    try {
      const [catalog, recipients, rules] = await Promise.all([api('/catalog'), api('/recipients'), api('/rules')]);
      state.catalog = catalog; state.recipients = recipients.recipients || []; state.rules = rules.rules || []; renderRules(); message('');
    } catch (e) { message('Aturan belum dapat dimuat: ' + e.message); }
  }
  function showSettingsPane(name) {
    $('entitySettingsAlarm').hidden = name !== 'alarm'; $('entitySettingsHome').hidden = name !== 'home';
    document.querySelectorAll('[data-management-pane]').forEach(b => { b.classList.toggle('active', b.dataset.managementPane === name); b.setAttribute('aria-pressed', String(b.dataset.managementPane === name)); });
  }
  function mount() {
    if (state.loaded) return; state.loaded = true;
    $('entityManagementSettingsBtn').onclick = () => switchEntityTab('settings');
    $('entityHomeSettings').onclick = () => { switchEntityTab('settings'); showSettingsPane('home'); };
    $('entityHomeRefresh').onclick = async () => { await window.MaxiNotifications.refresh(); };
    $('entityNewAlarm').onclick = () => ruleForm();
    $('entitySettingsRefresh').onclick = loadSettings;
    document.querySelectorAll('[data-management-pane]').forEach(b => b.onclick = () => showSettingsPane(b.dataset.managementPane));
  }
  async function init() {
    mount();
    await window.MaxiNotifications.init({ getToken: () => entityAdminState.token, onChange: snapshot => {
      state.snapshot = snapshot;
      if (!state.initialized) { state.initialized = true; const target = snapshot.preferences?.startTab; switchEntityTab(pages[target] ? target : 'home'); }
      else if (state.homeActive) { if (state.homeLayoutKey !== JSON.stringify(selectedPins())) renderHome(); else refreshPinnedViews(); }
      if ($('entityTab-settings').classList.contains('active')) renderPreferences();
    } });
    $('entityManagementSettingsBtn').classList.remove('hidden');
  }
  function onTab(name) {
    state.homeActive = name === 'home';
    if (!state.homeActive) restorePanels();
    if (state.homeActive) renderHome();
    if (name === 'settings') void loadSettings();
  }
  async function destroy() { state.homeActive = false; state.snapshot = null; state.initialized = false; restorePanels(); $('entityHomePins')?.replaceChildren(); $('entityAlarmEditor')?.replaceChildren(); $('entityManagementSettingsBtn')?.classList.add('hidden'); await window.MaxiNotifications.destroy({ revokePush: true }); }
  window.EntityManagement = { init, onTab, destroy };
})();
