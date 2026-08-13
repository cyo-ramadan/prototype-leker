(() => {
  const el = id => document.getElementById(id);

  function notify(message) {
    const node = el('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => node.classList.remove('show'), 2800);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: { ...(options.headers || {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }

  function statusText(summary = {}) {
    return `POS → Jurnal: ${Number(summary.posted || 0)} posted · ${Number(summary.needsConfiguration || 0)} perlu setting · ${Number(summary.failed || 0)} gagal`;
  }

  async function refreshStatus() {
    const badge = el('accountingBridgeStatus');
    if (!badge) return;
    try {
      const payload = await api('/api/admin/accounting/bridge');
      badge.textContent = statusText(payload.summary);
      badge.title = 'Status delivery business fact POS ke Accounting';
    } catch (error) {
      badge.textContent = 'POS → Jurnal: status gagal dibaca';
      badge.title = error.message;
    }
  }

  async function syncPos() {
    const button = el('accountingBridgeSync');
    if (!button) return;
    button.disabled = true;
    try {
      const result = await api('/api/admin/accounting/bridge/sync', {
        method: 'POST',
        body: JSON.stringify({ limit: 50 })
      });
      notify(`Sync POS: ${result.posted} posted · ${result.needsConfiguration} perlu setting · ${result.failed} gagal`);
      await refreshStatus();
      el('accountingWorkspaceRefresh')?.click();
    } catch (error) {
      notify(error.message);
    } finally {
      button.disabled = false;
    }
  }

  function mount() {
    const toolbar = document.querySelector('#tab-accounting-workspace .acct-toolbar');
    const refresh = el('accountingWorkspaceRefresh');
    if (!toolbar || !refresh || el('accountingBridgeSync')) return false;
    const group = document.createElement('div');
    group.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end';
    group.innerHTML = '<span id="accountingBridgeStatus" class="acct-chip">POS → Jurnal: memuat…</span><button id="accountingBridgeSync" class="acct-refresh" type="button">↻ Sync Transaksi POS</button>';
    toolbar.insertBefore(group, refresh);
    el('accountingBridgeSync').addEventListener('click', syncPos);
    refresh.addEventListener('click', () => setTimeout(refreshStatus, 0));
    refreshStatus();
    return true;
  }

  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (mount() || tries > 50) clearInterval(timer);
  }, 100);
})();
