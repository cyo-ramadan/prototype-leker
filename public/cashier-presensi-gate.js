(() => {
  const gate = document.getElementById('cashierPresensiGate');
  const button = document.getElementById('cashierPresensiInBtn');
  const message = document.getElementById('cashierPresensiMessage');
  if (!gate || !button || !message || !window.CameraSnapshotModal) return;

  // Wraps whatever openDashboard is currently bound to (cashier-workspace.js's
  // override, loaded just before this file) so presensi masuk becomes a
  // mandatory step right after login, before menu/laci/order load -- per
  // Bos Cyo's requirement 2026-09-04. Re-checks status itself on every call
  // instead of trusting a value threaded through login()/init(), so it stays
  // correct regardless of which caller reached openDashboard first.
  const proceedToDashboard = openDashboard;

  function showGate() {
    el('cashierLoginView').classList.add('hidden');
    el('cashierDashboard').classList.add('hidden');
    el('cashierTopActions').classList.remove('hidden');
    gate.classList.remove('hidden');
  }

  function hideGate() {
    gate.classList.add('hidden');
  }

  async function submitPresensiIn(blob, geo) {
    const form = new FormData();
    form.set('type', 'in');
    form.set('photo', blob, 'attendance-in.jpg');
    if (geo?.latitude != null) form.set('latitude', String(geo.latitude));
    if (geo?.longitude != null) form.set('longitude', String(geo.longitude));
    if (geo?.accuracy != null) form.set('accuracy', String(geo.accuracy));
    await api('/api/staff/attendance', { method: 'POST', body: form });
  }

  button.addEventListener('click', () => {
    message.textContent = '';
    window.CameraSnapshotModal.open({
      facingMode: 'user',
      title: 'Presensi Masuk',
      watermark: true,
      onCaptureSuccess: async (blob, geo) => {
        try {
          await submitPresensiIn(blob, geo);
          hideGate();
          await proceedToDashboard();
        } catch (error) {
          message.textContent = error.message;
        }
      },
      onPermissionDenied: error => {
        message.textContent = error?.name === 'NotAllowedError'
          ? 'Akses kamera ditolak. Izinkan kamera di browser lalu coba lagi.'
          : 'Kamera tidak tersedia. Coba lagi atau hubungi admin.';
      }
    });
  });

  openDashboard = async function gatedOpenDashboard() {
    let attendanceStatus = 'out';
    try {
      const payload = await api('/api/cashier/me');
      state.cashier = payload.cashier || state.cashier;
      attendanceStatus = payload.attendanceStatus || 'out';
    } catch {
      attendanceStatus = 'out';
    }
    if (attendanceStatus === 'in') {
      await proceedToDashboard();
      return;
    }
    showGate();
  };
})();
