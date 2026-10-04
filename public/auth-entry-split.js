(() => {
  // Login karyawan pindah ke halaman sendiri (/login, public/staff-login.js).
  // Link/tab lama yang masih membawa ?login=staff (bookmark, JS lama di cache
  // browser) diteruskan ke sana; staffBlocked ikut dibawa supaya halaman login
  // tahu sesi tab ini baru saja dicabut penjaga antar-tab.
  const entryUrl = new URL(location.href);
  if (entryUrl.searchParams.get('login') === 'staff') {
    const blocked = entryUrl.searchParams.get('staffBlocked') === '1';
    location.replace(blocked ? '/login?staffBlocked=1' : '/login');
    return;
  }

  const form = document.getElementById('entryLoginForm');
  if (!form) return;

  const el = id => document.getElementById(id);
  const storeCode = String(window.LEKER_STORE_CODE || 'G001').toUpperCase();

  const note = form.querySelector('.entry-login-note');
  if (note) note.textContent = 'Login pelanggan berlaku pada gerai yang dipilih. Belanja tetap bisa tanpa login.';
  if (el('entrySubmit')) el('entrySubmit').textContent = 'LOGIN PELANGGAN';

  const staffLink = document.createElement('a');
  staffLink.className = 'text-btn entry-back-btn';
  staffLink.href = '/login';
  staffLink.style.cssText = 'display:block;margin:12px 0;color:var(--brand);font-weight:900;text-align:center';
  staffLink.textContent = 'Karyawan? Login di sini →';
  form.after(staffLink);

  async function submitLogin() {
    const username = el('entryUsername')?.value.trim() || '';
    const password = el('entryPassword')?.value || '';
    const message = el('entryLoginMessage');
    const submit = el('entrySubmit');
    if (!username || !password) {
      if (message) message.textContent = 'Username dan password wajib diisi.';
      return;
    }

    if (message) message.textContent = '';
    if (submit) submit.disabled = true;
    try {
      const response = await fetch(`/api/auth/customer-login?store=${encodeURIComponent(storeCode)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Login gagal.');
      if (payload.role !== 'CUSTOMER' || !payload.customer) throw new Error('Akun ini bukan akun pelanggan.');
      sessionStorage.setItem(`lekerCustomerToken:${storeCode}`, payload.token);
      location.reload();
    } catch (error) {
      if (message) message.textContent = error.message;
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    submitLogin();
  }, true);
})();
