(() => {
  const form = document.getElementById('entryLoginForm');
  if (!form) return;

  const el = id => document.getElementById(id);
  const storeCode = String(window.LEKER_STORE_CODE || 'G001').toUpperCase();
  const leaseKey = 'lekerStaffBrowserLease';
  const leaseTtlMs = 15000;
  let mode = new URL(location.href).searchParams.get('login') === 'staff' ? 'STAFF' : 'CUSTOMER';

  const note = form.querySelector('.entry-login-note');
  const tabs = document.createElement('div');
  tabs.className = 'entry-login-role-tabs';
  tabs.innerHTML = `
    <button id="entryCustomerTab" class="entry-login-role-tab" type="button">Pelanggan</button>
    <button id="entryStaffTab" class="entry-login-role-tab" type="button">Karyawan</button>`;
  form.insertBefore(tabs, note);

  function activeStaffLease() {
    try {
      const lease = JSON.parse(localStorage.getItem(leaseKey) || 'null');
      if (!lease || !lease.updatedAt || Date.now() - Number(lease.updatedAt) > leaseTtlMs) {
        localStorage.removeItem(leaseKey);
        return null;
      }
      return lease;
    } catch {
      localStorage.removeItem(leaseKey);
      return null;
    }
  }

  function applyMode(nextMode) {
    mode = nextMode;
    el('entryCustomerTab')?.classList.toggle('active', mode === 'CUSTOMER');
    el('entryStaffTab')?.classList.toggle('active', mode === 'STAFF');
    if (note) {
      note.textContent = mode === 'CUSTOMER'
        ? 'Login pelanggan berlaku pada gerai yang dipilih. Belanja tetap bisa tanpa login.'
        : 'Login karyawan otomatis menentukan pangkat Owner, Admin Gerai, atau Kasir.';
    }
    if (el('entryRegisterOpen')) el('entryRegisterOpen').hidden = mode === 'STAFF';
    if (el('continueGuestBtn')) el('continueGuestBtn').textContent = mode === 'STAFF' ? 'Kembali ke halaman customer' : 'Lanjut beli tanpa login';
    if (el('entrySubmit')) el('entrySubmit').textContent = mode === 'STAFF' ? 'LOGIN KARYAWAN' : 'LOGIN PELANGGAN';
    if (el('entryLoginMessage')) el('entryLoginMessage').textContent = '';
  }

  function staffIdentity(payload) {
    if (payload.role === 'OWNER') return payload.owner;
    if (payload.role === 'ADMIN') return payload.admin;
    if (payload.role === 'CASHIER') return payload.cashier;
    return null;
  }

  function staffTokenKey(role) {
    if (role === 'OWNER') return 'lekerOwnerToken';
    if (role === 'ADMIN') return 'lekerAdminToken';
    return 'lekerCashierToken';
  }

  async function submitLogin({ takeover = false } = {}) {
    const username = el('entryUsername')?.value.trim() || '';
    const password = el('entryPassword')?.value || '';
    const message = el('entryLoginMessage');
    const submit = el('entrySubmit');
    if (!username || !password) {
      if (message) message.textContent = 'Username dan password wajib diisi.';
      return;
    }

    if (mode === 'STAFF' && !takeover && activeStaffLease()) {
      if (message) message.textContent = 'Sudah ada tab karyawan aktif di browser ini. Gunakan tab tersebut atau tutup dulu sebelum login karyawan lain.';
      return;
    }

    if (message) message.textContent = '';
    if (submit) submit.disabled = true;
    try {
      const path = mode === 'STAFF'
        ? '/api/auth/staff-login'
        : `/api/auth/customer-login?store=${encodeURIComponent(storeCode)}`;
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, takeover })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (mode === 'STAFF' && payload.code === 'STAFF_SESSION_ACTIVE' && payload.canTakeover) {
          if (message) {
            message.innerHTML = 'Akun karyawan masih aktif di tab/perangkat lain. <button id="entryTakeoverStaff" class="text-btn" type="button">Ambil alih sesi</button>';
            el('entryTakeoverStaff')?.addEventListener('click', () => submitLogin({ takeover: true }), { once: true });
          }
          return;
        }
        throw new Error(payload.error || 'Login gagal.');
      }

      if (mode === 'CUSTOMER') {
        if (payload.role !== 'CUSTOMER' || !payload.customer) throw new Error('Akun ini bukan akun pelanggan.');
        sessionStorage.setItem(`lekerCustomerToken:${storeCode}`, payload.token);
        location.reload();
        return;
      }

      if (!['OWNER', 'ADMIN', 'CASHIER'].includes(payload.role)) throw new Error('Akun ini bukan akun karyawan.');
      const identity = staffIdentity(payload);
      if (!identity?.id) throw new Error('Identitas karyawan tidak lengkap.');
      sessionStorage.setItem(staffTokenKey(payload.role), payload.token);
      if (payload.role === 'ADMIN') sessionStorage.setItem('lekerAdminStoreCode', identity.store?.code || '');
      sessionStorage.setItem('lekerStaffSessionMeta', JSON.stringify({
        id: identity.id,
        role: payload.role,
        name: identity.displayName || identity.employeeName || identity.username || '',
        storeCode: identity.store?.code || ''
      }));
      const handoffId = crypto.randomUUID();
      sessionStorage.setItem('lekerStaffHandoffId', handoffId);
      localStorage.setItem(leaseKey, JSON.stringify({ owner: handoffId, stage: 'handoff', updatedAt: Date.now() }));
      location.href = payload.redirect || '/';
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

  el('entryCustomerTab')?.addEventListener('click', () => applyMode('CUSTOMER'));
  el('entryStaffTab')?.addEventListener('click', () => applyMode('STAFF'));
  applyMode(mode);

  if (new URL(location.href).searchParams.get('login') === 'staff') {
    el('entryLoginBtn')?.click();
    const clean = new URL(location.href);
    clean.searchParams.delete('login');
    history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
  }
})();
