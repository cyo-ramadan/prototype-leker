(() => {
  // Laporan Presensi (Bos Cyo, 2026-10-01): bahan penilaian KPI manual Admin
  // dikumpulkan satu layar, per karyawan: sesi, telat, tidak tutup presensi,
  // koreksi jam, dan semua catatan GPS (tanpa GPS, di luar radius, di-ACC,
  // masih merah). Baca-saja, tanpa skor otomatis. Backend: src/attendance-report.js.
  const el = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
  const PERMIT_LABELS = { PENDING: 'pengajuan menunggu', APPROVED: 'pengajuan di-ACC', REJECTED: 'pengajuan ditolak' };
  let loaded = false;

  const dateTime = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '-';
  const jakartaToday = () => new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const shiftDate = (date, days) => { const base = new Date(`${date}T00:00:00Z`); base.setUTCDate(base.getUTCDate() + days); return base.toISOString().slice(0, 10); };

  function mount() {
    const tabs = document.querySelector('.admin-tabs');
    const shell = document.getElementById('adminApp');
    if (!tabs || !shell || el('tab-attendance-report')) return;

    const button = document.createElement('button');
    button.className = 'admin-tab';
    button.dataset.tab = 'attendance-report';
    button.type = 'button';
    button.textContent = '🕘 Laporan Presensi';
    button.addEventListener('click', () => { switchTab('attendance-report'); if (!loaded) { applyRange(); run(); } });
    tabs.appendChild(button);

    shell.insertAdjacentHTML('beforeend', `
      <section id="tab-attendance-report" class="admin-section">
        <div class="admin-card">
          <div class="list-head"><div><h2>Laporan Presensi</h2><div class="muted">Bahan penilaian KPI per karyawan: telat, tidak tutup presensi, koreksi jam, dan catatan GPS (tanpa GPS atau di luar radius). Hanya untuk dibaca; ACC perbaikan GPS ada di panel Kasir.</div></div></div>
          <div class="admin-grid two compact">
            <label class="admin-field">Karyawan<select id="attReportRequester"><option value="">Semua karyawan</option></select></label>
            <div></div>
            <label class="admin-field">Dari tanggal<input id="attReportFrom" type="date" /></label>
            <label class="admin-field">Sampai tanggal<input id="attReportTo" type="date" /></label>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
            <button class="text-btn" type="button" data-att-range="7">7 hari terakhir</button>
            <button class="text-btn" type="button" data-att-range="30">30 hari terakhir</button>
            <button class="text-btn" type="button" data-att-range="90">90 hari terakhir</button>
          </div>
          <button id="attReportRun" class="primary-btn" type="button">Tampilkan</button>
          <div id="attReportStatusLine" class="muted" style="margin-top:10px"></div>
        </div>
        <div id="attReportSummary" class="admin-card" style="margin-top:16px;display:none"></div>
        <div id="attReportDetail" class="admin-card" style="margin-top:16px;display:none"></div>
      </section>`);

    el('attReportRun').addEventListener('click', () => run());
    el('attReportRequester').addEventListener('change', () => run());
    document.querySelectorAll('[data-att-range]').forEach(item => {
      item.onclick = () => { applyRange(Number(item.dataset.attRange)); run(); };
    });
  }

  function applyRange(days = 30) {
    const today = jakartaToday();
    el('attReportTo').value = today;
    el('attReportFrom').value = shiftDate(today, -(days - 1));
  }

  const setStatusLine = message => { const node = el('attReportStatusLine'); if (node) node.textContent = message; };

  function fillRequesters(payload) {
    const select = el('attReportRequester');
    const chosen = select.value;
    select.innerHTML = '<option value="">Semua karyawan</option>' + (payload.requesters || []).map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    select.value = chosen;
    loaded = true;
  }

  const red = text => `<span style="font-weight:800;color:#a4133c">${escapeHtml(text)}</span>`;

  function employeeLine(entry) {
    const parts = [`${entry.sessions} sesi`];
    parts.push(entry.lateCount ? `${entry.lateCount}× telat (${entry.lateMinutes} menit)` : 'tidak pernah telat');
    if (entry.autoClosed) parts.push(`${entry.autoClosed}× tidak tutup presensi`);
    if (entry.timeCorrections) parts.push(`${entry.timeCorrections}× jam dikoreksi`);
    const gps = [];
    if (entry.gpsNoGps) gps.push(`${entry.gpsNoGps} tanpa GPS`);
    if (entry.gpsOutOfRadius) gps.push(`${entry.gpsOutOfRadius} di luar radius`);
    let gpsText = gps.length ? `GPS: ${gps.join(', ')}` : 'GPS bersih';
    if (entry.gpsResolved) gpsText += ` · ${entry.gpsResolved} di-ACC`;
    return { text: parts.join(' · '), gpsText, stillRed: entry.gpsStillRed, pending: entry.gpsPending };
  }

  function renderSummary(payload) {
    const box = el('attReportSummary');
    const totals = payload.totals;
    box.style.display = 'block';
    box.innerHTML = `<div class="list-head"><h2>Ringkasan per karyawan</h2><span class="master-count">${payload.employees.length}</span></div>
      <div class="master-meta" style="margin-bottom:8px">Periode ${escapeHtml(payload.filters.from)} s/d ${escapeHtml(payload.filters.to)} · ${totals.sessions} sesi · ${totals.lateCount} telat · ${totals.autoClosed} tidak tutup presensi · ${totals.gpsStillRed} catatan GPS masih merah · ${totals.gpsResolved} GPS di-ACC</div>
      ${payload.employees.length ? payload.employees.map(entry => {
        const line = employeeLine(entry);
        return `<div class="master-row"><div class="master-main">
          <strong>${escapeHtml(entry.employeeName)}</strong>${line.stillRed ? ` · ${red(`${line.stillRed} GPS merah`)}` : ''}
          <div class="master-meta">${escapeHtml(line.text)}</div>
          <div class="master-meta">${escapeHtml(line.gpsText)}${line.pending ? ` · ${line.pending} pengajuan menunggu` : ''}</div>
        </div></div>`;
      }).join('') : '<div class="empty">Tidak ada presensi pada periode ini.</div>'}
      ${payload.truncated ? '<div class="master-meta" style="margin-top:8px">Menampilkan 1500 sesi terbaru. Persempit periode atau pilih karyawan untuk melihat sisanya.</div>' : ''}`;
  }

  function gpsDetail(point) {
    const where = point.which === 'OUT' ? 'pulang' : 'masuk';
    const what = point.status === 'NO_GPS' ? 'tanpa GPS' : `melebihi batas radius ${point.overRadiusMeters} meter${point.distanceMeters != null ? ` (jarak ${point.distanceMeters} m)` : ''}`;
    const permit = point.permit ? ` · ${PERMIT_LABELS[point.permit.status] || point.permit.status}${point.permit.reason ? ` — alasan: ${point.permit.reason}` : ''}${point.permit.decisionNote ? ` — catatan Admin: ${point.permit.decisionNote}` : ''}` : '';
    const label = `GPS ${where}: ${what}`;
    return point.resolved
      ? `<div class="master-meta" style="color:#2f9e44">✓ ${escapeHtml(label)} · dikonfirmasi Admin${point.resolutionNote ? ` — ${escapeHtml(point.resolutionNote)}` : ''}</div>`
      : `<div class="master-meta">${red(`⚠ ${label}`)}${escapeHtml(permit)}</div>`;
  }

  function renderDetail(payload) {
    const box = el('attReportDetail');
    box.style.display = 'block';
    const rows = payload.detail || [];
    box.innerHTML = `<div class="list-head"><h2>Sesi yang perlu dilihat</h2><span class="master-count">${rows.length}</span></div>`
      + (rows.length ? rows.map(row => `
        <div class="master-row" style="align-items:flex-start"><div class="master-main">
          <strong>${escapeHtml(row.employeeName)}</strong> · <span class="master-meta">${escapeHtml(dateTime(row.checkInAt))} → ${escapeHtml(dateTime(row.checkOutAt))}</span>
          ${row.lateMinutes ? `<div class="master-meta">Telat ${row.lateMinutes} menit</div>` : ''}
          ${row.autoClosed ? '<div class="master-meta">Tidak tutup presensi (ditutup otomatis sistem)</div>' : ''}
          ${row.correction ? `<div class="master-meta">Jam masuk dikoreksi dari ${escapeHtml(dateTime(row.correction.originalAt))}${row.correction.reason ? ` — alasan: ${escapeHtml(row.correction.reason)}` : ''}${row.correction.decisionNote ? ` — catatan Admin: ${escapeHtml(row.correction.decisionNote)}` : ''}</div>` : ''}
          ${row.gps.map(gpsDetail).join('')}
        </div></div>`).join('') : '<div class="empty">Tidak ada sesi bermasalah pada filter ini.</div>')
      + (payload.detailTruncated ? '<div class="master-meta" style="margin-top:8px">Menampilkan 200 sesi terbaru yang bermasalah. Persempit periode atau pilih karyawan untuk melihat sisanya.</div>' : '');
  }

  async function run() {
    const params = new URLSearchParams({ store: window.LEKER_STORE_CODE || 'G001' });
    if (el('attReportRequester').value) params.set('requester', el('attReportRequester').value);
    if (el('attReportFrom').value) params.set('from', el('attReportFrom').value);
    if (el('attReportTo').value) params.set('to', el('attReportTo').value);
    setStatusLine('Memuat laporan...');
    try {
      const response = await fetch(`/api/admin/attendance-report?${params}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
      fillRequesters(payload);
      renderSummary(payload);
      renderDetail(payload);
      setStatusLine('');
    } catch (error) { setStatusLine(error.message); }
  }

  mount();
})();
