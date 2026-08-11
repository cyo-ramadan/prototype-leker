(() => {
  showOwnerLogin = function showCentralStaffEntry() {
    location.replace('/?login=staff');
  };

  ownerEl('ownerLogoutBtn')?.addEventListener('click', async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const token = sessionStorage.getItem('lekerOwnerToken') || '';
    try {
      if (token) {
        await fetch('/api/owner/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    } catch {}
    sessionStorage.removeItem('lekerOwnerToken');
    sessionStorage.removeItem('lekerStaffSessionMeta');
    location.href = '/?login=staff';
  }, true);
})();
