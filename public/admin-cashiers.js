(() => {
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  let data = { cashiers: [], store: null };

  // Bos Cyo, 2026-09-19: "akunnya dibikin lebih detil aja misal jam kerja
  // dan hari kerja. jadi misal hari senin jam 9-18 sampai hari jumat sama,
  // terus sabtu libur, minggu jam 9-22." Urutan tampilan mulai Senin (bukan
  // Minggu) supaya cocok cara Bos Cyo menjelaskan jadwalnya sendiri.
  const DAY_LABELS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

  function scheduleRowsHtml() {
    return DAY_ORDER.map(day => `
      <div class="admin-grid" style="grid-template-columns:64px auto 1fr 1fr;gap:6px;align-items:center;margin-bottom:4px">
        <span>${DAY_LABELS[day]}</span>
        <label style="display:flex;align-items:center;gap:4px;font-weight:400;white-space:nowrap"><input type="checkbox" data-sched-off="${day}" /> Libur</label>
        <input type="time" data-sched-start="${day}" />
        <input type="time" data-sched-end="${day}" />
      </div>`).join('');
  }

  const tabs = document.querySelector('.admin-tabs');
  if (tabs && !document.querySelector('[data-tab="cashiers"]')) {
    tabs.insertAdjacentHTML('beforeend', '<button class="admin-tab" data-tab="cashiers" type="button">🧑‍💼 Create Kasir</button>');
  }

  const contacts = el('tab-contacts');
  if (contacts && !el('tab-cashiers')) {
    contacts.insertAdjacentHTML('afterend', `
      <section id="tab-cashiers" class="admin-section">
        <div class="admin-grid master-layout">
          <form id="cashierForm" class="admin-card sticky-form">
            <input id="cashierId" type="hidden" />
            <div class="form-title-row"><h2 id="cashierFormTitle">Tambah kasir</h2><button id="cashierCancelEdit" class="text-btn hidden" type="button">Batal edit</button></div>
            <div class="admin-tip" style="margin-bottom:12px">Kasir otomatis terikat ke gerai workspace ini: <b id="cashierStoreLabel">-</b></div>
            <label class="admin-field">Username<input id="cashierUsername" maxlength="40" autocomplete="off" required /></label>
            <label class="admin-field">Password <span id="cashierPasswordNote" class="field-note">min. 6 karakter</span><input id="cashierPassword" type="password" minlength="6" autocomplete="new-password" required /></label>
            <label class="admin-field">Nama karyawan<input id="cashierEmployeeName" maxlength="100" required /><span class="field-note">Cuma label tampilan akun ini -- bukan tautan resmi. Menautkan ke orang sungguhan tetap dari tab Karyawan.</span></label>
            <div class="admin-tip" style="margin-bottom:12px">Detail di bawah menempel ke AKUN ini (jabatannya), bukan ke orang yang memegangnya -- tetap berlaku walau akun ini dioper ke karyawan lain.</div>
            <label class="admin-field">Jenis pekerjaan <span class="field-note">opsional</span><input id="cashierJobType" maxlength="100" placeholder="mis. Kasir Shift Pagi" /></label>
            <label class="admin-field">Jenis pembayaran<select id="cashierPaymentType"><option value="JAM">Per Jam</option><option value="SESI">Per Sesi</option></select></label>
            <label class="admin-field" id="cashierWageLabel">Gaji per jam (Rp) <span class="field-note">opsional</span><input id="cashierHourlyWage" type="number" min="0" step="1" /></label>
            <div class="admin-field"><span>Jam &amp; hari kerja <span class="field-note">opsional per hari</span></span><div id="cashierScheduleRows" style="margin-top:6px">${scheduleRowsHtml()}</div></div>
            <label class="admin-check"><input id="cashierActive" type="checkbox" checked /> Aktif</label>
            <button class="primary-btn" type="submit">Simpan kasir</button>
          </form>
          <div class="admin-card list-card">
            <div class="list-head"><h2>Master kasir gerai</h2><span id="cashierCount" class="master-count">0</span></div>
            <div id="cashierList" class="master-list"></div>
          </div>
        </div>
      </section>`);
  }

  function toast(message) {
    const node = el('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    setTimeout(() => node.classList.remove('show'), 2000);
  }

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function switchTab() {
    document.querySelectorAll('.admin-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === 'cashiers'));
    document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-cashiers'));
  }

  function jobDetailLabel(cashier) {
    const parts = [];
    if (cashier.jobType) parts.push(escapeHtml(cashier.jobType));
    if (cashier.hourlyWage > 0) parts.push(`${rupiah(cashier.hourlyWage)}/${cashier.paymentType === 'SESI' ? 'sesi' : 'jam'}`);
    return parts.length ? parts.join(' · ') : 'Detail jabatan belum diisi';
  }

  // Mengelompokkan hari berurutan yang jadwalnya identik, persis cara Bos
  // Cyo menjelaskan sendiri: "senin jam 9-18 sampai jumat sama, sabtu
  // libur, minggu jam 9-22" -- bukan daftar 7 baris terpisah.
  function scheduleSummary(schedule) {
    if (!schedule || !schedule.length) return 'Jadwal belum diatur';
    const byDay = new Map(schedule.map(day => [day.dayOfWeek, day]));
    const ordered = DAY_ORDER.map(day => byDay.get(day) || { dayOfWeek: day, isDayOff: false, shiftStart: '', shiftEnd: '' });
    const groups = [];
    for (const day of ordered) {
      const key = day.isDayOff ? 'OFF' : (day.shiftStart || day.shiftEnd) ? `${day.shiftStart}|${day.shiftEnd}` : 'UNSET';
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.days.push(day.dayOfWeek);
      else groups.push({ key, days: [day.dayOfWeek] });
    }
    const labels = groups.map(group => {
      if (group.key === 'UNSET') return null;
      const dayLabel = group.days.length > 1
        ? `${DAY_LABELS[group.days[0]]}–${DAY_LABELS[group.days[group.days.length - 1]]}`
        : DAY_LABELS[group.days[0]];
      if (group.key === 'OFF') return `${dayLabel} Libur`;
      const [start, end] = group.key.split('|');
      return `${dayLabel} ${escapeHtml(start || '?')}–${escapeHtml(end || '?')}`;
    }).filter(Boolean);
    return labels.length ? labels.join(' · ') : 'Jadwal belum diatur';
  }

  function syncWageLabel() {
    const isSesi = el('cashierPaymentType').value === 'SESI';
    el('cashierWageLabel').firstChild.textContent = isSesi ? 'Gaji per sesi (Rp) ' : 'Gaji per jam (Rp) ';
  }

  function render() {
    if (el('cashierStoreLabel')) el('cashierStoreLabel').textContent = data.store ? `${data.store.code} · ${data.store.storeName}` : (window.LEKER_STORE_CODE || 'G001');
    el('cashierCount').textContent = data.cashiers.length;
    el('cashierList').innerHTML = data.cashiers.length ? data.cashiers.map(cashier => `
      <div class="master-row contact-row ${cashier.isActive ? '' : 'inactive'}">
        <div class="master-main">
          <strong>${escapeHtml(cashier.employeeName)}</strong>
          <div class="master-meta">@${escapeHtml(cashier.username)} · ${escapeHtml(cashier.store.code)}</div>
          <div class="master-meta">${jobDetailLabel(cashier)}</div>
          <div class="master-meta">${scheduleSummary(cashier.schedule)}</div>
          <div class="master-meta">${cashier.isActive ? 'Aktif' : 'Nonaktif'}</div>
        </div>
        <div class="master-actions">
          <button class="mini-btn" type="button" data-edit-cashier="${escapeHtml(cashier.id)}">Edit</button>
          <button class="mini-btn danger" type="button" data-delete-cashier="${escapeHtml(cashier.id)}">Nonaktifkan</button>
        </div>
      </div>`).join('') : '<div class="empty">Belum ada kasir di gerai ini.</div>';

    document.querySelectorAll('[data-edit-cashier]').forEach(button => button.onclick = () => editCashier(button.dataset.editCashier));
    document.querySelectorAll('[data-delete-cashier]').forEach(button => button.onclick = () => deactivateCashier(button.dataset.deleteCashier));
  }

  async function load() {
    try {
      data = await request('/api/admin/cashiers');
      render();
    } catch (error) { toast(error.message); }
  }

  function fillScheduleForm(schedule) {
    const byDay = new Map((schedule || []).map(day => [day.dayOfWeek, day]));
    DAY_ORDER.forEach(day => {
      const value = byDay.get(day) || { isDayOff: false, shiftStart: '', shiftEnd: '' };
      document.querySelector(`[data-sched-off="${day}"]`).checked = value.isDayOff;
      document.querySelector(`[data-sched-start="${day}"]`).value = value.shiftStart || '';
      document.querySelector(`[data-sched-end="${day}"]`).value = value.shiftEnd || '';
      document.querySelector(`[data-sched-start="${day}"]`).disabled = value.isDayOff;
      document.querySelector(`[data-sched-end="${day}"]`).disabled = value.isDayOff;
    });
  }

  function readScheduleFromForm() {
    return DAY_ORDER.map(day => ({
      dayOfWeek: day,
      isDayOff: document.querySelector(`[data-sched-off="${day}"]`).checked,
      shiftStart: document.querySelector(`[data-sched-start="${day}"]`).value,
      shiftEnd: document.querySelector(`[data-sched-end="${day}"]`).value
    }));
  }

  function resetForm() {
    el('cashierForm').reset();
    el('cashierId').value = '';
    el('cashierActive').checked = true;
    el('cashierFormTitle').textContent = 'Tambah kasir';
    el('cashierCancelEdit').classList.add('hidden');
    el('cashierPassword').required = true;
    el('cashierPasswordNote').textContent = 'min. 6 karakter';
    el('cashierPaymentType').value = 'JAM';
    syncWageLabel();
    fillScheduleForm([]);
  }

  function editCashier(id) {
    const cashier = data.cashiers.find(item => item.id === id);
    if (!cashier) return;
    el('cashierId').value = cashier.id;
    el('cashierUsername').value = cashier.username;
    el('cashierPassword').value = '';
    el('cashierPassword').required = false;
    el('cashierPasswordNote').textContent = 'kosongkan jika tidak diubah';
    el('cashierEmployeeName').value = cashier.employeeName;
    el('cashierJobType').value = cashier.jobType || '';
    el('cashierPaymentType').value = cashier.paymentType || 'JAM';
    syncWageLabel();
    el('cashierHourlyWage').value = cashier.hourlyWage || '';
    fillScheduleForm(cashier.schedule);
    el('cashierActive').checked = cashier.isActive;
    el('cashierFormTitle').textContent = 'Edit kasir';
    el('cashierCancelEdit').classList.remove('hidden');
    switchTab();
    el('cashierForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function save(event) {
    event.preventDefault();
    const id = el('cashierId').value;
    const payload = {
      username: el('cashierUsername').value,
      password: el('cashierPassword').value,
      employeeName: el('cashierEmployeeName').value,
      jobType: el('cashierJobType').value,
      paymentType: el('cashierPaymentType').value,
      hourlyWage: el('cashierHourlyWage').value || 0,
      schedule: readScheduleFromForm(),
      isActive: el('cashierActive').checked
    };
    try {
      await request(id ? `/api/admin/cashiers/${encodeURIComponent(id)}` : '/api/admin/cashiers', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(payload)
      });
      await load();
      resetForm();
      toast(id ? 'Kasir diperbarui' : 'Kasir ditambahkan');
    } catch (error) { toast(error.message); }
  }

  async function deactivateCashier(id) {
    if (!confirm('Nonaktifkan kasir ini? Session login kasir juga akan diputus.')) return;
    try {
      await request(`/api/admin/cashiers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
      toast('Kasir dinonaktifkan');
    } catch (error) { toast(error.message); }
  }

  document.querySelector('[data-tab="cashiers"]')?.addEventListener('click', switchTab);
  el('cashierForm')?.addEventListener('submit', save);
  el('cashierCancelEdit')?.addEventListener('click', resetForm);
  el('cashierPaymentType')?.addEventListener('change', syncWageLabel);
  syncWageLabel();
  // Klik "Libur" mematikan (bukan menghapus nilainya) input jam hari itu --
  // kalau di-uncheck lagi, jamnya masih ada seperti sebelumnya.
  el('cashierScheduleRows')?.addEventListener('change', event => {
    const day = event.target.dataset.schedOff;
    if (day === undefined) return;
    document.querySelector(`[data-sched-start="${day}"]`).disabled = event.target.checked;
    document.querySelector(`[data-sched-end="${day}"]`).disabled = event.target.checked;
  });

  const gate = el('authGate');
  if (gate) new MutationObserver(() => { if (gate.classList.contains('hidden')) load(); }).observe(gate, { attributes: true, attributeFilter: ['class'] });
  if (gate?.classList.contains('hidden')) load();
})();
