(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const isBranchAdmin = Boolean(document.getElementById('adminApp'));
  const storeCode = String(window.LEKER_STORE_CODE || sessionStorage.getItem('lekerAdminStoreCode') || '').toUpperCase();

  function authSnapshot() {
    const ownerToken = sessionStorage.getItem('lekerOwnerToken') || '';
    const entityAdminToken = sessionStorage.getItem('lekerEntityAdminToken') || '';
    const adminToken = sessionStorage.getItem('lekerAdminToken') || '';
    return { ownerToken, entityAdminToken, adminToken, token: ownerToken || entityAdminToken || adminToken };
  }

  function requestUrl(path) {
    if (!isBranchAdmin || !storeCode) return path;
    const url = new URL(path, location.origin);
    url.searchParams.set('store', storeCode);
    return `${url.pathname}${url.search}`;
  }

  async function managementApi(path, options = {}) {
    const auth = authSnapshot();
    if (!auth.token) throw new Error('Session management tidak tersedia.');
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${auth.token}` };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(requestUrl(path), { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || `Request gagal (${response.status})`), { status: response.status, payload });
    return payload;
  }

  function requestLabel(request) {
    if (request.requestType === 'GOODS_FLOW' && request.payload?.purpose === 'STOCK_ADJUSTMENT') return 'STOCK ADJUSTMENT';
    if (request.requestType === 'CASH_FLOW' && request.payload?.purpose === 'DRAWER_OPENING_DISCREPANCY') return 'SELISIH SALDO AWAL LACI';
    return request.requestType;
  }

  function payloadSummary(request) {
    const payload = request.payload || {};
    if (request.requestType === 'CASH_FLOW' && payload.purpose === 'DRAWER_OPENING_DISCREPANCY') {
      return `Saldo awal dientry ${money(payload.enteredAmount)} · saldo akhir laci sebelumnya ${money(payload.expectedAmount)} · selisih ${money(payload.difference)}`;
    }
    if (request.requestType === 'CASH_FLOW') {
      const counterpart = [payload.accountingCounterpartAccountCode, payload.accountingCounterpartAccountName].filter(Boolean).join(' ');
      return `${payload.direction === 'OUT' ? 'Kas Keluar' : 'Kas Masuk'} · ${money(payload.amount)} · ${esc(payload.description || '')}${counterpart ? ` · Lawan: ${esc(counterpart)}` : ''}`;
    }
    if (request.requestType === 'GOODS_FLOW' && payload.purpose === 'STOCK_ADJUSTMENT') {
      const delta = Number(payload.targetQuantity || 0) - Number(payload.currentQuantitySnapshot || 0);
      return `Penyesuaian Stok · ${esc(payload.productName || `#${payload.productId || ''}`)} · ${Number(payload.currentQuantitySnapshot || 0)} → ${Number(payload.targetQuantity || 0)} ${esc(payload.unitSymbol || '')} · ${delta > 0 ? '+' : ''}${delta} · ${esc(payload.reason || '')}`;
    }
    if (request.requestType === 'GOODS_FLOW') {
      return `${payload.direction === 'OUT' ? 'Barang Keluar' : 'Barang Masuk'} · ${esc(payload.productName || `#${payload.productId || ''}`)} · ${Number(payload.quantity || 0)} qty`;
    }
    return `${payload.direction === 'DECREASE' ? 'Kurangi Aset' : 'Tambah Aset'} · ${money(payload.amount)} · ${esc(payload.description || '')}`;
  }

  function showMessage(message) {
    if (typeof ownerToast === 'function') {
      ownerToast(message);
      return;
    }
    const node = document.getElementById('adminToast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    setTimeout(() => node.classList.remove('show'), 2200);
  }

  function renderQueue(target, requests) {
    if (!requests.length) {
      target.innerHTML = '<div class="empty">Tidak ada pengajuan pending.</div>';
      return;
    }
    target.innerHTML = requests.map(request => `
      <article class="admin-card" style="box-shadow:none;margin-bottom:10px">
        <div class="list-head"><div><strong>${esc(requestLabel(request))}</strong><div class="muted">${esc(request.cashierName || request.cashierId)} · ${esc(request.storeId)}</div></div><span class="master-count">pending</span></div>
        <p>${payloadSummary(request)}</p>
        <div class="muted">${esc(request.payload?.note || '')}</div>
        ${request.requestType === 'GOODS_FLOW' && request.payload?.purpose === 'STOCK_ADJUSTMENT' ? '<div class="muted" style="margin-top:8px">ACC akan re-check stok aktual terhadap snapshot. Jika stok sudah berubah, request otomatis ditolak sebagai stale.</div>' : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="primary-btn" type="button" data-approval-acc="${esc(request.id)}">ACC + POSTING</button>
          <button class="secondary-btn" type="button" data-approval-reject="${esc(request.id)}">Reject</button>
        </div>
      </article>`).join('');
    target.querySelectorAll('[data-approval-acc]').forEach(button => button.addEventListener('click', () => decide(button.dataset.approvalAcc, 'ACC')));
    target.querySelectorAll('[data-approval-reject]').forEach(button => button.addEventListener('click', () => decide(button.dataset.approvalReject, 'REJECT')));
  }

  async function loadQueue() {
    const target = document.getElementById('managementApprovalList');
    if (!target) return;
    target.innerHTML = '<div class="muted">Memuat pengajuan...</div>';
    try {
      const payload = await managementApi('/api/management/approval-requests?status=pending_approval');
      renderQueue(target, payload.requests || []);
    } catch (error) {
      target.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
    }
  }

  async function decide(id, decision) {
    try {
      const payload = await managementApi(`/api/management/approval-requests/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ decision })
      });
      showMessage(payload.posted ? 'ACC berhasil · posting snapshot selesai.' : 'Pengajuan ditolak tanpa posting.');
      await loadQueue();
    } catch (error) {
      if (error.payload?.code === 'STOCK_ADJUSTMENT_STALE') {
        alert(`${error.message}\n\nRequest sudah ditolak otomatis. Buat Penyesuaian Stok baru dari saldo terbaru.`);
        await loadQueue();
        return;
      }
      alert(error.message);
    }
  }

  // Assigned via textContent below, not innerHTML -- no esc() needed here.
  function autoPermitStatusText(settings) {
    const who = settings.enabledByRole ? `${settings.enabledByRole} (${settings.enabledById})` : null;
    if (!settings.autoPermitEnabled) {
      return who ? `Nonaktif. Terakhir dinyalakan oleh ${who} pada ${settings.enabledAt || '-'}.` : 'Nonaktif.';
    }
    return who
      ? `AKTIF -- dinyalakan oleh ${who} pada ${settings.enabledAt || '-'}. Pengajuan baru gerai ini langsung ACC otomatis.`
      : 'AKTIF. Pengajuan baru gerai ini langsung ACC otomatis.';
  }

  async function toggleAutoPermit(currentlyEnabled) {
    if (!currentlyEnabled && !confirm('Auto Permit akan langsung meng-ACC semua pengajuan baru gerai ini tanpa direview manual. Kalau ada masalah, itu tanggung jawab akun yang mengaktifkan. Lanjutkan?')) return;
    try {
      await managementApi('/api/management/approval-settings', { method: 'PATCH', body: JSON.stringify({ enabled: !currentlyEnabled }) });
      showMessage(!currentlyEnabled ? 'Auto Permit dinyalakan.' : 'Auto Permit dimatikan.');
      await loadAutoPermit();
    } catch (error) {
      alert(error.message);
    }
  }

  async function loadAutoPermit() {
    const statusNode = document.getElementById('autoPermitStatus');
    const toggleBtn = document.getElementById('autoPermitToggle');
    if (!statusNode || !toggleBtn) return;
    try {
      const payload = await managementApi('/api/management/approval-settings');
      const settings = payload.settings;
      statusNode.textContent = autoPermitStatusText(settings);
      toggleBtn.textContent = settings.autoPermitEnabled ? 'Matikan Auto Permit' : 'Nyalakan Auto Permit';
      toggleBtn.disabled = false;
      toggleBtn.onclick = () => toggleAutoPermit(settings.autoPermitEnabled);
    } catch (error) {
      statusNode.textContent = error.message;
    }
  }

  function mountBranchAdmin() {
    const tabs = document.querySelector('.admin-tabs');
    const app = document.getElementById('adminApp');
    const toast = document.getElementById('adminToast');
    if (!tabs || !app || !toast || document.getElementById('tab-approvals')) return;
    tabs.insertAdjacentHTML('beforeend', '<button class="admin-tab" data-tab="approvals" type="button">Approval Queue</button>');
    toast.insertAdjacentHTML('beforebegin', `
      <section id="tab-approvals" class="admin-section">
        <div class="admin-card">
          <div class="list-head"><div><h2>Auto Permit</h2><div class="muted">Kalau nyala, pengajuan baru gerai ini (Arus Kas, Arus Barang, Penyesuaian Stok, Aset) langsung di-ACC otomatis tanpa direview manual.</div></div></div>
          <div id="autoPermitStatus" class="muted" style="margin-top:10px">Memuat status...</div>
          <button id="autoPermitToggle" class="secondary-btn" type="button" style="margin-top:10px" disabled>Memuat...</button>
        </div>
        <div class="admin-card" style="margin-top:14px">
          <div class="list-head"><div><h2>Approval Queue</h2><div class="muted">Arus Kas, Arus Barang, Penyesuaian Stok, dan Aset dari kasir. ACC mengeksekusi posting snapshot secara atomic sesuai contract aktif.</div></div><button id="managementApprovalRefresh" class="secondary-btn" type="button">↻ Refresh</button></div>
          <div id="managementApprovalList" class="master-list" style="margin-top:14px"></div>
        </div>
      </section>`);
    const tabButton = tabs.querySelector('[data-tab="approvals"]');
    tabButton?.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(item => item.classList.toggle('active', item === tabButton));
      document.querySelectorAll('.admin-section').forEach(section => section.classList.toggle('active', section.id === 'tab-approvals'));
      loadQueue();
      loadAutoPermit();
    });
    document.getElementById('managementApprovalRefresh')?.addEventListener('click', loadQueue);
  }

  function mountOwner() {
    const app = document.getElementById('ownerApp');
    if (!app || document.getElementById('ownerApprovalQueue')) return;
    app.insertAdjacentHTML('beforeend', `
      <section id="ownerApprovalQueue" class="admin-card" style="margin-top:18px">
        <div class="list-head"><div><h2>Approval Queue</h2><div class="muted">Owner dapat mereview pending approval seluruh gerai. Penyesuaian Stok memakai snapshot dan stale guard sebelum posting.</div></div><button id="managementApprovalRefresh" class="secondary-btn" type="button">↻ Refresh</button></div>
        <div id="managementApprovalList" class="master-list" style="margin-top:14px"></div>
      </section>`);
    document.getElementById('managementApprovalRefresh')?.addEventListener('click', loadQueue);
  }

  if (isBranchAdmin) mountBranchAdmin();
  else mountOwner();
})();
