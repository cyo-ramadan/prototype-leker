(() => {
  const pathname = location.pathname;
  const isCashier = pathname === '/cashier' || /\/cashier\/?$/.test(pathname);
  const isStaffPortal = pathname === '/staff' || /\/staff\/?$/.test(pathname);
  const isOwner = pathname === '/admin' || pathname === '/owner';
  // The page declares what it is (window.LEKER_PAGE_CONTEXT, set in <head>
  // before this guard runs). Deriving it from the URL alone silently missed
  // /branch-admin -- reachable directly, carrying no /s/:code prefix and not
  // ending in "/admin" -- so this guard let an unauthenticated visitor straight
  // through onto the Admin shell instead of sending them to login.
  const isBranchAdmin = !isOwner && (window.LEKER_PAGE_CONTEXT === 'admin' || /\/admin\/?$/.test(pathname));
  // Bos Cyo, 2026-09-17: "harusnya liat persis banget halaman kasir, tapi
  // dia ga bisa write" -- Owner/Admin Gerai/Entity Admin sekarang boleh
  // buka halaman Kasir ASLI (bukan halaman baru) lewat ?readonly=1 secara
  // eksplisit (lihat "Lihat Kasir (Read-only)" di branch-admin.html) tanpa
  // token kasir. Sengaja disyaratkan ?readonly=1 -- tanpa itu, perilaku
  // "Kasir Login" biasa (bare /cashier) tetap PERSIS seperti sebelumnya,
  // tidak ikut melonggar cuma karena kebetulan ada token Owner/Entity
  // Admin/Admin Gerai nganggur di localStorage.
  const isReadOnlyPreview = isCashier && new URLSearchParams(location.search).get('readonly') === '1';

  const allowed = (isCashier || isStaffPortal)
    ? Boolean(localStorage.getItem('lekerCashierToken'))
      || (isReadOnlyPreview && Boolean(localStorage.getItem('lekerOwnerToken') || localStorage.getItem('lekerAdminToken') || localStorage.getItem('lekerEntityAdminToken')))
    : isOwner
      ? Boolean(localStorage.getItem('lekerOwnerToken'))
      : isBranchAdmin
        ? Boolean(localStorage.getItem('lekerOwnerToken') || localStorage.getItem('lekerAdminToken') || localStorage.getItem('lekerEntityAdminToken'))
        : true;

  if (!allowed) location.replace('/?login=staff');
})();
