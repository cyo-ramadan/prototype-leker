(() => {
  const el = id => document.getElementById(id);
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  let portal = null;

  async function staffApi(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request gagal (${response.status})`);
      error.status = response.status;
      error.code = payload.code;
      throw error;
    }
    return payload;
  }

  function dateTime(value) {
    return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  function renderAttendance() {
    const rows = portal?.attendance || [];
    el('attendanceList').innerHTML = rows.length
      ? rows.map(row => `<div class="attendance-row"><div><strong>${row.type === 'out' ? 'Presensi Keluar' : 'Presensi Masuk'}</strong><div class="muted">${escapeHtml(dateTime(row.createdAt))}</div></div><span>${row.type === 'out' ? 'OUT' : 'IN'}</span></div>`).join('')
      : '<div class="staff-empty">Belum ada riwayat presensi.</div>';
  }

  function renderPortal() {
    if (!portal) return;
    el('staffIdentity').textContent = `${portal.staff.employeeName} · ${portal.staff.store.code}`;
    renderAttendance();
  }

  async function loadPortal() {
    try {
      portal = await staffApi('/api/staff/portal');
      renderPortal();
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem('lekerCashierToken');
        location.replace('/?login=staff');
        return;
      }
      el('attendanceList').innerHTML = `<div class="staff-message">${escapeHtml(error.message)}</div>`;
    }
  }

  function showCameraMessage(message) {
    const node = el('staffCameraMessage');
    node.textContent = message;
    node.classList.remove('hidden');
  }

  function clearCameraMessage() {
    const node = el('staffCameraMessage');
    node.textContent = '';
    node.classList.add('hidden');
  }

  async function submitAttendance(type, blob) {
    const form = new FormData();
    form.set('type', type);
    form.set('photo', blob, `attendance-${type}.jpg`);
    await staffApi('/api/staff/attendance', { method: 'POST', body: form });
    portal = await staffApi('/api/staff/portal');
    renderPortal();
    clearCameraMessage();
  }

  function startAttendance(type) {
    clearCameraMessage();
    window.CameraSnapshotModal.open({
      facingMode: 'user',
      title: type === 'out' ? 'Presensi Keluar' : 'Presensi Masuk',
      onCaptureSuccess: async blob => {
        try {
          await submitAttendance(type, blob);
        } catch (error) {
          showCameraMessage(error.message);
        }
      },
      onPermissionDenied: error => {
        const detail = error?.name === 'NotAllowedError' ? 'Akses kamera ditolak.' : 'Kamera tidak tersedia.';
        showCameraMessage(`${detail} Buka permission kamera di browser lalu coba lagi.`);
      }
    });
  }

  function bindTabs() {
    document.querySelectorAll('[data-staff-tab]').forEach(button => {
      button.addEventListener('click', () => {
        const tab = button.dataset.staffTab;
        document.querySelectorAll('[data-staff-tab]').forEach(item => item.classList.toggle('active', item === button));
        document.querySelectorAll('.staff-panel').forEach(panel => panel.classList.toggle('active', panel.id === `staffPanel${tab[0].toUpperCase()}${tab.slice(1)}`));
      });
    });
  }

  el('attendanceInBtn').addEventListener('click', () => startAttendance('in'));
  el('attendanceOutBtn').addEventListener('click', () => startAttendance('out'));
  el('backCashierBtn').addEventListener('click', () => location.assign('/cashier'));
  el('staffLogoutBtn').addEventListener('click', async () => {
    try { await staffApi('/api/cashier/logout', { method: 'POST' }); } catch {}
    sessionStorage.removeItem('lekerCashierToken');
    sessionStorage.removeItem('lekerStaffSessionMeta');
    location.replace('/?login=staff');
  });

  bindTabs();
  loadPortal();
})();
