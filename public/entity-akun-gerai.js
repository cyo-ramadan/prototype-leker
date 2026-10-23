// Entity Admin -> Karyawan -> tombol "Kelola akun" (Bos Cyo, 2026-10-23). Akun kasir per gerai, dikartukan
// seperti daftar karyawan, plus "peta akun" tiap gerai: baris jam 1-24 x kolom hari (satu kolom kecil per
// akun aktif berjadwal) dan "gerai aktif" (berapa akun menutup jam itu). Gunanya mengecek apakah masih ada
// akun aktif yang tersisa di suatu gerai -- yang ikut dibaca Dana Apresiasi. Data dari
// /api/entity-admin/akun-gerai, dimuat saat tombol ditekan (tanpa polling, invariant #6).
(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const api = (path, options) => entityAdminApi(`/api/entity-admin/akun-gerai${path}`, options);
  const toast = message => entityAdminToast(message);
  // Urutan kolom Senin..Minggu; day_of_week mengikuti getUTCDay (0 = Minggu).
  const HARI = [[1, 'Sen'], [2, 'Sel'], [3, 'Rab'], [4, 'Kam'], [5, 'Jum'], [6, 'Sab'], [0, 'Min']];
  const WARNA = 8;
  const tanggalJam = value => {
    if (!value) return '';
    const raw = String(value);
    const date = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(date)
      : raw;
  };
  let data = null;
  let open = false;

  const menit = hhmm => {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ''));
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };

  // Sama dengan jamJadwal di src/akun-gerai.js: slot jam (0-23) yang tersentuh shift; lewat tengah malam membungkus.
  function jamJadwal(row) {
    const slots = new Set();
    if (!row || row.isDayOff || !row.shiftStart || !row.shiftEnd) return slots;
    const start = menit(row.shiftStart);
    const end = menit(row.shiftEnd);
    if (start === null || end === null || start === end) return slots;
    const mark = (from, to) => { for (let hour = Math.floor(from / 60); hour * 60 < to; hour += 1) slots.add(hour); };
    if (end > start) mark(start, end);
    else { mark(start, 24 * 60); mark(0, end); }
    return slots;
  }

  function jamOperasional(store) {
    const buka = menit(store.jamBuka);
    const tutup = menit(store.jamTutup);
    if (buka === null || tutup === null || buka === tutup) return null;
    return jamJadwal({ shiftStart: store.jamBuka, shiftEnd: store.jamTutup });
  }

  function ringkasJadwal(schedule) {
    const byDay = new Map(schedule.map(row => [row.dayOfWeek, row]));
    const parts = HARI.map(([day, name]) => {
      const row = byDay.get(day);
      if (!row) return null;
      return `${name} ${row.isDayOff ? 'libur' : (row.shiftStart && row.shiftEnd ? `${row.shiftStart}-${row.shiftEnd}` : '-')}`;
    }).filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Belum ada jadwal';
  }

  function petaHtml(store, accounts) {
    const operasional = jamOperasional(store);
    const slots = new Map(accounts.map(account => [account.id, new Map(HARI.map(([day]) => [day, jamJadwal(account.schedule.find(row => row.dayOfWeek === day))]))]));
    const head1 = `<tr><th class="akg-jam" rowspan="2">Jam</th>${accounts.length ? `<th colspan="${HARI.length * accounts.length}">Akun aktif</th>` : ''}<th class="akg-sela" rowspan="2"></th><th colspan="${HARI.length}">Gerai aktif</th></tr>`;
    const head2 = `<tr>${accounts.length ? HARI.map(([, name]) => `<th class="akg-hari" colspan="${accounts.length}">${name}</th>`).join('') : ''}${HARI.map(([, name]) => `<th class="akg-hari">${name}</th>`).join('')}</tr>`;
    let bolong = 0;
    const rows = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const label = `${String(hour).padStart(2, '0')}:00-${String(hour + 1).padStart(2, '0')}:00`;
      const akunCells = accounts.length ? HARI.map(([day, name]) => accounts.map((account, index) => {
        const on = slots.get(account.id).get(day).has(hour);
        return `<td class="akg-cell ${index === 0 ? 'akg-awal' : ''} ${on ? `akg-w${account.warna}` : ''}" title="${esc(`${name} ${label}: ${account.username}${on ? ' jaga' : ' -'}`)}"></td>`;
      }).join('')).join('') : '';
      const geraiCells = HARI.map(([day, name]) => {
        const who = accounts.filter(account => slots.get(account.id).get(day).has(hour));
        const buka = operasional ? operasional.has(hour) : false;
        const kelas = who.length >= 2 ? 'akg-dobel' : (who.length === 1 ? 'akg-satu' : (buka ? 'akg-bolong' : ''));
        if (!who.length && buka) bolong += 1;
        const ket = who.length ? who.map(account => account.username).join(', ') : (buka ? 'KOSONG di jam operasional' : 'tidak ada akun');
        return `<td class="akg-cell akg-gerai ${kelas}" title="${esc(`${name} ${label}: ${ket}`)}"></td>`;
      }).join('');
      rows.push(`<tr><th class="akg-jam" title="${label}">${hour + 1}</th>${akunCells}<td class="akg-sela"></td>${geraiCells}</tr>`);
    }
    const legend = accounts.length
      ? accounts.map(account => `<span class="akg-legend"><i class="akg-w${account.warna}"></i>${esc(account.username)}</span>`).join('')
      : '<span class="muted">Tidak ada akun aktif berjadwal di gerai ini.</span>';
    const kunci = `<span class="akg-legend"><i class="akg-satu"></i>1 akun</span><span class="akg-legend"><i class="akg-dobel"></i>2+ akun</span>${operasional ? '<span class="akg-legend"><i class="akg-bolong"></i>kosong di jam operasional</span>' : ''}`;
    return {
      bolong,
      html: `
        <div class="akg-peta-wrap"><table class="akg-peta">${head1}${head2}${rows.join('')}</table></div>
        <div class="akg-legends">${legend}</div>
        <div class="akg-legends muted">${kunci}${operasional ? '' : ' · jam operasional gerai belum diisi (Pengaturan -> Dana Apresiasi)'}</div>`
    };
  }

  function kartuAkun(account, store) {
    const chips = [
      `<span class="status-chip ${account.isActive ? 'ok' : 'off'}">${account.isActive ? 'Aktif' : 'Nonaktif'}</span>`,
      `<span class="status-chip ${account.status === 'ASLI' ? 'ok' : 'warn'}">${account.status === 'ASLI' ? 'CS asli' : 'Freelance'}</span>`,
      account.isEntityBackup ? '<span class="status-chip warn">Backup entity</span>' : ''
    ].join('');
    const warnings = account.peringatan.map(item => `<div class="akg-warn ${item.kode === 'PRESENSI_BASI' || item.kode === 'KARYAWAN_NONAKTIF' ? 'bad' : ''}">⚠ ${esc(item.teks)}</div>`).join('');
    const swatch = account.isActive && account.warna !== undefined ? `<i class="akg-swatch akg-w${account.warna}"></i>` : '<i class="akg-swatch"></i>';
    return `
      <div class="master-row contact-row ${account.isActive ? '' : 'inactive'}">
        <div class="master-main">
          <strong>${swatch}${esc(account.name)} <span class="muted">(${esc(account.username)})</span></strong>
          ${chips}
          <div class="master-meta">Karyawan: ${account.employee ? `${esc(account.employee.name)}${account.employee.status === 'ACTIVE' ? '' : ' (nonaktif)'}` : '-'}${account.jobType ? ` · ${esc(account.jobType)}` : ''}</div>
          <div class="master-meta">Jadwal: ${esc(ringkasJadwal(account.schedule))}</div>
          <div class="master-meta">Presensi terakhir: ${account.lastAttendanceAt ? esc(tanggalJam(account.lastAttendanceAt)) : 'belum pernah'}${account.openSince ? ` · <strong>masih terbuka sejak ${esc(tanggalJam(account.openSince))}${account.openStoreCode && account.openStoreCode !== store.storeCode ? ` di ${esc(account.openStoreCode)}` : ''}</strong>` : ''}</div>
          ${warnings}
        </div>
        <div class="master-actions">
          <button class="mini-btn" type="button" data-akg-aktif="${esc(account.id)}" data-akg-ke="${account.isActive ? '0' : '1'}">${account.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button>
        </div>
      </div>`;
  }

  function render() {
    const host = el('entityAkunGeraiBody');
    if (!host || !data) return;
    const filter = el('entityAkunGeraiStore')?.value || '';
    const showInactive = Boolean(el('entityAkunGeraiInactive')?.checked);
    const select = el('entityAkunGeraiStore');
    if (select && select.options.length !== data.stores.length + 1) {
      select.innerHTML = `<option value="">Semua gerai</option>${data.stores.map(store => `<option value="${esc(store.storeId)}">${esc(store.storeCode)} · ${esc(store.storeName)}</option>`).join('')}`;
      select.value = filter;
    }
    const stores = data.stores.filter(store => !filter || store.storeId === filter);
    host.innerHTML = stores.length ? stores.map(store => {
      let warna = 0;
      for (const account of store.accounts) {
        account.warna = account.isActive && account.schedule.some(row => !row.isDayOff && row.shiftStart && row.shiftEnd) ? (warna++ % WARNA) : undefined;
      }
      const dipeta = store.accounts.filter(account => account.warna !== undefined);
      const aktif = store.accounts.filter(account => account.isActive);
      const nonaktif = store.accounts.length - aktif.length;
      const warnCount = store.accounts.reduce((sum, account) => sum + account.peringatan.length, 0);
      const peta = petaHtml(store, dipeta);
      const shown = store.accounts.filter(account => showInactive || account.isActive || account.peringatan.length);
      return `
        <div class="admin-card akg-store" style="margin-top:14px">
          <div class="list-head">
            <div><h2>${esc(store.storeName)} <span class="muted">${esc(store.storeCode)}</span></h2>
              <div class="muted">${store.jamBuka && store.jamTutup ? `Jam operasional ${esc(store.jamBuka)}-${esc(store.jamTutup)}` : 'Jam operasional belum diisi'} · Dana Apresiasi ${store.apresiasiOn ? 'ON' : 'OFF'}</div></div>
            <div class="akg-chips">
              <span class="status-chip ok">${aktif.length} akun aktif</span>
              ${nonaktif ? `<span class="status-chip off">${nonaktif} nonaktif</span>` : ''}
              ${warnCount ? `<span class="status-chip warn">${warnCount} peringatan</span>` : ''}
              ${peta.bolong ? `<span class="status-chip bad">${peta.bolong} jam kosong/minggu</span>` : ''}
            </div>
          </div>
          <h3 class="akg-sub">Peta akun</h3>
          ${peta.html}
          <h3 class="akg-sub">Akun kasir</h3>
          <div class="master-list">${shown.length ? shown.map(account => kartuAkun(account, store)).join('') : '<div class="empty">Tidak ada akun aktif.</div>'}</div>
          ${!showInactive && store.accounts.length > shown.length ? `<div class="muted" style="margin-top:6px">${store.accounts.length - shown.length} akun nonaktif disembunyikan.</div>` : ''}
        </div>`;
    }).join('') : '<div class="empty">Belum ada gerai di entity ini.</div>';
    host.querySelectorAll('[data-akg-aktif]').forEach(button => { button.onclick = () => ubahAktif(button.dataset.akgAktif, button.dataset.akgKe === '1'); });
  }

  async function ubahAktif(accountId, isActive) {
    const account = data?.stores.flatMap(store => store.accounts).find(item => item.id === accountId);
    if (!account) return;
    const pesan = isActive
      ? `Aktifkan lagi akun ${account.username}?`
      : `Nonaktifkan akun ${account.username}? Akun ini tidak bisa login lagi dan sesi login-nya diputus.${account.openSince ? '\n\nCatatan: presensinya yang masih terbuka TIDAK ikut ditutup -- tutup lewat Admin Gerai -> Presensi.' : ''}`;
    if (!confirm(pesan)) return;
    try {
      await api('/aktif', { method: 'POST', body: JSON.stringify({ accountId, isActive }) });
      toast(isActive ? 'Akun diaktifkan.' : 'Akun dinonaktifkan.');
      await load();
    } catch (error) { toast(error.message || 'Gagal mengubah akun.'); }
  }

  async function load() {
    const host = el('entityAkunGeraiBody');
    if (!host) return;
    if (!data) host.innerHTML = '<div class="empty">Memuat akun…</div>';
    try {
      data = await api('');
      render();
    } catch (error) {
      host.innerHTML = `<div class="empty">${esc(error.message || 'Gagal memuat akun.')}</div>`;
    }
  }

  function toggle() {
    const panel = el('entityAkunGerai');
    if (!panel) return;
    open = !open;
    panel.classList.toggle('hidden', !open);
    el('entityAkunKelolaBtn').textContent = open ? '✕ Tutup kelola akun' : '🔑 Kelola akun';
    if (open) {
      load();
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function init() {
    el('entityAkunKelolaBtn')?.addEventListener('click', toggle);
    el('entityAkunGeraiRefresh')?.addEventListener('click', load);
    el('entityAkunGeraiStore')?.addEventListener('change', render);
    el('entityAkunGeraiInactive')?.addEventListener('change', render);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
