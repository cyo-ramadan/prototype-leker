(() => {
  const form = document.getElementById('staffLoginForm');
  if (!form) return;

  const el = id => document.getElementById(id);
  const leaseKey = 'lekerStaffBrowserLease';
  const STAFF_ROLES = ['OWNER', 'ADMIN', 'ENTITY_ADMIN', 'CASHIER'];

  // crypto.randomUUID() bisa tidak ada di WebView lawas; ID ini cuma perlu unik
  // per login, jadi fallback tidak boleh melempar dan menggagalkan login.
  const randomId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      try { return crypto.randomUUID(); } catch {}
    }
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  };

  // Sesi yang masih sah di browser ini SELALU menang: langsung ke workspace-nya
  // tanpa menampilkan form. Mau ganti orang, logout dulu. staffBlocked=1 berarti
  // penjaga antar-tab baru saja mencabut sesi tab ini -- jangan redirect
  // berdasarkan pembacaan token yang basi, tampilkan form.
  function existingStaffWorkspaceRedirect() {
    if (localStorage.getItem('lekerOwnerToken')) return '/admin';
    if (localStorage.getItem('lekerEntityAdminToken')) return '/entity-admin';
    const adminStoreCode = localStorage.getItem('lekerAdminStoreCode');
    if (localStorage.getItem('lekerAdminToken') && adminStoreCode) return `/s/${encodeURIComponent(adminStoreCode)}/admin`;
    if (localStorage.getItem('lekerCashierToken')) return '/cashier';
    return null;
  }

  const staffBlocked = new URL(location.href).searchParams.get('staffBlocked') === '1';
  const existingRedirect = !staffBlocked && existingStaffWorkspaceRedirect();
  if (existingRedirect) {
    location.replace(existingRedirect);
    return;
  }

  function staffIdentity(payload) {
    if (payload.role === 'OWNER') return payload.owner;
    if (payload.role === 'ADMIN') return payload.admin;
    if (payload.role === 'ENTITY_ADMIN') return payload.entityAdmin;
    if (payload.role === 'CASHIER') return payload.cashier;
    return null;
  }

  function staffTokenKey(role) {
    if (role === 'OWNER') return 'lekerOwnerToken';
    if (role === 'ADMIN') return 'lekerAdminToken';
    if (role === 'ENTITY_ADMIN') return 'lekerEntityAdminToken';
    return 'lekerCashierToken';
  }

  async function submitLogin() {
    const username = el('staffUsername')?.value.trim() || '';
    const password = el('staffPassword')?.value || '';
    const message = el('staffLoginMessage');
    const submit = el('staffSubmit');
    if (!username || !password) {
      if (message) message.textContent = 'Username dan password wajib diisi.';
      return;
    }

    if (message) message.textContent = '';
    if (submit) submit.disabled = true;
    try {
      const response = await fetch('/api/auth/staff-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Login gagal.');
      if (!STAFF_ROLES.includes(payload.role)) throw new Error('Akun ini bukan akun karyawan.');
      const identity = staffIdentity(payload);
      if (!identity?.id) throw new Error('Identitas karyawan tidak lengkap.');

      // Token sudah sah di server di titik ini. Kalau pencatatan meta/lease
      // lintas-tab gagal (storage penuh, mode privat), itu tidak boleh
      // menggagalkan login: token ditulis dulu, sisanya dibungkus terpisah
      // supaya location.replace() di bawah selalu jalan.
      try {
        localStorage.setItem(staffTokenKey(payload.role), payload.token);
        if (payload.role === 'ADMIN') localStorage.setItem('lekerAdminStoreCode', identity.store?.code || '');
        const name = identity.displayName || identity.employeeName || identity.username || '';
        localStorage.setItem('lekerStaffSessionMeta', JSON.stringify({
          id: identity.id,
          role: payload.role,
          name,
          storeCode: identity.store?.code || ''
        }));
        // handoffId per-tab (sessionStorage): penanda "halaman berikutnya adalah diri saya sendiri".
        const handoffId = randomId();
        sessionStorage.setItem('lekerStaffHandoffId', handoffId);
        localStorage.setItem(leaseKey, JSON.stringify({
          owner: handoffId,
          stage: 'handoff',
          staffId: identity.id,
          role: payload.role,
          name,
          updatedAt: Date.now()
        }));
      } catch (storageError) {
        console.error('Gagal menulis status sesi lintas-tab, lanjut login tanpa fitur itu:', storageError);
      }
      // replace(), bukan href: halaman login tidak boleh tertinggal di history
      // supaya tombol Back tidak membawa orang yang sudah login kembali ke form.
      location.replace(payload.redirect || '/');
    } catch (error) {
      if (message) message.textContent = error.message;
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    submitLogin();
  });

  setTimeout(() => el('staffUsername')?.focus(), 40);
})();
