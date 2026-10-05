(() => {
  // Login Karyawan (/login) -- Bos Cyo, 2026-10-05: "habis klik login masih nyangkut ke login
  // entity kadang juga engga ... kalo terlanjur masuk ke entity engga bisa login karyawan lain
  // ... pertahankan walaupun ber-tab-tab tetap login di satu id sebelum adanya logout."
  //
  // Akar masalah lama: tiap login hanya menulis token perannya sendiri, token peran lain yang
  // basi tetap tertinggal, lalu halaman ini dulu otomatis melempar ke peran "tertinggi" yang
  // tokennya ada (Owner > Entity > Admin > Kasir) -- termasuk token Entity yang sudah mati,
  // sehingga orang tersangkut di form "Login Entity Admin". Sekarang:
  //   1. Satu browser = satu akun karyawan. Login baru menghapus semua token karyawan lain.
  //   2. Kalau sudah ada sesi, halaman ini menampilkan "Masuk sebagai <nama>" (Lanjutkan) atau
  //      "Masuk dengan akun lain" (logout dulu) -- tidak lagi melempar diam-diam.
  const form = document.getElementById('staffLoginForm');
  if (!form) return;

  const el = id => document.getElementById(id);
  const leaseKey = 'lekerStaffBrowserLease';
  const STAFF_ROLES = ['OWNER', 'ADMIN', 'ENTITY_ADMIN', 'CASHIER'];
  const TOKEN_KEY = { OWNER: 'lekerOwnerToken', ENTITY_ADMIN: 'lekerEntityAdminToken', ADMIN: 'lekerAdminToken', CASHIER: 'lekerCashierToken' };
  const ROLE_LABEL = { OWNER: 'Owner', ENTITY_ADMIN: 'Entity Admin', ADMIN: 'Admin Gerai', CASHIER: 'Kasir' };
  const STAFF_KEYS = ['lekerOwnerToken', 'lekerEntityAdminToken', 'lekerAdminToken', 'lekerCashierToken', 'lekerAdminStoreCode', 'lekerAdminPin', 'lekerStaffSessionMeta', leaseKey];

  const read = key => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
  const randomId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      try { return crypto.randomUUID(); } catch {}
    }
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  };

  function clearAllStaff() {
    for (const key of STAFF_KEYS) { try { localStorage.removeItem(key); } catch {} }
    try { sessionStorage.removeItem('lekerStaffHandoffId'); } catch {}
  }

  function workspaceFor(role, storeCode) {
    if (role === 'OWNER') return '/admin';
    if (role === 'ENTITY_ADMIN') return '/entity-admin';
    if (role === 'ADMIN') return storeCode ? `/s/${encodeURIComponent(storeCode)}/admin` : null;
    if (role === 'CASHIER') return '/cashier';
    return null;
  }

  // Sesi yang masih tersimpan di browser ini. Identitas (meta) menentukan perannya; tanpa meta
  // (sesi versi lama) dipakai token pertama yang ada.
  function currentSession() {
    let meta = null;
    try { meta = JSON.parse(read('lekerStaffSessionMeta') || 'null'); } catch {}
    const roles = meta?.role && read(TOKEN_KEY[meta.role]) ? [meta.role] : STAFF_ROLES.filter(role => read(TOKEN_KEY[role]));
    const role = roles[0];
    if (!role) return null;
    const storeCode = role === 'ADMIN' ? read('lekerAdminStoreCode') || meta?.storeCode || '' : meta?.storeCode || '';
    const href = workspaceFor(role, storeCode);
    if (!href) return null;
    const name = (meta?.role === role && meta?.name) || ROLE_LABEL[role];
    return { role, name, storeCode, href };
  }

  async function logoutEverywhere() {
    const calls = [];
    const post = (path, token) => calls.push(fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {}));
    const owner = read('lekerOwnerToken');
    const entity = read('lekerEntityAdminToken');
    const admin = read('lekerAdminToken');
    const cashier = read('lekerCashierToken');
    if (owner) post('/api/owner/logout', owner);
    if (entity) post('/api/entity-admin/logout', entity);
    if (admin) post(`/api/store-admin/logout?store=${encodeURIComponent(read('lekerAdminStoreCode'))}`, admin);
    if (cashier) post('/api/cashier/logout', cashier);
    await Promise.race([Promise.all(calls), new Promise(resolve => setTimeout(resolve, 2500))]);
    clearAllStaff();
  }

  function show(state) {
    el('loginCard').dataset.state = state;
    el('loginContinue').hidden = state !== 'continue';
    form.hidden = state !== 'form';
    if (state === 'form') setTimeout(() => el('staffUsername')?.focus(), 30);
  }

  function showContinue(session) {
    el('accountAvatar').textContent = (session.name || '?').trim().charAt(0).toUpperCase() || '?';
    el('accountName').textContent = session.name;
    el('accountRole').textContent = session.storeCode && session.role !== 'OWNER' && session.role !== 'ENTITY_ADMIN'
      ? `${ROLE_LABEL[session.role]} · ${session.storeCode}`
      : ROLE_LABEL[session.role];
    el('continueLink').href = session.href;
    show('continue');
  }

  function staffIdentity(payload) {
    if (payload.role === 'OWNER') return payload.owner;
    if (payload.role === 'ADMIN') return payload.admin;
    if (payload.role === 'ENTITY_ADMIN') return payload.entityAdmin;
    if (payload.role === 'CASHIER') return payload.cashier;
    return null;
  }

  async function submitLogin() {
    const username = el('staffUsername').value.trim();
    const password = el('staffPassword').value;
    const message = el('staffLoginMessage');
    const submit = el('staffSubmit');
    if (!username || !password) {
      message.textContent = 'Username dan password wajib diisi.';
      return;
    }
    message.textContent = '';
    submit.disabled = true;
    submit.textContent = 'Memeriksa…';
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

      // Satu browser = satu akun: semua token karyawan lain (termasuk yang basi) dibuang dulu,
      // supaya tidak ada lagi halaman yang menebak peran dari token tertinggal.
      clearAllStaff();
      try {
        localStorage.setItem(TOKEN_KEY[payload.role], payload.token);
        if (payload.role === 'ADMIN') localStorage.setItem('lekerAdminStoreCode', identity.store?.code || '');
        const name = identity.displayName || identity.employeeName || identity.username || '';
        localStorage.setItem('lekerStaffSessionMeta', JSON.stringify({ id: identity.id, role: payload.role, name, storeCode: identity.store?.code || '' }));
        const handoffId = randomId();
        sessionStorage.setItem('lekerStaffHandoffId', handoffId);
        localStorage.setItem(leaseKey, JSON.stringify({ owner: handoffId, stage: 'handoff', staffId: identity.id, role: payload.role, name, updatedAt: Date.now() }));
      } catch (storageError) {
        console.error('Gagal menulis status sesi lintas-tab, lanjut login tanpa fitur itu:', storageError);
      }
      // replace(): halaman login tidak tertinggal di riwayat, Back tidak kembali ke form.
      location.replace(payload.redirect || '/');
    } catch (error) {
      message.textContent = error.message;
      submit.disabled = false;
      submit.textContent = 'Masuk';
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    submitLogin();
  });
  el('togglePassword').addEventListener('click', () => {
    const input = el('staffPassword');
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    el('togglePassword').textContent = showing ? 'Lihat' : 'Sembunyi';
    el('togglePassword').setAttribute('aria-pressed', String(!showing));
    el('togglePassword').setAttribute('aria-label', showing ? 'Tampilkan password' : 'Sembunyikan password');
  });
  el('switchAccountBtn').addEventListener('click', async () => {
    const button = el('switchAccountBtn');
    button.disabled = true;
    button.textContent = 'Mengeluarkan akun…';
    await logoutEverywhere();
    button.disabled = false;
    button.textContent = 'Bukan Anda? Masuk dengan akun lain';
    show('form');
  });

  // staffBlocked=1: penjaga antar-tab baru saja mencabut sesi tab ini (akun lain masuk di tab
  // lain) -- tampilkan pesan, bukan tawaran "Lanjutkan" yang bisa membingungkan.
  const params = new URL(location.href).searchParams;
  const session = currentSession();
  if (session) showContinue(session);
  else show('form');
  if (params.get('staffBlocked') === '1') {
    el('staffLoginMessage').textContent = 'Akun lain baru saja masuk di browser ini. Silakan pilih akun.';
  }
})();
