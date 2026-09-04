(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
  const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const dt = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '-';
  const labels = { SALE: 'Penjualan', PURCHASE: 'Pembelian', EXPENSE: 'Operasional' };
  const isBranchAdmin = Boolean(document.getElementById('adminApp'));
  const storeCode = String(window.LEKER_STORE_CODE || sessionStorage.getItem('lekerAdminStoreCode') || '').toUpperCase();
  function authToken() { return sessionStorage.getItem('lekerOwnerToken') || sessionStorage.getItem('lekerEntityAdminToken') || sessionStorage.getItem('lekerAdminToken') || ''; }
  function scoped(path) {
    if (!isBranchAdmin || !storeCode) return path;
    const url = new URL(path, location.origin); url.searchParams.set('store', storeCode); return `${url.pathname}${url.search}`;
  }
  async function api(path, options = {}) {
    const token = authToken(); if (!token) throw new Error('Session management tidak tersedia.');
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(scoped(path), { cache: 'no-store', ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request gagal (${response.status})`);
    return payload;
  }
  function notify(message) {
    if (typeof ownerToast === 'function') return ownerToast(message);
    const node = document.getElementById('adminToast'); if (!node) return;
    node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 3000);
  }
  function statusText(item) {
    const parts = [item.approvalStatus || '-'];
    if (item.approvalStatus === 'approved') parts.push(item.executionStatus || 'NOT_ATTEMPTED');
    if (item.executionStatus === 'EXECUTED') parts.push(item.accountingStatus || 'NOT_REQUIRED');
    return parts.join(' · ');
  }
  function permitCard(item) {
    const subject = item.subject || {};
    const pending = item.approvalStatus === 'pending_approval';
    const actions = pending ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="primary-btn" type="button" data-void-permit-acc="${esc(item.id)}">ACC PERMIT</button><button class="secondary-btn" type="button" data-void-permit-reject="${esc(item.id)}">Reject</button></div>` : '';
    return `<article class="admin-card" style="box-shadow:none;margin-bottom:10px">
      <div class="list-head"><div><strong>PERMIT HAPUS · ${esc(labels[item.subjectType] || item.subjectType)}</strong><div class="muted">${esc(item.cashierName || item.cashierId)} · ${dt(item.requestedAt)}</div></div><span class="master-count">${esc(statusText(item))}</span></div>
      <p><b>${esc(subject.description || item.subjectId)}</b> · ${money(subject.amount)}</p>
      <div class="muted">Ref ${esc(item.subjectId)} · ${esc(subject.paymentMethod || '')}</div>
      <div class="admin-tip" style="margin-top:9px"><b>Alasan kasir:</b> ${esc(item.reason)}</div>
      <div class="muted" style="margin-top:8px">Soft-delete + correction auditable; history sumber tetap ada.</div>
      ${item.executionCode ? `<div class="muted"><b>Execution code:</b> ${esc(item.executionCode)}</div>` : ''}
      ${item.executionDetail ? `<div class="muted"><b>Execution:</b> ${esc(item.executionDetail)}</div>` : ''}
      ${item.originalJournalId ? `<div class="muted"><b>Jurnal sumber:</b> ${esc(item.originalJournalId)}</div>` : ''}
      ${item.reversalJournalId ? `<div class="muted"><b>Jurnal pembalik:</b> ${esc(item.reversalJournalId)}</div>` : ''}
      ${item.decisionNote ? `<div class="muted"><b>Catatan Admin:</b> ${esc(item.decisionNote)}</div>` : ''}
      ${actions}
    </article>`;
  }
  function render(target, permits) {
    target.innerHTML = permits.length ? permits.map(permitCard).join('') : '<div class="empty">Belum ada permit hapus transaksi.</div>';
    target.querySelectorAll('[data-void-permit-acc]').forEach(button => button.addEventListener('click', () => decide(button.dataset.voidPermitAcc, 'ACC')));
    target.querySelectorAll('[data-void-permit-reject]').forEach(button => button.addEventListener('click', () => decide(button.dataset.voidPermitReject, 'REJECT')));
  }
  function badge(count) {
    const tab = document.querySelector('[data-tab="approvals"]'); if (!tab) return;
    let node = document.getElementById('voidPermitPendingBadge');
    if (!node) { tab.insertAdjacentHTML('beforeend', ' <span id="voidPermitPendingBadge" class="master-count" style="margin-left:6px">0</span>'); node = document.getElementById('voidPermitPendingBadge'); }
    node.textContent = String(count); node.title = 'Pending permit hapus transaksi';
  }
  async function load() {
    const target = document.getElementById('managementVoidPermitList'); if (!target) return;
    target.innerHTML = '<div class="muted">Memuat permit...</div>';
    try {
      const payload = await api('/api/management/transaction-void-permits?status=all');
      const permits = payload.permits || [];
      render(target, permits.slice(0, 60)); badge(Number(payload.summary?.pending || 0));
    } catch (error) { target.innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
  }
  async function decide(id, decision) {
    try {
      const payload = await api(`/api/management/transaction-void-permits/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ decision }) });
      if (payload.executionHold) notify(`Permit ACC · execution HOLD · ${payload.permit?.executionCode || ''}`);
      else if (payload.accounting?.ok === false) notify('Correction operational selesai · jurnal pembalik perlu recovery.');
      else notify(decision === 'REJECT' ? 'Permit ditolak.' : 'Permit ACC dan correction diproses.');
      await load();
    } catch (error) { alert(error.message); }
  }
  function mountBranch() {
    const section = document.getElementById('tab-approvals'); if (!section || document.getElementById('managementVoidPermitCard')) return false;
    section.insertAdjacentHTML('beforeend', `<div id="managementVoidPermitCard" class="admin-card" style="margin-top:14px"><div class="list-head"><div><h2>Permit Hapus Transaksi</h2><div class="muted">Notification, ACC/Reject, execution status, dan jurnal pembalik berada di Approval Queue yang sama.</div></div><button id="managementVoidPermitRefresh" class="secondary-btn" type="button">↻ Refresh</button></div><div id="managementVoidPermitList" class="master-list" style="margin-top:14px"></div></div>`);
    document.getElementById('managementVoidPermitRefresh')?.addEventListener('click', load);
    document.querySelector('[data-tab="approvals"]')?.addEventListener('click', () => setTimeout(load, 0)); load(); return true;
  }
  function mountOwner() {
    const section = document.getElementById('ownerApprovalQueue'); if (!section || document.getElementById('managementVoidPermitCard')) return false;
    section.insertAdjacentHTML('beforeend', `<div id="managementVoidPermitCard" style="margin-top:18px;border-top:1px solid #eee;padding-top:16px"><div class="list-head"><div><h3>Permit Hapus Transaksi</h3><div class="muted">Owner melihat lifecycle permit dan ACC/Reject sesuai gerai.</div></div><button id="managementVoidPermitRefresh" class="secondary-btn" type="button">↻ Refresh</button></div><div id="managementVoidPermitList" class="master-list" style="margin-top:12px"></div></div>`);
    document.getElementById('managementVoidPermitRefresh')?.addEventListener('click', load); load(); return true;
  }
  let tries = 0;
  const timer = setInterval(() => { tries += 1; const done = isBranchAdmin ? mountBranch() : mountOwner(); if (done || tries > 50) clearInterval(timer); }, 100);
})();
