(() => {
  const pathname = location.pathname;
  const isCashier = pathname === '/cashier' || /\/cashier\/?$/.test(pathname);
  const isStaffPortal = pathname === '/staff' || /\/staff\/?$/.test(pathname);
  const isOwner = pathname === '/admin' || pathname === '/owner';
  const isBranchAdmin = /\/admin\/?$/.test(pathname) && !isOwner;

  const allowed = (isCashier || isStaffPortal)
    ? Boolean(sessionStorage.getItem('lekerCashierToken'))
    : isOwner
      ? Boolean(sessionStorage.getItem('lekerOwnerToken'))
      : isBranchAdmin
        ? Boolean(sessionStorage.getItem('lekerOwnerToken') || sessionStorage.getItem('lekerAdminToken'))
        : true;

  if (!allowed) location.replace('/?login=staff');
})();
