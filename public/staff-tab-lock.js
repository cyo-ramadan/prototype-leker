(() => {
  const metaRaw = sessionStorage.getItem('lekerStaffSessionMeta');
  if (!metaRaw) return;

  let meta;
  try { meta = JSON.parse(metaRaw); } catch { return; }
  if (!meta?.id || !meta?.role) return;

  const leaseKey = 'lekerStaffBrowserLease';
  const ttlMs = 15000;
  const heartbeatMs = 5000;
  const pageId = crypto.randomUUID();
  const handoffId = sessionStorage.getItem('lekerStaffHandoffId') || '';
  let blocked = false;

  const tokenKey = meta.role === 'OWNER'
    ? 'lekerOwnerToken'
    : meta.role === 'ADMIN'
      ? 'lekerAdminToken'
      : 'lekerCashierToken';
  // OWNER/ADMIN tokens live in localStorage (survive a discarded/reloaded tab
  // -- see branch-owner-auth.js); CASHIER stays sessionStorage. block() must
  // strip the token from wherever it actually lives, or a "blocked" tab keeps
  // a live token and can walk right back into the workspace.
  const tokenStore = meta.role === 'CASHIER' ? sessionStorage : localStorage;

  function readLease() {
    try { return JSON.parse(localStorage.getItem(leaseKey) || 'null'); }
    catch { return null; }
  }

  function writeLease() {
    localStorage.setItem(leaseKey, JSON.stringify({
      owner: pageId,
      stage: 'active',
      staffId: meta.id,
      role: meta.role,
      updatedAt: Date.now()
    }));
  }

  function clearOwnLease() {
    const lease = readLease();
    if (lease?.owner === pageId) localStorage.removeItem(leaseKey);
  }

  function block() {
    if (blocked) return;
    blocked = true;
    tokenStore.removeItem(tokenKey);
    sessionStorage.removeItem('lekerStaffSessionMeta');
    sessionStorage.removeItem('lekerStaffHandoffId');
    location.replace('/?login=staff&staffBlocked=1');
  }

  const existing = readLease();
  const existingActive = existing?.owner && Date.now() - Number(existing.updatedAt || 0) <= ttlMs;
  const isHandoff = handoffId && existing?.owner === handoffId;
  if (existingActive && !isHandoff) {
    block();
    return;
  }

  writeLease();
  sessionStorage.removeItem('lekerStaffHandoffId');

  // 2026-09-15, bug Bos Cyo: kasir Laili klik "Portal Staf" dari Kasir dan
  // langsung ter-logout. Root cause: navigasi Kasir<->Portal Staf itu
  // in-app-navigation biasa (bukan handoff dari halaman login), dan di HP
  // beforeunload/bfcache tidak selalu sempat membersihkan lease halaman lama
  // sebelum halaman baru mengecek -- lease lama masih kelihatan "aktif" dalam
  // window ttlMs, jadi halaman baru mengiranya tab lain dan blok dirinya
  // sendiri. Bukan disebabkan sesi kasir lain (Zahra) -- session per kasir
  // sudah terisolasi di server, dikonfirmasi dari cashier_sessions produksi.
  // Fix: expose fungsi yang link/tombol navigasi Kasir<->Portal Staf panggil
  // SEBELUM pindah halaman, supaya halaman tujuan mengenali page ini sebagai
  // handoff sah dari diri sendiri, sama seperti pola login (lihat
  // auth-entry-split.js) -- bukan dianggap tab kompetitor.
  window.lekerPrepareStaffHandoff = () => {
    sessionStorage.setItem('lekerStaffHandoffId', pageId);
  };

  const heartbeat = setInterval(() => {
    if (blocked) return;
    const lease = readLease();
    if (lease?.owner && lease.owner !== pageId && Date.now() - Number(lease.updatedAt || 0) <= ttlMs) {
      clearInterval(heartbeat);
      block();
      return;
    }
    writeLease();
  }, heartbeatMs);

  window.addEventListener('storage', event => {
    if (event.key !== leaseKey || blocked) return;
    const lease = readLease();
    if (lease?.owner && lease.owner !== pageId && Date.now() - Number(lease.updatedAt || 0) <= ttlMs) {
      clearInterval(heartbeat);
      block();
    }
  });

  window.addEventListener('beforeunload', clearOwnLease);
})();
