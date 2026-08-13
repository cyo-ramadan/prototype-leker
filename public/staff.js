(() => {
  const el = id => document.getElementById(id);
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  let portal = null;
  async function staffApi(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(payload.error || `Request gagal (${response.status})`); error.status = response.status; error.code = payload.code; throw error; }
    return payload;
  }
  function dateTime(value) { return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  function renderAttendance() {
    const rows = portal?.attendance || [];
    el('attendanceList').innerHTML = rows.length ? rows.map(row => `<div class="attendance-row"><div><strong>${row.type === 'out' ? 'Presensi Keluar' : 'Presensi Masuk'}</strong><div class="muted">${escapeHtml(dateTime(row.createdAt))}</div></div><span>${row.type === 'out' ? 'OUT' : 'IN'}</span></div>`).join('') : '<div class="staff-empty">Belum ada riwayat presensi.</div>';
  }
  function metric(label, value, detail = '') { return `<div class="staff-card" style="margin:0"><div class="muted">${escapeHtml(label)}</div><h2 style="margin:5px 0">${escapeHtml(String(value))}</h2>${detail ? `<div class="muted">${escapeHtml(detail)}</div>` : ''}</div>`; }
  function renderKpi() {
    const target = el('staffKpiList'); if (!target) return;
    const kpi = portal?.kpi; if (!kpi?.facts) { target.innerHTML = '<div class="staff-empty">Belum ada data Raport.</div>'; return; }
    const facts = kpi.facts; const permits = facts.transactionVoidPermits || {};
    target.innerHTML = `<div class="staff-card"><div class="muted">Raport / KPI Facts</div><h2>Skor belum dikonfigurasi</h2><p class="muted">${escapeHtml(kpi.scoreMessage || '')}</p><div class="staff-message">Nilai final menunggu bobot, target, periode, dan grade yang disetujui.</div></div><div class="staff-metric-grid">${metric('Penjualan', facts.sales?.count || 0, money(facts.sales?.amount || 0))}${metric('Pembelian', facts.purchases?.count || 0, money(facts.purchases?.amount || 0))}${metric('Operasional', facts.operationalExpenses?.count || 0, money(facts.operationalExpenses?.amount || 0))}${metric('Permit koreksi transaksi', permits.requested || 0, `${permits.pending || 0} pending · ${permits.approved || 0} ACC · ${permits.rejected || 0} reject`)}${metric('Presensi', facts.attendance?.total || 0, `${facts.attendance?.checkIn || 0} masuk · ${facts.attendance?.checkOut || 0} keluar`)}${metric('Laci', facts.drawers?.total || 0, `${facts.drawers?.closed || 0} ditutup`)}</div><div class="staff-card" style="margin-top:14px"><h3>Input Penilaian</h3><div class="attendance-list">${(kpi.assessmentInputs || []).map(item => `<div class="attendance-row"><div><strong>${escapeHtml(item.label)}</strong><div class="muted">Source: ${escapeHtml(item.source)}</div></div><span>${escapeHtml(item.scoring)}</span></div>`).join('')}</div></div>`;
  }
  function renderPortal() { if (!portal) return; el('staffIdentity').textContent = `${portal.staff.employeeName} · ${portal.staff.store.code}`; renderAttendance(); renderKpi(); }
  async function loadPortal() { try { portal = await staffApi('/api/staff/portal'); renderPortal(); } catch (error) { if (error.status === 401) { sessionStorage.removeItem('lekerCashierToken'); location.replace('/?login=staff'); return; } el('attendanceList').innerHTML = `<div class="staff-message">${escapeHtml(error.message)}</div>`; } }
  function showCameraMessage(message) { const node = el('staffCameraMessage'); node.textContent = message; node.classList.remove('hidden'); }
  function clearCameraMessage() { const node = el('staffCameraMessage'); node.textContent = ''; node.classList.add('hidden'); }
  async function submitAttendance(type, blob) { const form = new FormData(); form.set('type', type); form.set('photo', blob, `attendance-${type}.jpg`); await staffApi('/api/staff/attendance', { method: 'POST', body: form }); portal = await staffApi('/api/staff/portal'); renderPortal(); clearCameraMessage(); }
  function startAttendance(type) { clearCameraMessage(); window.CameraSnapshotModal.open({ facingMode: 'user', title: type === 'out' ? 'Presensi Keluar' : 'Presensi Masuk', onCaptureSuccess: async blob => { try { await submitAttendance(type, blob); } catch (error) { showCameraMessage(error.message); } }, onPermissionDenied: error => { const detail = error?.name === 'NotAllowedError' ? 'Akses kamera ditolak.' : 'Kamera tidak tersedia.'; showCameraMessage(`${detail} Buka permission kamera di browser lalu coba lagi.`); } }); }
  function bindTabs() { document.querySelectorAll('[data-staff-tab]').forEach(button => { button.addEventListener('click', () => { const tab = button.dataset.staffTab; document.querySelectorAll('[data-staff-tab]').forEach(item => item.classList.toggle('active', item === button)); document.querySelectorAll('.staff-panel').forEach(panel => panel.classList.toggle('active', panel.id === `staffPanel${tab[0].toUpperCase()}${tab.slice(1)}`)); }); }); }
  el('attendanceInBtn').addEventListener('click', () => startAttendance('in'));
  el('attendanceOutBtn').addEventListener('click', () => startAttendance('out'));
  el('backCashierBtn').addEventListener('click', () => location.assign('/cashier'));
  el('staffLogoutBtn').addEventListener('click', async () => { try { await staffApi('/api/cashier/logout', { method: 'POST' }); } catch {} sessionStorage.removeItem('lekerCashierToken'); sessionStorage.removeItem('lekerStaffSessionMeta'); location.replace('/?login=staff'); });
  bindTabs(); loadPortal();
})();
