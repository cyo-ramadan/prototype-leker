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

  const allowed = (isCashier || isStaffPortal)
    ? Boolean(sessionStorage.getItem('lekerCashierToken'))
    : isOwner
      ? Boolean(sessionStorage.getItem('lekerOwnerToken'))
      : isBranchAdmin
        ? Boolean(sessionStorage.getItem('lekerOwnerToken') || sessionStorage.getItem('lekerAdminToken'))
        : true;

  if (!allowed) location.replace('/?login=staff');
})();
