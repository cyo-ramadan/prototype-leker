(() => {
  const el = id => document.getElementById(id);
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  let portal = null;
  let deposits = null;
  async function staffApi(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(payload.error || `Request gagal (${response.status})`); error.status = response.status; error.code = payload.code; throw error; }
    return payload;
  }
  function dateTime(value) { return value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : ''; }
  function locationLine(fact) {
    if (!fact || fact.latitude == null || fact.longitude == null) return 'Lokasi tidak tersedia';
    const accuracy = fact.accuracyMeters != null ? ` (±${Math.round(fact.accuracyMeters)}m)` : '';
    return `${Number(fact.latitude).toFixed(5)}, ${Number(fact.longitude).toFixed(5)}${accuracy}`;
  }
  // Satu baris = satu sesi kerja penuh (masuk + pulang), bukan dua baris
  // event terpisah -- lihat migration 0068 dan src/staff-portal.js.
  function attendancePhotoThumb(row, which) {
    const fact = which === 'in' ? row.checkIn : row.checkOut;
    if (!fact) return '';
    // 2026-09-15, bug ketemu sendiri: endpoint foto presensi butuh Authorization
    // Bearer header (requireCashier), tapi <img src="..."> browser TIDAK PERNAH
    // mengirim header custom -- itu jalur fetch() JS punya (lihat
    // staff-auth-fetch.js yang nyuntik token ke window.fetch, bukan ke
    // permintaan gambar bawaan browser). Kalau src langsung diisi URL endpoint,
    // hasilnya 401 dan foto ga pernah kelihatan. Diperbaiki: src dikosongkan
    // dulu, diisi belakangan lewat fetch() + blob URL di loadAttendancePhotoThumbs().
    return `<img class="attendance-thumb" data-photo-attendance="${escapeHtml(row.id)}" data-photo-which="${which}" alt="Foto presensi ${which === 'in' ? 'datang' : 'pulang'}" loading="lazy" />`;
  }
  let attendancePhotoUrls = [];
  async function loadAttendancePhotoThumbs() {
    attendancePhotoUrls.forEach(url => URL.revokeObjectURL(url));
    attendancePhotoUrls = [];
    const nodes = [...document.querySelectorAll('[data-photo-attendance]')];
    await Promise.all(nodes.map(async img => {
      try {
        const response = await fetch(`/api/staff/attendance/${encodeURIComponent(img.dataset.photoAttendance)}/photo?which=${img.dataset.photoWhich}`);
        if (!response.ok) return;
        const url = URL.createObjectURL(await response.blob());
        attendancePhotoUrls.push(url);
        img.src = url;
      } catch {}
    }));
  }
  // Bos Cyo, 2026-09-19: "kalo telat kasih background merah muda kita, telat
  // 5 menit semakin merah warnanya, telat 10 menit ke atas lebih merah
  // banget ... ga telat ada tulisan di bold hijau, trrus kalo telat
  // berartintulisannya merah". lateMinutes null = shift_start belum diisi
  // Admin di Master Kasir -- tidak ditampilkan sama sekali, karena tidak ada
  // dasar untuk menilai telat/tidak.
  function latenessRowStyle(checkIn) {
    const lateMinutes = checkIn?.lateMinutes;
    if (lateMinutes == null || lateMinutes === 0) return '';
    if (lateMinutes < 5) return 'background:#ffe4ec';
    if (lateMinutes < 10) return 'background:#ffb3c6';
    return 'background:#ff8fa3';
  }
  function latenessBadge(checkIn) {
    const lateMinutes = checkIn?.lateMinutes;
    if (lateMinutes == null) return '';
    if (lateMinutes === 0) return ' · <span style="font-weight:800;color:#2f9e44">Tepat waktu</span>';
    const color = lateMinutes < 5 ? '#d6336c' : lateMinutes < 10 ? '#c2255c' : '#a4133c';
    return ` · <span style="font-weight:800;color:${color}">Telat ${lateMinutes} menit</span>`;
  }
  function renderAttendance() {
    const rows = portal?.attendance || [];
    el('attendanceList').innerHTML = rows.length ? rows.map(row => `<div class="attendance-row" style="${latenessRowStyle(row.checkIn)}"><div class="attendance-row-photos">${attendancePhotoThumb(row, 'in')}${attendancePhotoThumb(row, 'out')}</div><div><strong>${row.status === 'OPEN' ? 'Masih bekerja' : 'Sesi selesai'}</strong><div class="muted">Datang: ${row.checkIn ? `${escapeHtml(dateTime(row.checkIn.at))} · ${escapeHtml(locationLine(row.checkIn))}${latenessBadge(row.checkIn)}` : '—'}</div><div class="muted">Pulang: ${row.checkOut ? `${escapeHtml(dateTime(row.checkOut.at))} · ${escapeHtml(locationLine(row.checkOut))}` : '—'}</div></div><span>${row.status === 'OPEN' ? 'IN' : 'OUT'}</span></div>`).join('') : '<div class="staff-empty">Belum ada riwayat presensi.</div>';
    loadAttendancePhotoThumbs();
  }
  function metric(label, value, detail = '') { return `<div class="staff-card" style="margin:0"><div class="muted">${escapeHtml(label)}</div><h2 style="margin:5px 0">${escapeHtml(String(value))}</h2>${detail ? `<div class="muted">${escapeHtml(detail)}</div>` : ''}</div>`; }
  function renderKpi() {
    const target = el('staffKpiList'); if (!target) return;
    const kpi = portal?.kpi; if (!kpi?.facts) { target.innerHTML = '<div class="staff-empty">Belum ada data Raport.</div>'; return; }
    const facts = kpi.facts; const permits = facts.transactionVoidPermits || {};
    target.innerHTML = `<div class="staff-card"><div class="muted">Raport / KPI Facts</div><h2>Skor belum dikonfigurasi</h2><p class="muted">${escapeHtml(kpi.scoreMessage || '')}</p><div class="staff-message">Nilai final menunggu bobot, target, periode, dan grade yang disetujui.</div></div><div class="staff-metric-grid">${metric('Penjualan', facts.sales?.count || 0, money(facts.sales?.amount || 0))}${metric('Pembelian', facts.purchases?.count || 0, money(facts.purchases?.amount || 0))}${metric('Operasional', facts.operationalExpenses?.count || 0, money(facts.operationalExpenses?.amount || 0))}${metric('Permit koreksi transaksi', permits.requested || 0, `${permits.pending || 0} pending · ${permits.approved || 0} ACC · ${permits.rejected || 0} reject`)}${metric('Presensi', facts.attendance?.total || 0, `${facts.attendance?.closed || 0} selesai · ${facts.attendance?.open || 0} masih bekerja`)}${metric('Laci', facts.drawers?.total || 0, `${facts.drawers?.closed || 0} ditutup`)}</div><div class="staff-card" style="margin-top:14px"><h3>Input Penilaian</h3><div class="attendance-list">${(kpi.assessmentInputs || []).map(item => `<div class="attendance-row"><div><strong>${escapeHtml(item.label)}</strong><div class="muted">Source: ${escapeHtml(item.source)}</div></div><span>${escapeHtml(item.scoring)}</span></div>`).join('')}</div></div>`;
  }
  function renderPortal() {
    if (!portal) return;
    el('staffIdentity').textContent = `${portal.staff.employeeName} · ${portal.staff.store.code}`;
    const checkedIn = portal.attendanceStatus === 'in';
    const toggleBtn = el('attendanceToggleBtn');
    toggleBtn.textContent = checkedIn ? '📸 Presensi Pulang' : '📸 Presensi Datang';
    toggleBtn.className = checkedIn ? 'secondary-btn' : 'primary-btn';
    toggleBtn.dataset.attendanceType = checkedIn ? 'out' : 'in';
    renderAttendance();
    renderKpi();
    renderPayroll();
  }
  // Bos Cyo, 2026-09-19: "pendapatan gaji perharinya harusnya juga masukin ke
  // riwayat gaji". Satu baris per sesi presensi SELESAI -- dihitung ulang
  // server tiap load (src/staff-portal.js), bukan snapshot. Sesi yang masih
  // berjalan (OPEN) belum masuk daftar ini karena belum ada durasi final.
  function renderPayroll() {
    const target = el('staffPayrollList'); if (!target) return;
    const rows = portal?.payroll || [];
    if (!rows.length) { target.innerHTML = '<div class="staff-empty">Belum ada sesi presensi yang selesai untuk dihitung gajinya.</div>'; return; }
    const total = rows.reduce((sum, row) => sum + (Number(row.earningRupiah) || 0), 0);
    target.innerHTML = `
      <div class="staff-card" style="margin-bottom:12px"><div class="muted">Total (${rows.length} sesi)</div><h2 style="margin:5px 0">${money(total)}</h2></div>
      <div class="attendance-list">${rows.map(row => `
        <div class="attendance-row">
          <div><strong>${escapeHtml(row.date)}</strong><div class="muted">${row.paymentType === 'SESI' ? 'Per sesi' : `Per jam${row.hoursWorked != null ? ` · ${row.hoursWorked} jam` : ''}`}</div></div>
          <span>${money(row.earningRupiah)}</span>
        </div>`).join('')}</div>`;
  }
  const approvalLabel = { pending_approval: 'Menunggu ACC', approved: 'Sudah disetor', rejected: 'Ditolak' };
  function renderDeposits() {
    const target = el('staffDepositList'); if (!target) return;
    const items = deposits || [];
    if (!items.length) { target.innerHTML = '<div class="staff-empty">Belum ada data setoran.</div>'; return; }
    target.innerHTML = items.map(item => `
      <div class="staff-card" style="margin-bottom:12px">
        <div class="muted">Sisa piutang setoran</div>
        <h2 style="margin:5px 0">${money(item.balanceRupiah)}</h2>
        <div class="attendance-list">${(item.payments || []).map(payment => `
          <div class="attendance-row">
            <div><strong>${money(payment.amountRupiah)}</strong><div class="muted">${escapeHtml(payment.proofReference)}${payment.rejectionReason ? ` · Ditolak: ${escapeHtml(payment.rejectionReason)}` : ''}</div></div>
            <span>${escapeHtml(approvalLabel[payment.approvalStatus] || payment.approvalStatus)}</span>
          </div>`).join('') || '<div class="muted">Belum ada entry setoran untuk piutang ini.</div>'}</div>
        <div class="field" style="margin-top:10px"><label>Nominal disetor</label><input class="text-input deposit-amount" type="number" min="1" step="1" /></div>
        <div class="field"><label>Referensi/bukti transfer</label><input class="text-input deposit-proof" type="text" placeholder="mis. nomor referensi transfer bank" /></div>
        <button type="button" class="secondary-btn deposit-submit" data-receivable-id="${escapeHtml(item.id)}">Kirim Bukti Setoran</button>
      </div>`).join('');
    target.querySelectorAll('.deposit-submit').forEach(button => {
      button.addEventListener('click', async () => {
        const card = button.closest('.staff-card');
        const amountRupiah = Number(card.querySelector('.deposit-amount').value);
        const proofReference = card.querySelector('.deposit-proof').value.trim();
        if (!amountRupiah || !proofReference) { toastStaff('Nominal dan referensi bukti wajib diisi.'); return; }
        try {
          await staffApi(`/api/cashier/employee-deposits/${encodeURIComponent(button.dataset.receivableId)}/payments`, {
            method: 'POST', body: JSON.stringify({ amountRupiah, proofReference })
          });
          await loadDeposits();
          toastStaff('Bukti setoran terkirim, menunggu ACC Admin/Finance.');
        } catch (error) { toastStaff(error.message); }
      });
    });
  }
  function toastStaff(message) { showCameraMessage(message); setTimeout(clearCameraMessage, 4000); }
  async function loadDeposits() { try { const payload = await staffApi('/api/cashier/employee-deposits'); deposits = payload.items || []; renderDeposits(); } catch (error) { el('staffDepositList').innerHTML = `<div class="staff-message">${escapeHtml(error.message)}</div>`; } }
  async function loadPortal() { try { portal = await staffApi('/api/staff/portal'); renderPortal(); } catch (error) { if (error.status === 401) { localStorage.removeItem('lekerCashierToken'); localStorage.removeItem('lekerStaffSessionMeta'); location.replace('/?login=staff'); return; } el('attendanceList').innerHTML = `<div class="staff-message">${escapeHtml(error.message)}</div>`; } }
  function showCameraMessage(message) { const node = el('staffCameraMessage'); node.textContent = message; node.classList.remove('hidden'); }
  function clearCameraMessage() { const node = el('staffCameraMessage'); node.textContent = ''; node.classList.add('hidden'); }
  async function submitAttendance(type, blob, geo) {
    const form = new FormData();
    form.set('type', type);
    form.set('photo', blob, `attendance-${type}.jpg`);
    if (geo?.latitude != null) form.set('latitude', String(geo.latitude));
    if (geo?.longitude != null) form.set('longitude', String(geo.longitude));
    if (geo?.accuracy != null) form.set('accuracy', String(geo.accuracy));
    await staffApi('/api/staff/attendance', { method: 'POST', body: form });
    portal = await staffApi('/api/staff/portal');
    renderPortal();
    clearCameraMessage();
  }
  function startAttendance(type) {
    clearCameraMessage();
    window.CameraSnapshotModal.open({
      facingMode: 'user',
      title: type === 'out' ? 'Presensi Pulang' : 'Presensi Datang',
      watermark: true,
      onCaptureSuccess: async (blob, geo) => { try { await submitAttendance(type, blob, geo); } catch (error) { showCameraMessage(error.message); } },
      onPermissionDenied: error => { const detail = error?.name === 'NotAllowedError' ? 'Akses kamera ditolak.' : 'Kamera tidak tersedia.'; showCameraMessage(`${detail} Buka permission kamera di browser lalu coba lagi.`); }
    });
  }
  function bindTabs() { document.querySelectorAll('[data-staff-tab]').forEach(button => { button.addEventListener('click', () => { const tab = button.dataset.staffTab; document.querySelectorAll('[data-staff-tab]').forEach(item => item.classList.toggle('active', item === button)); document.querySelectorAll('.staff-panel').forEach(panel => panel.classList.toggle('active', panel.id === `staffPanel${tab[0].toUpperCase()}${tab.slice(1)}`)); }); }); }
  el('attendanceToggleBtn').addEventListener('click', () => startAttendance(el('attendanceToggleBtn').dataset.attendanceType || 'in'));
  el('backCashierBtn').addEventListener('click', () => { window.lekerPrepareStaffHandoff?.(); location.assign('/cashier'); });
  el('staffLogoutBtn').addEventListener('click', async () => { try { await staffApi('/api/cashier/logout', { method: 'POST' }); } catch {} window.lekerClearStaffSession?.(); localStorage.removeItem('lekerCashierToken'); localStorage.removeItem('lekerStaffSessionMeta'); location.replace('/?login=staff'); });
  bindTabs(); loadPortal(); loadDeposits();
})();
