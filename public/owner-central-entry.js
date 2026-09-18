(() => {
  showOwnerLogin = function showCentralStaffEntry() {
    location.replace('/?login=staff');
  };

  ownerEl('ownerLogoutBtn')?.addEventListener('click', async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const token = localStorage.getItem('lekerOwnerToken') || '';
    try {
      if (token) {
        await fetch('/api/owner/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    } catch {}
    window.lekerClearStaffSession?.();
    localStorage.removeItem('lekerOwnerToken');
    localStorage.removeItem('lekerStaffSessionMeta');
    location.href = '/?login=staff';
  }, true);
})();
