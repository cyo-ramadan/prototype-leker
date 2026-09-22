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

  // Bos Cyo, 2026-09-22: REVERT PARSIAL. 2026-09-21 perbaikan ini diperluas
  // supaya klik tab "Karyawan" manual (bukan cuma URL /?login=staff) juga
  // auto-redirect kalau sesi masih valid -- niatnya benar ("kalo dia uda
  // login jadi karyawan disuatu tab, ketika klik login lagi di tab yang
  // lain, harusnya langsung landing"), tapi ternyata berbahaya di device
  // yang dipakai BERGANTIAN oleh beberapa kasir (mis. satu HP/laptop kasir
  // gantian shift): begitu kasir B klik tab "Karyawan" untuk login sebagai
  // DIRINYA SENDIRI, kode ini melihat masih ada token kasir A yang valid di
  // localStorage dan langsung melempar B ke sesi A tanpa sempat menampilkan
  // form sama sekali -- B tidak pernah dapat kesempatan mengetik username
  // sendiri. Kasir Pendem (adependemk2s2) mengalami 13x percobaan login
  // berhasil di server (cashier_sessions) tapi tidak pernah benar-benar
  // masuk selama ~5 jam sejak fix ini live -- polanya cocok dengan loop
  // redirect ini, bukan gagal login sungguhan. Dikembalikan ke perilaku
  // semula yang sudah terbukti aman: auto-redirect CUMA untuk URL
  // /?login=staff persis (skenario tombol Back, 2026-09-17) -- itu jalur
  // yang device-nya bisa dipastikan masih sama, bukan potensi ganti orang.
  // Klik tab "Karyawan" manual sekarang selalu menampilkan form lagi,
  // seperti sebelum 2026-09-21 -- iya, itu berarti kasir yang SAMA klik
  // ulang harus mengetik lagi, tapi itu jauh lebih aman daripada diam-diam
  // masuk ke sesi orang lain.
  function existingStaffWorkspaceRedirect() {
    if (localStorage.getItem('lekerOwnerToken')) return '/admin';
    if (localStorage.getItem('lekerEntityAdminToken')) return '/entity-admin';
    const adminStoreCode = localStorage.getItem('lekerAdminStoreCode');
    if (localStorage.getItem('lekerAdminToken') && adminStoreCode) return `/s/${encodeURIComponent(adminStoreCode)}/admin`;
    if (localStorage.getItem('lekerCashierToken')) return '/cashier';
    return null;
  }

  function applyMode(nextMode) {
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

    // Pengecekan lease SENGAJA tidak lagi dilakukan di sini (sebelum submit).
    // Dulu: ada lease aktif apa pun -> login langsung ditolak, walau yang mau
    // login ORANG YANG SAMA. Itu salah satu sumber "risih" yang dilaporkan Bos
    // Cyo 2026-09-18. Sekarang lease baru diperiksa SESUDAH server memberi tahu
    // siapa yang login (lihat di bawah), karena sebelum submit kita memang
    // belum tahu identitasnya -- dan yang perlu dicegah cuma PINDAH USER,
    // bukan login ulang orang yang sama.
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

      // Baru DI SINI lease diperiksa -- sesudah tahu siapa yang login. Yang
      // dicegah cuma PINDAH USER di browser yang sama (Bos Cyo: "yang penting
      // di 2 tab itu ga pindah user"); login ulang orang yang sama lewat mulus.
      // Satu browser memang cuma muat satu sesi karyawan, karena tokennya satu
      // key per pangkat di localStorage -- kalau user lain menimpanya, tab lama
      // akan memakai token orang lain tanpa sadar, dan itu jauh lebih berbahaya
      // daripada sekadar merepotkan.
      const lease = mode === 'STAFF' ? activeStaffLease() : null;
      if (lease?.staffId && (lease.staffId !== identity.id || lease.role !== payload.role)) {
        if (message) {
          message.textContent = `Masih ada sesi karyawan lain (${lease.name || lease.role}) yang aktif di browser ini. Logout dari tab itu dulu, atau tutup tabnya, baru login di sini.`;
        }
        return;
      }

      // Semua pangkat -- TERMASUK KASIR -- sekarang di localStorage. Dulu kasir
      // sengaja ditaruh di sessionStorage dengan alasan "terikat lifecycle laci",
      // tapi itu tidak pernah benar: tidak ada satu pun kode yang menutup laci
      // saat tab ditutup (dicek langsung, 2026-09-18) -- lacinya tetap terbuka
      // di server, cuma kasirnya yang dipaksa login ulang. sessionStorage juga
      // ikut hilang saat OS/Chrome membuang browsing context di HP walau tabnya
      // tidak pernah ditutup -- persis bug yang sudah diperbaiki untuk
      // Owner/Admin pada 2026-09-13, cuma waktu itu kasir tidak ikut disentuh.
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
      const handoffId = crypto.randomUUID();
      sessionStorage.setItem('lekerStaffHandoffId', handoffId);
      localStorage.setItem(leaseKey, JSON.stringify({
        owner: handoffId,
        stage: 'handoff',
        staffId: identity.id,
        role: payload.role,
        name: identity.displayName || identity.employeeName || identity.username || '',
        updatedAt: Date.now()
      }));
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
  // sengaja ke back back malah ada menu loginnya lagi". Kalau token masih
  // ada, lempar langsung ke workspace-nya alih-alih menampilkan form. Kalau
  // token itu ternyata sudah kedaluwarsa/dicabut server, halaman tujuan
  // sendiri yang akan mendeteksi dan menampilkan login-nya (pola yang sama
  // seperti admin-session-bootstrap-guard.js) -- redirect ini tidak
  // menggantikan pengecekan server, cuma menghindari form login yang
  // sebenarnya tidak perlu dilihat. CUMA untuk URL /?login=staff persis --
  // lihat catatan revert 2026-09-22 di atas untuk kenapa ini sengaja tidak
  // diperluas lagi ke klik tab manual.
  if (new URL(location.href).searchParams.get('login') === 'staff') {
    const staffBlocked = new URL(location.href).searchParams.get('staffBlocked') === '1';
    const existingRedirect = !staffBlocked && existingStaffWorkspaceRedirect();
    if (existingRedirect) {
      location.replace(existingRedirect);
      return;
    }
    el('entryLoginBtn')?.click();
    const clean = new URL(location.href);
    clean.searchParams.delete('login');
    history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
  }
})();
