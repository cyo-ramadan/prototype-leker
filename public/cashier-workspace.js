(() => {
  async function applyWorkspace({ includeMenu = true } = {}) {
    const payload = await api('/api/cashier/workspace');
    state.cashier = payload.cashier || state.cashier;
    state.orders = payload.orders || [];
    state.drawer = payload.drawer || null;
    state.readOnly = Boolean(payload.readOnly);
    // Mode Lihat (Bos Cyo, 2026-10-05): Owner/Entity Admin/Admin Gerai boleh mencoba SEMUA fungsi
    // kasir supaya tahu apa yang dikerjakan CS; tombol tidak dimatikan di tengah alur. Penolakan
    // terjadi di server saat simpan/kirim (403 CASHIER_READ_ONLY_MODE), jadi tampilan menganggap
    // pengunjung "boleh coba". Server tetap mengembalikan canWrite=false untuk mereka.
    state.canWrite = Boolean(payload.canWrite) || state.readOnly;
    // Distinct from canWrite: a real cashier with no drawer open yet is
    // also canWrite=false (they just haven't opened one), and must still
    // see "Buka Laci" enabled -- readOnly is the actual "never able to
    // write, no matter what" signal for an Owner/Admin Gerai/Entity Admin
    // viewer (see src/cashier-auth.js requireCashierOrReadOnlyManagement).
    state.readOnly = Boolean(payload.readOnly);
    state.paymentMethods = payload.paymentMethods || [];
    state.cashFlowCounterparts = payload.cashFlowCounterparts || [];
    state.sharedAccounts = payload.sharedAccounts || [];
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
    location.replace('/login');
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
    // Mode Lihat: openDashboard di sini MENIMPA versi di cashier.js, jadi tombol kembali harus
    // dipasang dari sini (state.readOnly dari server = pengunjung manajemen tanpa akun kasir).
    state.viewerMode = Boolean(state.readOnly);
    renderViewerNavigation(cashier);
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
