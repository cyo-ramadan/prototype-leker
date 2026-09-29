(() => {
  const form = document.getElementById('entryLoginForm');
  if (!form) return;

  const el = id => document.getElementById(id);
  const storeCode = String(window.LEKER_STORE_CODE || 'G001').toUpperCase();
  const leaseKey = 'lekerStaffBrowserLease';
  // Bos Cyo, 2026-09-22: kasir Pendem masih kepental balik ke login sesudah
  // dua perbaikan sebelumnya, 4x berturut-turut dalam semenit -- pola PASTI
  // gagal, bukan sesekali (race). crypto.randomUUID() baru didukung luas
  // sejak ~2022 dan bisa tidak ada di browser/WebView lawas; kalau melempar
  // TypeError di submitLogin(), seluruh alur berhenti SEBELUM
  // location.replace() sempat jalan -- pengguna cuma lihat error di form
  // yang sama, persis "kepental balik ke login". randomId() tidak pernah
  // melempar, dan ID-nya cuma perlu unik per login, tidak perlu acak
  // kriptografis.
  const randomId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      try { return crypto.randomUUID(); } catch {}
    }
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  };
  let mode = new URL(location.href).searchParams.get('login') === 'staff' ? 'STAFF' : 'CUSTOMER';

  const note = form.querySelector('.entry-login-note');
  const tabs = document.createElement('div');
  tabs.className = 'entry-login-role-tabs';
  tabs.innerHTML = `
    <button id="entryCustomerTab" class="entry-login-role-tab" type="button">Pelanggan</button>
    <button id="entryStaffTab" class="entry-login-role-tab" type="button">Karyawan</button>`;
  form.insertBefore(tabs, note);

  // Bos Cyo, 2026-09-22: "maunya ya sekali login baik di tab manapun ya
  // tetap dia yang login sebelum logout. kalo hp dibuat gantian, ya harus
  // di logout in dulu... coba cek di facebook, tiktok dsb apa juga bisa
  // seperti itu." Final design, matching mainstream apps: a valid session
  // in this browser ALWAYS wins -- any entry into STAFF mode (URL or manual
  // "Karyawan" tab click) redirects straight to that identity's workspace,
  // no login form shown at all. To become a DIFFERENT person, you must
  // explicitly Logout first (always visible in the topbar); only then does
  // the form appear, and whoever submits it next simply becomes the new
  // session -- no "someone else is still active" refusal (removed below).
  // This is intentionally the OPPOSITE of the 2026-09-22 same-day hotfix
  // that scoped the redirect back to the /?login=staff URL only: that
  // hotfix assumed showing someone else's session first was unsafe, but
  // Bos Cyo confirmed it is the expected, standard behavior -- the actual
  // bug it was chasing (kasir Pendem stuck relogging in) was a SEPARATE
  // defect: public/cashier.js's own dedicated login form never wrote
  // lekerStaffSessionMeta/lease at all, so staff-tab-lock.js was comparing
  // against a stale identity from whoever last left this browser without
  // logging out. Fixed at the source in cashier.js; this redirect returns
  // to the broader, Facebook-like behavior Bos Cyo actually asked for.
  function existingStaffWorkspaceRedirect() {
    if (localStorage.getItem('lekerOwnerToken')) return '/admin';
    if (localStorage.getItem('lekerEntityAdminToken')) return '/entity-admin';
    const adminStoreCode = localStorage.getItem('lekerAdminStoreCode');
    if (localStorage.getItem('lekerAdminToken') && adminStoreCode) return `/s/${encodeURIComponent(adminStoreCode)}/admin`;
    if (localStorage.getItem('lekerCashierToken')) return '/cashier';
    return null;
  }

  function applyMode(nextMode) {
    if (nextMode === 'STAFF') {
      // staffBlocked=1 means the tab-lock deliberately just cleared this
      // session's token -- the redirect must not fire off a stale read in
      // that exact moment and must still fall through to the login form.
      const staffBlocked = new URL(location.href).searchParams.get('staffBlocked') === '1';
      const existingRedirect = !staffBlocked && existingStaffWorkspaceRedirect();
      if (existingRedirect) {
        location.replace(existingRedirect);
        return;
      }
    }
    mode = nextMode;
    el('entryCustomerTab')?.classList.toggle('active', mode === 'CUSTOMER');
    el('entryStaffTab')?.classList.toggle('active', mode === 'STAFF');
    if (note) {
      note.textContent = mode === 'CUSTOMER'
        ? 'Login pelanggan berlaku pada gerai yang dipilih. Belanja tetap bisa tanpa login.'
        : 'Login karyawan otomatis menentukan pangkat Owner, Entity Admin, Admin Gerai, atau Kasir.';
    }
    if (el('entryRegisterOpen')) el('entryRegisterOpen').hidden = mode === 'STAFF';
    if (el('continueGuestBtn')) el('continueGuestBtn').textContent = mode === 'STAFF' ? 'Kembali ke halaman customer' : 'Lanjut beli tanpa login';
    if (el('entrySubmit')) el('entrySubmit').textContent = mode === 'STAFF' ? 'LOGIN KARYAWAN' : 'LOGIN PELANGGAN';
    if (el('entryLoginMessage')) el('entryLoginMessage').textContent = '';
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
      const path = mode === 'STAFF'
        ? '/api/auth/staff-login'
        : `/api/auth/customer-login?store=${encodeURIComponent(storeCode)}`;
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const payload = await response.json().catch(() => ({}));

      // Penanganan 409 STAFF_SESSION_ACTIVE ("Ambil alih sesi") sudah dicabut
      // -- server tidak pernah mengirimkannya lagi (src/unified-login.js).
      if (!response.ok) throw new Error(payload.error || 'Login gagal.');

      if (mode === 'CUSTOMER') {
        if (payload.role !== 'CUSTOMER' || !payload.customer) throw new Error('Akun ini bukan akun pelanggan.');
        sessionStorage.setItem(`lekerCustomerToken:${storeCode}`, payload.token);
        location.reload();
        return;
      }

      if (!['OWNER', 'ADMIN', 'ENTITY_ADMIN', 'CASHIER'].includes(payload.role)) throw new Error('Akun ini bukan akun karyawan.');
      const identity = staffIdentity(payload);
      if (!identity?.id) throw new Error('Identitas karyawan tidak lengkap.');

      // Bos Cyo, 2026-09-22: login yang berhasil SELALU menang dan menjadi
      // sesi aktif browser ini -- tidak ada lagi penolakan "masih ada sesi
      // karyawan lain". Kalau device ini sebelumnya dipegang orang lain,
      // menimpa token/identitasnya di sini memang tujuannya (dia harus
      // logout dulu baru form ini bisa dicapai lewat redirect di atas --
      // begitu form ini benar-benar terlihat dan disubmit, siapa pun yang
      // login berhak jadi sesi baru). staff-tab-lock.js di tab LAIN yang
      // masih terbuka dengan identitas lama tetap akan mendeteksi dan
      // menendang dirinya sendiri sendiri lewat heartbeat/storage event --
      // itu perlindungan yang tetap jalan, cuma bukan lagi di titik submit.
      // Semua pangkat -- TERMASUK KASIR -- sekarang di localStorage. Dulu kasir
      // sengaja ditaruh di sessionStorage dengan alasan "terikat lifecycle laci",
      // tapi itu tidak pernah benar: tidak ada satu pun kode yang menutup laci
      // saat tab ditutup (dicek langsung, 2026-09-18) -- lacinya tetap terbuka
      // di server, cuma kasirnya yang dipaksa login ulang. sessionStorage juga
      // ikut hilang saat OS/Chrome membuang browsing context di HP walau tabnya
      // tidak pernah ditutup -- persis bug yang sudah diperbaiki untuk
      // Owner/Admin pada 2026-09-13, cuma waktu itu kasir tidak ikut disentuh.
      // Bos Cyo, 2026-09-22: kasir Pendem masih kepental balik ke login
      // sesudah dua perbaikan sebelumnya -- 4x berturut-turut gagal dalam
      // semenit, pola PASTI gagal, bukan sesekali. Token di atas SUDAH sah
      // di server pada titik ini (login sebenarnya sudah berhasil); kalau
      // langkah bookkeeping meta+lease di bawah melempar apa pun (localStorage
      // penuh, mode privat yang membatasi storage, dsb), itu tidak boleh
      // menggagalkan login yang sudah sah -- login lintas-tab cuma fitur
      // tambahan, bukan syarat bisa masuk. Ditangkap terpisah supaya
      // location.replace() di bawah tetap selalu jalan.
      try {
        localStorage.setItem(staffTokenKey(payload.role), payload.token);
        if (payload.role === 'ADMIN') localStorage.setItem('lekerAdminStoreCode', identity.store?.code || '');
        // Meta ikut ke localStorage: guard antar-tab harus bisa membandingkan
        // SIAPA yang sedang aktif, dan itu mustahil kalau identitasnya ikut hilang
        // bersama tab.
        localStorage.setItem('lekerStaffSessionMeta', JSON.stringify({
          id: identity.id,
          role: payload.role,
          name: identity.displayName || identity.employeeName || identity.username || '',
          storeCode: identity.store?.code || ''
        }));
        // handoffId tetap di sessionStorage -- ini memang harus per-tab (penanda
        // "halaman berikutnya adalah diri saya sendiri"), bukan dibagi antar tab.
        const handoffId = randomId();
        sessionStorage.setItem('lekerStaffHandoffId', handoffId);
        localStorage.setItem(leaseKey, JSON.stringify({
          owner: handoffId,
          stage: 'handoff',
          staffId: identity.id,
          role: payload.role,
          name: identity.displayName || identity.employeeName || identity.username || '',
          updatedAt: Date.now()
        }));
      } catch (storageError) {
        console.error('Gagal menulis status sesi lintas-tab, lanjut login tanpa fitur itu:', storageError);
      }
      // replace(), bukan href: halaman login tidak boleh tertinggal di history.
      // Bos Cyo: "ke back ada pilihan login lagi" -- itu karena entry login
      // masih ada di riwayat, jadi tombol Back selalu bisa balik ke form.
      location.replace(payload.redirect || '/');
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

  // Bos Cyo, 2026-09-17: "jangan sampe orang yang uda berhasil login, dia ga
  // sengaja ke back back malah ada menu loginnya lagi". applyMode(mode) di
  // atas sudah menjalankan pengecekan redirect kalau mode awal ini STAFF
  // (URL bawa ?login=staff) -- kalau itu terjadi, halaman sudah pindah dan
  // baris-baris di bawah ini tidak akan sempat jalan. Kalau TIDAK redirect
  // (belum ada sesi valid), sisanya di sini cuma membuka modal login dan
  // membersihkan query string dari URL.
  if (new URL(location.href).searchParams.get('login') === 'staff') {
    el('entryLoginBtn')?.click();
    const clean = new URL(location.href);
    clean.searchParams.delete('login');
    history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
  }
})();
