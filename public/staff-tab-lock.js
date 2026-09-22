(() => {
  // Guard sesi karyawan antar tab.
  //
  // PERUBAHAN BESAR 2026-09-18 (Bos Cyo): dulu ini guard "SATU TAB" -- tab
  // kedua selalu diblokir walau isinya orang yang sama. Bos Cyo: "harusnya
  // meskipun dia buka program pos ini 2 tab ga masalah, yang penting di 2 tab
  // itu ga pindah user." Sekarang guardnya "SATU USER": beberapa tab dengan
  // karyawan YANG SAMA dibiarkan jalan berdampingan, yang diblokir cuma tab
  // yang usernya BERBEDA dari yang sedang memegang browser ini.
  //
  // Kenapa pindah user tetap harus diblokir: token karyawan disimpan satu key
  // per pangkat di localStorage (lekerCashierToken dst) dan localStorage itu
  // dibagi seluruh tab. Kalau user B login sementara tab user A masih terbuka,
  // token A tertimpa token B -- tab A lalu mengirim transaksi memakai token
  // orang lain tanpa ada yang sadar. Itu bahaya data, bukan sekadar repot.
  const leaseKey = 'lekerStaffBrowserLease';

  // Satu tempat untuk membersihkan SELURUH jejak sesi karyawan di browser --
  // token, identitas, dan lease. Dipanggil semua tombol logout (Kasir, Portal
  // Staf, Owner, Admin Gerai, Entity Admin). Dulu tiap logout cuma menghapus
  // tokennya sendiri: lease-nya tertinggal, jadi karyawan BERIKUTNYA yang mau
  // login di perangkat yang sama masih dianggap "user lain sedang aktif"
  // sampai lease-nya kedaluwarsa sendiri. File ini dimuat di semua halaman
  // staf, jadi helper-nya sengaja diekspos SEBELUM guard di bawah -- supaya
  // tetap tersedia walau halaman ini dibuka tanpa sesi sama sekali.
  window.lekerClearStaffSession = () => {
    for (const key of ['lekerCashierToken', 'lekerOwnerToken', 'lekerAdminToken', 'lekerEntityAdminToken', 'lekerStaffSessionMeta', leaseKey]) {
      try { localStorage.removeItem(key); } catch {}
    }
    try { sessionStorage.removeItem('lekerStaffHandoffId'); } catch {}
  };

  const metaRaw = localStorage.getItem('lekerStaffSessionMeta');
  if (!metaRaw) return;

  let meta;
  try { meta = JSON.parse(metaRaw); } catch { return; }
  if (!meta?.id || !meta?.role) return;

  const ttlMs = 15000;
  const heartbeatMs = 5000;
  const pageId = crypto.randomUUID();
  let blocked = false;

  function readLease() {
    try { return JSON.parse(localStorage.getItem(leaseKey) || 'null'); }
    catch { return null; }
  }

  function leaseIsFresh(lease) {
    return Boolean(lease?.owner) && Date.now() - Number(lease.updatedAt || 0) <= ttlMs;
  }

  // Inti aturan barunya. Lease lama yang belum sempat membawa staffId (ditulis
  // versi sebelum perubahan ini, masih nyangkut di browser user) dianggap
  // "user sama" -- lebih baik meloloskan satu lease basi daripada menendang
  // keluar orang yang sebenarnya berhak.
  function leaseIsOtherUser(lease) {
    if (!lease?.staffId) return false;
    return lease.staffId !== meta.id || lease.role !== meta.role;
  }

  function writeLease() {
    localStorage.setItem(leaseKey, JSON.stringify({
      owner: pageId,
      stage: 'active',
      staffId: meta.id,
      role: meta.role,
      name: meta.name || '',
      updatedAt: Date.now()
    }));
  }

  function clearOwnLease() {
    const lease = readLease();
    if (lease?.owner === pageId) localStorage.removeItem(leaseKey);
  }

  // SENGAJA tidak menghapus token di sini. Di guard versi lama itu benar (yang
  // diblokir adalah tab kedua milik user yang sama, tokennya memang tokennya
  // sendiri). Sekarang tab yang diblokir justru tab yang usernya SUDAH BUKAN
  // pemegang browser ini -- token di localStorage sudah milik user yang baru,
  // jadi menghapusnya berarti menendang keluar orang yang justru sedang sah
  // memakai aplikasi.
  function block() {
    if (blocked) return;
    blocked = true;
    sessionStorage.removeItem('lekerStaffHandoffId');
    location.replace('/?login=staff&staffBlocked=1');
  }

  // Bos Cyo, 2026-09-22 (kasir Pendem): "berhasil login abis itu kepental
  // balik lagi ke halaman login dan status logout." Akar KEDUA, terpisah
  // dari perbaikan sesi persisten tadi -- ini race antar tab. submitLogin()/
  // persistStaffSessionAndReload() menulis meta+lease lalu pindah halaman;
  // di jeda singkat sebelum halaman baru ini sempat mount, tab LAIN yang
  // masih terbuka dari user sebelumnya (belum logout resmi) bisa saja
  // heartbeat-nya (tiap 5 detik, lihat writeLease() di bawah) kebetulan
  // jalan duluan dan menimpa balik lease ke identitas lama -- lease itu
  // murni "siapa nulis terakhir", tidak ada urutan/generasi. Akibatnya
  // login yang BARU SAJA berhasil malah menganggap dirinya sendiri "user
  // lain" dan menendang diri sendiri.
  //
  // sessionStorage TIDAK dibagi antar tab (beda dari localStorage), jadi
  // lekerStaffHandoffId yang ditulis tepat sebelum pindah halaman itu bukti
  // kuat: kalau ada di tab ini, login barusan memang terjadi DI TAB INI
  // SENDIRI, bukan warisan dari tab lain -- lebih bisa dipercaya daripada
  // lease yang rentan ditimpa tab lain. Jadi tab pemegang handoff SELALU
  // dianggap sah, berapa pun isi lease saat ini, lalu langsung menimpanya --
  // tab lama (kalau masih ada) yang kena tendang lewat heartbeat-nya
  // sendiri berikutnya, bukan sebaliknya.
  const freshHandoff = Boolean(sessionStorage.getItem('lekerStaffHandoffId'));

  const existing = readLease();
  if (!freshHandoff && leaseIsFresh(existing) && leaseIsOtherUser(existing)) {
    block();
    return;
  }

  writeLease();
  sessionStorage.removeItem('lekerStaffHandoffId');

  // Dipertahankan dari perbaikan 2026-09-15 (navigasi Kasir <-> Portal Staf
  // sempat dikira "tab kompetitor" oleh guard lama, lihat KNOWN_PITFALLS).
  // Dengan guard berbasis user, navigasi in-app sebenarnya sudah aman dengan
  // sendirinya -- usernya kan sama. Fungsinya tetap disediakan supaya pemanggil
  // yang sudah ada tidak error, dan supaya kebiasaan memanggilnya tidak hilang
  // kalau nanti aturannya diperketat lagi.
  window.lekerPrepareStaffHandoff = () => {
    sessionStorage.setItem('lekerStaffHandoffId', pageId);
  };

  const heartbeat = setInterval(() => {
    if (blocked) return;
    const lease = readLease();
    if (leaseIsFresh(lease) && leaseIsOtherUser(lease)) {
      clearInterval(heartbeat);
      block();
      return;
    }
    // Lease diperbarui terus walau pemiliknya tab lain dengan user yang sama --
    // dua tab yang sama-sama sah memang saling menimpa di sini, dan itu tidak
    // apa-apa: yang dibandingkan staffId, bukan siapa pemilik lease terakhir.
    writeLease();
  }, heartbeatMs);

  window.addEventListener('storage', event => {
    if (event.key !== leaseKey || blocked) return;
    const lease = readLease();
    if (leaseIsFresh(lease) && leaseIsOtherUser(lease)) {
      clearInterval(heartbeat);
      block();
    }
  });

  window.addEventListener('beforeunload', clearOwnLease);
})();
