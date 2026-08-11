(() => {
  let refreshInFlight = null;

  async function refreshCashierState({ notify = false } = {}) {
    if (!state.token || document.hidden) return;
    if (refreshInFlight) return refreshInFlight;

    const button = el('refreshOrdersBtn');
    if (button) {
      button.disabled = true;
      button.textContent = '↻ Memuat...';
    }

    refreshInFlight = Promise.all([loadOrders(), loadDrawer()])
      .then(() => {
        if (notify) toast('Pesanan dan status laci diperbarui');
      })
      .catch(error => {
        if (error?.status !== 401) toast(error?.message || 'Gagal memperbarui data kasir.');
      })
      .finally(() => {
        refreshInFlight = null;
        if (button) {
          button.disabled = false;
          button.textContent = '↻ Refresh Pesanan';
        }
      });

    return refreshInFlight;
  }

  startPolling = function bindCashierRefreshEvents() {
    if (state.poller) clearInterval(state.poller);
    state.poller = null;

    if (state.visibilityBound) return;

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.token) refreshCashierState();
    });
    window.addEventListener('focus', () => {
      if (state.token) refreshCashierState();
    });
    state.visibilityBound = true;
  };

  el('refreshOrdersBtn')?.addEventListener('click', () => refreshCashierState({ notify: true }));
})();
