(() => {
  // Konfirmasi keluar saat tombol Back (Bos Cyo, 2026-10-05: "kalo di back sampe mau keluar
  // kasih dulu tulisan apakah anda mau keluar"). Dulu Back dari halaman kerja langsung
  // melempar ke halaman pelanggan / login dan karyawan harus masuk ulang.
  //
  // Hanya dipasang di halaman kerja PERTAMA di tab ini (masuk dari login, halaman pelanggan,
  // atau dibuka langsung). Kalau datang dari halaman kerja lain (mis. Owner -> Workspace Gerai),
  // Back tetap kembali ke halaman sebelumnya seperti biasa.
  const STAFF_PATH = /^\/(owner|admin|entity-admin|branch-admin|cashier|staff|warung|peta-kode)\/?$|^\/s\/[^/]+\/(admin|cashier|warung)\/?$/;
  let fromStaffPage = false;
  try {
    const ref = document.referrer ? new URL(document.referrer) : null;
    fromStaffPage = Boolean(ref && ref.origin === location.origin && STAFF_PATH.test(ref.pathname));
  } catch { /* referrer tidak terbaca: anggap halaman pertama */ }
  // Halaman sedang dialihkan (mis. belum login -> /login): jangan sentuh riwayat.
  if (window.lekerRedirecting || fromStaffPage || typeof history.pushState !== 'function') return;

  const state = history.state && typeof history.state === 'object' ? history.state : {};
  if (!state.lekerExitGuard) {
    history.replaceState({ ...state, lekerExitBase: true }, '');
    history.pushState({ lekerExitGuard: true }, '');
  }

  let dialog = null;
  function ask() {
    if (dialog) return;
    dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'lekerExitTitle');
    dialog.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(20,14,10,.45);font-family:system-ui,-apple-system,"Segoe UI",sans-serif';
    dialog.innerHTML = `
      <div style="width:min(360px,100%);background:#fff;color:#1f1a16;border-radius:14px;padding:20px 18px 16px;box-shadow:0 18px 40px rgba(0,0,0,.25)">
        <h2 id="lekerExitTitle" style="margin:0 0 6px;font-size:18px">Keluar dari aplikasi?</h2>
        <p style="margin:0 0 16px;font-size:14px;color:#6b625a;line-height:1.45">Anda tetap masuk (tidak logout). Untuk berganti akun, pakai tombol Logout.</p>
        <div style="display:flex;gap:10px">
          <button type="button" data-exit-stay style="flex:1;height:46px;border-radius:10px;border:0;background:#dc5b2b;color:#fff;font:inherit;font-weight:800;font-size:15px;cursor:pointer">Tetap di sini</button>
          <button type="button" data-exit-leave style="flex:1;height:46px;border-radius:10px;border:1px solid #ddd5cc;background:#fff;color:#1f1a16;font:inherit;font-weight:700;font-size:15px;cursor:pointer">Keluar</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    const close = () => { dialog?.remove(); dialog = null; };
    dialog.querySelector('[data-exit-stay]').addEventListener('click', () => {
      close();
      history.pushState({ lekerExitGuard: true }, '');
    });
    dialog.querySelector('[data-exit-leave]').addEventListener('click', () => {
      close();
      window.removeEventListener('popstate', onPop);
      history.back();
    });
    dialog.querySelector('[data-exit-stay]').focus();
  }

  function onPop(event) {
    if (event.state && event.state.lekerExitBase) ask();
  }
  window.addEventListener('popstate', onPop);
  window.lekerExitGuard = { ask };
})();
