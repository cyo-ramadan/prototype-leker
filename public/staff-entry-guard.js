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
  // Read-only Kasir preview (public/cashier-preview.js) for Owner/Admin
  // Gerai/Entity Admin -- declares its own context the same defensive way
  // isBranchAdmin does, so a bookmark/shortcut without the /s/:code/ prefix
  // still gates correctly instead of silently falling through.
  const isCashierPreview = window.LEKER_PAGE_CONTEXT === 'cashier-preview';

  const allowed = (isCashier || isStaffPortal)
    ? Boolean(sessionStorage.getItem('lekerCashierToken'))
    : isOwner
      ? Boolean(localStorage.getItem('lekerOwnerToken'))
      : (isBranchAdmin || isCashierPreview)
        ? Boolean(localStorage.getItem('lekerOwnerToken') || localStorage.getItem('lekerAdminToken') || localStorage.getItem('lekerEntityAdminToken'))
        : true;

  if (!allowed) location.replace('/?login=staff');
})();
