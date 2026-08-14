(() => {
  async function applyWorkspace({ includeMenu = true } = {}) {
    const payload = await api('/api/cashier/workspace');
    state.cashier = payload.cashier || state.cashier;
    state.orders = payload.orders || [];
    state.drawer = payload.drawer || null;
    state.canWrite = Boolean(payload.canWrite);
    state.paymentMethods = payload.paymentMethods || [];
    state.operationalAccountingComponents = payload.operationalAccountingComponents || [];
    if (includeMenu) {
      state.products = payload.products || [];
      renderMenu();
    }
    renderDrawer();
    renderOrders();
    renderDraft();
    document.dispatchEvent(new CustomEvent('cashier:workspace-applied'));
    return payload;
  }

  window.refreshCashierWorkspace = applyWorkspace;

  showLogin = function showCentralStaffLogin() {
    location.replace('/?login=staff');
  };

  openDashboard = async function openCashierWorkspace() {
    const cashier = state.cashier;
    el('cashierLoginView').classList.add('hidden');
    el('cashierDashboard').classList.remove('hidden');
    el('cashierTopActions').classList.remove('hidden');
    el('cashierBrandSub').textContent = `Cashier · ${cashier.store.code}`;
    el('cashierIdentity').textContent = `${cashier.employeeName} · ${cashier.store.code}`;
    el('cashierStoreLabel').textContent = `${cashier.store.code} · ${cashier.store.storeName}`;
    el('openKioskLink').href = `/s/${encodeURIComponent(cashier.store.code)}/customer`;
    await applyWorkspace({ includeMenu: true });
    startPolling();
  };

  loadOrders = async function loadWorkspaceOrders() {
    try {
      await applyWorkspace({ includeMenu: false });
    } catch (error) {
      if (error.status === 401) {
        clearSession();
        showLogin();
        return;
      }
      throw error;
    }
  };

  loadDrawer = async function loadWorkspaceDrawer() {
    return loadOrders();
  };

  setTimeout(() => {
    if (document.querySelector('script[data-cashier-payment-methods]')) return;
    const script = document.createElement('script');
    script.src = '/cashier-payment-methods.js';
    script.dataset.cashierPaymentMethods = '1';
    document.body.appendChild(script);
  }, 0);
})();
