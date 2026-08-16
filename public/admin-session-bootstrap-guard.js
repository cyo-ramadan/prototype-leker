(() => {
  const hasModernManagementSession = Boolean(
    sessionStorage.getItem('lekerAdminToken') || sessionStorage.getItem('lekerOwnerToken')
  );
  if (!hasModernManagementSession) return;

  const revealFailure = error => {
    const app = document.getElementById('adminApp');
    const gate = document.getElementById('authGate');
    const title = document.getElementById('authTitle');
    const help = document.getElementById('authHelp');
    const message = document.getElementById('authMessage');
    const button = document.getElementById('authBtn');

    app?.classList.add('hidden');
    gate?.classList.remove('hidden');
    if (title) title.textContent = 'Workspace Admin gagal dimuat';
    if (help) help.textContent = 'Session Admin sudah dikenali, tetapi data workspace gagal dibuka.';
    if (message) message.textContent = error?.message || 'Admin gagal dimuat.';
    if (button) button.textContent = 'Kembali ke Login';
  };

  const recover = async () => {
    const app = document.getElementById('adminApp');
    if (!app?.classList.contains('hidden')) return;
    if (typeof window.unlock !== 'function') {
      revealFailure(new Error('Runtime Admin belum siap. Muat ulang halaman.'));
      return;
    }

    try {
      await window.unlock();
    } catch (error) {
      revealFailure(error);
    }
  };

  // admin.js starts its legacy-compatible init immediately. Give that path a
  // short chance to finish, then recover with the already-authenticated modern
  // Admin/Owner bearer session if the workspace is still hidden.
  setTimeout(recover, 250);
})();
